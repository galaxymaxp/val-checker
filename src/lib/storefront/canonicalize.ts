import { createHash } from "node:crypto";

import { SKIN_LEVEL_ITEM_TYPE_ID } from "@/src/lib/catalog/resolve-skin-uuids";
import type { ResolvedSkinLevel } from "@/src/lib/catalog/resolve-skin-uuids";
import {
  parseNightMarketPayload,
  type StorefrontPayload,
} from "@/src/lib/storefront/schema";

/** Valorant Points. Totals prefer it and fall back to the first currency. */
const VP_CURRENCY_UUID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";

export interface CanonicalStorefrontCost {
  readonly amount: number;
  readonly currencyUuid: string;
}

export interface CanonicalStorefrontReward {
  readonly levelUuid: string;
  readonly quantity: number;
  readonly skinUuid: string;
}

export interface StorefrontSnapshotReward {
  readonly levelUuid: string;
  readonly quantity: number;
  readonly skinUuid: string | null;
}

export interface CanonicalStorefrontOffer {
  readonly costs: readonly CanonicalStorefrontCost[];
  readonly offerId: string;
  readonly rewards: readonly CanonicalStorefrontReward[];
}

export interface StorefrontSnapshotOffer {
  readonly costs: readonly CanonicalStorefrontCost[];
  readonly offerId: string;
  readonly rewards: readonly StorefrontSnapshotReward[];
}

export interface StorefrontBundleItem {
  readonly amount: number;
  readonly basePrice: number;
  readonly discountedPrice: number;
  readonly itemTypeUuid: string;
  readonly itemUuid: string;
}

/**
 * The featured bundle, kept catalog-independent like the daily offers. The
 * bundle's own name and artwork live behind `bundleUuid` (Riot's DataAssetID)
 * and are resolved when the dashboard reads this back, not while the worker is
 * holding a storefront claim.
 */
export interface StorefrontBundleSnapshot {
  readonly bundleUuid: string;
  readonly expiresAt: string;
  readonly items: readonly StorefrontBundleItem[];
  readonly totalBaseCost: number | null;
  readonly totalDiscountedCost: number | null;
  readonly totalDiscountPercent: number;
}

export interface StorefrontNightMarketOffer {
  readonly basePrice: number | null;
  readonly discountPercent: number;
  readonly discountedPrice: number | null;
  readonly levelUuid: string | null;
  readonly offerId: string;
}

export interface StorefrontNightMarketSnapshot {
  readonly expiresAt: string;
  readonly offers: readonly StorefrontNightMarketOffer[];
}

export interface CanonicalStorefront {
  readonly bundle: StorefrontBundleSnapshot | null;
  readonly expiresAt: string;
  readonly nightMarket: StorefrontNightMarketSnapshot | null;
  readonly offers: readonly CanonicalStorefrontOffer[];
  readonly shopHash: string;
  readonly skinUuids: readonly string[];
  readonly storeDate: string;
}

/**
 * Catalog-independent representation persisted as soon as Riot returns a
 * schema-valid daily shop. Skin UUIDs are deliberately null until the catalog
 * enrichment phase; offer ids, level ids, quantities, and prices are already
 * sufficient to durably show that the refresh succeeded.
 */
export interface StorefrontRefreshSnapshot {
  readonly bundle: StorefrontBundleSnapshot | null;
  readonly expiresAt: string;
  readonly nightMarket: StorefrontNightMarketSnapshot | null;
  readonly offers: readonly StorefrontSnapshotOffer[];
  readonly shopHash: string;
  readonly skinUuids: readonly string[];
  readonly storeDate: string;
}

export type PersistableStorefront =
  | CanonicalStorefront
  | StorefrontRefreshSnapshot;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalOfferKey(offer: StorefrontSnapshotOffer): string {
  return JSON.stringify(offer);
}

function createSnapshotOffers(
  storefront: StorefrontPayload,
): StorefrontSnapshotOffer[] {
  const offers: StorefrontSnapshotOffer[] =
    storefront.SkinsPanelLayout.SingleItemStoreOffers.map((offer) => ({
      costs: Object.entries(offer.Cost)
        .map(([currencyUuid, amount]) => ({ amount, currencyUuid }))
        .sort((left, right) =>
          compareStrings(left.currencyUuid, right.currencyUuid),
        ),
      offerId: offer.OfferID,
      rewards: offer.Rewards.map((reward) => ({
        levelUuid: reward.ItemID,
        quantity: reward.Quantity,
        skinUuid: null,
      })).sort(
        (left, right) =>
          compareStrings(left.levelUuid, right.levelUuid) ||
          left.quantity - right.quantity,
      ),
    }));

  offers.sort(
    (left, right) =>
      compareStrings(left.offerId, right.offerId) ||
      compareStrings(canonicalOfferKey(left), canonicalOfferKey(right)),
  );
  return offers;
}

function storefrontTiming(storefront: StorefrontPayload, checkedAt: Date) {
  const checkedAtMs = checkedAt.getTime();
  if (!Number.isFinite(checkedAtMs)) {
    throw new RangeError("Storefront check time must be a valid date.");
  }

  const expiresAtMs =
    checkedAtMs +
    storefront.SkinsPanelLayout.SingleItemOffersRemainingDurationInSeconds *
      1_000;
  const expiresAt = new Date(expiresAtMs);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new RangeError("Storefront expiry is outside the supported date range.");
  }

  return {
    expiresAt: expiresAt.toISOString(),
    storeDate: checkedAt.toISOString().slice(0, 10),
  };
}

