import { beforeEach, describe, expect, it, vi } from "vitest";

const adminDelete = vi.fn();
const createAdminSupabaseClient = vi.fn(() => ({
  from: () => ({ delete: adminDelete }),
}));
const deleteEq = vi.fn();
const getClaims = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

describe("Riot disconnect server action", () => {
  beforeEach(() => {
    adminDelete.mockReset();
    adminDelete.mockReturnValue({ eq: deleteEq });
    createAdminSupabaseClient.mockClear();
    deleteEq.mockReset();
    deleteEq.mockResolvedValue({ error: null });
    getClaims.mockReset();
    revalidatePath.mockReset();
  });

  it("deletes only the verified user's service-role row", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(disconnectRiotSession()).resolves.toEqual({ ok: true });
    expect(deleteEq).toHaveBeenCalledWith("user_id", "verified-user");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects unauthenticated disconnects before creating an admin client", async () => {
    getClaims.mockResolvedValue({ data: { claims: {} } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(disconnectRiotSession()).resolves.toEqual({
      error: "Please sign in again.",
      ok: false,
    });
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it("returns a redacted error without revalidating on storage failure", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    deleteEq.mockResolvedValue({ error: { message: "sensitive database detail" } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(disconnectRiotSession()).resolves.toEqual({
      error: "The Riot session could not be disconnected.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
