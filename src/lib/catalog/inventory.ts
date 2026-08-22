import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { weaponInventoryCategory } from "@/src/lib/catalog/weapon-categories";
import type { InventoryTileView } from "@/src/types/catalog-view";
import type { Database } from "@/src/types/database";

const PAGE_SIZE = 1_000;

interface WatchedSkinJoinRow {
  readonly created_at: string;
  readonly skin_uuid: string;
  readonly skins: {
    readonly display_icon: string | null;
    readonly display_name: string;
    readonly skin_uuid: string;
    readonly weapon_uuid: string | null;
  };
}

async function loadWatchedSkins(
  supabase: SupabaseClient<Database>,
  userId: string,
  connectionId: string | null,
) {
  const rows: WatchedSkinJoinRow[] = [];

  if (!connectionId) {
    return rows;
  }

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("watchlist")
      .select(
        "skin_uuid, created_at, skins!inner(skin_uuid, display_name, display_icon, weapon_uuid)",
      )
      .eq("user_id", userId)
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error("The inventory could not be read.");
    }

    // The hand-written Database types carry no relationship metadata, so the
    // embedded-resource select cannot infer its own shape; the join is pinned
    // here instead.
    const page = (data ?? []) as unknown as readonly WatchedSkinJoinRow[];
    rows.push(...page);

    if (!data || page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/**
 * Builds the collection screen's weapon grid from the catalog and the user's
 * watchlist. Every weapon becomes one tile; the newest watched skin for that
 * weapon supplies the tile art, and a weapon with nothing watched falls back
 * to its own default render. Tiles arrive in collection-screen order:
 * category first, weapon name second.
 */
export async function loadWishlistInventory(
  supabase: SupabaseClient<Database>,
  userId: string,
  connectionId: string | null,
): Promise<readonly InventoryTileView[]> {
  const [{ data: weapons, error: weaponsError }, watchedSkins] =
    await Promise.all([
      supabase
        .from("weapons")
        .select(
          "weapon_uuid, display_name, display_icon, inventory_label, inventory_ordinal, category",
        ),
      loadWatchedSkins(supabase, userId, connectionId),
    ]);

  if (weaponsError) {
    throw new Error("The inventory could not be read.");
  }

  // Rows arrive newest first, so the first watched skin per weapon wins the
  // tile art.
  const newestByWeaponUuid = new Map<string, WatchedSkinJoinRow>();
  const watchedCountByWeaponUuid = new Map<string, number>();

  for (const row of watchedSkins) {
    const weaponUuid = row.skins.weapon_uuid;

    if (!weaponUuid) {
      continue;
    }

    if (!newestByWeaponUuid.has(weaponUuid)) {
      newestByWeaponUuid.set(weaponUuid, row);
    }

    watchedCountByWeaponUuid.set(
      weaponUuid,
      (watchedCountByWeaponUuid.get(weaponUuid) ?? 0) + 1,
    );
  }

  const tiles = (weapons ?? []).map((weapon): InventoryTileView => {
    // Rows synced before the inventory-column backfill carry null labels;
    // derive the category from the upstream enum suffix instead.
    const category =
      weapon.inventory_label !== null && weapon.inventory_ordinal !== null
        ? { label: weapon.inventory_label, ordinal: weapon.inventory_ordinal }
        : weaponInventoryCategory(weapon.category ?? "");
    const newest = newestByWeaponUuid.get(weapon.weapon_uuid);

    return {
      artSource: newest ? "watched-skin" : "weapon-default",
      categoryLabel: category.label,
      categoryOrdinal: category.ordinal,
      displayIcon: newest ? newest.skins.display_icon : weapon.display_icon,
      displayName: weapon.display_name,
      watchedCount: watchedCountByWeaponUuid.get(weapon.weapon_uuid) ?? 0,
      watchedSkinName: newest ? newest.skins.display_name : null,
      weaponUuid: weapon.weapon_uuid,
    };
  });

  return tiles.sort(
    (first, second) =>
      first.categoryOrdinal - second.categoryOrdinal ||
      first.displayName.localeCompare(second.displayName),
  );
}
