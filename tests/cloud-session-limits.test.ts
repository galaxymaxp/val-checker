import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_SESSION_TTL_MS,
  VIEWER_DISCONNECT_GRACE_MS,
  VIEWER_HEARTBEAT_INTERVAL_MS,
} from "@/cloud-browser/src/session-limits";
import { RIOT_CLOUD_CONNECTION_TTL_MS } from "@/src/lib/riot/cloud-connection-store";

describe("cloud Riot session limits", () => {
  it("allows enough time for CAPTCHA and MFA within the provider cap", () => {
    expect(RIOT_CLOUD_CONNECTION_TTL_MS).toBe(15 * 60 * 1_000);
    expect(MAX_SESSION_TTL_MS).toBeGreaterThanOrEqual(
      RIOT_CLOUD_CONNECTION_TTL_MS,
    );
  });

  it("keeps an interrupted viewer alive long enough to reconnect", () => {
    expect(VIEWER_DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(3 * 60 * 1_000);
    expect(VIEWER_HEARTBEAT_INTERVAL_MS).toBeLessThan(
      VIEWER_DISCONNECT_GRACE_MS,
    );
  });
});
