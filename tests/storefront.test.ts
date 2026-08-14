import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { SKIN_LEVEL_ITEM_TYPE_ID } from "@/src/lib/catalog/resolve-skin-uuids";
import {
  extractStorefrontSkinLevelUuids,
  parseStorefrontPayload,
} from "@/src/lib/storefront/schema";

vi.mock("server-only", () => ({}));

const fixturePath = path.join(
  process.cwd(),
  "fixtures",
  "storefront-real.json",
);
const fixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));

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
