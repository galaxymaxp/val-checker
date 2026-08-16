import { z } from "zod";

import { weaponInventoryCategory } from "./weapon-categories";

const VALORANT_API_WEAPONS_URL =
  "https://valorant-api.com/v1/weapons?language=en-US";

const VALORANT_API_CONTENT_TIERS_URL =
  "https://valorant-api.com/v1/contenttiers?language=en-US";

// Riot IDs fit Postgres' uuid type but do not consistently set RFC version bits.
const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid database UUID",
);

const levelSchema = z.object({
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  levelItem: z.string().nullable(),
  streamedVideo: z.url().nullable(),
  uuid: databaseUuidSchema,
});

const chromaSchema = z.object({
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  fullRender: z.url(),
  streamedVideo: z.url().nullable(),
  swatch: z.url().nullable(),
  uuid: databaseUuidSchema,
});

const skinSchema = z.object({
  chromas: z.array(chromaSchema),
  contentTierUuid: databaseUuidSchema.nullable(),
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  levels: z.array(levelSchema),
  themeUuid: databaseUuidSchema.nullable(),
  uuid: databaseUuidSchema,
  wallpaper: z.url().nullable(),
});

const weaponSchema = z.object({
  category: z.string().min(1),
  defaultSkinUuid: databaseUuidSchema,
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  // shopData is null for Melee: the knife is not purchasable.
  shopData: z
    .object({
      category: z.string().min(1),
      categoryText: z.string().min(1),
      cost: z.number().int(),
    })
    .nullable(),
  skins: z.array(skinSchema),
  uuid: databaseUuidSchema,
});

const weaponsResponseSchema = z.object({
  data: z.array(weaponSchema),
  status: z.literal(200),
});

const contentTierSchema = z.object({
  devName: z.string().min(1),
  displayIcon: z.url().nullable(),
  displayName: z.string().min(1),
  // Raw upstream value: 8 hex characters of RGBA with no leading "#".
  highlightColor: z.string().min(1),
  rank: z.number().int(),
  uuid: databaseUuidSchema,
});

const contentTiersResponseSchema = z.object({
  data: z.array(contentTierSchema),
  status: z.literal(200),
});

export interface WeaponCatalogRow {
  readonly weapon_uuid: string;
  readonly display_name: string;
  readonly category: string;
  readonly display_icon: string | null;
  readonly default_skin_uuid: string;
  readonly shop_category: string | null;
  readonly inventory_label: string;
  readonly inventory_ordinal: number;
}

export interface SkinCatalogRow {
  readonly skin_uuid: string;
  readonly display_name: string;
  readonly weapon_uuid: string;
  readonly content_tier_uuid: string | null;
  readonly display_icon: string | null;
  readonly full_render: string | null;
  readonly theme_uuid: string | null;
  readonly wallpaper: string | null;
}

export interface SkinLevelCatalogRow {
  readonly level_uuid: string;
  readonly skin_uuid: string;
  readonly ordinal: number;
  readonly display_name: string;
  readonly level_item: string | null;
  readonly display_icon: string | null;
  readonly streamed_video: string | null;
}

export interface SkinChromaCatalogRow {
  readonly chroma_uuid: string;
  readonly skin_uuid: string;
  readonly ordinal: number;
  readonly display_name: string;
  readonly variant_label: string | null;
  readonly display_icon: string | null;
  readonly full_render: string;
  readonly swatch: string | null;
  readonly streamed_video: string | null;
}

export interface ContentTierCatalogRow {
  readonly content_tier_uuid: string;
  readonly display_name: string;
  readonly dev_name: string;
  readonly rank: number;
  readonly highlight_color: string;
  readonly display_icon: string | null;
}

export interface CatalogSnapshot {
  readonly weapons: readonly WeaponCatalogRow[];
  readonly skins: readonly SkinCatalogRow[];
  readonly skinLevels: readonly SkinLevelCatalogRow[];
  readonly skinChromas: readonly SkinChromaCatalogRow[];
}

export interface ContentTierSnapshot {
  readonly contentTiers: readonly ContentTierCatalogRow[];
}

