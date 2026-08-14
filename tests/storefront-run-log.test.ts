import { describe, expect, it, vi } from "vitest";

import type { Session } from "@/src/lib/riot/adapter";
import {
  DailyStorefrontWorker,
  type DailyRunClaim,
  type DailyStorefrontRepository,
  type DailyStorefrontWorkerDependencies,
  type RunLogEntry,
  type WorkerConnection,
} from "@/src/lib/worker/storefront-worker";

vi.mock("server-only", () => ({}));

const claim: DailyRunClaim = {
  claimedAt: new Date("2026-08-14T00:05:00.000Z"),
  id: "99999999-9999-4999-8999-999999999999",
  storeDate: "2026-08-14",
};
const checkedAt = new Date("2026-08-14T00:05:01.000Z");

// Every value the worker may ever write to the reason column. The migration
// pins the same list, so a raw error string cannot reach the log.
const ALLOWED_REASONS = new Set([
  "ATTEMPT_FENCED",
  "DAILY_CLAIM_HELD",
  "DELIVERY_FAILED",
  "LIFECYCLE_STALE",
  "NOT_ALLOWLISTED",
  "REAUTH_FAILED",
  "REAUTH_REQUIRED_SKIP",
  "SESSION_UNAVAILABLE",
  "STOREFRONT_FAILED",
  "UNEXPECTED",
]);

