import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadWishlistInventory } from "@/src/lib/catalog/inventory";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

interface WeaponFixture {
  readonly category: string | null;
  readonly display_icon: string | null;
  readonly display_name: string;
  readonly inventory_label: string | null;
  readonly inventory_ordinal: number | null;
  readonly weapon_uuid: string;
}

interface WatchedFixture {
  readonly created_at: string;
  readonly skin_uuid: string;
  readonly skins: {
    readonly display_icon: string | null;
    readonly display_name: string;
    readonly skin_uuid: string;
    readonly weapon_uuid: string | null;
  };
}

function createInventoryClient({
  watchlist = [],
  watchlistError = null,
  weapons = [],
  weaponsError = null,
}: {
  watchlist?: readonly WatchedFixture[];
  watchlistError?: unknown;
  weapons?: readonly WeaponFixture[];
  weaponsError?: unknown;
} = {}) {
  const weaponsSelect = vi.fn(async () => ({
    data: weaponsError ? null : weapons,
    error: weaponsError,
  }));

  const watchlistRange = vi.fn(async (from: number, to: number) => ({
    data: watchlistError ? null : watchlist.slice(from, to + 1),
    error: watchlistError,
  }));
  const watchlistOrder = vi.fn(() => ({ range: watchlistRange }));
  const watchlistEq = vi.fn(() => ({ order: watchlistOrder }));
  const watchlistSelect = vi.fn(() => ({ eq: watchlistEq }));

  const from = vi.fn((table: string) => {
    switch (table) {
      case "watchlist":
        return { select: watchlistSelect };
      case "weapons":
        return { select: weaponsSelect };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    watchlistEq,
    watchlistOrder,
    watchlistRange,
    watchlistSelect,
    weaponsSelect,
  };
}

const userId = "11111111-1111-4111-8111-111111111111";

describe("wishlist inventory loader", () => {
  it("tiles every weapon, with the newest watched skin supplying the art", async () => {
    const { client, watchlistEq, watchlistOrder } = createInventoryClient({
      // Newest first, as the descending order clause would return.
      watchlist: [
        {
          created_at: "2026-08-16T10:00:00Z",
          skin_uuid: "skin-new",
          skins: {
            display_icon: "new.png",
            display_name: "Newest Vandal Skin",
            skin_uuid: "skin-new",
            weapon_uuid: "weapon-vandal",
          },
        },
        {
          created_at: "2026-08-15T10:00:00Z",
          skin_uuid: "skin-old",
          skins: {
            display_icon: "old.png",
            display_name: "Older Vandal Skin",
            skin_uuid: "skin-old",
            weapon_uuid: "weapon-vandal",
          },
        },
      ],
      weapons: [
        {
          category: "Rifle",
          display_icon: "vandal.png",
          display_name: "Vandal",
          inventory_label: "RIFLES",
          inventory_ordinal: 2,
          weapon_uuid: "weapon-vandal",
        },
        {
          category: "Sidearm",
          display_icon: "classic.png",
          display_name: "Classic",
          inventory_label: "SIDEARMS",
          inventory_ordinal: 0,
          weapon_uuid: "weapon-classic",
        },
      ],
    });

    const tiles = await loadWishlistInventory(client, userId);

    // Sidearms outrank rifles in the collection-screen order.
    expect(tiles).toEqual([
      {
        artSource: "weapon-default",
        categoryLabel: "SIDEARMS",
        categoryOrdinal: 0,
        displayIcon: "classic.png",
        displayName: "Classic",
        watchedCount: 0,
        watchedSkinName: null,
        weaponUuid: "weapon-classic",
      },
      {
        artSource: "watched-skin",
        categoryLabel: "RIFLES",
        categoryOrdinal: 2,
        displayIcon: "new.png",
        displayName: "Vandal",
        watchedCount: 2,
        watchedSkinName: "Newest Vandal Skin",
        weaponUuid: "weapon-vandal",
      },
    ]);
    expect(watchlistEq).toHaveBeenCalledWith("user_id", userId);
    expect(watchlistOrder).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("sorts weapons by name within a category", async () => {
    const { client } = createInventoryClient({
      weapons: [
        {
          category: "Rifle",
          display_icon: null,
          display_name: "Phantom",
          inventory_label: "RIFLES",
          inventory_ordinal: 2,
          weapon_uuid: "weapon-phantom",
        },
        {
          category: "Rifle",
          display_icon: null,
          display_name: "Bulldog",
          inventory_label: "RIFLES",
          inventory_ordinal: 2,
          weapon_uuid: "weapon-bulldog",
        },
      ],
    });

    const tiles = await loadWishlistInventory(client, userId);

    expect(tiles.map((tile) => tile.displayName)).toEqual(["Bulldog", "Phantom"]);
  });

  it("derives the category from the API enum when the columns predate the backfill", async () => {
    const { client } = createInventoryClient({
      weapons: [
        {
          category: "Sniper",
          display_icon: null,
          display_name: "Operator",
          inventory_label: null,
          inventory_ordinal: null,
          weapon_uuid: "weapon-operator",
        },
      ],
    });

    const tiles = await loadWishlistInventory(client, userId);

    expect(tiles[0]).toMatchObject({
      categoryLabel: "SNIPER RIFLES",
      categoryOrdinal: 3,
    });
  });

  it("returns a redacted error when the weapons read fails", async () => {
    const { client } = createInventoryClient({
      weaponsError: new Error("sensitive database detail"),
    });

    await expect(loadWishlistInventory(client, userId)).rejects.toThrow(
      "The inventory could not be read.",
    );
  });

  it("returns a redacted error when the watchlist read fails", async () => {
    const { client } = createInventoryClient({
      watchlistError: new Error("sensitive database detail"),
    });

    await expect(loadWishlistInventory(client, userId)).rejects.toThrow(
      "The inventory could not be read.",
    );
  });
});
