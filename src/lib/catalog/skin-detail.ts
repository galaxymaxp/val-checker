import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ChromaView,
  LevelView,
  SkinDetailView,
  TierView,
} from "@/src/types/catalog-view";
import type { Database } from "@/src/types/database";

/**
 * Assembles everything the skin page shows for one skin: its renders, its
 * content tier, and its levels and chromas in upgrade order. The levels and
 * chromas are read alongside the skin row itself; only the weapon name and
 * tier lookup wait for the skin row to resolve.
 */
export async function loadSkinDetail(
  supabase: SupabaseClient<Database>,
  skinUuid: string,
): Promise<SkinDetailView> {
  const [skinResult, levelsResult, chromasResult] = await Promise.all([
    supabase
      .from("skins")
      .select(
        "skin_uuid, display_name, full_render, wallpaper, weapon_uuid, content_tier_uuid",
      )
      .eq("skin_uuid", skinUuid)
      .maybeSingle(),
    supabase
      .from("skin_levels")
      .select(
        "level_uuid, display_name, level_item, display_icon, streamed_video, ordinal",
      )
      .eq("skin_uuid", skinUuid)
      .order("ordinal", { ascending: true }),
    supabase
      .from("skin_chromas")
      .select(
        "chroma_uuid, display_icon, full_render, ordinal, streamed_video, swatch, variant_label",
      )
      .eq("skin_uuid", skinUuid)
      .order("ordinal", { ascending: true }),
  ]);

  if (skinResult.error || levelsResult.error || chromasResult.error) {
    throw new Error("The skin could not be read.");
  }

  const skin = skinResult.data;

  if (!skin) {
    throw new Error("The skin could not be found.");
  }

  if (!skin.weapon_uuid) {
    throw new Error("The skin could not be read.");
  }

  const tierKey = skin.content_tier_uuid;

  const [weaponResult, tierResult] = await Promise.all([
    supabase
      .from("weapons")
      .select("weapon_uuid, display_name")
      .eq("weapon_uuid", skin.weapon_uuid)
      .maybeSingle(),
    tierKey
      ? supabase
          .from("content_tiers")
          .select(
            "content_tier_uuid, display_name, display_icon, highlight_color, rank",
          )
          .eq("content_tier_uuid", tierKey)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (weaponResult.error || tierResult.error) {
    throw new Error("The skin could not be read.");
  }

  const weapon = weaponResult.data;

  if (!weapon) {
    throw new Error("The skin could not be read.");
  }

  const tierRow = tierResult.data;
  const tier: TierView | null = tierRow
    ? {
        contentTierUuid: tierRow.content_tier_uuid,
        displayIcon: tierRow.display_icon,
        displayName: tierRow.display_name,
        highlightColor: tierRow.highlight_color,
        rank: tierRow.rank,
      }
    : null;

  const levels = (levelsResult.data ?? [])
    .map(
      (level): LevelView => ({
        displayIcon: level.display_icon,
        displayName: level.display_name,
        levelItem: level.level_item,
        levelUuid: level.level_uuid,
        ordinal: level.ordinal ?? 0,
        streamedVideo: level.streamed_video,
      }),
    )
    .sort((first, second) => first.ordinal - second.ordinal);

  const chromas = (chromasResult.data ?? [])
    .map(
      (chroma): ChromaView => ({
        chromaUuid: chroma.chroma_uuid,
        displayIcon: chroma.display_icon,
        fullRender: chroma.full_render,
        ordinal: chroma.ordinal,
        streamedVideo: chroma.streamed_video,
        swatch: chroma.swatch,
        variantLabel: chroma.variant_label,
      }),
    )
    .sort((first, second) => first.ordinal - second.ordinal);

  return {
    chromas,
    displayName: skin.display_name,
    fullRender: skin.full_render,
    levels,
    skinUuid: skin.skin_uuid,
    tier,
    wallpaper: skin.wallpaper,
    weaponName: weapon.display_name,
    weaponUuid: weapon.weapon_uuid,
  };
}
