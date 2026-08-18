import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedSkinLevel } from "@/src/lib/catalog/resolve-skin-uuids";
import { renderStorefrontMatchEmail } from "@/src/lib/notifications/storefront-match";
import type { FetchedStorefront } from "@/src/lib/riot/adapter";
import {
  canonicalizeStorefront,
  createStorefrontRefreshSnapshot,
} from "@/src/lib/storefront/canonicalize";
import { planStorefrontNotificationsWithClient } from "@/src/lib/storefront/pipeline";
import {
  extractStorefrontSkinLevelUuids,
  parseStorefrontPayload,
} from "@/src/lib/storefront/schema";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

const fixturePath = path.join(
  process.cwd(),
  "fixtures",
  "storefront-real.json",
);
const fixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
const secondCurrencyUuid = "11111111-2222-3333-4444-555555555555";

type MutableFixture = {
  SkinsPanelLayout: {
    SingleItemStoreOffers: Array<{
      Cost: Record<string, number>;
      Rewards: unknown[];
    }>;
  };
};

type ResolverRow = {
  readonly level_uuid: string;
  readonly skin_uuid: string;
};

type WatchRow = {
  readonly skin_uuid: string;
  readonly user_id: string;
};

type SkinNameRow = {
  readonly display_name: string;
  readonly skin_uuid: string;
};

function fixtureSkinUuid(ordinal: number): string {
  return `10000000-0000-0000-0000-${ordinal.toString(16).padStart(12, "0")}`;
}

function createPipelineClient(options: {
  readonly resolverRows: readonly ResolverRow[];
  readonly skinRows: readonly SkinNameRow[];
  readonly watchRows: readonly WatchRow[];
}) {
  const levelIn = vi.fn(
    async (_column: string, values: readonly string[]) => ({
      data: options.resolverRows.filter((row) => values.includes(row.level_uuid)),
      error: null,
    }),
  );
  const skinIn = vi.fn(
    async (_column: string, values: readonly string[]) => ({
      data: options.skinRows.filter((row) => values.includes(row.skin_uuid)),
      error: null,
    }),
  );
  let scopedUserId: string | undefined;
  const watchEq = vi.fn((column: string, value: string) => {
    if (column === "user_id") {
      scopedUserId = value;
    }
    return watchQuery;
  });
  const watchOrder = vi.fn(() => watchQuery);
  const watchRange = vi.fn(async (from: number, to: number) => ({
    data: options.watchRows
      .filter((row) => row.user_id === scopedUserId)
      .slice(from, to + 1)
      .map(({ skin_uuid }) => ({ skin_uuid })),
    error: null,
  }));
  const watchSelect = vi.fn(() => watchQuery);
  const watchQuery: Record<string, unknown> = {
    eq: watchEq,
    order: watchOrder,
    range: watchRange,
    select: watchSelect,
  };
  const from = vi.fn((table: string) => {
    if (table === "skin_levels") {
      return { select: vi.fn(() => ({ in: levelIn })) };
    }
    if (table === "skins") {
      return { select: vi.fn(() => ({ in: skinIn })) };
    }
    if (table === "watchlist") {
      return watchQuery;
    }
    throw new Error(`Unexpected test table: ${table}`);
  });

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    levelIn,
    skinIn,
    watchEq,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storefront canonicalization", () => {
  it("creates a catalog-independent priced snapshot with the final shop hash", () => {
    const parsed = parseStorefrontPayload(fixture);
    const checkedAt = new Date("2026-08-14T00:05:00.000Z");
    const resolvedLevels: ResolvedSkinLevel[] =
      extractStorefrontSkinLevelUuids(parsed).map((levelUuid, ordinal) => ({
        levelUuid,
        skinUuid: fixtureSkinUuid(ordinal + 1),
      }));

    const snapshot = createStorefrontRefreshSnapshot(parsed, checkedAt);
    const enriched = canonicalizeStorefront(
      parsed,
      resolvedLevels,
      checkedAt,
    );

    expect(snapshot.shopHash).toBe(enriched.shopHash);
    expect(snapshot.skinUuids).toEqual([]);
    expect(snapshot.offers).toHaveLength(4);
    expect(snapshot.offers.every((offer) => offer.costs.length > 0)).toBe(true);
    expect(
      snapshot.offers.every((offer) =>
        offer.rewards.every((reward) => reward.skinUuid === null),
      ),
    ).toBe(true);
    expect(enriched.skinUuids).toHaveLength(resolvedLevels.length);
  });

  it("hashes stable offer data independently of source order and check time", () => {
    const firstRaw = structuredClone(fixture) as MutableFixture;
    firstRaw.SkinsPanelLayout.SingleItemStoreOffers[0].Cost[
      secondCurrencyUuid
    ] = 25;
    const secondRaw = structuredClone(firstRaw);
    secondRaw.SkinsPanelLayout.SingleItemStoreOffers.reverse();
    for (const offer of secondRaw.SkinsPanelLayout.SingleItemStoreOffers) {
      offer.Rewards.reverse();
      offer.Cost = Object.fromEntries(Object.entries(offer.Cost).reverse());
    }

    const firstPayload = parseStorefrontPayload(firstRaw);
    const secondPayload = parseStorefrontPayload(secondRaw);
    const resolvedLevels: ResolvedSkinLevel[] = [
      ...new Set(extractStorefrontSkinLevelUuids(firstPayload)),
    ].map((levelUuid, ordinal) => ({
      levelUuid,
      skinUuid: fixtureSkinUuid(ordinal + 1),
    }));
    const first = canonicalizeStorefront(
      firstPayload,
      resolvedLevels,
      new Date("2026-08-14T00:05:00.000Z"),
    );
    const second = canonicalizeStorefront(
      secondPayload,
      resolvedLevels.toReversed(),
      new Date("2026-08-14T00:25:00.000Z"),
    );

    expect(first.offers).toEqual(second.offers);
    expect(first.shopHash).toBe(second.shopHash);
    expect(first.shopHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.expiresAt).not.toBe(second.expiresAt);
    expect(first.storeDate).toBe("2026-08-14");
    expect(
      first.offers.find((offer) => offer.costs.length === 2)?.costs,
    ).toEqual(
      first.offers
        .find((offer) => offer.costs.length === 2)
        ?.costs.toSorted((left, right) =>
          left.currencyUuid.localeCompare(right.currencyUuid),
        ),
    );
  });
});

