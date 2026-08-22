import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeCaptureToken = vi.fn();
const connectSubmittedRiotJar = vi.fn();
const getUserById = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/src/lib/desktop/capture-token", () => ({ consumeCaptureToken }));
vi.mock("@/src/lib/riot/connect-submitted-jar", () => ({
  connectSubmittedRiotJar,
  RIOT_CONNECT_NOT_ENABLED_MESSAGE: "Riot connection access is not enabled.",
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: () => ({ auth: { admin: { getUserById } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

describe("captured Riot session endpoint", () => {
  beforeEach(() => {
    consumeCaptureToken.mockReset();
    connectSubmittedRiotJar.mockReset();
    getUserById.mockReset();
    revalidatePath.mockReset();
  });

  it("binds extension metadata to the token owner and never echoes the jar", async () => {
    consumeCaptureToken.mockResolvedValue("owner-id");
    getUserById.mockResolvedValue({
      data: { user: { email: "owner@example.com" } },
      error: null,
    });
    connectSubmittedRiotJar.mockResolvedValue({ ok: true });
    const jar = JSON.stringify([
      { domain: "auth.riotgames.com", name: "ssid", path: "/", value: "secret" },
    ]);
    const connectionId = "11111111-1111-4111-8111-111111111111";
    const { POST } = await import("@/app/api/desktop/connect/route");

    const response = await POST(
      new Request("https://val-checker-three.vercel.app/api/desktop/connect", {
        body: JSON.stringify({
          connectionId,
          jar,
          label: "Main",
          region: "ap",
          token: "t".repeat(43),
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ ok: true });
    expect(connectSubmittedRiotJar).toHaveBeenCalledWith(
      { email: "owner@example.com", userId: "owner-id" },
      {
        connectionId,
        consentGranted: true,
        label: "Main",
        region: "ap",
        serializedJar: jar,
      },
    );
    expect(JSON.stringify(responseBody)).not.toContain("secret");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("refuses expired or replayed tokens before reading account data", async () => {
    consumeCaptureToken.mockResolvedValue(null);
    const { POST } = await import("@/app/api/desktop/connect/route");
    const response = await POST(
      new Request("https://val-checker-three.vercel.app/api/desktop/connect", {
        body: JSON.stringify({ jar: "[]", token: "x".repeat(43) }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "This capture link is invalid or has expired.",
      ok: false,
    });
    expect(getUserById).not.toHaveBeenCalled();
    expect(connectSubmittedRiotJar).not.toHaveBeenCalled();
  });
});
