/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InventoryGrid } from "@/app/dashboard/_components/inventory-grid";
import { INVENTORY_CATEGORIES } from "@/src/lib/catalog/weapon-categories";
import type { InventoryTileView } from "@/src/types/catalog-view";

const CATEGORY_ORDINALS: Readonly<Record<string, number>> = Object.fromEntries(
  INVENTORY_CATEGORIES.map((label, index) => [label, index]),
);

function tile(
  displayName: string,
  categoryLabel: string,
  overrides: Partial<InventoryTileView> = {},
): InventoryTileView {
  return {
    artSource: "weapon-default",
    categoryLabel,
    categoryOrdinal: CATEGORY_ORDINALS[categoryLabel],
    displayIcon: null,
    displayName,
    watchedCount: 0,
    watchedSkinName: null,
    weaponUuid: `weapon-${displayName.toLowerCase().replace(/\s+/g, "-")}`,
    ...overrides,
  };
}

// All 20 weapons across the seven collection-screen categories.
const fixture: InventoryTileView[] = [
  tile("Classic", "SIDEARMS"),
  tile("Frenzy", "SIDEARMS"),
  tile("Ghost", "SIDEARMS"),
  tile("Sheriff", "SIDEARMS"),
  tile("Shorty", "SIDEARMS"),
  tile("Spectre", "SMGS"),
  tile("Stinger", "SMGS"),
  tile("Bulldog", "RIFLES"),
  tile("Guardian", "RIFLES"),
  tile("Phantom", "RIFLES"),
  tile("Vandal", "RIFLES", {
    artSource: "watched-skin",
    watchedCount: 2,
    watchedSkinName: "Prime Vandal",
  }),
  tile("Marshal", "SNIPER RIFLES"),
  tile("Operator", "SNIPER RIFLES"),
  tile("Outlaw", "SNIPER RIFLES"),
  tile("Bucky", "SHOTGUNS"),
  tile("Judge", "SHOTGUNS"),
  tile("Ares", "MACHINE GUNS"),
  tile("Odin", "MACHINE GUNS"),
  tile("Melee", "MELEE"),
  tile("Golden Gun", "MELEE"),
];

afterEach(cleanup);

describe("InventoryGrid", () => {
  it("renders one tile per weapon", () => {
    render(<InventoryGrid tiles={fixture} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });

  it("groups category headings into the buy menu's columns", () => {
    render(<InventoryGrid tiles={fixture} />);

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);

    // Column order, not the flat collection-screen order: SMGs sit above
    // shotguns in one column, snipers above machine guns in another.
    expect(headings).toEqual([
      "SIDEARMS",
      "SMGS",
      "SHOTGUNS",
      "RIFLES",
      "SNIPER RIFLES",
      "MACHINE GUNS",
      "MELEE",
    ]);
  });

  it("keeps every category the catalog produces", () => {
    render(<InventoryGrid tiles={fixture} />);

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);

    expect([...headings].sort()).toEqual([...INVENTORY_CATEGORIES].sort());
  });

  it("shows the newest watched skin and the watch count", () => {
    render(<InventoryGrid tiles={fixture} />);

    expect(screen.getByText("Prime Vandal")).toBeInTheDocument();
    expect(screen.getByText("2 skins watched")).toBeInTheDocument();
  });

  it("marks tiles with nothing watched", () => {
    render(<InventoryGrid tiles={fixture} />);

    expect(screen.getAllByText("Not watched")).toHaveLength(19);
  });
});
