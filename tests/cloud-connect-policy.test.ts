import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canUseRiotCloudConnect } from "@/src/lib/riot/cloud-connect-policy";

const identity = {
  email: "canary@example.test",
  userId: "9ea5107b-343f-4884-aa4d-b04349a3d2cf",
};

describe("Riot cloud connection rollout policy", () => {
  it("fails closed behind the emergency kill switch", () => {
    expect(
      canUseRiotCloudConnect(identity, {
        RIOT_CLOUD_CONNECT_ENABLED: "false",
        RIOT_CLOUD_CONNECT_PUBLIC: "true",
      }),
    ).toBe(false);
  });

  it("uses the canary allowlist while public rollout is disabled", () => {
    expect(
      canUseRiotCloudConnect(identity, {
        RIOT_CLOUD_CONNECT_ENABLED: "true",
        RIOT_CLOUD_CONNECT_PUBLIC: "false",
        RIOT_CONNECT_ALLOWED_EMAILS: identity.email,
      }),
    ).toBe(true);
    expect(
      canUseRiotCloudConnect(identity, {
        RIOT_CLOUD_CONNECT_ENABLED: "true",
        RIOT_CLOUD_CONNECT_PUBLIC: "false",
      }),
    ).toBe(false);
  });

  it("admits any authenticated identity only when public rollout is explicit", () => {
    expect(
      canUseRiotCloudConnect(identity, {
        RIOT_CLOUD_CONNECT_ENABLED: "true",
        RIOT_CLOUD_CONNECT_PUBLIC: "true",
      }),
    ).toBe(true);
  });
});
