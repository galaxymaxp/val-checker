import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteEqSkin = vi.fn();
const deleteEqUser = vi.fn(() => ({ eq: deleteEqSkin }));
const deleteRows = vi.fn(() => ({ eq: deleteEqUser }));
const getClaims = vi.fn();
const revalidatePath = vi.fn();
const upsert = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getClaims },
    from: () => ({ delete: deleteRows, upsert }),
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
    revalidatePath.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it("derives user ownership from verified claims when adding", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      {
        skin_uuid: skinUuid,
        user_id: "verified-user",
      },
      {
        ignoreDuplicates: true,
        onConflict: "user_id,skin_uuid",
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("treats replayed watched=true requests as successful", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({ ok: true });
    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed watched values before authentication", async () => {
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, "true")).resolves.toEqual({
      error: "This watch request is not valid.",
      ok: false,
    });
    expect(getClaims).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteRows).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid skin UUID before authentication", async () => {
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched("not-a-uuid", true)).resolves.toEqual({
      error: "This skin is not valid.",
      ok: false,
    });
    expect(getClaims).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteRows).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated mutation", async () => {
    getClaims.mockResolvedValue({ data: { claims: {} } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({
      error: "Please sign in again.",
      ok: false,
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteRows).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removes only the verified user's matching row", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, false)).resolves.toEqual({ ok: true });
    expect(deleteEqUser).toHaveBeenCalledWith("user_id", "verified-user");
    expect(deleteEqSkin).toHaveBeenCalledWith("skin_uuid", skinUuid);
  });

  it("treats replayed watched=false requests as successful", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, false)).resolves.toEqual({ ok: true });
    await expect(setSkinWatched(skinUuid, false)).resolves.toEqual({ ok: true });
    expect(deleteRows).toHaveBeenCalledTimes(2);
    expect(deleteEqUser).toHaveBeenCalledTimes(2);
    expect(deleteEqUser).toHaveBeenCalledWith("user_id", "verified-user");
    expect(deleteEqSkin).toHaveBeenCalledTimes(2);
    expect(deleteEqSkin).toHaveBeenCalledWith("skin_uuid", skinUuid);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("returns a redacted error when the database rejects a mutation", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    upsert.mockResolvedValue({ error: { message: "sensitive database detail" } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(skinUuid, true)).resolves.toEqual({
      error: "Your watchlist could not be updated.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
