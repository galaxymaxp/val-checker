import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  fetchValorantCatalog,
  normalizeDisplayName,
  parseValorantCatalogPayload,
  variantLabel,
} from "@/src/lib/catalog/valorant-api";

const weaponUuid = "11111111-1111-0111-0111-111111111111";
const skinUuid = "22222222-2222-4222-8222-222222222222";
const levelOneUuid = "33333333-3333-4333-8333-333333333333";
const levelTwoUuid = "44444444-4444-4444-8444-444444444444";
const contentTierUuid = "55555555-5555-4555-8555-555555555555";
const themeUuid = "66666666-6666-4666-8666-666666666666";
const chromaBaseUuid = "77777777-7777-4777-8777-777777777777";
const chromaVariantUuid = "88888888-8888-4888-8888-888888888888";
const defaultSkinUuid = "99999999-9999-4999-8999-999999999999";
const meleeWeaponUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const meleeSkinUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const meleeLevelUuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const meleeChromaUuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const meleeDefaultSkinUuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const fixture = {
  data: [
    {
      category: "EEquippableCategory::Rifle",
      defaultSkinUuid,
      displayIcon: "https://media.valorant-api.com/weapons/vandal.png",
      displayName: "Vandal",
      shopData: { category: "Rifles", categoryText: "Rifles", cost: 2900 },
      skins: [
        {
          chromas: [
            {
              displayIcon: null,
              displayName: "Prime Vandal",
              fullRender: "https://media.valorant-api.com/chromas/base-full.png",
              streamedVideo: null,
              swatch: null,
              uuid: chromaBaseUuid,
            },
            {
              displayIcon: "https://media.valorant-api.com/chromas/red.png",
              displayName: "Prime Vandal Level 4\n(Variant 1 Red)",
              fullRender: "https://media.valorant-api.com/chromas/red-full.png",
              streamedVideo: "https://media.valorant-api.com/chromas/red.mp4",
              swatch: "https://media.valorant-api.com/chromas/red-swatch.png",
              uuid: chromaVariantUuid,
            },
          ],
          contentTierUuid,
          displayIcon: "https://media.valorant-api.com/skins/example.png",
          displayName: "Prime Vandal",
          levels: [
            {
              displayIcon: "https://media.valorant-api.com/levels/one.png",
              displayName: "Prime Vandal",
              levelItem: null,
              streamedVideo: null,
              uuid: levelOneUuid,
            },
            {
              displayIcon: null,
              displayName: "Prime Vandal Level 2",
              levelItem: "EEquipmentSkinLevelItem::VFX",
              streamedVideo: "https://media.valorant-api.com/levels/two.mp4",
              uuid: levelTwoUuid,
            },
          ],
          themeUuid,
          uuid: skinUuid,
          wallpaper: "https://media.valorant-api.com/skins/wallpaper.png",
        },
      ],
      uuid: weaponUuid,
    },
    {
      category: "EEquippableCategory::Melee",
      defaultSkinUuid: meleeDefaultSkinUuid,
      displayIcon: "https://media.valorant-api.com/weapons/melee.png",
      displayName: "Melee",
      shopData: null,
      skins: [
        {
          chromas: [
            {
              displayIcon: null,
              displayName: "Standard Melee",
              fullRender: "https://media.valorant-api.com/chromas/melee-full.png",
              streamedVideo: null,
              swatch: null,
              uuid: meleeChromaUuid,
            },
          ],
          contentTierUuid: null,
          displayIcon: null,
          displayName: "Standard Melee",
          levels: [
            {
              displayIcon: null,
              displayName: "Standard Melee",
              levelItem: null,
              streamedVideo: null,
              uuid: meleeLevelUuid,
            },
          ],
          themeUuid: null,
          uuid: meleeSkinUuid,
          wallpaper: null,
        },
      ],
      uuid: meleeWeaponUuid,
    },
  ],
  status: 200,
};

