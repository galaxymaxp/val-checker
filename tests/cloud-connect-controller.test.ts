import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CloudBrowserServiceError,
  CloudBrowserSessionNotFoundError,
  type CloudBrowserService,
} from "@/src/lib/riot/cloud-browser-service";
import { CloudConnectController } from "@/src/lib/riot/cloud-connect-controller";
import type {
  CloudConnectionStore,
  CloudSessionRow,
} from "@/src/lib/riot/cloud-connection-store";

const userA = "9ea5107b-343f-4884-aa4d-b04349a3d2cf";
const userB = "5faf813f-7735-4cb9-8d0f-8808cf015f44";
const sessionId = "5b0cb64f-7d14-456a-842b-369ecf3d2f61";
const connectionId = "ee5f8ff0-a7c4-4f3c-b070-424db488457b";

function row(overrides: Partial<CloudSessionRow> = {}): CloudSessionRow {
  return {
    captcha_observed: false,
    consumed_at: null,
    created_at: "2026-08-21T00:00:00.000Z",
    destroyed_at: null,
    expires_at: "2026-08-21T00:08:00.000Z",
    failure_code: null,
    id: sessionId,
    label: null,
    last_heartbeat_at: null,
    mfa_requested: false,
    provider_session_id: "provider-session-123456",
    reauth_test_succeeded: false,
    region: "ap",
    state: "waiting_for_user",
    storefront_succeeded: false,
    target_connection_id: null,
    user_id: userA,
    validation_succeeded: false,
    ...overrides,
  };
}

function fixture(initial = row()) {
  let current = initial;
  const store: CloudConnectionStore = {
    create: vi.fn(async () => current),
    loadOwned: vi.fn(async (id, userId) =>
      id === current.id && userId === current.user_id ? current : null,
    ),
    attachProvider: vi.fn(async (_id, _userId, providerSessionId) => {
      current = { ...current, provider_session_id: providerSessionId, state: "waiting_for_user" };
      return current;
    }),
    updateOwned: vi.fn(async (_id, _userId, values) => {
      current = { ...current, ...values };
      return current;
    }),
    claimCapture: vi.fn(async (id, userId) => {
      if (
        id !== current.id ||
        userId !== current.user_id ||
        !["waiting_for_user", "authenticating"].includes(current.state)
      ) {
        return null;
      }
      current = { ...current, state: "capturing_session" };
      return current;
    }),
  };
  const browser: CloudBrowserService = {
    captureCookies: vi.fn(async () => [
      {
        domain: ".riotgames.com",
        httpOnly: true,
        name: "ssid",
        path: "/",
        secure: true,
        value: "fixture-only",
      },
    ]),
    createSession: vi.fn(async () => ({
      captchaObserved: false,
      mfaRequested: false,
      providerSessionId: "provider-session-123456",
      state: "waiting_for_user" as const,
      streamUrl: "https://browser.example/session/1#token=fixture",
    })),
    destroySession: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({
      captchaObserved: true,
      mfaRequested: true,
      state: "captured" as const,
    })),
    getStream: vi.fn(async () => "https://browser.example/session/1#token=fixture"),
  };
  const connection = {
    connectCaptured: vi.fn(async () => ({
      connectionId,
      puuid: "fixture-puuid",
      region: "ap" as const,
      riotId: { gameName: "Fixture", tagLine: "TEST" },
    })),
  };
  const validateStorefront = vi.fn(async () => ({ ran: true }));
  const controller = new CloudConnectController(
    store,
    browser,
    connection,
    validateStorefront,
    undefined,
    () => new Date("2026-08-21T00:04:00.000Z"),
  );
  return { browser, connection, controller, get row() { return current; }, store, validateStorefront };
}

describe("CloudConnectController", () => {
  it("prevents one user from reading or controlling another user's session", async () => {
    const test = fixture();
    await expect(
      test.controller.status(sessionId, { userId: userB }),
    ).resolves.toBeNull();
    expect(test.browser.getStatus).not.toHaveBeenCalled();
  });

  it("captures once, validates, fetches storefront, and cleans up after success", async () => {
    const test = fixture();
    const result = await test.controller.status(sessionId, { userId: userA });
    expect(result).toMatchObject({
      account: { gameName: "Fixture", region: "ap", tagLine: "TEST" },
      id: sessionId,
      state: "connected",
    });
    expect(JSON.stringify(result)).not.toMatch(/ssid|fixture-only|puuid/i);
    expect(test.connection.connectCaptured).toHaveBeenCalledOnce();
    expect(test.validateStorefront).toHaveBeenCalledWith(userA, connectionId);
    expect(test.browser.destroySession).toHaveBeenCalledOnce();
    expect(test.row).toMatchObject({
      reauth_test_succeeded: false,
      storefront_succeeded: true,
      target_connection_id: connectionId,
      validation_succeeded: true,
    });
  });

  it("prevents capture replay after the session is consumed", async () => {
    const test = fixture(row({ consumed_at: "2026-08-21T00:04:00.000Z", state: "connected" }));
    const result = await test.controller.status(sessionId, { userId: userA });
    expect(result?.state).toBe("connected");
    expect(test.browser.captureCookies).not.toHaveBeenCalled();
  });

  it("cleans up and fails closed when storefront validation fails", async () => {
    const test = fixture();
    vi.mocked(test.validateStorefront).mockResolvedValue({ ran: false });
    const result = await test.controller.status(sessionId, { userId: userA });
    expect(result).toMatchObject({
      failureCode: "storefront_failed",
      state: "failed",
    });
    expect(test.browser.destroySession).toHaveBeenCalledOnce();
  });

  it("expires and destroys abandoned sessions", async () => {
    const test = fixture(row({ expires_at: "2026-08-21T00:03:00.000Z" }));
    const result = await test.controller.status(sessionId, { userId: userA });
    expect(result).toMatchObject({ failureCode: "expired", state: "expired" });
    expect(test.browser.destroySession).toHaveBeenCalledOnce();
  });

  it("fails cleanly when the temporary provider session disappears", async () => {
    const test = fixture();
    vi.mocked(test.browser.getStatus).mockRejectedValue(
      new CloudBrowserSessionNotFoundError(),
    );

    const result = await test.controller.status(sessionId, { userId: userA });

    expect(result).toMatchObject({
      failureCode: "browser_unavailable",
      state: "failed",
    });
    expect(test.browser.destroySession).not.toHaveBeenCalled();
    expect(test.row.destroyed_at).toBe("2026-08-21T00:04:00.000Z");
  });

  it("does not destroy an active browser after transient provider overload", async () => {
    const test = fixture();
    vi.mocked(test.browser.getStatus).mockRejectedValue(
      new CloudBrowserServiceError(),
    );

    await expect(
      test.controller.status(sessionId, { userId: userA }),
    ).rejects.toBeInstanceOf(CloudBrowserServiceError);
    expect(test.browser.destroySession).not.toHaveBeenCalled();
    expect(test.row.state).toBe("waiting_for_user");
  });

  it("only requests the sensitive stream URL when the caller needs it", async () => {
    const test = fixture();
    vi.mocked(test.browser.getStatus).mockResolvedValue({
      captchaObserved: false,
      mfaRequested: false,
      state: "waiting_for_user",
    });

    await test.controller.status(sessionId, { userId: userA });
    expect(test.browser.getStream).not.toHaveBeenCalled();

    await test.controller.status(sessionId, { userId: userA }, true);
    expect(test.browser.getStream).toHaveBeenCalledOnce();
  });
});
