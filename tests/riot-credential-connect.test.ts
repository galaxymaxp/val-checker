import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RiotConnectAllowlist } from "@/src/lib/riot/connect-allowlist";
import {
  RiotConnectionService,
  RiotConsentRequiredError,
  RiotPendingAuthExpiredError,
  type RiotSessionIdentityResolver,
} from "@/src/lib/riot/connection-service";
import type {
  PendingAuthRecord,
  PendingAuthStore,
} from "@/src/lib/riot/pending-auth-store";
import type { RiotLoginProvider } from "@/src/lib/riot/login-provider";
import { ManualCookieProvider } from "@/src/lib/riot/session-provider";
import type { CapturedSession } from "@/src/lib/riot/session-provider";
import type { SessionStore } from "@/src/lib/riot/session-store";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "correct-horse-battery-staple";
const IDENTITY = { email: "operator@example.com", userId: USER_ID };
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";

const PENDING_JAR = new TextEncoder().encode(
  JSON.stringify([
    { domain: "auth.riotgames.com", name: "asid", path: "/", value: "pending" },
  ]),
);

function connectedSession(): CapturedSession {
  return {
    capturedAt: "2026-08-15T00:00:00.000Z",
    fixtureOnly: false,
    kind: "captured-session",
    material: new TextEncoder().encode(
      JSON.stringify([
        {
          domain: "auth.riotgames.com",
          name: "ssid",
          path: "/",
          value: "live-session",
        },
      ]),
    ),
    provider: "riot-login",
  };
}

function fakeSessionStore() {
  const saved: { options: unknown; session: CapturedSession }[] = [];
  const store: SessionStore = {
    delete: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    persistRotated: vi.fn(async () => {}),
    save: vi.fn(async (_userId, session, options) => {
      saved.push({ options, session });
      return "connection-id";
    }),
  };

  return { saved, store };
}

function fakePendingAuthStore(initial: PendingAuthRecord | null = null) {
  let record = initial;
  const store: PendingAuthStore = {
    clear: vi.fn(async () => {
      record = null;
    }),
    load: vi.fn(async () => record),
    save: vi.fn(async (_userId, pendingJar, options) => {
      record = {
        connectionId: options?.connectionId ?? null,
        label: options?.label ?? null,
        pendingJar,
        region: options?.region ?? null,
      };
    }),
  };

  return { peek: () => record, store };
}

function buildService(
  login: Partial<RiotLoginProvider>,
  sessionStore: SessionStore,
  pendingAuth: PendingAuthStore,
  identityResolver?: RiotSessionIdentityResolver,
) {
  return new RiotConnectionService(
    new ManualCookieProvider(),
    sessionStore,
    new RiotConnectAllowlist({ RIOT_CONNECT_ALLOWED_USER_IDS: USER_ID }),
    undefined,
    login as RiotLoginProvider,
    pendingAuth,
    identityResolver,
  );
}

