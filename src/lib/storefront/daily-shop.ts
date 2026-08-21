import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadBundleMetadata } from "@/src/lib/catalog/bundle-metadata";
import {
  resolveSkinLevelsWithClient,
  SKIN_LEVEL_ITEM_TYPE_ID,
} from "@/src/lib/catalog/resolve-skin-uuids";
import type {
  StorefrontBundleSnapshot,
  StorefrontNightMarketSnapshot,
} from "@/src/lib/storefront/canonicalize";
import type { Database } from "@/src/types/database";

export interface DailyShopOffer {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly price: number | null;
  readonly skinUuid: string;
  readonly tierName: string | null;
  readonly watched: boolean;
  readonly weaponName: string | null;
}

export interface DailyShopBundleItemView {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly price: number | null;
  readonly skinUuid: string;
}

export interface DailyShopBundleView {
  readonly displayIcon: string | null;
  readonly displayName: string | null;
  readonly expiresAt: string;
  readonly items: readonly DailyShopBundleItemView[];
  /** Items that are not weapon skins, e.g. buddies, sprays, and cards. */
  readonly otherItemCount: number;
  readonly totalBaseCost: number | null;
  readonly totalDiscountedCost: number | null;
  readonly totalDiscountPercent: number;
}

export interface DailyShopNightMarketOfferView {
  readonly basePrice: number | null;
  readonly discountPercent: number;
  readonly discountedPrice: number | null;
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly skinUuid: string | null;
  readonly watched: boolean;
  readonly weaponName: string | null;
}

export interface DailyShopNightMarketView {
  readonly expiresAt: string;
  readonly offers: readonly DailyShopNightMarketOfferView[];
}

export interface DailyShopView {
  readonly bundle: DailyShopBundleView | null;
  readonly checkedAt: string;
  readonly connectionId: string;
  readonly expiresAt: string | null;
  readonly label: string | null;
  readonly nightMarket: DailyShopNightMarketView | null;
  readonly offers: readonly DailyShopOffer[];
  readonly rotationDate: string;
}

interface StoredShopCheck {
  readonly bundle: unknown;
  readonly checked_at: string;
  readonly connection_id: string;
  readonly expires_at: string | null;
  readonly offer_details: Database["public"]["Tables"]["shop_checks"]["Row"]["offer_details"];
  readonly night_market: unknown;
  readonly offer_skin_uuids: string[] | null;
  readonly rotation_date: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * These columns hold JSON this application wrote itself, but a stored shape
 * still predates any later change to it, so both readers check structure and
 * return null rather than trusting the column.
 */
function readBundle(value: unknown): StorefrontBundleSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.bundleUuid !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  return value as unknown as StorefrontBundleSnapshot;
}

function readNightMarket(
  value: unknown,
): StorefrontNightMarketSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.expiresAt !== "string" ||
    !Array.isArray(value.offers)
  ) {
    return null;
  }
  return value as unknown as StorefrontNightMarketSnapshot;
}

/**
 * Reads the storefronts the daily worker already recorded, one view per
 * connected Riot account that has a check. This never contacts Riot: the
 * one-check-per-connection-per-UTC-rotation cadence is an architectural
 * constraint, so the dashboard reports the stored results rather than
 * fetching.
 */
