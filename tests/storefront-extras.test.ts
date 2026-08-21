import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createStorefrontRefreshSnapshot } from "@/src/lib/storefront/canonicalize";
import {
  extractNightMarketSkinLevelUuids,
  parseNightMarketPayload,
  parseStorefrontPayload,
} from "@/src/lib/storefront/schema";

vi.mock("server-only", () => ({}));

const CHECKED_AT = new Date("2026-08-20T00:05:00.000Z");
const SKIN_LEVEL_ITEM_TYPE_ID = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
const VP = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";

function realStorefront(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL("../fixtures/storefront-real.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

function bonusStore(offerCount = 2) {
  return {
    BonusStoreOffers: Array.from({ length: offerCount }, (_, index) => ({
      BonusOfferID: `0000000${index}-0000-0000-0000-00000000000${index}`,
      DiscountCosts: { [VP]: 875 },
      // Riot sends the night market discount as a whole percent, unlike the
      // bundle's fractional TotalDiscountPercent.
      DiscountPercent: 47,
      IsSeen: false,
      Offer: {
        Cost: { [VP]: 1775 },
        IsDirectPurchase: true,
        OfferID: `1111111${index}-1111-1111-1111-11111111111${index}`,
        Rewards: [
          {
            ItemID: `2222222${index}-2222-2222-2222-22222222222${index}`,
            ItemTypeID: SKIN_LEVEL_ITEM_TYPE_ID,
            Quantity: 1,
          },
        ],
        StartDate: "2026-08-20T00:00:00Z",
      },
    })),
    BonusStoreRemainingDurationInSeconds: 3_600,
  };
}

describe("featured bundle snapshot", () => {
  it("captures the bundle from a real storefront", () => {
    const snapshot = createStorefrontRefreshSnapshot(
      parseStorefrontPayload(realStorefront()),
      CHECKED_AT,
    );

    expect(snapshot.bundle).not.toBeNull();
    expect(snapshot.bundle?.bundleUuid).toBe(
      "4d368017-4f98-1e89-dbec-31abd2533eb9",
    );
    expect(snapshot.bundle?.items).toHaveLength(6);
    expect(snapshot.bundle?.totalBaseCost).toBe(9775);
    expect(snapshot.bundle?.totalDiscountedCost).toBe(6700);
    expect(snapshot.bundle?.totalDiscountPercent).toBeCloseTo(0.315);
  });

  it("prices bundle items and keeps their skin-level ids for resolution", () => {
    const snapshot = createStorefrontRefreshSnapshot(
      parseStorefrontPayload(realStorefront()),
      CHECKED_AT,
    );
    const skinItems = (snapshot.bundle?.items ?? []).filter(
      (item) => item.itemTypeUuid === SKIN_LEVEL_ITEM_TYPE_ID,
    );

    expect(skinItems.length).toBeGreaterThan(0);
    for (const item of skinItems) {
      expect(item.discountedPrice).toBeLessThanOrEqual(item.basePrice);
    }
  });
});

describe("night market snapshot", () => {
  it("captures a running night market", () => {
    const payload = { ...realStorefront(), BonusStore: bonusStore() };
    const snapshot = createStorefrontRefreshSnapshot(
      parseStorefrontPayload(payload),
      CHECKED_AT,
    );

    expect(snapshot.nightMarket?.offers).toHaveLength(2);
    expect(snapshot.nightMarket?.expiresAt).toBe("2026-08-20T01:05:00.000Z");
    const [offer] = snapshot.nightMarket?.offers ?? [];
    expect(offer?.basePrice).toBe(1775);
    expect(offer?.discountedPrice).toBe(875);
    expect(offer?.discountPercent).toBe(47);
    expect(offer?.levelUuid).toMatch(/^2222222\d-/);
  });

  it("is null when Riot is not running one", () => {
    const snapshot = createStorefrontRefreshSnapshot(
      parseStorefrontPayload(realStorefront()),
      CHECKED_AT,
    );

    expect(snapshot.nightMarket).toBeNull();
  });

  it("exposes its skin levels for catalog resolution", () => {
    const payload = { ...realStorefront(), BonusStore: bonusStore(3) };

    expect(extractNightMarketSkinLevelUuids(payload)).toHaveLength(3);
  });

  it("degrades to null instead of failing the storefront on an unknown shape", () => {
    // The night market shape was written from documentation, never observed
    // live. A wrong guess must cost the panel, not the daily check.
    const payload = {
      ...realStorefront(),
      BonusStore: { Unexpected: "shape", BonusStoreOffers: "not-an-array" },
    };

    expect(() => parseStorefrontPayload(payload)).not.toThrow();
    expect(parseNightMarketPayload(payload)).toBeNull();
    expect(
      createStorefrontRefreshSnapshot(parseStorefrontPayload(payload), CHECKED_AT)
        .nightMarket,
    ).toBeNull();
  });

  it("never lets a night market change the shop identity", () => {
    const withoutMarket = createStorefrontRefreshSnapshot(
      parseStorefrontPayload(realStorefront()),
      CHECKED_AT,
    );
    const withMarket = createStorefrontRefreshSnapshot(
      parseStorefrontPayload({ ...realStorefront(), BonusStore: bonusStore() }),
      CHECKED_AT,
    );

    expect(withMarket.shopHash).toBe(withoutMarket.shopHash);
  });
});

describe("night market visibility", () => {
  it("is dropped once Riot has closed it", async () => {
    // The stored check outlives the market: yesterday's row keeps its
    // BonusStore, so an expired one must not keep rendering.
    const { loadDailyShops } = await import("@/src/lib/storefront/daily-shop");
    const now = new Date("2026-08-20T12:00:00.000Z");
    const closed = {
      expiresAt: "2026-08-19T00:00:00.000Z",
      offers: [{ basePrice: 1775, discountPercent: 47, discountedPrice: 940, levelUuid: null, offerId: "o" }],
    };
    const running = { ...closed, expiresAt: "2026-08-21T00:00:00.000Z" };

    for (const [nightMarket, expected] of [
      [closed, null],
      [running, "shown"],
    ] as const) {
      const supabase = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              order: () => ({ data: [{ id: "c1", label: "A" }], error: null }),
            }),
            in: () =>
              table === "shop_checks"
                ? {
                    order: () => ({
                      data: [
                        {
                          bundle: null,
                          checked_at: "2026-08-20T00:05:00.000Z",
                          connection_id: "c1",
                          expires_at: "2026-08-21T00:00:00.000Z",
                          night_market: nightMarket,
                          offer_details: [],
                          offer_skin_uuids: [],
                          rotation_date: "2026-08-20",
                        },
                      ],
                      error: null,
                    }),
                  }
                : { data: [], error: null },
          }),
        }),
      };

      const [view] = await loadDailyShops(
        supabase as never,
        "user-id",
        now,
      );
      expect(view?.nightMarket === null ? null : "shown").toBe(expected);
    }
  });
});
