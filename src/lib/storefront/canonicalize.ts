import { createHash } from "node:crypto";

import type { ResolvedSkinLevel } from "@/src/lib/catalog/resolve-skin-uuids";
import type { StorefrontPayload } from "@/src/lib/storefront/schema";

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

export interface CanonicalStorefront {
  readonly expiresAt: string;
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
  readonly expiresAt: string;
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

export function createStorefrontRefreshSnapshot(
  storefront: StorefrontPayload,
  checkedAt: Date,
): StorefrontRefreshSnapshot {
  const offers = createSnapshotOffers(storefront);
  const timing = storefrontTiming(storefront, checkedAt);

  return {
    ...timing,
    offers,
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
    expiresAt: snapshot.expiresAt,
    offers,
    shopHash: snapshot.shopHash,
    skinUuids,
    storeDate: snapshot.storeDate,
  };
}
