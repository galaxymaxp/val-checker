import { describe, expect, it } from "vitest";

import {
  INVENTORY_CATEGORIES,
  weaponInventoryCategory,
} from "@/src/lib/catalog/weapon-categories";

describe("weapon inventory categories", () => {
  it.each([
    { category: "Sidearm", label: "SIDEARMS", ordinal: 0 },
    { category: "SMG", label: "SMGS", ordinal: 1 },
    { category: "Rifle", label: "RIFLES", ordinal: 2 },
    { category: "Sniper", label: "SNIPER RIFLES", ordinal: 3 },
    { category: "Shotgun", label: "SHOTGUNS", ordinal: 4 },
    { category: "Heavy", label: "MACHINE GUNS", ordinal: 5 },
    { category: "Melee", label: "MELEE", ordinal: 6 },
  ])("maps $category to $label at ordinal $ordinal", ({ category, label, ordinal }) => {
    expect(weaponInventoryCategory(category)).toEqual({ label, ordinal });
  });

  it("lists every label once, in ordinal order", () => {
    expect(INVENTORY_CATEGORIES).toEqual([
      "SIDEARMS",
      "SMGS",
      "RIFLES",
      "SNIPER RIFLES",
      "SHOTGUNS",
      "MACHINE GUNS",
      "MELEE",
    ]);
  });

  it("throws loudly for a weapon class it has never seen", () => {
    expect(() => weaponInventoryCategory("Flamethrower")).toThrow(
      'Unknown weapon category "Flamethrower".',
    );
  });
});
