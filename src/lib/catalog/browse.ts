import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";

const PAGE_SIZE = 1_000;

export interface CatalogSkinView {
  readonly skinUuid: string;
  readonly displayName: string;
  readonly displayIcon: string | null;
  readonly contentTier: string | null;
}

export interface CatalogWeaponView {
  readonly weaponUuid: string;
  readonly displayName: string;
  readonly category: string;
  readonly skins: readonly CatalogSkinView[];
}

async function loadAllSkins(supabase: SupabaseClient<Database>) {
  const skins: Database["public"]["Tables"]["skins"]["Row"][] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("skins")
      .select("skin_uuid, display_name, weapon_uuid, content_tier, display_icon, first_seen_at")
      .order("display_name")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error("Catalog browse failed while reading skins.");
    }

    skins.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      return skins;
    }
  }
}

export async function loadCatalogForBrowse(
  supabase: SupabaseClient<Database>,
): Promise<CatalogWeaponView[]> {
  const [{ data: weapons, error: weaponsError }, skins] = await Promise.all([
    supabase.from("weapons").select("weapon_uuid, display_name, category").order("display_name"),
    loadAllSkins(supabase),
  ]);

  if (weaponsError) {
    throw new Error("Catalog browse failed while reading weapons.");
  }

  const skinsByWeapon = new Map<string, CatalogSkinView[]>();

  for (const skin of skins) {
    if (!skin.weapon_uuid) {
      throw new Error("Catalog browse found a skin without a parent weapon.");
    }

    const weaponSkins = skinsByWeapon.get(skin.weapon_uuid) ?? [];
    weaponSkins.push({
      contentTier: skin.content_tier,
      displayIcon: skin.display_icon,
      displayName: skin.display_name,
      skinUuid: skin.skin_uuid,
    });
    skinsByWeapon.set(skin.weapon_uuid, weaponSkins);
  }

  return (weapons ?? []).map((weapon) => ({
    category: weapon.category ?? "Other",
    displayName: weapon.display_name,
    skins: skinsByWeapon.get(weapon.weapon_uuid) ?? [],
    weaponUuid: weapon.weapon_uuid,
  }));
}