export async function loadDailyShops(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<readonly DailyShopView[]> {
  const { data: connections, error: connectionsError } = await supabase
    .from("riot_connections")
    .select("id, label")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (connectionsError) {
    throw new Error("The daily shop could not be read.");
  }

  if (!connections || connections.length === 0) {
    return [];
  }

  const { data: checks, error: checksError } = await supabase
    .from("shop_checks")
    .select(
      "connection_id, checked_at, expires_at, offer_skin_uuids, offer_details, rotation_date, bundle, night_market",
    )
    .in(
      "connection_id",
      connections.map((connection) => connection.id),
    )
    .order("rotation_date", { ascending: false });

  if (checksError) {
    throw new Error("The daily shop could not be read.");
  }

  // Rows arrive newest rotation first, so the first row per connection wins.
  const latestByConnectionId = new Map<string, StoredShopCheck>();

  for (const check of checks ?? []) {
    if (!latestByConnectionId.has(check.connection_id)) {
      latestByConnectionId.set(check.connection_id, check);
    }
  }

  // The night market and bundle store skin LEVEL ids, the same as the daily
  // offers did before enrichment, so both resolve through the one resolver
  // that owns that boundary.
  const extraLevelUuids = [
    ...new Set(
      [...latestByConnectionId.values()].flatMap((check) => [
        ...(readNightMarket(check.night_market)?.offers ?? []).flatMap(
          (offer) => (offer.levelUuid ? [offer.levelUuid] : []),
        ),
        ...(readBundle(check.bundle)?.items ?? []).flatMap((item) =>
          item.itemTypeUuid === SKIN_LEVEL_ITEM_TYPE_ID ? [item.itemUuid] : [],
        ),
      ]),
    ),
  ];
  const resolvedExtraLevels =
    extraLevelUuids.length > 0
      ? await resolveSkinLevelsWithClient(supabase, extraLevelUuids)
      : [];
  const skinByLevelUuid = new Map(
    resolvedExtraLevels.map((level) => [level.levelUuid, level.skinUuid]),
  );

  const resolvedSkinUuidUnion = [
    ...new Set(
      [
        ...skinByLevelUuid.values(),
      ].concat([...latestByConnectionId.values()].flatMap((check) => [
        ...(check.offer_skin_uuids ?? []),
        ...(check.offer_details ?? []).flatMap((offer) =>
          offer.rewards.flatMap((reward) =>
            reward.skinUuid ? [reward.skinUuid] : [],
          ),
        ),
      ])),
    ),
  ];

  let bySkinUuid = new Map<
    string,
    {
      content_tier_uuid: string | null;
      display_icon: string | null;
      display_name: string;
      skin_uuid: string;
      weapon_uuid: string | null;
    }
  >();
  let tierNameByUuid = new Map<string, string>();
  let watchedSkinUuids = new Set<string>();
  let weaponNameByUuid = new Map<string, string>();

  // One catalog read and one watchlist read regardless of how many accounts
  // the login has connected.
  if (resolvedSkinUuidUnion.length > 0) {
    const [{ data: skins, error: skinsError }, { data: watched, error: watchedError }] =
      await Promise.all([
        supabase
          .from("skins")
          .select(
            "skin_uuid, display_name, display_icon, weapon_uuid, content_tier_uuid",
          )
          .in("skin_uuid", resolvedSkinUuidUnion),
        supabase
          .from("watchlist")
          .select("skin_uuid")
          .eq("user_id", userId)
          .in("skin_uuid", resolvedSkinUuidUnion),
      ]);

    if (skinsError || watchedError) {
      throw new Error("The daily shop could not be read.");
    }

    watchedSkinUuids = new Set((watched ?? []).map((row) => row.skin_uuid));
    bySkinUuid = new Map((skins ?? []).map((row) => [row.skin_uuid, row]));

    const weaponUuids = [
      ...new Set((skins ?? []).flatMap((skin) => skin.weapon_uuid ?? [])),
    ];
    const tierUuids = [
      ...new Set(
        (skins ?? []).flatMap((skin) => skin.content_tier_uuid ?? []),
      ),
    ];
    const [weaponsResult, tiersResult] = await Promise.all([
      weaponUuids.length > 0
        ? supabase
            .from("weapons")
            .select("weapon_uuid, display_name")
            .in("weapon_uuid", weaponUuids)
        : Promise.resolve({ data: [], error: null }),
      tierUuids.length > 0
        ? supabase
            .from("content_tiers")
            .select("content_tier_uuid, display_name")
            .in("content_tier_uuid", tierUuids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (weaponsResult.error || tiersResult.error) {
      throw new Error("The daily shop could not be read.");
    }
    weaponNameByUuid = new Map(
      (weaponsResult.data ?? []).map((row) => [
        row.weapon_uuid,
        row.display_name,
      ]),
    );
    tierNameByUuid = new Map(
      (tiersResult.data ?? []).map((row) => [
        row.content_tier_uuid,
        row.display_name,
      ]),
    );
  }

  const bundleUuids = [
    ...new Set(
      [...latestByConnectionId.values()].flatMap(
        (check) => readBundle(check.bundle)?.bundleUuid ?? [],
      ),
    ),
  ];
  const bundleMetadata = new Map(
    await Promise.all(
      bundleUuids.map(
        async (bundleUuid) =>
          [bundleUuid, await loadBundleMetadata(bundleUuid)] as const,
      ),
    ),
  );

  const views: DailyShopView[] = [];

  for (const connection of connections) {
    const check = latestByConnectionId.get(connection.id);

    if (!check) {
      continue;
    }

    const offers =
      (check.offer_details ?? []).length > 0
        ? (check.offer_details ?? []).map((offer) => {
            const reward = offer.rewards[0];
            const skinUuid = reward?.skinUuid ?? reward?.levelUuid ?? offer.offerId;
            const skin = reward?.skinUuid
              ? bySkinUuid.get(reward.skinUuid)
              : undefined;

            return {
              displayIcon: skin?.display_icon ?? null,
              displayName: skin?.display_name ?? "Catalog update pending",
              price: offer.costs[0]?.amount ?? null,
              skinUuid,
              tierName: skin?.content_tier_uuid
                ? (tierNameByUuid.get(skin.content_tier_uuid) ?? null)
                : null,
              watched: reward?.skinUuid
                ? watchedSkinUuids.has(reward.skinUuid)
                : false,
              weaponName: skin?.weapon_uuid
                ? (weaponNameByUuid.get(skin.weapon_uuid) ?? null)
                : null,
            };
          })
        : (check.offer_skin_uuids ?? []).map((skinUuid) => {
            const skin = bySkinUuid.get(skinUuid);
            return {
              displayIcon: skin?.display_icon ?? null,
              displayName: skin?.display_name ?? "Unknown skin",
              price: null,
              skinUuid,
              tierName: skin?.content_tier_uuid
                ? (tierNameByUuid.get(skin.content_tier_uuid) ?? null)
                : null,
              watched: watchedSkinUuids.has(skinUuid),
              weaponName: skin?.weapon_uuid
                ? (weaponNameByUuid.get(skin.weapon_uuid) ?? null)
                : null,
            };
          });

    const storedBundle = readBundle(check.bundle);
    const bundleItems = (storedBundle?.items ?? []).flatMap((item) => {
      const skinUuid = skinByLevelUuid.get(item.itemUuid);
      const skin = skinUuid ? bySkinUuid.get(skinUuid) : undefined;
      if (!skinUuid || !skin) {
        return [];
      }
      return [
        {
          displayIcon: skin.display_icon,
          displayName: skin.display_name,
          price: item.discountedPrice,
          skinUuid,
        },
      ];
    });
    const metadata = storedBundle
      ? bundleMetadata.get(storedBundle.bundleUuid)
      : undefined;
    const bundle: DailyShopBundleView | null = storedBundle
      ? {
          displayIcon: metadata?.promoImage ?? metadata?.displayIcon ?? null,
          displayName: metadata?.displayName ?? null,
          expiresAt: storedBundle.expiresAt,
          items: bundleItems,
          otherItemCount: storedBundle.items.length - bundleItems.length,
          totalBaseCost: storedBundle.totalBaseCost,
          totalDiscountedCost: storedBundle.totalDiscountedCost,
          totalDiscountPercent: storedBundle.totalDiscountPercent,
        }
      : null;

    const storedNightMarket = readNightMarket(check.night_market);
    const nightMarket: DailyShopNightMarketView | null = storedNightMarket
      ? {
          expiresAt: storedNightMarket.expiresAt,
          offers: storedNightMarket.offers.map((offer) => {
            const skinUuid = offer.levelUuid
              ? (skinByLevelUuid.get(offer.levelUuid) ?? null)
              : null;
            const skin = skinUuid ? bySkinUuid.get(skinUuid) : undefined;

            return {
              basePrice: offer.basePrice,
              discountPercent: offer.discountPercent,
              discountedPrice: offer.discountedPrice,
              displayIcon: skin?.display_icon ?? null,
              displayName: skin?.display_name ?? "Catalog update pending",
              skinUuid,
              watched: skinUuid ? watchedSkinUuids.has(skinUuid) : false,
              weaponName: skin?.weapon_uuid
                ? (weaponNameByUuid.get(skin.weapon_uuid) ?? null)
                : null,
            };
          }),
        }
      : null;

    views.push({
      bundle,
      checkedAt: check.checked_at,
      connectionId: connection.id,
      expiresAt: check.expires_at,
      label: connection.label,
      nightMarket,
      // Preserve each storefront's own ordering rather than the catalog's.
      offers,
      rotationDate: check.rotation_date,
    });
  }

  return views;
}
