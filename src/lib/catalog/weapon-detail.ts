import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  TierView,
  WeaponSkinRowView,
  WeaponSkinsView,
} from "@/src/types/catalog-view";
import type { Database } from "@/src/types/database";

type ContentTierRow = Pick<
  Database["public"]["Tables"]["content_tiers"]["Row"],
  "content_tier_uuid" | "display_icon" | "display_name" | "highlight_color" | "rank"
>;

function toTierView(tier: ContentTierRow): TierView {
  return {
    contentTierUuid: tier.content_tier_uuid,
    displayIcon: tier.display_icon,
    displayName: tier.display_name,
    highlightColor: tier.highlight_color,
    rank: tier.rank,
  };
}

/**
 * Reads one weapon's skins a page at a time, ordered by display name so the
 * pagination stays deterministic, and flags the rows the user already
 * watches. Each row carries its resolved content tier for display; the five
 * tiers are read once per call rather than joined per row.
 */
export async function loadWeaponSkins(
  supabase: SupabaseClient<Database>,
  weaponUuid: string,
  options: { readonly limit: number; readonly offset: number },
  userId: string,
  connectionId: string,
): Promise<WeaponSkinsView> {
  const { limit, offset } = options;

  const [weaponResult, skinsResult, tiersResult] = await Promise.all([
    supabase
      .from("weapons")
      .select("weapon_uuid, display_name")
      .eq("weapon_uuid", weaponUuid)
      .maybeSingle(),
    supabase
      .from("skins")
      .select(
        "skin_uuid, display_name, display_icon, full_render, content_tier_uuid",
        { count: "exact" },
      )
      .eq("weapon_uuid", weaponUuid)
      .order("display_name", { ascending: true })
      .range(offset, offset + limit - 1),
    supabase
      .from("content_tiers")
      .select("content_tier_uuid, display_name, display_icon, highlight_color, rank"),
  ]);

  if (weaponResult.error || skinsResult.error || tiersResult.error) {
    throw new Error("The weapon skins could not be read.");
  }

  if (!weaponResult.data) {
    throw new Error("The weapon could not be found.");
  }

  const pageSkins = skinsResult.data ?? [];
  let watchedSkinUuids = new Set<string>();

  if (pageSkins.length > 0) {
    const { data: watched, error: watchedError } = await supabase
      .from("watchlist")
      .select("skin_uuid")
      .eq("user_id", userId)
      .eq("connection_id", connectionId)
      .in(
        "skin_uuid",
        pageSkins.map((skin) => skin.skin_uuid),
      );

    if (watchedError) {
      throw new Error("The weapon skins could not be read.");
    }

    watchedSkinUuids = new Set((watched ?? []).map((row) => row.skin_uuid));
  }

  const tiersByUuid = new Map(
    (tiersResult.data ?? []).map((tier) => [tier.content_tier_uuid, tier]),
  );
  const total = skinsResult.count ?? 0;

  const skins = pageSkins.map((skin): WeaponSkinRowView => {
    const tierKey = skin.content_tier_uuid;
    const tier = tierKey ? tiersByUuid.get(tierKey) : undefined;

    return {
      displayIcon: skin.display_icon,
      displayName: skin.display_name,
      fullRender: skin.full_render,
      skinUuid: skin.skin_uuid,
      tier: tier ? toTierView(tier) : null,
      watched: watchedSkinUuids.has(skin.skin_uuid),
    };
  });

  return {
    hasMore: offset + pageSkins.length < total,
    skins,
    total,
    weaponName: weaponResult.data.display_name,
    weaponUuid: weaponResult.data.weapon_uuid,
  };
}
