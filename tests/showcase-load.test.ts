import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadShowcaseSkins } from "@/src/lib/catalog/showcase";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

interface SkinFixture {
  readonly display_icon: string | null;
  readonly display_name: string;
  readonly skin_uuid: string;
}

function skinRow(index: number): SkinFixture {
  return {
    display_icon: `https://media.valorant-api.com/weaponskins/skin-${index}/displayicon.png`,
    display_name: `Skin ${index}`,
    skin_uuid: `skin-${index}`,
  };
}

function createShowcaseClient({
  count = 0,
  countError = null,
  rows = [],
  rowsError = null,
}: {
  count?: number | null;
  countError?: unknown;
  rows?: readonly SkinFixture[];
  rowsError?: unknown;
} = {}) {
  const range = vi.fn(async () => ({
    data: rowsError ? null : rows,
    error: rowsError,
  }));
  const order = vi.fn(() => ({ range }));
  const notFilters: string[] = [];

  // A read chains `.not().not().order().range()`; a head count chains
  // `.not().not()` and is awaited straight off the last filter.
  const readChain: { not: (column: string) => unknown; order: typeof order } = {
    not: (column: string) => {
      notFilters.push(column);
      return readChain;
    },
    order,
  };

  const countChain = {
    not: () => countChain,
    then: (resolve: (value: { count: number | null; error: unknown }) => void) =>
      Promise.resolve({ count, error: countError }).then(resolve),
  };

  const select = vi.fn(
    (_columns: string, options?: { readonly head?: boolean }) =>
      options?.head ? countChain : readChain,
  );

  const client = {
    from: vi.fn(() => ({ select })),
  } as unknown as SupabaseClient<Database>;

  return { client, notFilters, range, select };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadShowcaseSkins", () => {
  it("draws a pool of tiered skins that all carry art", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => skinRow(index));
    const { client, notFilters } = createShowcaseClient({ count: 60, rows });

    const pool = await loadShowcaseSkins(client);

    expect(pool).toHaveLength(34);
    expect(new Set(pool.map((skin) => skin.skinUuid)).size).toBe(34);
    expect(pool[0]).toEqual({
      displayIcon: expect.stringContaining("displayicon.png"),
      displayName: expect.stringContaining("Skin "),
      skinUuid: expect.stringContaining("skin-"),
    });
    // Default and battlepass skins carry no content tier; a ring of grey
    // stock weapons is not a showcase.
    expect(notFilters).toContain("content_tier_uuid");
    expect(notFilters).toContain("display_icon");
  });

  it("shuffles, so two draws from the same window differ", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => skinRow(index));

    const first = await loadShowcaseSkins(
      createShowcaseClient({ count: 120, rows }).client,
    );
    const second = await loadShowcaseSkins(
      createShowcaseClient({ count: 120, rows }).client,
    );

    expect(first.map((skin) => skin.skinUuid)).not.toEqual(
      second.map((skin) => skin.skinUuid),
    );
  });

  it("reads a random window of the catalog", async () => {
    const rows = Array.from({ length: 240 }, (_, index) => skinRow(index));
    const { client, range } = createShowcaseClient({ count: 2_000, rows });

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await loadShowcaseSkins(client);

    expect(range).toHaveBeenCalledWith(880, 1_119);
  });

  it("drops rows whose art went missing", async () => {
    const rows = [
      skinRow(0),
      { display_icon: null, display_name: "Artless", skin_uuid: "skin-x" },
      skinRow(1),
    ];
    const { client } = createShowcaseClient({ count: 3, rows });

    const pool = await loadShowcaseSkins(client);

    expect(pool).toHaveLength(2);
    expect(pool.map((skin) => skin.skinUuid).sort()).toEqual([
      "skin-0",
      "skin-1",
    ]);
  });

  it("returns an empty pool rather than failing the dashboard", async () => {
    const counted = createShowcaseClient({ countError: new Error("down") });
    const read = createShowcaseClient({
      count: 10,
      rowsError: new Error("down"),
    });

    await expect(loadShowcaseSkins(counted.client)).resolves.toEqual([]);
    await expect(loadShowcaseSkins(read.client)).resolves.toEqual([]);
    await expect(
      loadShowcaseSkins(createShowcaseClient({ count: 0 }).client),
    ).resolves.toEqual([]);
  });
});
