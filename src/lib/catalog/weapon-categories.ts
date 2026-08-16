export interface WeaponInventoryCategory {
  readonly label: string;
  readonly ordinal: number;
}

// Keyed by the suffix of the upstream EEquippableCategory enum, in the order
// the in-game collection screen lists its sections.
const INVENTORY_CATEGORY_BY_API_SUFFIX: Readonly<
  Record<string, WeaponInventoryCategory>
> = {
  Heavy: { label: "MACHINE GUNS", ordinal: 5 },
  Melee: { label: "MELEE", ordinal: 6 },
  Rifle: { label: "RIFLES", ordinal: 2 },
  SMG: { label: "SMGS", ordinal: 1 },
  Shotgun: { label: "SHOTGUNS", ordinal: 4 },
  Sidearm: { label: "SIDEARMS", ordinal: 0 },
  Sniper: { label: "SNIPER RIFLES", ordinal: 3 },
};

export const INVENTORY_CATEGORIES: readonly string[] = Object.values(
  INVENTORY_CATEGORY_BY_API_SUFFIX,
)
  .sort((first, second) => first.ordinal - second.ordinal)
  .map((category) => category.label);

export function weaponInventoryCategory(
  category: string,
): WeaponInventoryCategory {
  const inventoryCategory = INVENTORY_CATEGORY_BY_API_SUFFIX[category];

  if (!inventoryCategory) {
    throw new Error(
      `Unknown weapon category "${category}". Riot added a weapon class; map it in weapon-categories.ts before syncing.`,
    );
  }

  return inventoryCategory;
}
