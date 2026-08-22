import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveSessionIdentity } = vi.hoisted(() => ({
  resolveSessionIdentity: vi.fn(),
}));
const adminDelete = vi.fn();
const adminUpsert = vi.fn();
const adminInsertSingle = vi.fn();
const adminInsert = vi.fn((row: Record<string, unknown>) => {
  void row;
  return { select: () => ({ single: adminInsertSingle }) };
});
const adminFrom = vi.fn(() => ({
  delete: adminDelete,
  insert: adminInsert,
  upsert: adminUpsert,
}));
const createAdminSupabaseClient = vi.fn(() => ({
  from: adminFrom,
}));
const deleteConnectionEq = vi.fn();
const deleteUserEq = vi.fn(() => ({ eq: deleteConnectionEq }));
const getClaims = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient,
}));
vi.mock("@/src/lib/riot/session-identity", () => ({
  LiveRiotSessionIdentityResolver: class {
    resolve = resolveSessionIdentity;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("server-only", () => ({}));

const allowedUserId = "11111111-1111-4111-8111-111111111111";
const submittedJar = JSON.stringify([
  {
    domain: ".riotgames.com",
    name: "ssid",
    path: "/",
    value: "offline-session-value",
  },
]);

describe("Riot disconnect server action", () => {
  beforeEach(() => {
    adminDelete.mockReset();
    adminDelete.mockReturnValue({ eq: deleteUserEq });
    adminFrom.mockClear();
    adminUpsert.mockReset();
    adminUpsert.mockResolvedValue({ error: null });
    adminInsert.mockClear();
    adminInsertSingle.mockReset();
    // save() now provisions a new connection row and returns its id.
    adminInsertSingle.mockResolvedValue({
      data: { id: "44444444-4444-4444-8444-444444444444" },
      error: null,
    });
    createAdminSupabaseClient.mockClear();
    deleteUserEq.mockClear();
    deleteConnectionEq.mockReset();
    deleteConnectionEq.mockResolvedValue({ error: null });
    getClaims.mockReset();
    resolveSessionIdentity.mockReset();
    resolveSessionIdentity.mockImplementation(async (session) => ({
      puuid: "55555555-5555-4555-8555-555555555555",
      session,
    }));
    revalidatePath.mockReset();
    vi.stubEnv("SESSION_ENCRYPTION_CURRENT_VERSION", "1");
    vi.stubEnv(
      "SESSION_ENCRYPTION_KEY_V1",
      Buffer.alloc(32, 7).toString("base64"),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves a stable identity before encrypting a submitted jar", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "operator@example.com", sub: allowedUserId } },
    });
    const { connectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(
      connectRiotSession({
        consentGranted: true,
        serializedJar: submittedJar,
      }),
    ).resolves.toEqual({ ok: true });

    expect(createAdminSupabaseClient).toHaveBeenCalledTimes(1);
    expect(adminFrom).toHaveBeenCalledWith("riot_connections");
    const [persisted] = adminInsert.mock.calls[0];
    expect(persisted).toMatchObject({
      auth_status: "CONNECTED",
      puuid: "55555555-5555-4555-8555-555555555555",
      region: "ap",
      user_id: allowedUserId,
    });
    expect(JSON.stringify(persisted)).not.toContain("offline-session-value");
    expect(resolveSessionIdentity).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("allows an authenticated account without configured membership", async () => {
    const friendUserId = "22222222-2222-4222-8222-222222222222";
    getClaims.mockResolvedValue({
      data: {
        claims: {
          email: "public@example.com",
          sub: friendUserId,
        },
      },
    });
    const { connectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(
      connectRiotSession({
        consentGranted: true,
        serializedJar: submittedJar,
      }),
    ).resolves.toEqual({ ok: true });
    expect(adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: friendUserId }),
    );
  });

  it("rejects an unauthenticated submission before processing session material", async () => {
    const marker = "unauthenticated-session-marker";
    getClaims.mockResolvedValue({ data: null });
    const { connectRiotSession } = await import("@/app/dashboard/riot-actions");

    const result = await connectRiotSession({
      consentGranted: true,
      serializedJar: marker,
    });

    expect(result).toEqual({ error: "Please sign in again.", ok: false });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(adminUpsert).not.toHaveBeenCalled();
  });

  it("requires explicit consent and redacts malformed submitted material", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "operator@example.com", sub: allowedUserId } },
    });
    const { connectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(
      connectRiotSession({
        consentGranted: false,
        serializedJar: submittedJar,
      }),
    ).resolves.toEqual({
      error: "Please confirm consent before connecting.",
      ok: false,
    });
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();

    const marker = "malformed-cookie-marker";
    const result = await connectRiotSession({
      consentGranted: true,
      serializedJar: marker,
    });
    expect(result).toEqual({
      error: "The Riot session could not be connected.",
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(adminUpsert).not.toHaveBeenCalled();
  });

  it("deletes only the verified user's service-role row", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    const connectionId = "44444444-4444-4444-8444-444444444444";
    await expect(disconnectRiotSession(connectionId)).resolves.toEqual({
      ok: true,
    });
    expect(deleteUserEq).toHaveBeenCalledWith("user_id", "verified-user");
    expect(deleteConnectionEq).toHaveBeenCalledWith("id", connectionId);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("rejects unauthenticated disconnects before creating an admin client", async () => {
    getClaims.mockResolvedValue({ data: { claims: {} } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(
      disconnectRiotSession("44444444-4444-4444-8444-444444444444"),
    ).resolves.toEqual({
      error: "Please sign in again.",
      ok: false,
    });
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(deleteUserEq).not.toHaveBeenCalled();
  });

  it("returns a redacted error without revalidating on storage failure", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    deleteConnectionEq.mockResolvedValue({
      error: { message: "sensitive database detail" },
    });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(
      disconnectRiotSession("44444444-4444-4444-8444-444444444444"),
    ).resolves.toEqual({
      error: "The Riot session could not be disconnected.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed connection id before deleting", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "verified-user" } } });
    const { disconnectRiotSession } = await import("@/app/dashboard/riot-actions");

    await expect(disconnectRiotSession(undefined)).resolves.toEqual({
      error: "Choose a valid Riot account to disconnect.",
      ok: false,
    });
    await expect(disconnectRiotSession("not-an-id")).resolves.toEqual({
      error: "Choose a valid Riot account to disconnect.",
      ok: false,
    });
    expect(adminDelete).not.toHaveBeenCalled();
  });
});