describe("offline storefront notification pipeline", () => {
  it("resolves, scopes, matches, deduplicates, and renders one email per skin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const parsedFixture = parseStorefrontPayload(fixture);
    const levelUuids = extractStorefrontSkinLevelUuids(parsedFixture);
    const skinUuids = levelUuids.map((_levelUuid, ordinal) =>
      fixtureSkinUuid(ordinal + 1),
    );
    const resolverRows = levelUuids.map((level_uuid, ordinal) => ({
      level_uuid,
      skin_uuid: skinUuids[ordinal],
    }));
    const userId = "22222222-2222-4222-8222-222222222222";
    const otherUserId = "33333333-3333-4333-8333-333333333333";
    const escapedName = `Mage's <Choice> & "Rare"\r\nEdition`;
    const { client, levelIn, skinIn, watchEq } = createPipelineClient({
      resolverRows,
      skinRows: skinUuids.map((skin_uuid, ordinal) => ({
        display_name: ordinal === 1 ? escapedName : `Fixture skin ${ordinal}`,
        skin_uuid,
      })),
      watchRows: [
        { skin_uuid: skinUuids[0], user_id: userId },
        { skin_uuid: skinUuids[1], user_id: userId },
        { skin_uuid: skinUuids[2], user_id: otherUserId },
      ],
    });
    const storefront: FetchedStorefront = { levelUuids, payload: fixture };

    const result = await planStorefrontNotificationsWithClient(client, {
      checkedAt: new Date("2026-08-14T00:05:00.000Z"),
      sentNotifications: [
        { skinUuid: skinUuids[0], storeDate: "2026-08-14" },
        { skinUuid: skinUuids[1], storeDate: "2026-08-13" },
      ],
      storefront,
      userId,
    });

    expect(result.matches.map(({ skinUuid }) => skinUuid)).toEqual(
      skinUuids.slice(0, 2),
    );
    expect(result.decision.duplicates.map(({ skinUuid }) => skinUuid)).toEqual([
      skinUuids[0],
    ]);
    expect(result.decision.toSend.map(({ skinUuid }) => skinUuid)).toEqual([
      skinUuids[1],
    ]);
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].skinUuid).toBe(skinUuids[1]);
    expect(result.emails[0].email.subject).toBe(
      `Mage's <Choice> & "Rare" Edition is in your store!`,
    );
    expect(result.emails[0].email.subject).not.toMatch(/[\r\n]/);
    expect(result.emails[0].email.html).toContain(
      "Mage&#39;s &lt;Choice&gt; &amp; &quot;Rare&quot;",
    );
    expect(result.emails[0].email.html).not.toContain("<Choice>");

    const matchingOffer =
      parsedFixture.SkinsPanelLayout.SingleItemStoreOffers.find((offer) =>
        offer.Rewards.some((reward) => reward.ItemID === levelUuids[1]),
      )!;
    for (const [currencyUuid, amount] of Object.entries(matchingOffer.Cost)) {
      // Currency uuids are no longer rendered; the VP amount is.
      expect(result.emails[0].email.html).not.toContain(currencyUuid);
      // Rendered with a thousands separator for readability.
      expect(result.emails[0].email.html).toContain(
        amount.toLocaleString("en-US"),
      );
    }

    expect(result.canonicalStorefront.shopHash).toMatch(/^[0-9a-f]{64}$/);
    expect(watchEq).toHaveBeenCalledWith("user_id", userId);
    expect(levelIn).toHaveBeenCalledWith("level_uuid", levelUuids);
    expect(skinIn).toHaveBeenCalledWith("skin_uuid", [skinUuids[1]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      renderStorefrontMatchEmail({
        displayName: escapedName,
        expiresAt: result.canonicalStorefront.expiresAt,
        // The fixture catalog rows carry no artwork.
        imageUrl: null,
        match: result.decision.toSend[0],
        priceVp: Object.values(matchingOffer.Cost)[0] ?? null,
      }),
    ).toEqual(result.emails[0].email);
  });

  it("does not load email catalog data when every match is a same-day duplicate", async () => {
    const levelUuids = extractStorefrontSkinLevelUuids(fixture);
    const skinUuids = levelUuids.map((_levelUuid, ordinal) =>
      fixtureSkinUuid(ordinal + 1),
    );
    const userId = "22222222-2222-4222-8222-222222222222";
    const { client, skinIn } = createPipelineClient({
      resolverRows: levelUuids.map((level_uuid, ordinal) => ({
        level_uuid,
        skin_uuid: skinUuids[ordinal],
      })),
      skinRows: [],
      watchRows: [{ skin_uuid: skinUuids[0], user_id: userId }],
    });

    const result = await planStorefrontNotificationsWithClient(client, {
      checkedAt: new Date("2026-08-14T00:05:00.000Z"),
      sentNotifications: [
        { skinUuid: skinUuids[0], storeDate: "2026-08-14" },
      ],
      storefront: { levelUuids, payload: fixture },
      userId,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.decision.toSend).toEqual([]);
    expect(result.emails).toEqual([]);
    expect(skinIn).not.toHaveBeenCalled();
  });
});