function connection(
  overrides: Partial<WorkerConnection> = {},
): WorkerConnection {
  return {
    authStatus: "CONNECTED",
    connectionEpoch: "22222222-2222-4222-8222-222222222222",
    consecutiveFailures: 0,
    createdAt: "2026-08-13T00:00:00.000Z",
    id: "33333333-3333-4333-8333-333333333333",
    lastRefreshAt: "2026-08-13T23:00:00.000Z",
    region: "ap",
    userId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function session(marker: number): Session {
  return {
    capturedAt: `2026-08-14T00:0${marker}:00.000Z`,
    fixtureOnly: false,
    kind: "captured-session",
    material: new Uint8Array([marker]),
    provider: "manual-cookie",
  };
}

function setup(
  options: {
    readonly allowed?: boolean;
    readonly connections?: readonly WorkerConnection[];
    readonly emailsSent?: number;
    readonly matches?: readonly unknown[];
  } = {},
) {
  const repository: DailyStorefrontRepository = {
    applyLifecycle: vi.fn().mockResolvedValue({
      applied: true,
      terminalTransition: false,
    }),
    claim: vi.fn().mockResolvedValue(claim),
    listConnections: vi
      .fn()
      .mockResolvedValue(options.connections ?? [connection()]),
    loadSentNotifications: vi.fn().mockResolvedValue([]),
    loadVerifiedEmail: vi.fn().mockResolvedValue("verified@example.com"),
    markStorefrontAttempt: vi.fn().mockResolvedValue(checkedAt),
    recordRun: vi.fn().mockResolvedValue(undefined),
  };
  const refreshSession = vi.fn().mockResolvedValue(session(2));
  const getStore = vi.fn().mockResolvedValue({ levelUuids: [], payload: {} });
  const sessionStore = {
    load: vi.fn().mockResolvedValue(session(1).material),
    persistRotated: vi.fn().mockResolvedValue(undefined),
  };
  const pipeline = vi.fn().mockResolvedValue({
    canonicalStorefront: {
      expiresAt: null,
      offers: [],
      shopHash: "a".repeat(64),
      skinUuids: [],
      storeDate: "2026-08-14",
    },
    decision: { duplicates: [], toSend: [] },
    emails: [],
    matches: options.matches ?? [],
  });
  const dependencies: DailyStorefrontWorkerDependencies = {
    allowlist: { allows: vi.fn(() => options.allowed !== false) },
    createRiotClient: vi.fn(() => ({ getStore, refreshSession })),
    pipeline,
    repository,
    sendExpiry: vi.fn().mockResolvedValue(undefined),
    sendStorefront: vi
      .fn()
      .mockResolvedValue({ emailsSent: options.emailsSent ?? 0 }),
    sessionStore,
  };
  return {
    dependencies,
    getStore,
    pipeline,
    refreshSession,
    repository,
    sessionStore,
  };
}

function loggedEntries(repository: DailyStorefrontRepository): RunLogEntry[] {
  return vi.mocked(repository.recordRun).mock.calls.map(([entry]) => entry);
}

describe("daily worker run logging", () => {
  it("records the per-user outcome, classification, matches, and emails sent", async () => {
    const fixture = setup({ emailsSent: 2, matches: [{}, {}, {}] });

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(loggedEntries(fixture.repository)).toEqual([
      {
        classification: "OK",
        connectionId: connection().id,
        emailsSent: 2,
        matchesFound: 3,
        outcome: "checked",
        reason: null,
        runId: claim.id,
        storeDate: claim.storeDate,
        userId: connection().userId,
      },
    ]);
  });

  it("records why an account was skipped without reaching Riot", async () => {
    const blocked = setup({
      connections: [connection({ authStatus: "REAUTH_REQUIRED" })],
    });
    await new DailyStorefrontWorker(blocked.dependencies).run();
    expect(loggedEntries(blocked.repository)).toMatchObject([
      { outcome: "skipped", reason: "REAUTH_REQUIRED_SKIP", runId: null },
    ]);

    const rejected = setup({ allowed: false });
    await new DailyStorefrontWorker(rejected.dependencies).run();
    expect(loggedEntries(rejected.repository)).toMatchObject([
      { outcome: "skipped", reason: "NOT_ALLOWLISTED" },
    ]);

    const duplicate = setup();
    vi.mocked(duplicate.repository.claim).mockResolvedValue(null);
    await new DailyStorefrontWorker(duplicate.dependencies).run();
    expect(loggedEntries(duplicate.repository)).toMatchObject([
      { outcome: "skipped", reason: "DAILY_CLAIM_HELD" },
    ]);
  });

  it("records the failing phase and Riot classification for each failure", async () => {
    const dead = setup();
    dead.refreshSession.mockRejectedValue({
      classification: "DEAD",
      status: 302,
    });
    await new DailyStorefrontWorker(dead.dependencies).run();
    expect(loggedEntries(dead.repository)).toMatchObject([
      { classification: "DEAD", outcome: "failed", reason: "REAUTH_FAILED" },
    ]);

    const storefront = setup();
    storefront.getStore.mockRejectedValue({
      classification: "UNKNOWN",
      status: 429,
    });
    await new DailyStorefrontWorker(storefront.dependencies).run();
    expect(loggedEntries(storefront.repository)).toMatchObject([
      {
        classification: "UNKNOWN",
        outcome: "failed",
        reason: "STOREFRONT_FAILED",
      },
    ]);

    const missing = setup();
    missing.sessionStore.load.mockResolvedValue(null);
    await new DailyStorefrontWorker(missing.dependencies).run();
    expect(loggedEntries(missing.repository)).toMatchObject([
      { outcome: "failed", reason: "SESSION_UNAVAILABLE" },
    ]);
  });

  it("keeps a healthy classification and match count when delivery fails", async () => {
    const fixture = setup({ matches: [{}, {}] });
    vi.mocked(fixture.dependencies.sendStorefront).mockRejectedValue(
      new Error("resend unavailable"),
    );

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(loggedEntries(fixture.repository)).toMatchObject([
      {
        classification: "OK",
        emailsSent: 0,
        matchesFound: 2,
        outcome: "failed",
        reason: "DELIVERY_FAILED",
      },
    ]);
  });

  it("logs every account once and never writes a raw error string", async () => {
    const first = connection();
    const second = connection({
      connectionEpoch: "55555555-5555-4555-8555-555555555555",
      id: "66666666-6666-4666-8666-666666666666",
      userId: "44444444-4444-4444-8444-444444444444",
    });
    const fixture = setup({ connections: [first, second] });
    fixture.refreshSession
      .mockRejectedValueOnce(new Error("cookie=secret-session-material"))
      .mockResolvedValueOnce(session(2));

    await new DailyStorefrontWorker(fixture.dependencies).run();

    const entries = loggedEntries(fixture.repository);
    expect(entries.map(({ userId }) => userId)).toEqual([
      first.userId,
      second.userId,
    ]);
    for (const entry of entries) {
      expect(entry.reason === null || ALLOWED_REASONS.has(entry.reason)).toBe(
        true,
      );
      expect(JSON.stringify(entry)).not.toContain("secret-session-material");
    }
  });

  it("never lets a logging failure change the run outcome or stop later accounts", async () => {
    const fixture = setup({
      connections: [
        connection(),
        connection({
          id: "66666666-6666-4666-8666-666666666666",
          userId: "44444444-4444-4444-8444-444444444444",
        }),
      ],
    });
    vi.mocked(fixture.repository.recordRun).mockRejectedValue(
      new Error("run log insert failed"),
    );

    await expect(
      new DailyStorefrontWorker(fixture.dependencies).run(),
    ).resolves.toEqual({ checked: 2, failed: 0, processed: 2, skipped: 0 });
    expect(fixture.repository.recordRun).toHaveBeenCalledTimes(2);
  });
});
