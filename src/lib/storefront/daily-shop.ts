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
  readonly expiresAt: string | null;
  readonly offers: readonly DailyShopOffer[];
  readonly rotationDate: string;
}

/**
 * Reads the storefront the daily worker already recorded. This never contacts
 * Riot: the one-check-per-user-per-UTC-rotation cadence is an architectural
 * constraint, so the dashboard reports the stored result rather than fetching.
 */
export async function loadDailyShop(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DailyShopView | null> {
  const { data: connection, error: connectionError } = await supabase
    .from("riot_connections")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (connectionError) {
    throw new Error("The daily shop could not be read.");
  }

  if (!connection) {
    return null;
  }

  const { data: check, error: checkError } = await supabase
    .from("shop_checks")
    .select("checked_at, expires_at, offer_skin_uuids, rotation_date")
    .eq("connection_id", connection.id)
    .order("rotation_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (checkError) {
    throw new Error("The daily shop could not be read.");
  }

  if (!check) {
    return null;
  }

  const skinUuids = check.offer_skin_uuids ?? [];

  if (skinUuids.length === 0) {
    return {
      checkedAt: check.checked_at,
      expiresAt: check.expires_at,
      offers: [],
      rotationDate: check.rotation_date,
    };
  }

  const [{ data: skins, error: skinsError }, { data: watched, error: watchedError }] =
    await Promise.all([
      supabase
        .from("skins")
        .select("skin_uuid, display_name, display_icon")
        .in("skin_uuid", skinUuids),
      supabase
        .from("watchlist")
        .select("skin_uuid")
        .eq("user_id", userId)
        .in("skin_uuid", skinUuids),
    ]);

  if (skinsError || watchedError) {
    throw new Error("The daily shop could not be read.");
  }

  const watchedSkinUuids = new Set((watched ?? []).map((row) => row.skin_uuid));
  const bySkinUuid = new Map((skins ?? []).map((row) => [row.skin_uuid, row]));

  return {
    checkedAt: check.checked_at,
    expiresAt: check.expires_at,
    // Preserve the storefront's own ordering rather than the catalog's.
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
  };
}
