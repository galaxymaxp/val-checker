import { z } from "zod";

const VALORANT_API_WEAPONS_URL =
  "https://valorant-api.com/v1/weapons?language=en-US";

// Riot IDs fit Postgres' uuid type but do not consistently set RFC version bits.
const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid database UUID",
);

const levelSchema = z.object({
  uuid: databaseUuidSchema,
});

const skinSchema = z.object({
  contentTierUuid: databaseUuidSchema.nullable(),
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  levels: z.array(levelSchema),
  uuid: databaseUuidSchema,
});

const weaponSchema = z.object({
  category: z.string().min(1),
  displayName: z.string().min(1),
  skins: z.array(skinSchema),
  uuid: databaseUuidSchema,
});

const weaponsResponseSchema = z.object({
  data: z.array(weaponSchema),
  status: z.literal(200),
});

export interface WeaponCatalogRow {
  readonly weapon_uuid: string;
  readonly display_name: string;
  readonly category: string;
}

export interface SkinCatalogRow {
  readonly skin_uuid: string;
  readonly display_name: string;
  readonly weapon_uuid: string;
  readonly content_tier: string | null;
  readonly display_icon: string | null;
}

export interface SkinLevelCatalogRow {
  readonly level_uuid: string;
  readonly skin_uuid: string;
  readonly ordinal: number;
}

export interface CatalogSnapshot {
  readonly weapons: readonly WeaponCatalogRow[];
  readonly skins: readonly SkinCatalogRow[];
  readonly skinLevels: readonly SkinLevelCatalogRow[];
}

function categoryName(category: string) {
  return category.split("::").at(-1) ?? category;
}

export function parseValorantCatalogPayload(payload: unknown): CatalogSnapshot {
  const response = weaponsResponseSchema.parse(payload);
  const weapons: WeaponCatalogRow[] = [];
  const skins: SkinCatalogRow[] = [];
  const skinLevels: SkinLevelCatalogRow[] = [];

  for (const weapon of response.data) {
    weapons.push({
      category: categoryName(weapon.category),
      display_name: weapon.displayName,
      weapon_uuid: weapon.uuid,
    });

    for (const skin of weapon.skins) {
      skins.push({
        content_tier: skin.contentTierUuid,
        display_icon: skin.displayIcon,
        display_name: skin.displayName,
        skin_uuid: skin.uuid,
        weapon_uuid: weapon.uuid,
      });

      skin.levels.forEach((level, ordinal) => {
        skinLevels.push({
          level_uuid: level.uuid,
          ordinal,
          skin_uuid: skin.uuid,
        });
      });
    }
  }

  return { weapons, skins, skinLevels };
}

export async function fetchValorantCatalog(
  fetchImplementation: typeof fetch = fetch,
): Promise<CatalogSnapshot> {
  const response = await fetchImplementation(VALORANT_API_WEAPONS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Valorant catalog request failed with HTTP ${response.status}.`);
  }

  return parseValorantCatalogPayload(await response.json());
}
