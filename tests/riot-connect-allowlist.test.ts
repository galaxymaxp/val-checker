import { describe, expect, it, vi } from "vitest";

import {
  RiotConnectAllowlist,
  RiotConnectAllowlistConfigurationError,
  RiotConnectNotAllowedError,
} from "@/src/lib/riot/connect-allowlist";

vi.mock("server-only", () => ({}));

describe("Riot connect allowlist", () => {
  it("fails closed when no IDs or emails are configured", () => {
    const allowlist = new RiotConnectAllowlist({});

    expect(() =>
      allowlist.assertAllowed({
        email: "member@example.com",
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow(RiotConnectNotAllowedError);
  });

  it("permits an exact user ID or case-normalized email", () => {
    const allowlist = new RiotConnectAllowlist({
      RIOT_CONNECT_ALLOWED_EMAILS: "Member@Example.com",
      RIOT_CONNECT_ALLOWED_USER_IDS: "11111111-1111-4111-8111-111111111111",
    });

    expect(
      allowlist.allows({
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
    expect(
      allowlist.allows({
        email: "member@example.com",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBe(true);
  });

  it("rejects malformed configuration instead of partially applying it", () => {
    expect(
      () =>
        new RiotConnectAllowlist({
          RIOT_CONNECT_ALLOWED_USER_IDS:
            "11111111-1111-4111-8111-111111111111,not-a-user-id",
        }),
    ).toThrow(RiotConnectAllowlistConfigurationError);
  });
});
