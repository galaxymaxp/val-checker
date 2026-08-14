import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadCatalogForBrowse } from "@/src/lib/catalog/browse";
import type { Database } from "@/src/types/database";

type SkinRow = Database["public"]["Tables"]["skins"]["Row"];
type WeaponRow = Database["public"]["Tables"]["weapons"]["Row"];

function createCatalogClient({
  skins = [],
  skinsError = null,
  weapons = [],
  weaponsError = null,
}: {
  skins?: readonly SkinRow[];
  skinsError?: unknown;
  weapons?: readonly WeaponRow[];
  weaponsError?: unknown;
} = {}) {
  const skinRange = vi.fn(async (from: number, to: number) => ({
    data: skinsError ? null : skins.slice(from, to + 1),
    error: skinsError,
  }));
  const skinOrder = vi.fn();
  const skinSelect = vi.fn();
  const skinQuery = { order: skinOrder, range: skinRange, select: skinSelect };
  skinOrder.mockReturnValue(skinQuery);
  skinSelect.mockReturnValue(skinQuery);

  const weaponOrder = vi.fn(async () => ({
    data: weaponsError ? null : weapons,
    error: weaponsError,
  }));
  const weaponSelect = vi.fn(() => ({ order: weaponOrder }));
  const from = vi.fn((table: string) =>
    table === "skins" ? skinQuery : { select: weaponSelect },
  );

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    skinOrder,
    skinRange,
    skinSelect,
    weaponOrder,
    weaponSelect,
  };
}

const vandal: WeaponRow = {
  category: "Rifle",
  display_name: "Vandal",
  weapon_uuid: "weapon-vandal",
};

function skinRow(index: number, weaponUuid: string | null = vandal.weapon_uuid): SkinRow {
  return {
    content_tier: index % 2 === 0 ? "Exclusive" : null,
    display_icon: index % 2 === 0 ? `https://example.test/skin-${index}.png` : null,
    display_name: `Skin ${index.toString().padStart(4, "0")}`,
    first_seen_at: "2026-08-13T00:00:00.000Z",
    skin_uuid: `skin-${index.toString().padStart(4, "0")}`,
    weapon_uuid: weaponUuid,
  };
}

describe("catalog browse loader", () => {
  it("maps skins to weapons and falls back to Other for a null category", async () => {
    const classic: WeaponRow = {
      category: null,
      display_name: "Classic",
      weapon_uuid: "weapon-classic",
    };
    const { client, from, skinOrder, skinRange, weaponOrder } = createCatalogClient({
      skins: [skinRow(1), skinRow(2)],
      weapons: [classic, vandal],
    });

    await expect(loadCatalogForBrowse(client)).resolves.toEqual([
      {
        category: "Other",
        displayName: "Classic",
        skins: [],
        weaponUuid: "weapon-classic",
      },
      {
        category: "Rifle",
        displayName: "Vandal",
        skins: [
          {
            contentTier: null,
            displayIcon: null,
            displayName: "Skin 0001",
            skinUuid: "skin-0001",
          },
          {
            contentTier: "Exclusive",
            displayIcon: "https://example.test/skin-2.png",
            displayName: "Skin 0002",
            skinUuid: "skin-0002",
          },
        ],
        weaponUuid: "weapon-vandal",
      },
    ]);
    expect(from).toHaveBeenCalledWith("weapons");
    expect(from).toHaveBeenCalledWith("skins");
    expect(weaponOrder).toHaveBeenCalledWith("display_name");
    expect(skinOrder).toHaveBeenCalledWith("display_name");
    expect(skinRange).toHaveBeenCalledWith(0, 999);
  });

  it("loads every skin page without skipping a page boundary", async () => {
    const skins = Array.from({ length: 1_001 }, (_, index) => skinRow(index));
    const { client, skinRange } = createCatalogClient({ skins, weapons: [vandal] });

    const catalog = await loadCatalogForBrowse(client);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.skins).toHaveLength(1_001);
    expect(catalog[0]?.skins[0]?.skinUuid).toBe("skin-0000");
    expect(catalog[0]?.skins[1_000]?.skinUuid).toBe("skin-1000");
    expect(skinRange.mock.calls).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("rejects a skin without a parent weapon", async () => {
    const { client } = createCatalogClient({
      skins: [skinRow(1, null)],
      weapons: [vandal],
    });

    await expect(loadCatalogForBrowse(client)).rejects.toThrow(
      "Catalog browse found a skin without a parent weapon.",
    );
  });

  it.each([
    {
      expected: "Catalog browse failed while reading weapons.",
      options: { weaponsError: new Error("sensitive weapons detail") },
    },
    {
      expected: "Catalog browse failed while reading skins.",
      options: { skinsError: new Error("sensitive skins detail") },
    },
  ])("redacts database errors as $expected", async ({ expected, options }) => {
    const { client } = createCatalogClient(options);

    await expect(loadCatalogForBrowse(client)).rejects.toThrow(expected);
  });
});
