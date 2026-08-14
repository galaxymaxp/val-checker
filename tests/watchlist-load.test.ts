import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadWatchedSkinUuids } from "@/src/lib/watchlist/load";
import type { Database } from "@/src/types/database";

function createWatchlistClient({
  error = null,
  rows = [],
}: {
  error?: unknown;
  rows?: readonly { skin_uuid: string }[] | null;
} = {}) {
  const range = vi.fn(async (from: number, to: number) => ({
    data: error || rows === null ? null : rows.slice(from, to + 1),
    error,
  }));
  const order = vi.fn();
  const select = vi.fn();
  const query = { order, range, select };
  order.mockReturnValue(query);
  select.mockReturnValue(query);
  const from = vi.fn(() => query);

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    order,
    range,
    select,
  };
}

describe("watchlist loader", () => {
  it("loads a small watchlist in deterministic order", async () => {
    const { client, from, order, range, select } = createWatchlistClient({
      rows: [{ skin_uuid: "skin-one" }, { skin_uuid: "skin-two" }],
    });

    await expect(loadWatchedSkinUuids(client)).resolves.toEqual(["skin-one", "skin-two"]);
    expect(from).toHaveBeenCalledWith("watchlist");
    expect(select).toHaveBeenCalledWith("skin_uuid");
    expect(order.mock.calls).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(range.mock.calls).toEqual([[0, 999]]);
  });

  it("treats a null response as an empty watchlist", async () => {
    const { client, range } = createWatchlistClient({ rows: null });

    await expect(loadWatchedSkinUuids(client)).resolves.toEqual([]);
    expect(range).toHaveBeenCalledTimes(1);
  });

  it("returns a redacted error when loading fails", async () => {
    const { client } = createWatchlistClient({
      error: new Error("sensitive database detail"),
    });

    await expect(loadWatchedSkinUuids(client)).rejects.toThrow(
      "Watchlist could not be loaded.",
    );
  });
});
