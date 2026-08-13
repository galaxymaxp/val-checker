import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  fetchValorantCatalog,
  parseValorantCatalogPayload,
} from "@/src/lib/catalog/valorant-api";

const weaponUuid = "11111111-1111-0111-0111-111111111111";
const skinUuid = "22222222-2222-4222-8222-222222222222";
const levelOneUuid = "33333333-3333-4333-8333-333333333333";
const levelTwoUuid = "44444444-4444-4444-8444-444444444444";
const contentTierUuid = "55555555-5555-4555-8555-555555555555";

const fixture = {
  data: [
    {
      category: "EEquippableCategory::Rifle",
      displayName: "Vandal",
      skins: [
        {
          contentTierUuid,
          displayIcon: "https://media.valorant-api.com/skins/example.png",
          displayName: "Prime Vandal",
          levels: [{ uuid: levelOneUuid }, { uuid: levelTwoUuid }],
          uuid: skinUuid,
        },
      ],
      uuid: weaponUuid,
    },
  ],
  status: 200,
};

describe("valorant-api catalog boundary", () => {
  it("parses a fixture into typed database rows", () => {
    expect(parseValorantCatalogPayload(fixture)).toEqual({
      skinLevels: [
        { level_uuid: levelOneUuid, ordinal: 0, skin_uuid: skinUuid },
        { level_uuid: levelTwoUuid, ordinal: 1, skin_uuid: skinUuid },
      ],
      skins: [
        {
          content_tier: contentTierUuid,
          display_icon: "https://media.valorant-api.com/skins/example.png",
          display_name: "Prime Vandal",
          skin_uuid: skinUuid,
          weapon_uuid: weaponUuid,
        },
      ],
      weapons: [
        {
          category: "Rifle",
          display_name: "Vandal",
          weapon_uuid: weaponUuid,
        },
      ],
    });
  });

  it("throws a Zod error at the boundary for malformed nested data", () => {
    const malformed = structuredClone(fixture);
    malformed.data[0].skins[0].levels = [{ uuid: "not-a-uuid" }];

    expect(() => parseValorantCatalogPayload(malformed)).toThrow(z.ZodError);
  });

  it("validates mocked fetch responses before returning rows", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const catalog = await fetchValorantCatalog(fetchMock);

    expect(catalog.skins).toHaveLength(1);
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