function categoryName(category: string) {
  return category.split("::").at(-1) ?? category;
}

/** Chroma display names can carry a second line; store them on one line. */
export function normalizeDisplayName(name: string): string {
  return name
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * Chroma variants append a parenthetical second line to the display name,
 * e.g. "RGX 11z Pro Phantom Level 5\n(Variant 1 Red)". The base chroma
 * (ordinal 0) never has a variant label.
 */
export function variantLabel(displayName: string, ordinal: number): string | null {
  if (ordinal === 0) {
    return null;
  }

  const newlineIndex = displayName.indexOf("\n");

  if (newlineIndex === -1) {
    return null;
  }

  const secondLine = displayName.slice(newlineIndex + 1).trim();
  const label =
    secondLine.startsWith("(") && secondLine.endsWith(")")
      ? secondLine.slice(1, -1).trim()
      : secondLine;

  return label.length > 0 ? label : null;
}

export function parseValorantCatalogPayload(payload: unknown): CatalogSnapshot {
  const response = weaponsResponseSchema.parse(payload);
  const weapons: WeaponCatalogRow[] = [];
  const skins: SkinCatalogRow[] = [];
  const skinLevels: SkinLevelCatalogRow[] = [];
  const skinChromas: SkinChromaCatalogRow[] = [];

  for (const weapon of response.data) {
    const category = categoryName(weapon.category);
    const inventory = weaponInventoryCategory(category);

    weapons.push({
      category,
      default_skin_uuid: weapon.defaultSkinUuid,
      display_icon: weapon.displayIcon,
      display_name: weapon.displayName,
      inventory_label: inventory.label,
      inventory_ordinal: inventory.ordinal,
      shop_category: weapon.shopData?.categoryText ?? null,
      weapon_uuid: weapon.uuid,
    });

    for (const skin of weapon.skins) {
      skins.push({
        content_tier_uuid: skin.contentTierUuid,
        display_icon: skin.displayIcon,
        display_name: skin.displayName,
        // Full renders live on chromas; the base chroma renders the skin.
        full_render: skin.chromas[0]?.fullRender ?? null,
        skin_uuid: skin.uuid,
        theme_uuid: skin.themeUuid,
        wallpaper: skin.wallpaper,
        weapon_uuid: weapon.uuid,
      });

      skin.levels.forEach((level, ordinal) => {
        skinLevels.push({
          display_icon: level.displayIcon,
          display_name: level.displayName,
          level_item: level.levelItem,
          level_uuid: level.uuid,
          ordinal,
          skin_uuid: skin.uuid,
          streamed_video: level.streamedVideo,
        });
      });

      skin.chromas.forEach((chroma, ordinal) => {
        skinChromas.push({
          chroma_uuid: chroma.uuid,
          display_icon: chroma.displayIcon,
          display_name: normalizeDisplayName(chroma.displayName),
          full_render: chroma.fullRender,
          ordinal,
          skin_uuid: skin.uuid,
          streamed_video: chroma.streamedVideo,
          swatch: chroma.swatch,
          variant_label: variantLabel(chroma.displayName, ordinal),
        });
      });
    }
  }

  return { weapons, skins, skinLevels, skinChromas };
}

export function parseValorantContentTiersPayload(
  payload: unknown,
): ContentTierSnapshot {
  const response = contentTiersResponseSchema.parse(payload);

  return {
    contentTiers: response.data.map((tier) => ({
      content_tier_uuid: tier.uuid,
      dev_name: tier.devName,
      display_icon: tier.displayIcon,
      display_name: tier.displayName,
      highlight_color: tier.highlightColor,
      rank: tier.rank,
    })),
  };
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

export async function fetchValorantContentTiers(
  fetchImplementation: typeof fetch = fetch,
): Promise<ContentTierSnapshot> {
  const response = await fetchImplementation(VALORANT_API_CONTENT_TIERS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Valorant content tier request failed with HTTP ${response.status}.`,
    );
  }

  return parseValorantContentTiersPayload(await response.json());
}
