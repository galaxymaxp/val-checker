import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  fetchValorantContentTiers,
  parseValorantContentTiersPayload,
} from "@/src/lib/catalog/valorant-api";

function tier(
  uuid: string,
  devName: string,
  displayName: string,
  rank: number,
  highlightColor: string,
) {
  return {
    assetPath: `ShooterGame/Content/${devName}`,
    devName,
    displayIcon: `https://media.valorant-api.com/contenttiers/${uuid}/displayicon.png`,
    displayName,
    highlightColor,
    juiceCost: 10,
    juiceValue: 10,
    rank,
    uuid,
  };
}

const fixture = {
  data: [
    tier("12683d76-48d7-84a3-4e09-6985794f11ed", "Select", "Select Edition", 0, "5a9fe1ff"),
    tier("0cebb8be-46d7-c12a-d306-e9907bfc5a25", "Deluxe", "Deluxe Edition", 1, "009587ff"),
    tier("60bca009-4182-7998-dee7-b8a2558dc369", "Premium", "Premium Edition", 2, "d1548dff"),
    tier("411e4a55-4e59-7757-41f0-86a53f101bb5", "Ultra", "Ultra Edition", 3, "efeb65ff"),
    tier("e046854e-406c-37f4-6607-19a9ba8426fc", "Exclusive", "Exclusive Edition", 4, "f5955bff"),
  ],
  status: 200,
};

describe("valorant-api content tier boundary", () => {
  it("parses a five-tier fixture into typed database rows", () => {
    const snapshot = parseValorantContentTiersPayload(fixture);

    expect(snapshot.contentTiers).toHaveLength(5);
    expect(snapshot.contentTiers[1]).toEqual({
      content_tier_uuid: "0cebb8be-46d7-c12a-d306-e9907bfc5a25",
      dev_name: "Deluxe",
      display_icon:
        "https://media.valorant-api.com/contenttiers/0cebb8be-46d7-c12a-d306-e9907bfc5a25/displayicon.png",
      display_name: "Deluxe Edition",
      // Raw upstream RGBA hex, stored without a leading "#".
      highlight_color: "009587ff",
      rank: 1,
    });
    expect(snapshot.contentTiers.map((row) => row.rank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("throws a Zod error for an invalid payload", () => {
    expect(() => parseValorantContentTiersPayload({ data: "nope", status: 200 })).toThrow(
      z.ZodError,
    );
    expect(() =>
      parseValorantContentTiersPayload({ data: fixture.data, status: 500 }),
    ).toThrow(z.ZodError);
  });

  it("validates mocked fetch responses before returning rows", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const snapshot = await fetchValorantContentTiers(fetchMock);

    expect(snapshot.contentTiers).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://valorant-api.com/v1/contenttiers?language=en-US",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("surfaces a redacted HTTP error without parsing the body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream detail", { status: 503 }));

    await expect(fetchValorantContentTiers(fetchMock)).rejects.toThrow(
      "Valorant content tier request failed with HTTP 503.",
    );
  });
});
