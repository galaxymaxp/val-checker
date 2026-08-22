import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeCaptureToken = vi.fn();
const connectSubmittedRiotJar = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/src/lib/desktop/capture-token", () => ({ consumeCaptureToken }));
vi.mock("@/src/lib/riot/connect-submitted-jar", () => ({
  connectSubmittedRiotJar,
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: () => ({}),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

describe("captured Riot session endpoint", () => {
  beforeEach(() => {
    consumeCaptureToken.mockReset();
    connectSubmittedRiotJar.mockReset();
    revalidatePath.mockReset();
  });

  it("binds extension metadata to the token owner and never echoes the jar", async () => {
    consumeCaptureToken.mockResolvedValue("owner-id");
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
      { userId: "owner-id" },
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
    expect(connectSubmittedRiotJar).not.toHaveBeenCalled();
  });
});
