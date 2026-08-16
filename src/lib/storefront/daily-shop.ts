import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

export interface DailyShopOffer {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly skinUuid: string;
  readonly watched: boolean;
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
    .select("connection_id, checked_at, expires_at, offer_skin_uuids, rotation_date")
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

  const skinUuidUnion = [
    ...new Set(
      [...latestByConnectionId.values()].flatMap(
        (check) => check.offer_skin_uuids ?? [],
      ),
    ),
  ];

  let bySkinUuid = new Map<
    string,
    { display_icon: string | null; display_name: string; skin_uuid: string }
  >();
  let watchedSkinUuids = new Set<string>();

  // One catalog read and one watchlist read regardless of how many accounts
  // the login has connected.
  if (skinUuidUnion.length > 0) {
    const [{ data: skins, error: skinsError }, { data: watched, error: watchedError }] =
      await Promise.all([
        supabase
          .from("skins")
          .select("skin_uuid, display_name, display_icon")
          .in("skin_uuid", skinUuidUnion),
        supabase
          .from("watchlist")
          .select("skin_uuid")
          .eq("user_id", userId)
          .in("skin_uuid", skinUuidUnion),
      ]);

    if (skinsError || watchedError) {
      throw new Error("The daily shop could not be read.");
    }

    watchedSkinUuids = new Set((watched ?? []).map((row) => row.skin_uuid));
    bySkinUuid = new Map((skins ?? []).map((row) => [row.skin_uuid, row]));
  }

  const views: DailyShopView[] = [];

  for (const connection of connections) {
    const check = latestByConnectionId.get(connection.id);

    if (!check) {
      continue;
    }

    const skinUuids = check.offer_skin_uuids ?? [];

    views.push({
      checkedAt: check.checked_at,
      connectionId: connection.id,
      expiresAt: check.expires_at,
      label: connection.label,
      // Preserve each storefront's own ordering rather than the catalog's.
      offers: skinUuids.map((skinUuid) => {
        const skin = bySkinUuid.get(skinUuid);

        return {
          displayIcon: skin?.display_icon ?? null,
          displayName: skin?.display_name ?? "Unknown skin",
          skinUuid,
          watched: watchedSkinUuids.has(skinUuid),
        };
      }),
      rotationDate: check.rotation_date,
    });
  }

  return views;
}
