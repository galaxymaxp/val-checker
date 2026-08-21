import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadDailyShops } from "@/src/lib/storefront/daily-shop";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

interface ClientFixture {
  readonly checks?: readonly {
    checked_at: string;
    connection_id: string;
    expires_at: string | null;
    offer_skin_uuids: string[] | null;
    rotation_date: string;
  }[];
  readonly connections?: readonly { id: string; label: string | null }[];
  readonly skins?: readonly {
    display_icon: string | null;
    display_name: string;
    skin_uuid: string;
  }[];
  readonly watchlist?: readonly { skin_uuid: string }[];
}

function createShopClient({
  checks = [],
  connections = [],
  skins = [],
  watchlist = [],
}: ClientFixture = {}) {
  const connectionsOrder = vi.fn(async () => ({ data: connections, error: null }));
  const connectionsEq = vi.fn(() => ({ order: connectionsOrder }));
  const connectionsSelect = vi.fn(() => ({ eq: connectionsEq }));

  const checksOrder = vi.fn(async () => ({ data: checks, error: null }));
  const checksIn = vi.fn<(column: string, connectionIds: readonly string[]) => { order: typeof checksOrder }>(
    () => ({ order: checksOrder }),
  );
  const checksSelect = vi.fn(() => ({ in: checksIn }));

  const skinsIn = vi.fn<(column: string, skinUuids: readonly string[]) => Promise<{ data: typeof skins; error: null }>>(
    async () => ({ data: skins, error: null }),
  );
  const skinsSelect = vi.fn(() => ({ in: skinsIn }));

  const watchlistIn = vi.fn<(column: string, skinUuids: readonly string[]) => Promise<{ data: typeof watchlist; error: null }>>(
    async () => ({ data: watchlist, error: null }),
  );
  const watchlistEq = vi.fn(() => ({ in: watchlistIn }));
  const watchlistSelect = vi.fn(() => ({ eq: watchlistEq }));

  const from = vi.fn((table: string) => {
    switch (table) {
      case "riot_connections":
        return { select: connectionsSelect };
      case "shop_checks":
        return { select: checksSelect };
      case "skins":
        return { select: skinsSelect };
      case "watchlist":
        return { select: watchlistSelect };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return {
    checksIn,
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    skinsIn,
    watchlistIn,
  };
}

const userId = "11111111-1111-4111-8111-111111111111";

describe("daily shop with multiple Riot accounts", () => {
  it("returns one view per connection, in connection creation order", async () => {
    const { checksIn, client, from, skinsIn, watchlistIn } = createShopClient({
      // Newest rotation first, as the descending order clause would return.
      checks: [
        {
          checked_at: "2026-08-16T00:05:00Z",
          connection_id: "conn-one",
          expires_at: "2026-08-17T00:00:00Z",
          offer_skin_uuids: ["skin-a", "skin-b"],
          rotation_date: "2026-08-16",
        },
        {
          checked_at: "2026-08-16T00:06:00Z",
          connection_id: "conn-two",
          expires_at: null,
          offer_skin_uuids: ["skin-b", "skin-c"],
          rotation_date: "2026-08-16",
        },
        {
          checked_at: "2026-08-15T00:05:00Z",
          connection_id: "conn-one",
          expires_at: null,
          offer_skin_uuids: ["skin-stale"],
          rotation_date: "2026-08-15",
        },
      ],
      connections: [
        { id: "conn-one", label: "Main" },
        { id: "conn-two", label: null },
      ],
      skins: [
        { display_icon: "a.png", display_name: "Skin A", skin_uuid: "skin-a" },
        { display_icon: null, display_name: "Skin B", skin_uuid: "skin-b" },
        { display_icon: "c.png", display_name: "Skin C", skin_uuid: "skin-c" },
      ],
      watchlist: [{ skin_uuid: "skin-c" }],
    });

    const views = await loadDailyShops(client, userId);

    expect(views).toHaveLength(2);
    expect(views[0]).toEqual({
      bundle: null,
      checkedAt: "2026-08-16T00:05:00Z",
      connectionId: "conn-one",
      expiresAt: "2026-08-17T00:00:00Z",
      label: "Main",
      nightMarket: null,
      offers: [
        {
          displayIcon: "a.png",
          displayName: "Skin A",
          price: null,
          skinUuid: "skin-a",
          tierName: null,
          watched: false,
          weaponName: null,
        },
        {
          displayIcon: null,
          displayName: "Skin B",
          price: null,
          skinUuid: "skin-b",
          tierName: null,
          watched: false,
          weaponName: null,
        },
      ],
      rotationDate: "2026-08-16",
    });
    expect(views[1]).toEqual({
      bundle: null,
      checkedAt: "2026-08-16T00:06:00Z",
      connectionId: "conn-two",
      expiresAt: null,
      label: null,
      nightMarket: null,
      offers: [
        {
          displayIcon: null,
          displayName: "Skin B",
          price: null,
          skinUuid: "skin-b",
          tierName: null,
          watched: false,
          weaponName: null,
        },
        {
          displayIcon: "c.png",
          displayName: "Skin C",
          price: null,
          skinUuid: "skin-c",
          tierName: null,
          watched: true,
          weaponName: null,
        },
      ],
      rotationDate: "2026-08-16",
    });

    expect(checksIn).toHaveBeenCalledWith("connection_id", ["conn-one", "conn-two"]);
    // One catalog read and one watchlist read, no matter how many accounts.
    expect(from.mock.calls.filter(([table]) => table === "skins")).toHaveLength(1);
    expect(from.mock.calls.filter(([table]) => table === "watchlist")).toHaveLength(1);
    expect(skinsIn.mock.calls[0]?.[1]).toEqual(["skin-a", "skin-b", "skin-c"]);
    expect(watchlistIn.mock.calls[0]?.[1]).toEqual(["skin-a", "skin-b", "skin-c"]);
  });

  it("returns an empty list for a login with no connections", async () => {
    const { client, from } = createShopClient();

    await expect(loadDailyShops(client, userId)).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("riot_connections");
  });

  it("skips connections the worker has not checked yet", async () => {
    const { client, from } = createShopClient({
      checks: [
        {
          checked_at: "2026-08-16T00:05:00Z",
          connection_id: "conn-two",
          expires_at: null,
          offer_skin_uuids: [],
          rotation_date: "2026-08-16",
        },
      ],
      connections: [
        { id: "conn-one", label: null },
        { id: "conn-two", label: "Alt" },
      ],
    });

    const views = await loadDailyShops(client, userId);

    expect(views).toHaveLength(1);
    expect(views[0]?.connectionId).toBe("conn-two");
    expect(views[0]?.offers).toEqual([]);
    // An empty skin union skips the catalog and watchlist reads entirely.
    expect(from.mock.calls.filter(([table]) => table === "skins")).toHaveLength(0);
    expect(from.mock.calls.filter(([table]) => table === "watchlist")).toHaveLength(0);
  });
});
