import { describe, expect, it } from "vitest";

import { renderSessionExpiredEmail } from "@/src/lib/notifications/session-expired";

describe("session expiry notification rendering", () => {
  it("renders deterministic subject and HTML for authoritative session expiry", () => {
    expect(
      renderSessionExpiredEmail({
        connection: "disconnected",
        reason: "session-expired",
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<!doctype html><html lang=\"en\"><body><h1>Your Riot session expired</h1><p>Reconnect your Riot account so VAL Checker can resume Riot-dependent checks.</p><p>VAL Checker is not affiliated with Riot Games.</p></body></html>",
        "subject": "Your Riot session expired",
      }
    `);
  });

  it("does not render expiry mail for active or user-disconnected sessions", () => {
    expect(
      renderSessionExpiredEmail({ connection: "connected" }),
    ).toBeNull();
    expect(
      renderSessionExpiredEmail({
        connection: "disconnected",
        reason: "user-disconnected",
      }),
    ).toBeNull();
  });
});
