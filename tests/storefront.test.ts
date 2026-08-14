import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  SKIN_LEVEL_ITEM_TYPE_ID,
  UnknownSkinLevelsError,
} from "@/src/lib/catalog/resolve-skin-uuids";
import { resolveStorefrontSkinUuidsWithClient } from "@/src/lib/storefront/resolve";
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

type SkinLevelRow = {
  level_uuid: string;
  skin_uuid: string;
};

function resolverClient(rows: readonly SkinLevelRow[]) {
  const inFilter = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ in: inFilter }));
  const from = vi.fn(() => ({ select }));

  return {
    inFilter,
    supabase: { from } as unknown as SupabaseClient<Database>,
  };
}

describe("storefront payload boundary", () => {
  it("parses the real non-Night-Market storefront and ignores plugin data", () => {
    const storefront = parseStorefrontPayload(fixture);

    expect(storefront).not.toHaveProperty("BonusStore");
    expect(storefront).not.toHaveProperty("PluginStores");
    expect(storefront.SkinsPanelLayout.SingleItemStoreOffers).toHaveLength(4);
  });

  it("extracts normalized SkinLevel UUIDs from reward ItemIDs", () => {
    const storefront = parseStorefrontPayload(fixture);
    const rewardLevelUuids = storefront.SkinsPanelLayout.SingleItemStoreOffers.flatMap(
      (offer) => offer.Rewards.map((reward) => reward.ItemID),
    );

    expect(
      storefront.SkinsPanelLayout.SingleItemStoreOffers.flatMap((offer) =>
        offer.Rewards.map((reward) => reward.ItemTypeID),
      ),
    ).toEqual(rewardLevelUuids.map(() => SKIN_LEVEL_ITEM_TYPE_ID));
    expect(extractStorefrontSkinLevelUuids(fixture)).toEqual([
      ...new Set(rewardLevelUuids.map((uuid) => uuid.toLowerCase())),
    ]);
  });

  it("keeps prices keyed by each offer's own currency", () => {
    const storefront = parseStorefrontPayload(fixture);
    const dailyCurrencies = Object.keys(
      storefront.SkinsPanelLayout.SingleItemStoreOffers[0].Cost,
    );
    const accessoryCurrencies = Object.keys(
      storefront.AccessoryStore.AccessoryStoreOffers[0].Offer.Cost,
    );

    expect(dailyCurrencies).toHaveLength(1);
    expect(accessoryCurrencies).toHaveLength(1);
    expect(accessoryCurrencies).not.toEqual(dailyCurrencies);
  });
});

describe("storefront resolver handoff", () => {
  it("passes real fixture reward levels through the catalog resolver", async () => {
    const levelUuids = extractStorefrontSkinLevelUuids(fixture);
    const rows = levelUuids.map((level_uuid) => ({
      level_uuid,
      skin_uuid: randomUUID(),
    }));
    const { inFilter, supabase } = resolverClient(rows);

    await expect(
      resolveStorefrontSkinUuidsWithClient(supabase, fixture),
    ).resolves.toEqual(rows.map(({ skin_uuid }) => skin_uuid));
    expect(inFilter).toHaveBeenCalledWith("level_uuid", levelUuids);
  });

  it("fails explicitly when a real fixture level is unmapped", async () => {
    const levelUuids = extractStorefrontSkinLevelUuids(fixture);
    const unmappedLevelUuid = levelUuids.at(-1);
    const mappedRows = levelUuids.slice(0, -1).map((level_uuid) => ({
      level_uuid,
      skin_uuid: randomUUID(),
    }));
    const { supabase } = resolverClient(mappedRows);

    expect(unmappedLevelUuid).toBeDefined();

    try {
      await resolveStorefrontSkinUuidsWithClient(supabase, fixture);
      expect.unreachable("The storefront resolver must surface a stale catalog.");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownSkinLevelsError);
      expect((error as UnknownSkinLevelsError).unknownLevelUuids).toEqual([
        unmappedLevelUuid,
      ]);
    }
  });
});
