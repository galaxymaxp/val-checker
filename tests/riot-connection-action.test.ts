import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminDelete = vi.fn();
const adminUpsert = vi.fn();
const adminFrom = vi.fn(() => ({ delete: adminDelete, upsert: adminUpsert }));
const createAdminSupabaseClient = vi.fn(() => ({
  from: adminFrom,
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
    adminDelete.mockReturnValue({ eq: deleteEq });
    adminFrom.mockClear();
    adminUpsert.mockReset();
    adminUpsert.mockResolvedValue({ error: null });
    createAdminSupabaseClient.mockClear();
    deleteEq.mockReset();
    deleteEq.mockResolvedValue({ error: null });
    getClaims.mockReset();
    revalidatePath.mockReset();
    vi.stubEnv("RIOT_CONNECT_ALLOWED_EMAILS", "");
    vi.stubEnv("RIOT_CONNECT_ALLOWED_USER_IDS", allowedUserId);
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

  it("encrypts an allowlisted submitted jar with AP as the default and makes no Riot request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
    const [persisted] = adminUpsert.mock.calls[0];
    expect(persisted).toMatchObject({
      auth_status: "CONNECTED",
      region: "ap",
      user_id: allowedUserId,
    });
    expect(JSON.stringify(persisted)).not.toContain("offline-session-value");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects a non-allowlisted identity before constructing storage or processing material", async () => {
    const marker = "do-not-process-or-echo";
    getClaims.mockResolvedValue({
      data: {
        claims: {
          email: "public@example.com",
          sub: "22222222-2222-4222-8222-222222222222",
        },
      },
    });
    const { connectRiotSession } = await import("@/app/dashboard/riot-actions");

    const result = await connectRiotSession({
      consentGranted: true,
      serializedJar: marker,
    });

    expect(result).toEqual({
      error: "Riot connection access is not enabled.",
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(adminUpsert).not.toHaveBeenCalled();
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
    getClaims.mockResolvedValue({ data: { claims: { sub: allowedUserId } } });
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