function preferredAmount(
  costs: Readonly<Record<string, number>> | undefined,
): number | null {
  if (!costs) {
    return null;
  }
  const vp = costs[VP_CURRENCY_UUID];
  if (typeof vp === "number") {
    return vp;
  }
  const first = Object.values(costs)[0];
  return typeof first === "number" ? first : null;
}

function expiryFromDuration(
  checkedAt: Date,
  remainingSeconds: number,
): string | null {
  const expiresAt = new Date(checkedAt.getTime() + remainingSeconds * 1_000);
  return Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null;
}

function createBundleSnapshot(
  storefront: StorefrontPayload,
  checkedAt: Date,
): StorefrontBundleSnapshot | null {
  const featured = storefront.FeaturedBundle.Bundle;
  const expiresAt = expiryFromDuration(
    checkedAt,
    storefront.FeaturedBundle.BundleRemainingDurationInSeconds ||
      featured.DurationRemainingInSeconds,
  );
  if (!expiresAt) {
    return null;
  }

  return {
    bundleUuid: featured.DataAssetID,
    expiresAt,
    items: featured.Items.map((item) => ({
      amount: item.Item.Amount,
      basePrice: item.BasePrice,
      discountedPrice: item.DiscountedPrice,
      itemTypeUuid: item.Item.ItemTypeID,
      itemUuid: item.Item.ItemID,
    })).sort((left, right) => compareStrings(left.itemUuid, right.itemUuid)),
    totalBaseCost: preferredAmount(featured.TotalBaseCost),
    totalDiscountedCost: preferredAmount(featured.TotalDiscountedCost),
    totalDiscountPercent: featured.TotalDiscountPercent,
  };
}

/**
 * Reads the night market from the raw payload, where it stays unmodelled. A
 * shape this code has never seen against a live response degrades to null
 * rather than costing an account its daily check.
 */
function createNightMarketSnapshot(
  storefront: StorefrontPayload,
  checkedAt: Date,
): StorefrontNightMarketSnapshot | null {
  const nightMarket = parseNightMarketPayload(storefront);
  if (!nightMarket) {
    return null;
  }

  const expiresAt = expiryFromDuration(
    checkedAt,
    nightMarket.BonusStoreRemainingDurationInSeconds,
  );
  if (!expiresAt) {
    return null;
  }

  return {
    expiresAt,
    offers: nightMarket.BonusStoreOffers.map((bonus) => ({
      basePrice: preferredAmount(bonus.Offer.Cost),
      discountPercent: bonus.DiscountPercent,
      discountedPrice: preferredAmount(bonus.DiscountCosts),
      levelUuid:
        bonus.Offer.Rewards.find(
          (reward) => reward.ItemTypeID === SKIN_LEVEL_ITEM_TYPE_ID,
        )?.ItemID ?? null,
      offerId: bonus.Offer.OfferID,
    })).sort((left, right) => compareStrings(left.offerId, right.offerId)),
  };
}

export function createStorefrontRefreshSnapshot(
  storefront: StorefrontPayload,
  checkedAt: Date,
): StorefrontRefreshSnapshot {
  const offers = createSnapshotOffers(storefront);
  const timing = storefrontTiming(storefront, checkedAt);

  return {
    ...timing,
    bundle: createBundleSnapshot(storefront, checkedAt),
    nightMarket: createNightMarketSnapshot(storefront, checkedAt),
    offers,
    // Hashed over the daily offers alone: a bundle or night market countdown
    // must not make the same rotation look like a different shop.
    shopHash: createHash("sha256")
      .update(JSON.stringify(offers))
      .digest("hex"),
    skinUuids: [],
  };
}

/**
 * Produces a stable daily-offer representation. Rotation timing is useful to
 * callers but deliberately excluded from shopHash so a retry cannot create a
 * different shop merely because the remaining-duration counter changed.
 */
export function canonicalizeStorefront(
  storefront: StorefrontPayload,
  resolvedLevels: readonly ResolvedSkinLevel[],
  checkedAt: Date,
): CanonicalStorefront {
  const snapshot = createStorefrontRefreshSnapshot(storefront, checkedAt);

  const skinByLevel = new Map<string, string>();
  for (const { levelUuid, skinUuid } of resolvedLevels) {
    const existing = skinByLevel.get(levelUuid);
    if (existing && existing !== skinUuid) {
      throw new Error("A storefront level resolved to conflicting skins.");
    }
    skinByLevel.set(levelUuid, skinUuid);
  }

  const offers: CanonicalStorefrontOffer[] = snapshot.offers.map((offer) => ({
    costs: offer.costs,
    offerId: offer.offerId,
    rewards: offer.rewards.map((reward) => {
        const skinUuid = skinByLevel.get(reward.levelUuid);
        if (!skinUuid) {
          throw new Error("A storefront level was not resolved to a skin.");
        }

        return {
          levelUuid: reward.levelUuid,
          quantity: reward.quantity,
          skinUuid,
        };
      }),
  }));

  const skinUuids = [
    ...new Set(
      offers.flatMap((offer) =>
        offer.rewards.map((reward) => reward.skinUuid),
      ),
    ),
  ].sort(compareStrings);
  return {
    bundle: snapshot.bundle,
    expiresAt: snapshot.expiresAt,
    nightMarket: snapshot.nightMarket,
    offers,
    shopHash: snapshot.shopHash,
    skinUuids,
    storeDate: snapshot.storeDate,
  };
}
