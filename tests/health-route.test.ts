import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

describe("database health route", () => {
  beforeEach(() => rpc.mockReset());

  it("returns ok only when the service-only select-one RPC succeeds", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(rpc).toHaveBeenCalledWith("health_check");
  });

  it("returns a redacted unavailable response on database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sensitive-upstream-detail" } });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
