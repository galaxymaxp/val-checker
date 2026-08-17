import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface DailyShopView {
  readonly checkedAt: string;
  readonly connectionId: string;
  readonly expiresAt: string | null;
  readonly label: string | null;
  readonly offers: readonly DailyShopOffer[];
  readonly rotationDate: string;
}

interface StoredShopCheck {
  readonly checked_at: string;
  readonly connection_id: string;
  readonly expires_at: string | null;
  readonly offer_details: Database["public"]["Tables"]["shop_checks"]["Row"]["offer_details"];
  readonly offer_skin_uuids: string[] | null;
  readonly rotation_date: string;
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
      "connection_id, checked_at, expires_at, offer_skin_uuids, offer_details, rotation_date",
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

  const resolvedSkinUuidUnion = [
    ...new Set(
      [...latestByConnectionId.values()].flatMap((check) => [
        ...(check.offer_skin_uuids ?? []),
        ...(check.offer_details ?? []).flatMap((offer) =>
          offer.rewards.flatMap((reward) =>
            reward.skinUuid ? [reward.skinUuid] : [],
          ),
        ),
      ]),
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

    views.push({
      checkedAt: check.checked_at,
      connectionId: connection.id,
      expiresAt: check.expires_at,
      label: connection.label,
      // Preserve each storefront's own ordering rather than the catalog's.
      offers,
      rotationDate: check.rotation_date,
    });
  }

  return views;
}