describe("valorant-api catalog boundary", () => {
  it("parses a fixture into typed database rows", () => {
    expect(parseValorantCatalogPayload(fixture)).toEqual({
      skinChromas: [
        {
          chroma_uuid: chromaBaseUuid,
          display_icon: null,
          display_name: "Prime Vandal",
          full_render: "https://media.valorant-api.com/chromas/base-full.png",
          ordinal: 0,
          skin_uuid: skinUuid,
          streamed_video: null,
          swatch: null,
          variant_label: null,
        },
        {
          chroma_uuid: chromaVariantUuid,
          display_icon: "https://media.valorant-api.com/chromas/red.png",
          display_name: "Prime Vandal Level 4 (Variant 1 Red)",
          full_render: "https://media.valorant-api.com/chromas/red-full.png",
          ordinal: 1,
          skin_uuid: skinUuid,
          streamed_video: "https://media.valorant-api.com/chromas/red.mp4",
          swatch: "https://media.valorant-api.com/chromas/red-swatch.png",
          variant_label: "Variant 1 Red",
        },
        {
          chroma_uuid: meleeChromaUuid,
          display_icon: null,
          display_name: "Standard Melee",
          full_render: "https://media.valorant-api.com/chromas/melee-full.png",
          ordinal: 0,
          skin_uuid: meleeSkinUuid,
          streamed_video: null,
          swatch: null,
          variant_label: null,
        },
      ],
      skinLevels: [
        {
          display_icon: "https://media.valorant-api.com/levels/one.png",
          display_name: "Prime Vandal",
          level_item: null,
          level_uuid: levelOneUuid,
          ordinal: 0,
          skin_uuid: skinUuid,
          streamed_video: null,
        },
        {
          display_icon: null,
          display_name: "Prime Vandal Level 2",
          level_item: "EEquipmentSkinLevelItem::VFX",
          level_uuid: levelTwoUuid,
          ordinal: 1,
          skin_uuid: skinUuid,
          streamed_video: "https://media.valorant-api.com/levels/two.mp4",
        },
        {
          display_icon: null,
          display_name: "Standard Melee",
          level_item: null,
          level_uuid: meleeLevelUuid,
          ordinal: 0,
          skin_uuid: meleeSkinUuid,
          streamed_video: null,
        },
      ],
      skins: [
        {
          content_tier_uuid: contentTierUuid,
          display_icon: "https://media.valorant-api.com/skins/example.png",
          display_name: "Prime Vandal",
          full_render: "https://media.valorant-api.com/chromas/base-full.png",
          skin_uuid: skinUuid,
          theme_uuid: themeUuid,
          wallpaper: "https://media.valorant-api.com/skins/wallpaper.png",
          weapon_uuid: weaponUuid,
        },
        {
          content_tier_uuid: null,
          display_icon: null,
          display_name: "Standard Melee",
          full_render: "https://media.valorant-api.com/chromas/melee-full.png",
          skin_uuid: meleeSkinUuid,
          theme_uuid: null,
          wallpaper: null,
          weapon_uuid: meleeWeaponUuid,
        },
      ],
      weapons: [
        {
          category: "Rifle",
          default_skin_uuid: defaultSkinUuid,
          display_icon: "https://media.valorant-api.com/weapons/vandal.png",
          display_name: "Vandal",
          inventory_label: "RIFLES",
          inventory_ordinal: 2,
          shop_category: "Rifles",
          weapon_uuid: weaponUuid,
        },
        {
          category: "Melee",
          default_skin_uuid: meleeDefaultSkinUuid,
          display_icon: "https://media.valorant-api.com/weapons/melee.png",
          display_name: "Melee",
          inventory_label: "MELEE",
          inventory_ordinal: 6,
          shop_category: null,
          weapon_uuid: meleeWeaponUuid,
        },
      ],
    });
  });

  it("takes the skin full render from the base chroma", () => {
    const snapshot = parseValorantCatalogPayload(fixture);

    expect(snapshot.skins[0]?.full_render).toBe(
      fixture.data[0].skins[0].chromas[0].fullRender,
    );
  });

  it("normalizes multi-line chroma names and extracts variant labels", () => {
    expect(normalizeDisplayName("RGX 11z Pro Phantom Level 5\n(Variant 1 Red)")).toBe(
      "RGX 11z Pro Phantom Level 5 (Variant 1 Red)",
    );
    expect(variantLabel("RGX 11z Pro Phantom Level 5\n(Variant 1 Red)", 1)).toBe(
      "Variant 1 Red",
    );
    expect(variantLabel("RGX 11z Pro Phantom Level 5\n(Variant 1 Red)", 0)).toBeNull();
    expect(variantLabel("Prime Vandal", 1)).toBeNull();
  });

  it("throws a Zod error at the boundary for malformed nested data", () => {
    const malformed = structuredClone(fixture);
    malformed.data[0].skins[0].levels[0].uuid = "not-a-uuid";

    expect(() => parseValorantCatalogPayload(malformed)).toThrow(z.ZodError);
  });

  it("fails loudly when Riot introduces an unknown weapon category", () => {
    const unknown = structuredClone(fixture);
    unknown.data[0].category = "EEquippableCategory::Flamethrower";

    expect(() => parseValorantCatalogPayload(unknown)).toThrow(
      'Unknown weapon category "Flamethrower".',
    );
  });

  it("validates mocked fetch responses before returning rows", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const catalog = await fetchValorantCatalog(fetchMock);

    expect(catalog.skins).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://valorant-api.com/v1/weapons?language=en-US",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("surfaces a redacted HTTP error without parsing the body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream detail", { status: 503 }));

    await expect(fetchValorantCatalog(fetchMock)).rejects.toThrow(
      "Valorant catalog request failed with HTTP 503.",
    );
  });
});
