import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadWeaponSkins } from "@/src/lib/catalog/weapon-detail";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

interface SkinFixture {
  readonly content_tier_uuid: string | null;
  readonly display_icon: string | null;
  readonly display_name: string;
  readonly full_render: string | null;
  readonly skin_uuid: string;
}

interface TierFixture {
  readonly content_tier_uuid: string;
  readonly display_icon: string | null;
  readonly display_name: string;
  readonly highlight_color: string | null;
  readonly rank: number;
}

function createWeaponDetailClient({
  count = 0,
  skins = [],
  tiers = [],
  watchlist = [],
  weapon = null,
  weaponError = null,
}: {
  count?: number;
  skins?: readonly SkinFixture[];
  tiers?: readonly TierFixture[];
  watchlist?: readonly { skin_uuid: string }[];
  weapon?: { display_name: string; weapon_uuid: string } | null;
  weaponError?: unknown;
} = {}) {
  const weaponMaybeSingle = vi.fn(async () => ({
    data: weaponError ? null : weapon,
    error: weaponError,
  }));
  const weaponEq = vi.fn(() => ({ maybeSingle: weaponMaybeSingle }));
  const weaponSelect = vi.fn(() => ({ eq: weaponEq }));

  const skinsRange = vi.fn(async () => ({ count, data: skins, error: null }));
  const skinsOrder = vi.fn(() => ({ range: skinsRange }));
  const skinsEq = vi.fn(() => ({ order: skinsOrder }));
  const skinsSelect = vi.fn(() => ({ eq: skinsEq }));

  const tiersSelect = vi.fn(async () => ({ data: tiers, error: null }));

  const watchlistIn = vi.fn<
    (column: string, skinUuids: readonly string[]) => Promise<{ data: typeof watchlist; error: null }>
  >(async () => ({ data: watchlist, error: null }));
  const watchlistConnectionEq = vi.fn(() => ({ in: watchlistIn }));
  const watchlistEq = vi.fn(() => ({ eq: watchlistConnectionEq }));
  const watchlistSelect = vi.fn(() => ({ eq: watchlistEq }));

  const from = vi.fn((table: string) => {
    switch (table) {
      case "content_tiers":
        return { select: tiersSelect };
      case "skins":
        return { select: skinsSelect };
      case "watchlist":
        return { select: watchlistSelect };
      case "weapons":
        return { select: weaponSelect };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    skinsRange,
    skinsSelect,
    watchlistIn,
    watchlistConnectionEq,
  };
}

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("weapon detail loader", () => {
  it("assembles a page with watched flags and resolved tiers", async () => {
    const { client, skinsRange, skinsSelect, watchlistIn } = createWeaponDetailClient({
      count: 5,
      skins: [
        {
          content_tier_uuid: "tier-deluxe",
          display_icon: "a.png",
          display_name: "Skin A",
          full_render: "a-full.png",
          skin_uuid: "skin-a",
        },
        {
          content_tier_uuid: "tier-deluxe",
          display_icon: null,
          display_name: "Skin B",
          full_render: null,
          skin_uuid: "skin-b",
        },
        {
          content_tier_uuid: null,
          display_icon: null,
          display_name: "Skin C",
          full_render: null,
          skin_uuid: "skin-c",
        },
      ],
      tiers: [
        {
          content_tier_uuid: "tier-deluxe",
          display_icon: "deluxe.png",
          display_name: "Deluxe Edition",
          highlight_color: "009587ff",
          rank: 1,
        },
      ],
      watchlist: [{ skin_uuid: "skin-b" }],
      weapon: { display_name: "Vandal", weapon_uuid: "weapon-vandal" },
    });

    const view = await loadWeaponSkins(
      client,
      "weapon-vandal",
      { limit: 3, offset: 0 },
      userId,
      connectionId,
    );

    const deluxe = {
      contentTierUuid: "tier-deluxe",
      displayIcon: "deluxe.png",
      displayName: "Deluxe Edition",
      highlightColor: "009587ff",
      rank: 1,
    };

    expect(view).toEqual({
      hasMore: true,
      skins: [
        {
          displayIcon: "a.png",
          displayName: "Skin A",
          fullRender: "a-full.png",
          skinUuid: "skin-a",
          tier: deluxe,
          watched: false,
        },
        {
          displayIcon: null,
          displayName: "Skin B",
          fullRender: null,
          skinUuid: "skin-b",
          tier: deluxe,
          watched: true,
        },
        {
          displayIcon: null,
          displayName: "Skin C",
          fullRender: null,
          skinUuid: "skin-c",
          tier: null,
          watched: false,
        },
      ],
      total: 5,
      weaponName: "Vandal",
      weaponUuid: "weapon-vandal",
    });
    expect(skinsSelect).toHaveBeenCalledWith(
      "skin_uuid, display_name, display_icon, full_render, content_tier_uuid",
      { count: "exact" },
    );
    expect(skinsRange).toHaveBeenCalledWith(0, 2);
    expect(watchlistIn).toHaveBeenCalledWith("skin_uuid", ["skin-a", "skin-b", "skin-c"]);
  });

  it("reports the final page as having no more rows", async () => {
    const { client, skinsRange } = createWeaponDetailClient({
      count: 5,
      skins: [
        {
          content_tier_uuid: null,
          display_icon: null,
          display_name: "Skin E",
          full_render: null,
          skin_uuid: "skin-e",
        },
      ],
      weapon: { display_name: "Vandal", weapon_uuid: "weapon-vandal" },
    });

    const view = await loadWeaponSkins(
      client,
      "weapon-vandal",
      { limit: 4, offset: 4 },
      userId,
      connectionId,
    );

    expect(view.hasMore).toBe(false);
    expect(view.total).toBe(5);
    expect(skinsRange).toHaveBeenCalledWith(4, 7);
  });

  it("skips the watchlist read when the page is empty", async () => {
    const { client, from } = createWeaponDetailClient({
      count: 0,
      weapon: { display_name: "Vandal", weapon_uuid: "weapon-vandal" },
    });

    const view = await loadWeaponSkins(
      client,
      "weapon-vandal",
      { limit: 10, offset: 0 },
      userId,
      connectionId,
    );

    expect(view.skins).toEqual([]);
    expect(view.hasMore).toBe(false);
    expect(from.mock.calls.filter(([table]) => table === "watchlist")).toHaveLength(0);
  });

  it("throws when the weapon does not exist", async () => {
    const { client } = createWeaponDetailClient({ weapon: null });

    await expect(
      loadWeaponSkins(client, "weapon-missing", { limit: 10, offset: 0 }, userId, connectionId),
    ).rejects.toThrow("The weapon could not be found.");
  });

  it("returns a redacted error when a read fails", async () => {
    const { client } = createWeaponDetailClient({
      weaponError: new Error("sensitive database detail"),
    });

    await expect(
      loadWeaponSkins(client, "weapon-vandal", { limit: 10, offset: 0 }, userId, connectionId),
    ).rejects.toThrow("The weapon skins could not be read.");
  });
});
