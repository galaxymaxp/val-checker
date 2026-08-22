import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canUseRiotCloudConnect } from "@/src/lib/riot/cloud-connect-policy";

const identity = {
  userId: "9ea5107b-343f-4884-aa4d-b04349a3d2cf",
};

describe("Riot cloud connection rollout policy", () => {
  it("fails closed behind the emergency kill switch", () => {
    expect(
      canUseRiotCloudConnect(identity, { RIOT_CLOUD_CONNECT_ENABLED: "false" }),
    ).toBe(false);
  });

  it("admits every authenticated identity when the feature is enabled", () => {
    expect(
      canUseRiotCloudConnect(identity, { RIOT_CLOUD_CONNECT_ENABLED: "true" }),
    ).toBe(true);
    expect(
      canUseRiotCloudConnect(
        { userId: "another-authenticated-user" },
        { RIOT_CLOUD_CONNECT_ENABLED: "true" },
      ),
    ).toBe(true);
  });
});
