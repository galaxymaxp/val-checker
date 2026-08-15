import type {
  CanonicalStorefront,
  CanonicalStorefrontOffer,
} from "@/src/lib/storefront/canonicalize";

export interface StorefrontSkinMatch {
  readonly offers: readonly CanonicalStorefrontOffer[];
  readonly skinUuid: string;
}

export function matchStorefrontWatchlist(
  storefront: CanonicalStorefront,
  watchedSkinUuids: readonly string[],
): StorefrontSkinMatch[] {
  const watched = new Set(watchedSkinUuids);

  return storefront.skinUuids
    .filter((skinUuid) => watched.has(skinUuid))
    .map((skinUuid) => ({
      offers: storefront.offers.filter((offer) =>
        offer.rewards.some((reward) => reward.skinUuid === skinUuid),
      ),
      skinUuid,
    }));
}
