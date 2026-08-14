import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  loadRiotConnectionStateWithClient,
  RiotConnectionStateError,
} from "@/src/lib/riot/connection-state";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

function stateClient(result: { data: { id: string } | null; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    eq,
    supabase: { from } as unknown as SupabaseClient<Database>,
  };
}

describe("Riot connection state loader", () => {
  it("loads only connection presence scoped to the verified user", async () => {
    const { eq, supabase } = stateClient({ data: { id: "row-id" }, error: null });

    await expect(
      loadRiotConnectionStateWithClient(supabase, "verified-user"),
    ).resolves.toBe("connected");
    expect(eq).toHaveBeenCalledWith("user_id", "verified-user");
  });

  it("returns disconnected for no row and redacts query failures", async () => {
    const missing = stateClient({ data: null, error: null });
    await expect(
      loadRiotConnectionStateWithClient(missing.supabase, "verified-user"),
    ).resolves.toBe("disconnected");

    const failed = stateClient({
      data: null,
      error: { message: "sensitive database detail" },
    });
    await expect(
      loadRiotConnectionStateWithClient(failed.supabase, "verified-user"),
    ).rejects.toThrow(RiotConnectionStateError);
  });
});
