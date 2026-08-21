import { describe, expect, it } from "vitest";

import {
  CloudBrowserSessionProvider,
  SubmittedCookieProvider,
  SubmittedSessionInputError,
} from "@/src/lib/riot/session-provider";
import { parseCookieJar } from "@/src/lib/riot/cookie-jar";

const cookies = [
  {
    domain: ".riotgames.com",
    expires: 2_000_000_000,
    httpOnly: true,
    name: "ssid",
    path: "/",
    secure: true,
    value: "test-session-not-a-real-secret",
  },
  {
    domain: "auth.riotgames.com",
    name: "clid",
    path: "/",
    value: "test-client",
  },
];

describe("CloudBrowserSessionProvider", () => {
  it("normalizes a complete captured jar into a cloud-browser CapturedSession", async () => {
    const session = await new CloudBrowserSessionProvider({
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    }).capture({ cookies });

    expect(session).toMatchObject({
      capturedAt: "2026-08-21T00:00:00.000Z",
      fixtureOnly: false,
      kind: "captured-session",
      provider: "cloud-browser",
    });
    expect(parseCookieJar(session.material)).toEqual(cookies);
  });

  it("rejects a pre-login analytics-only cookie set", async () => {
    await expect(
      new CloudBrowserSessionProvider().capture({
        cookies: [{ domain: ".riotgames.com", name: "__cf_bm", path: "/", value: "x" }],
      }),
    ).rejects.toBeInstanceOf(SubmittedSessionInputError);
  });

  it("keeps manual JSON import available", async () => {
    const session = await new SubmittedCookieProvider().capture({
      serializedJar: JSON.stringify(cookies),
    });
    expect(session.provider).toBe("manual-cookie");
  });
});
