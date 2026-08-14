import { z } from "zod";

import { SKIN_LEVEL_ITEM_TYPE_ID } from "@/src/lib/catalog/resolve-skin-uuids";

// Riot UUIDs fit Postgres' uuid type but do not consistently set RFC version bits.
const riotUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid Riot UUID",
  )
  .transform((uuid) => uuid.toLowerCase());

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const nonnegativeNumberSchema = z.number().nonnegative();
const priceByCurrencySchema = z.record(
  riotUuidSchema,
  nonnegativeIntegerSchema,
);

const rewardSchema = z.object({
  ItemID: riotUuidSchema,
  ItemTypeID: riotUuidSchema,
  Quantity: z.number().int().positive(),
});

const offerSchema = z.object({
  Cost: priceByCurrencySchema,
  IsDirectPurchase: z.boolean(),
  OfferID: riotUuidSchema,
  Rewards: z.array(rewardSchema).min(1),
  StartDate: z.string().min(1),
});

const skinLevelRewardSchema = rewardSchema.extend({
  ItemTypeID: riotUuidSchema.pipe(z.literal(SKIN_LEVEL_ITEM_TYPE_ID)),
});

const dailySkinOfferSchema = offerSchema.extend({
  Rewards: z.array(skinLevelRewardSchema).min(1),
});

const bundleItemSchema = z.object({
  BasePrice: nonnegativeIntegerSchema,
  CurrencyID: riotUuidSchema,
  DiscountedPrice: nonnegativeIntegerSchema,
  DiscountPercent: nonnegativeNumberSchema,
  IsPromoItem: z.boolean(),
  Item: z.object({
    Amount: z.number().int().positive(),
    ItemID: riotUuidSchema,
    ItemTypeID: riotUuidSchema,
  }),
});

const bundleSchema = z.object({
  CurrencyID: riotUuidSchema,
  DataAssetID: riotUuidSchema,
  DurationRemainingInSeconds: nonnegativeIntegerSchema,
  ID: riotUuidSchema,
  ItemOffers: z.array(
    z.object({
      BundleItemOfferID: riotUuidSchema,
      DiscountedCost: priceByCurrencySchema,
      DiscountPercent: nonnegativeNumberSchema,
      Offer: offerSchema,
    }),
  ),
  Items: z.array(bundleItemSchema),
  TotalBaseCost: priceByCurrencySchema,
  TotalDiscountedCost: priceByCurrencySchema,
  TotalDiscountPercent: nonnegativeNumberSchema,
  WholesaleOnly: z.boolean(),
});

const featuredBundleSchema = z.object({
  Bundle: bundleSchema,
  BundleRemainingDurationInSeconds: nonnegativeIntegerSchema,
  Bundles: z.array(bundleSchema),
  FeaturedTileEntries: z.array(
    z.object({
      Entry: z.object({ Bundle: bundleSchema }),
      Type: nonnegativeIntegerSchema,
    }),
  ),
});

const skinsPanelLayoutSchema = z.object({
  SingleItemOffers: z.array(riotUuidSchema),
  SingleItemOffersRemainingDurationInSeconds: nonnegativeIntegerSchema,
  SingleItemStoreOffers: z.array(dailySkinOfferSchema),
});

const upgradeCurrencyStoreSchema = z.object({
  UpgradeCurrencyOffers: z.array(
    z.object({
      DiscountedPercent: nonnegativeNumberSchema,
      Offer: offerSchema,
      OfferID: riotUuidSchema,
      StorefrontItemID: riotUuidSchema,
    }),
  ),
});

const accessoryStoreSchema = z.object({
  AccessoryStoreOffers: z.array(
    z.object({
      ContractID: riotUuidSchema,
      Offer: offerSchema,
    }),
  ),
  AccessoryStoreRemainingDurationInSeconds: nonnegativeIntegerSchema,
  StorefrontID: riotUuidSchema,
});

const presentBonusStoreSchema = z.unknown().refine(
  (bonusStore) => bonusStore !== null,
  "BonusStore must be omitted rather than null",
);

export const storefrontSchema = z.object({
  AccessoryStore: accessoryStoreSchema,
  BonusStore: presentBonusStoreSchema.optional(),
  FeaturedBundle: featuredBundleSchema,
  SkinsPanelLayout: skinsPanelLayoutSchema,
  UpgradeCurrencyStore: upgradeCurrencyStoreSchema,
});

export type StorefrontPayload = z.infer<typeof storefrontSchema>;

export function parseStorefrontPayload(payload: unknown): StorefrontPayload {
  return storefrontSchema.parse(payload);
}

export function extractStorefrontSkinLevelUuids(payload: unknown): string[] {
  const storefront = parseStorefrontPayload(payload);
  const uniqueLevelUuids = new Set<string>();

  for (const offer of storefront.SkinsPanelLayout.SingleItemStoreOffers) {
    for (const reward of offer.Rewards) {
      uniqueLevelUuids.add(reward.ItemID);
    }
  }

  return [...uniqueLevelUuids];
}
