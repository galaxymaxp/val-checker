/**
 * View models for the catalog read loaders. Client components import these
 * shapes directly, and the client-boundary test walks import graphs without
 * distinguishing type-only imports, so this module must never import from
 * src/lib.
 */

export interface TierView {
  readonly contentTierUuid: string;
  readonly displayIcon: string | null;
  readonly displayName: string;
  /** 8 hex chars RGBA, no leading #. */
  readonly highlightColor: string | null;
  readonly rank: number;
}

export interface ChromaView {
  readonly chromaUuid: string;
  readonly displayIcon: string | null;
  readonly fullRender: string | null;
  readonly ordinal: number;
  readonly streamedVideo: string | null;
  readonly swatch: string | null;
  readonly variantLabel: string | null;
}

export interface LevelView {
  readonly displayIcon: string | null;
  readonly displayName: string | null;
  /** Upstream upgrade kind, e.g. "EEquipmentSkinLevelItem::VFX". */
  readonly levelItem: string | null;
  readonly levelUuid: string;
  readonly ordinal: number;
  readonly streamedVideo: string | null;
}

export interface InventoryTileView {
  readonly artSource: "watched-skin" | "weapon-default";
  readonly categoryLabel: string;
  readonly categoryOrdinal: number;
  readonly displayIcon: string | null;
  /** Weapon name, e.g. "Vandal". */
  readonly displayName: string;
  readonly watchedCount: number;
  readonly watchedSkinName: string | null;
  readonly weaponUuid: string;
}

export interface WeaponSkinRowView {
  readonly displayIcon: string | null;
  readonly displayName: string;
  readonly fullRender: string | null;
  readonly skinUuid: string;
  readonly tier: TierView | null;
  readonly watched: boolean;
}

export interface WeaponSkinsView {
  readonly hasMore: boolean;
  readonly skins: readonly WeaponSkinRowView[];
  readonly total: number;
  readonly weaponName: string;
  readonly weaponUuid: string;
}

export interface SkinDetailView {
  readonly chromas: readonly ChromaView[];
  readonly displayName: string;
  readonly fullRender: string | null;
  readonly levels: readonly LevelView[];
  readonly skinUuid: string;
  readonly tier: TierView | null;
  readonly wallpaper: string | null;
  readonly weaponName: string;
  readonly weaponUuid: string;
}