describe("credential connect flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the jar and never the credential on a direct sign-in", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore();
    const submitCredentials = vi.fn(async () => ({
      kind: "connected" as const,
      session: connectedSession(),
    }));

    const result = await buildService(
      { submitCredentials },
      sessions.store,
      pending.store,
    ).connectWithCredentials({
      consentGranted: true,
      identity: IDENTITY,
      label: "  main account  ",
      password: PASSWORD,
      region: "eu",
      username: "operator",
    });

    expect(result).toEqual({ kind: "connected", state: "connected" });
    expect(submitCredentials).toHaveBeenCalledWith({
      password: PASSWORD,
      username: "operator",
    });
    expect(sessions.saved).toHaveLength(1);
    expect(sessions.saved[0].options).toEqual({
      label: "main account",
      region: "eu",
    });
    // Nothing handed to storage may carry the credential.
    expect(JSON.stringify(sessions.saved)).not.toContain(PASSWORD);
    expect(pending.store.save).not.toHaveBeenCalled();
  });

  it("holds only jar material while an MFA challenge is outstanding", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore();
    const submitCredentials = vi.fn(async () => ({
      kind: "multifactor" as const,
      maskedTarget: "o***@example.com",
      method: "email",
      pendingJar: PENDING_JAR,
    }));

    const result = await buildService(
      { submitCredentials },
      sessions.store,
      pending.store,
    ).connectWithCredentials({
      connectionId: CONNECTION_ID,
      consentGranted: true,
      identity: IDENTITY,
      password: PASSWORD,
      region: "ap",
      username: "operator",
    });

    expect(result).toEqual({
      kind: "multifactor",
      maskedTarget: "o***@example.com",
      method: "email",
    });
    // No connection is provisioned until the code is verified.
    expect(sessions.store.save).not.toHaveBeenCalled();

    const held = pending.peek();
    expect(held?.connectionId).toBe(CONNECTION_ID);
    expect(held?.region).toBe("ap");
    expect(new TextDecoder().decode(held?.pendingJar)).not.toContain(PASSWORD);
    expect(
      JSON.stringify(vi.mocked(pending.store.save).mock.calls),
    ).not.toContain(PASSWORD);
  });

  it("completes the connection from the held jar and clears it", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore({
      connectionId: CONNECTION_ID,
      label: "alt account",
      pendingJar: PENDING_JAR,
      region: "kr",
    });
    const submitMfaCode = vi.fn(async () => ({
      kind: "connected" as const,
      session: connectedSession(),
    }));

    const result = await buildService(
      { submitMfaCode },
      sessions.store,
      pending.store,
    ).submitMfaCode({ code: "123456", identity: IDENTITY });

    expect(result).toEqual({ kind: "connected", state: "connected" });
    expect(submitMfaCode).toHaveBeenCalledWith({
      code: "123456",
      pendingJar: PENDING_JAR,
    });
    // Region and label chosen on the first screen survive the second step.
    expect(sessions.saved[0].options).toEqual({
      connectionId: CONNECTION_ID,
      label: "alt account",
      region: "kr",
    });
    expect(pending.store.clear).toHaveBeenCalledWith(USER_ID);
    expect(pending.peek()).toBeNull();
  });

  it("refuses a code once the held challenge has expired", async () => {
    const sessions = fakeSessionStore();
    // load() returning null is how the store reports an expired or absent row.
    const pending = fakePendingAuthStore(null);
    const submitMfaCode = vi.fn();

    await expect(
      buildService(
        { submitMfaCode },
        sessions.store,
        pending.store,
      ).submitMfaCode({ code: "123456", identity: IDENTITY }),
    ).rejects.toBeInstanceOf(RiotPendingAuthExpiredError);

    expect(submitMfaCode).not.toHaveBeenCalled();
    expect(sessions.store.save).not.toHaveBeenCalled();
  });

  it("checks consent and the allowlist before touching the credential", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore();
    const submitCredentials = vi.fn();
    const service = buildService(
      { submitCredentials },
      sessions.store,
      pending.store,
    );

    await expect(
      service.connectWithCredentials({
        consentGranted: false,
        identity: IDENTITY,
        password: PASSWORD,
        username: "operator",
      }),
    ).rejects.toBeInstanceOf(RiotConsentRequiredError);

    await expect(
      service.connectWithCredentials({
        consentGranted: true,
        identity: {
          email: "public@example.com",
          userId: "22222222-2222-4222-8222-222222222222",
        },
        password: PASSWORD,
        username: "operator",
      }),
    ).rejects.toThrow();

    expect(submitCredentials).not.toHaveBeenCalled();
  });

  it("resolves a stable PUUID before replacing one exact connection", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore();
    const original = connectedSession();
    const rotated = { ...connectedSession(), capturedAt: "2026-08-15T00:01:00Z" };
    const submitCredentials = vi.fn(async () => ({
      kind: "connected" as const,
      session: original,
    }));
    const identityResolver: RiotSessionIdentityResolver = {
      resolve: vi.fn(async () => ({
        puuid: "33333333-3333-4333-8333-333333333333",
        session: rotated,
      })),
    };

    await buildService(
      { submitCredentials },
      sessions.store,
      pending.store,
      identityResolver,
    ).connectWithCredentials({
      connectionId: CONNECTION_ID,
      consentGranted: true,
      identity: IDENTITY,
      password: PASSWORD,
      region: "ap",
      username: "operator",
    });

    expect(identityResolver.resolve).toHaveBeenCalledWith(original, "ap");
    expect(sessions.saved[0]).toEqual({
      options: {
        connectionId: CONNECTION_ID,
        label: null,
        puuid: "33333333-3333-4333-8333-333333333333",
        region: "ap",
      },
      session: rotated,
    });
  });

  it("resolves a submitted session before replacing one exact connection", async () => {
    const sessions = fakeSessionStore();
    const pending = fakePendingAuthStore();
    const rotated = {
      ...connectedSession(),
      capturedAt: "2026-08-15T00:02:00Z",
    };
    const identityResolver: RiotSessionIdentityResolver = {
      resolve: vi.fn(async () => ({
        puuid: "33333333-3333-4333-8333-333333333333",
        session: rotated,
      })),
    };
    const service = buildService(
      {},
      sessions.store,
      pending.store,
      identityResolver,
    );

    await service.connect({
      connectionId: CONNECTION_ID,
      consentGranted: true,
      identity: IDENTITY,
      region: "eu",
      session: {
        serializedJar: JSON.stringify([
          {
            domain: ".riotgames.com",
            name: "ssid",
            path: "/",
            value: "submitted-session",
          },
        ]),
      },
    });

    expect(identityResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "manual-cookie" }),
      "eu",
    );
    expect(sessions.saved[0]).toEqual({
      options: {
        connectionId: CONNECTION_ID,
        label: null,
        puuid: "33333333-3333-4333-8333-333333333333",
        region: "eu",
      },
      session: rotated,
    });
  });
});
