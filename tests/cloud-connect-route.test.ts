import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildCloudConnectController, resolveCloudConnectIdentity } = vi.hoisted(
  () => ({
    buildCloudConnectController: vi.fn(),
    resolveCloudConnectIdentity: vi.fn(),
  }),
);

vi.mock("@/src/lib/riot/cloud-connect-auth", () => ({
  resolveCloudConnectIdentity,
}));

vi.mock("@/src/lib/riot/cloud-connect-runtime", () => ({
  buildCloudConnectController,
}));

vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

import { POST } from "@/app/api/riot/cloud/sessions/route";

describe("Riot cloud connection session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCloudConnectIdentity.mockResolvedValue(null);
  });

  it("does not let an unauthenticated caller create a browser session", async () => {
    const response = await POST(
      new Request("https://val-checker.test/api/riot/cloud/sessions", {
        body: JSON.stringify({ consentGranted: true }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Please sign in again.",
    });
    expect(buildCloudConnectController).not.toHaveBeenCalled();
  });
});
