import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteEqSkin = vi.fn();
const deleteEqUser = vi.fn(() => ({ eq: deleteEqSkin }));
const deleteRows = vi.fn(() => ({ eq: deleteEqUser }));
const getClaims = vi.fn();
const insert = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getClaims },
    from: () => ({ delete: deleteRows, insert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const skinUuid = "11111111-1111-0111-0111-111111111111";

describe("watchlist server action", () => {
  beforeEach(() => {
    deleteEqSkin.mockReset();
    deleteEqSkin.mockResolvedValue({ error: null });
    deleteEqUser.mockClear();
    deleteRows.mockClear();
    getClaims.mockReset();
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    revalidatePath.mockReset();
  });

  it("derives user ownership from verified claims when adding", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      skin_uuid: skinUuid,
      user_id: "verified-user",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("removes only the verified user's matching row", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, false)).resolves.toEqual({ ok: true });
    expect(deleteEqUser).toHaveBeenCalledWith("user_id", "verified-user");
    expect(deleteEqSkin).toHaveBeenCalledWith("skin_uuid", skinUuid);
  });

  it("returns a redacted error when the database rejects a mutation", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    insert.mockResolvedValue({ error: { message: "sensitive database detail" } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({
      error: "Your watchlist could not be updated.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
