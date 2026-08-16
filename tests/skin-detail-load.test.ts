import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadSkinDetail } from "@/src/lib/catalog/skin-detail";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

interface SkinFixture {
  readonly content_tier_uuid: string | null;
  readonly display_name: string;
  readonly full_render: string | null;
  readonly skin_uuid: string;
  readonly wallpaper: string | null;
  readonly weapon_uuid: string | null;
}

interface LevelFixture {
  readonly display_icon: string | null;
  readonly display_name: string | null;
  readonly level_item: string | null;
  readonly level_uuid: string;
  readonly ordinal: number | null;
  readonly streamed_video: string | null;
}

interface ChromaFixture {
  readonly chroma_uuid: string;
  readonly display_icon: string | null;
  readonly full_render: string | null;
  readonly ordinal: number;
  readonly streamed_video: string | null;
  readonly swatch: string | null;
  readonly variant_label: string | null;
}

function createSkinDetailClient({
  chromas = [],
  levels = [],
  skin = null,
  tier = null,
  weapon = null,
}: {
  chromas?: readonly ChromaFixture[];
  levels?: readonly LevelFixture[];
  skin?: SkinFixture | null;
  tier?: {
    content_tier_uuid: string;
    display_icon: string | null;
    display_name: string;
    highlight_color: string | null;
    rank: number;
  } | null;
  weapon?: { display_name: string; weapon_uuid: string } | null;
} = {}) {
  const skinMaybeSingle = vi.fn(async () => ({ data: skin, error: null }));
  const skinEq = vi.fn(() => ({ maybeSingle: skinMaybeSingle }));
  const skinSelect = vi.fn(() => ({ eq: skinEq }));

  const levelsOrder = vi.fn(async () => ({ data: levels, error: null }));
  const levelsEq = vi.fn(() => ({ order: levelsOrder }));
  const levelsSelect = vi.fn(() => ({ eq: levelsEq }));

  const chromasOrder = vi.fn(async () => ({ data: chromas, error: null }));
  const chromasEq = vi.fn(() => ({ order: chromasOrder }));
  const chromasSelect = vi.fn(() => ({ eq: chromasEq }));

  const weaponMaybeSingle = vi.fn(async () => ({ data: weapon, error: null }));
  const weaponEq = vi.fn(() => ({ maybeSingle: weaponMaybeSingle }));
  const weaponSelect = vi.fn(() => ({ eq: weaponEq }));

  const tierMaybeSingle = vi.fn(async () => ({ data: tier, error: null }));
  const tierEq = vi.fn(() => ({ maybeSingle: tierMaybeSingle }));
  const tierSelect = vi.fn(() => ({ eq: tierEq }));

  const from = vi.fn((table: string) => {
    switch (table) {
      case "content_tiers":
        return { select: tierSelect };
      case "skin_chromas":
        return { select: chromasSelect };
      case "skin_levels":
        return { select: levelsSelect };
      case "skins":
        return { select: skinSelect };
      case "weapons":
        return { select: weaponSelect };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    tierEq,
  };
}

describe("skin detail loader", () => {
  it("assembles the full detail view with levels and chromas in ordinal order", async () => {
    const { client, tierEq } = createSkinDetailClient({
      // Deliberately out of order to prove the loader sorts by ordinal.
      chromas: [
        {
          chroma_uuid: "chroma-two",
          display_icon: "chroma-two.png",
          full_render: "chroma-two-full.png",
          ordinal: 2,
          streamed_video: null,
          swatch: "swatch-two.png",
          variant_label: "Gold",
        },
        {
          chroma_uuid: "chroma-one",
          display_icon: null,
          full_render: null,
          ordinal: 1,
          streamed_video: "chroma-one.mp4",
          swatch: null,
          variant_label: null,
        },
      ],
      levels: [
        {
          display_icon: null,
          display_name: "Level 2",
          level_item: "EEquipmentSkinLevelItem::VFX",
          level_uuid: "level-two",
          ordinal: 2,
          streamed_video: "level-two.mp4",
        },
        {
          display_icon: "level-one.png",
          display_name: "Level 1",
          level_item: null,
          level_uuid: "level-one",
          ordinal: 1,
          streamed_video: null,
        },
      ],
      skin: {
        content_tier_uuid: "tier-exclusive",
        display_name: "Elderflame Vandal",
        full_render: "elderflame.png",
        skin_uuid: "skin-elderflame",
        wallpaper: "elderflame-wall.png",
        weapon_uuid: "weapon-vandal",
      },
      tier: {
        content_tier_uuid: "tier-exclusive",
        display_icon: "exclusive.png",
        display_name: "Exclusive Edition",
        highlight_color: "f5955bff",
        rank: 3,
      },
      weapon: { display_name: "Vandal", weapon_uuid: "weapon-vandal" },
    });

    const view = await loadSkinDetail(client, "skin-elderflame");

    expect(view).toEqual({
      chromas: [
        {
          chromaUuid: "chroma-one",
          displayIcon: null,
          fullRender: null,
          ordinal: 1,
          streamedVideo: "chroma-one.mp4",
          swatch: null,
          variantLabel: null,
        },
        {
          chromaUuid: "chroma-two",
          displayIcon: "chroma-two.png",
          fullRender: "chroma-two-full.png",
          ordinal: 2,
          streamedVideo: null,
          swatch: "swatch-two.png",
          variantLabel: "Gold",
        },
      ],
      displayName: "Elderflame Vandal",
      fullRender: "elderflame.png",
      levels: [
        {
          displayIcon: "level-one.png",
          displayName: "Level 1",
          levelItem: null,
          levelUuid: "level-one",
          ordinal: 1,
          streamedVideo: null,
        },
        {
          displayIcon: null,
          displayName: "Level 2",
          levelItem: "EEquipmentSkinLevelItem::VFX",
          levelUuid: "level-two",
          ordinal: 2,
          streamedVideo: "level-two.mp4",
        },
      ],
      skinUuid: "skin-elderflame",
      tier: {
        contentTierUuid: "tier-exclusive",
        displayIcon: "exclusive.png",
        displayName: "Exclusive Edition",
        highlightColor: "f5955bff",
        rank: 3,
      },
      wallpaper: "elderflame-wall.png",
      weaponName: "Vandal",
      weaponUuid: "weapon-vandal",
    });
    expect(tierEq).toHaveBeenCalledWith("content_tier_uuid", "tier-exclusive");
  });

  it("returns a null tier without querying when the skin has none", async () => {
    const { client, from } = createSkinDetailClient({
      skin: {
        content_tier_uuid: null,
        display_name: "Tierless Skin",
        full_render: null,
        skin_uuid: "skin-tierless",
        wallpaper: null,
        weapon_uuid: "weapon-vandal",
      },
      weapon: { display_name: "Vandal", weapon_uuid: "weapon-vandal" },
    });

    const view = await loadSkinDetail(client, "skin-tierless");

    expect(view.tier).toBeNull();
    expect(view.levels).toEqual([]);
    expect(view.chromas).toEqual([]);
    expect(from.mock.calls.filter(([table]) => table === "content_tiers")).toHaveLength(0);
  });

  it("throws when the skin does not exist", async () => {
    const { client } = createSkinDetailClient({ skin: null });

    await expect(loadSkinDetail(client, "skin-missing")).rejects.toThrow(
      "The skin could not be found.",
    );
  });
});
