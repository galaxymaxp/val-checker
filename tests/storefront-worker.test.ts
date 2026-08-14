import { describe, expect, it, vi } from "vitest";

import type { Session } from "@/src/lib/riot/adapter";
import {
  DailyStorefrontWorker,
  type DailyRunClaim,
  type DailyStorefrontRepository,
  type DailyStorefrontWorkerDependencies,
  type WorkerConnection,
} from "@/src/lib/worker/storefront-worker";

vi.mock("server-only", () => ({}));

const claim: DailyRunClaim = {
  claimedAt: new Date("2026-08-14T00:05:00.000Z"),
  id: "99999999-9999-4999-8999-999999999999",
  storeDate: "2026-08-14",
};
const checkedAt = new Date("2026-08-14T00:05:01.000Z");

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

function setup(options: {
  readonly connections?: readonly WorkerConnection[];
  readonly allowed?: boolean;
} = {}) {
  const connections = options.connections ?? [connection()];
  const repository: DailyStorefrontRepository = {
    applyLifecycle: vi.fn().mockResolvedValue({
      applied: true,
      terminalTransition: false,
    }),
    claim: vi.fn().mockResolvedValue(claim),
    listConnections: vi.fn().mockResolvedValue(connections),
    loadSentNotifications: vi.fn().mockResolvedValue([]),
    loadVerifiedEmail: vi.fn().mockResolvedValue("verified@example.com"),
    markStorefrontAttempt: vi.fn().mockResolvedValue(checkedAt),
  };
  const refreshSession = vi.fn().mockResolvedValue(session(2));
  const getStore = vi.fn().mockResolvedValue({ levelUuids: [], payload: {} });
  const createRiotClient = vi.fn(() => ({ getStore, refreshSession }));
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
    matches: [],
  });
  const dependencies: DailyStorefrontWorkerDependencies = {
    allowlist: { allows: vi.fn(() => options.allowed !== false) },
    createRiotClient,
    pipeline,
    repository,
    sendExpiry: vi.fn().mockResolvedValue(undefined),
    sendStorefront: vi.fn().mockResolvedValue(undefined),
    sessionStore,
  };
  return {
    createRiotClient,
    dependencies,
    getStore,
    pipeline,
    refreshSession,
    repository,
    sessionStore,
  };
}

describe("daily storefront worker", () => {
  it("claims, persists rotation, marks the attempt, fetches once, and runs the pure pipeline", async () => {
    const fixture = setup();

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toEqual({
      checked: 1,
      failed: 0,
      processed: 1,
      skipped: 0,
    });
    expect(fixture.sessionStore.load).toHaveBeenCalledWith(
      connection().userId,
      connection().connectionEpoch,
    );
    expect(fixture.sessionStore.persistRotated).toHaveBeenCalledWith(
      connection().userId,
      expect.objectContaining({ material: new Uint8Array([2]) }),
      connection().connectionEpoch,
    );
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledWith(
      connection(),
      "OK",
      "CONNECTED",
    );
    expect(fixture.pipeline).toHaveBeenCalledWith({
      checkedAt,
      sentNotifications: [],
      storefront: { levelUuids: [], payload: {} },
      userId: connection().userId,
    });
  });

  it("lets a durable duplicate claim skip a duplicate cron with zero further Riot calls", async () => {
    const fixture = setup();
    vi.mocked(fixture.repository.claim)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(null);
    const worker = new DailyStorefrontWorker(fixture.dependencies);

    await worker.run();
    await expect(worker.run()).resolves.toMatchObject({ skipped: 1 });
    expect(fixture.createRiotClient).toHaveBeenCalledTimes(1);
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
  });

  it("does not call storefront when the atomic attempt marker loses the race", async () => {
    const fixture = setup();
    vi.mocked(fixture.repository.markStorefrontAttempt).mockResolvedValue(null);

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      skipped: 1,
    });
    expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
    expect(fixture.sessionStore.persistRotated).toHaveBeenCalledTimes(1);
    expect(fixture.getStore).not.toHaveBeenCalled();
    expect(fixture.repository.applyLifecycle).not.toHaveBeenCalled();
  });

  it("rechecks verified allowlist membership before claims, decryption, or Riot", async () => {
    const fixture = setup({ allowed: false });

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      skipped: 1,
    });
    expect(fixture.repository.loadVerifiedEmail).toHaveBeenCalledTimes(1);
    expect(fixture.repository.claim).not.toHaveBeenCalled();
    expect(fixture.sessionStore.load).not.toHaveBeenCalled();
    expect(fixture.createRiotClient).not.toHaveBeenCalled();
  });

  it("treats rotated-session persistence failure as failure before storefront", async () => {
    const fixture = setup();
    fixture.sessionStore.persistRotated.mockRejectedValue(
      new Error("sensitive database detail"),
    );

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      failed: 1,
    });
    expect(fixture.getStore).not.toHaveBeenCalled();
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledWith(
      connection(),
      "ERROR",
      "RIOT_UNAVAILABLE",
    );
  });

  it("isolates one account failure and processes the next account sequentially", async () => {
    const first = connection();
    const second = connection({
      connectionEpoch: "55555555-5555-4555-8555-555555555555",
      id: "66666666-6666-4666-8666-666666666666",
      userId: "44444444-4444-4444-8444-444444444444",
    });
    const fixture = setup({ connections: [first, second] });
    fixture.refreshSession
      .mockRejectedValueOnce({ classification: "UNKNOWN", status: 429 })
      .mockResolvedValueOnce(session(2));

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toEqual({
      checked: 1,
      failed: 1,
      processed: 2,
      skipped: 0,
    });
    expect(fixture.repository.applyLifecycle).toHaveBeenNthCalledWith(
      1,
      first,
      "UNKNOWN",
      "RATE_LIMITED",
    );
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
  });

  it("does zero Riot work for existing reauth-required rows and emails once on a terminal transition", async () => {
    const blocked = setup({
      connections: [connection({ authStatus: "REAUTH_REQUIRED" })],
    });
    await new DailyStorefrontWorker(blocked.dependencies).run();
    expect(blocked.repository.loadVerifiedEmail).not.toHaveBeenCalled();
    expect(blocked.createRiotClient).not.toHaveBeenCalled();

    const terminal = setup();
    terminal.refreshSession.mockRejectedValue({
      classification: "DEAD",
      status: 302,
    });
    vi.mocked(terminal.repository.applyLifecycle).mockResolvedValue({
      applied: true,
      terminalTransition: true,
    });
    await new DailyStorefrontWorker(terminal.dependencies).run();
    expect(terminal.dependencies.sendExpiry).toHaveBeenCalledTimes(1);
    expect(terminal.dependencies.sendExpiry).toHaveBeenCalledWith({
      email: "verified@example.com",
      idempotencyKey: `val-checker/session-expired/${claim.id}`,
    });
  });

  it("does not poison session health when the fetch-free pipeline fails", async () => {
    const fixture = setup();
    fixture.pipeline.mockRejectedValue(new Error("catalog unavailable"));

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      failed: 1,
    });
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledWith(
      connection(),
      "OK",
      "CONNECTED",
    );
  });
});
