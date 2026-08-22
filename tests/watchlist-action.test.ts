import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteEqSkin = vi.fn();
const deleteEqConnection = vi.fn(() => ({ eq: deleteEqSkin }));
const deleteEqUser = vi.fn(() => ({ eq: deleteEqConnection }));
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
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("watchlist server action", () => {
  beforeEach(() => {
    deleteEqSkin.mockReset();
    deleteEqSkin.mockResolvedValue({ error: null });
    deleteEqConnection.mockClear();
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

    await expect(setSkinWatched(connectionId, skinUuid, true)).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      {
        connection_id: connectionId,
        skin_uuid: skinUuid,
        user_id: "verified-user",
      },
      {
        ignoreDuplicates: true,
        onConflict: "connection_id,skin_uuid",
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("treats replayed watched=true requests as successful", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(connectionId, skinUuid, true)).resolves.toEqual({ ok: true });
    await expect(setSkinWatched(connectionId, skinUuid, true)).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("keeps add and remove mutations scoped to the selected Riot account", async () => {
    const otherConnectionId = "33333333-3333-4333-8333-333333333333";
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await setSkinWatched(connectionId, skinUuid, true);
    await setSkinWatched(otherConnectionId, skinUuid, true);
    await setSkinWatched(connectionId, skinUuid, false);

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ connection_id: connectionId }),
      expect.anything(),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ connection_id: otherConnectionId }),
      expect.anything(),
    );
    expect(deleteEqConnection).toHaveBeenCalledWith(
      "connection_id",
      connectionId,
    );
    expect(deleteEqConnection).not.toHaveBeenCalledWith(
      "connection_id",
      otherConnectionId,
    );
  });

  it("rejects malformed watched values before authentication", async () => {
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(connectionId, skinUuid, "true")).resolves.toEqual({
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

    await expect(setSkinWatched(connectionId, "not-a-uuid", true)).resolves.toEqual({
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

    await expect(setSkinWatched(connectionId, skinUuid, true)).resolves.toEqual({
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

    await expect(setSkinWatched(connectionId, skinUuid, false)).resolves.toEqual({ ok: true });
    expect(deleteEqUser).toHaveBeenCalledWith("user_id", "verified-user");
    expect(deleteEqConnection).toHaveBeenCalledWith("connection_id", connectionId);
    expect(deleteEqSkin).toHaveBeenCalledWith("skin_uuid", skinUuid);
  });

  it("treats replayed watched=false requests as successful", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { setSkinWatched } = await import("@/app/dashboard/actions");

    await expect(setSkinWatched(connectionId, skinUuid, false)).resolves.toEqual({ ok: true });
    await expect(setSkinWatched(connectionId, skinUuid, false)).resolves.toEqual({ ok: true });
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

    await expect(setSkinWatched(connectionId, skinUuid, true)).resolves.toEqual({
      error: "Your watchlist could not be updated.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
