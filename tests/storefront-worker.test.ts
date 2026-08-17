import { describe, expect, it, vi } from "vitest";

import type { Session } from "@/src/lib/riot/adapter";
import {
  DailyStorefrontWorker,
  type DailyRunClaim,
  type DailyStorefrontRepository,
  type DailyStorefrontWorkerDependencies,
  type SessionRotationLease,
  type StorefrontRefreshTrigger,
  type WorkerConnection,
} from "@/src/lib/worker/storefront-worker";

vi.mock("server-only", () => ({}));

const claim: DailyRunClaim = {
  claimToken: null,
  claimedAt: new Date("2026-08-14T00:05:00.000Z"),
  id: "99999999-9999-4999-8999-999999999999",
  storeDate: "2026-08-14",
};
const manualClaim: DailyRunClaim = {
  ...claim,
  claimToken: "88888888-8888-4888-8888-888888888888",
};
const rotationLease: SessionRotationLease = {
  claimedAt: new Date("2026-08-14T00:04:59.000Z"),
  storeDate: "2026-08-14",
  token: "77777777-7777-4777-8777-777777777777",
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
  readonly trigger?: StorefrontRefreshTrigger;
} = {}) {
  const connections = options.connections ?? [connection()];
  const runClaim = options.trigger === "manual" ? manualClaim : claim;
  const repository: DailyStorefrontRepository = {
    acquireSessionRotationLease: vi.fn().mockResolvedValue({
      lease: rotationLease,
      reason: null,
    }),
    applyLifecycle: vi.fn().mockResolvedValue({
      applied: true,
      terminalTransition: false,
    }),
    claim: vi.fn().mockResolvedValue({ claim: runClaim, reason: null }),
    failRefresh: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue(connections),
    loadSentNotifications: vi.fn().mockResolvedValue([]),
    loadVerifiedEmail: vi.fn().mockResolvedValue("verified@example.com"),
    markStorefrontAttempt: vi.fn().mockResolvedValue(checkedAt),
    persistPuuid: vi.fn().mockResolvedValue(undefined),
    recordStorefrontRefresh: vi.fn().mockResolvedValue(undefined),
    recordRun: vi.fn().mockResolvedValue(undefined),
    releaseSessionRotationLease: vi.fn().mockResolvedValue(undefined),
    renewSessionRotationLease: vi.fn().mockResolvedValue(rotationLease),
  };
  const refreshSession = vi.fn().mockResolvedValue(session(2));
  const prepareRiotStorefront = vi.fn().mockResolvedValue(undefined);
  const getStore = vi.fn().mockResolvedValue({ levelUuids: [], payload: {} });
  const getPUUID = vi
    .fn()
    .mockResolvedValue("77777777-7777-4777-8777-777777777777");
  const createRiotClient = vi.fn(() => ({
    getPUUID,
    getStore,
    prepareStorefront: prepareRiotStorefront,
    refreshSession,
  }));
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
  const prepareStorefront = vi.fn().mockResolvedValue({
    expiresAt: "2026-08-15T00:00:00.000Z",
    offers: [],
    shopHash: "b".repeat(64),
    skinUuids: [],
    storeDate: "2026-08-14",
  });
  const dependencies: DailyStorefrontWorkerDependencies = {
    allowlist: { allows: vi.fn(() => options.allowed !== false) },
    createRiotClient,
    pipeline,
    prepareStorefront,
    repository,
    sendExpiry: vi.fn().mockResolvedValue(undefined),
    sendStorefront: vi.fn().mockResolvedValue({ emailsSent: 0 }),
    sessionStore,
    trigger: options.trigger ?? "cron",
  };
  return {
    createRiotClient,
    dependencies,
    getStore,
    getPUUID,
    pipeline,
    prepareStorefront,
    prepareRiotStorefront,
    refreshSession,
    repository,
    sessionStore,
  };
}

describe("daily storefront worker", () => {
  it("claims, persists rotation, marks the attempt, fetches once, and runs the pure pipeline", async () => {
    const fixture = setup();

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      checked: 1,
      failed: 0,
      processed: 1,
      refreshed: 1,
      skipped: 0,
      trigger: "cron",
    });
    expect(fixture.sessionStore.load).toHaveBeenCalledWith(
      connection().userId,
      connection().id,
      connection().connectionEpoch,
    );
    expect(fixture.sessionStore.persistRotated).toHaveBeenCalledWith(
      connection().userId,
      connection().id,
      expect.objectContaining({ material: new Uint8Array([2]) }),
      connection().connectionEpoch,
      rotationLease.token,
    );
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.getPUUID).toHaveBeenCalledWith(
      expect.objectContaining({ material: new Uint8Array([2]) }),
    );
    expect(fixture.repository.persistPuuid).toHaveBeenCalledWith(
      connection(),
      "77777777-7777-4777-8777-777777777777",
    );
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledWith(
      connection(),
      "OK",
      "CONNECTED",
    );
    expect(
      fixture.repository.acquireSessionRotationLease,
    ).toHaveBeenCalledWith(connection());
    expect(fixture.repository.claim).toHaveBeenCalledWith(
      connection(),
      "cron",
      rotationLease,
    );
    expect(
      fixture.repository.renewSessionRotationLease,
    ).toHaveBeenCalledWith(connection(), rotationLease);
    expect(fixture.prepareRiotStorefront).toHaveBeenCalledWith(
      expect.objectContaining({ material: new Uint8Array([2]) }),
    );
    expect(fixture.repository.markStorefrontAttempt).toHaveBeenCalledWith(
      claim,
      connection(),
      "cron",
      rotationLease,
    );
    expect(
      fixture.prepareRiotStorefront.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.markStorefrontAttempt).mock
        .invocationCallOrder[0],
    );
    expect(
      vi.mocked(fixture.repository.markStorefrontAttempt).mock
        .invocationCallOrder[0],
    ).toBeLessThan(fixture.getStore.mock.invocationCallOrder[0]);
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).not.toHaveBeenCalled();
    expect(
      vi.mocked(fixture.repository.acquireSessionRotationLease).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.claim).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(fixture.repository.acquireSessionRotationLease).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      fixture.refreshSession.mock.invocationCallOrder[0],
    );
    expect(fixture.pipeline).toHaveBeenCalledWith({
      checkedAt,
      sentNotifications: [],
      storefront: { levelUuids: [], payload: {} },
      userId: connection().userId,
    });
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledWith({
      checkedAt,
      claim,
      connection: connection(),
      consumeManualClaim: true,
      rotationLease,
      storefront: expect.objectContaining({ shopHash: "b".repeat(64) }),
      trigger: "cron",
    });
    expect(
      vi.mocked(fixture.repository.applyLifecycle).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.recordStorefrontRefresh).mock
        .invocationCallOrder[0],
    );
  });

  it.each(["cron", "manual", "operator"] as const)(
    "acquires the shared session lease before the %s claim and Riot reauth",
    async (trigger) => {
      const fixture = setup({ trigger });

      await new DailyStorefrontWorker(fixture.dependencies).run();

      const leaseOrder = vi.mocked(
        fixture.repository.acquireSessionRotationLease,
      ).mock.invocationCallOrder[0];
      expect(leaseOrder).toBeLessThan(
        vi.mocked(fixture.repository.claim).mock.invocationCallOrder[0],
      );
      expect(fixture.repository.claim).toHaveBeenCalledWith(
        connection(),
        trigger,
        rotationLease,
      );
      expect(
        fixture.repository.renewSessionRotationLease,
      ).toHaveBeenCalledWith(connection(), rotationLease);
      expect(
        vi.mocked(fixture.repository.renewSessionRotationLease).mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        fixture.refreshSession.mock.invocationCallOrder[0],
      );
      expect(
        fixture.repository.releaseSessionRotationLease,
      ).not.toHaveBeenCalled();
    },
  );

  it("blocks a concurrent manual trigger before any session or Riot work", async () => {
    const winner = setup({ trigger: "cron" });
    const loser = setup({ trigger: "manual" });
    let held = false;
    const acquire = async () => {
      if (held) {
        return { lease: null, reason: "SESSION_LEASE_HELD" as const };
      }
      held = true;
      return { lease: rotationLease, reason: null };
    };
    vi.mocked(
      winner.repository.acquireSessionRotationLease,
    ).mockImplementation(acquire);
    vi.mocked(
      loser.repository.acquireSessionRotationLease,
    ).mockImplementation(acquire);
    vi.mocked(
      winner.repository.releaseSessionRotationLease,
    ).mockImplementation(async () => {
      held = false;
    });

    let finishReauth: ((rotated: Session) => void) | undefined;
    winner.refreshSession.mockImplementation(
      () =>
        new Promise<Session>((resolve) => {
          finishReauth = resolve;
        }),
    );

    const winnerRun = new DailyStorefrontWorker(winner.dependencies).run();
    await vi.waitFor(() => {
      expect(winner.refreshSession).toHaveBeenCalledTimes(1);
    });

    const losingSummary = await new DailyStorefrontWorker(
      loser.dependencies,
    ).run();

    expect(losingSummary.accounts).toMatchObject([
      {
        outcome: "skipped",
        reason: "SESSION_LEASE_HELD",
        refreshPersisted: false,
        trigger: "manual",
      },
    ]);
    expect(loser.repository.claim).not.toHaveBeenCalled();
    expect(loser.sessionStore.load).not.toHaveBeenCalled();
    expect(loser.createRiotClient).not.toHaveBeenCalled();
    expect(loser.refreshSession).not.toHaveBeenCalled();
    expect(loser.getStore).not.toHaveBeenCalled();

    finishReauth?.(session(2));
    await expect(winnerRun).resolves.toMatchObject({ checked: 1 });
  });

  it.each([
    "session-unavailable",
    "lease-renewal-lost",
    "reauth-failed",
    "persistence-failed",
    "preflight-failed",
    "attempt-fenced",
  ] as const)("releases the session lease after %s", async (failure) => {
    const fixture = setup({ trigger: "manual" });
    if (failure === "session-unavailable") {
      fixture.sessionStore.load.mockResolvedValue(null);
    } else if (failure === "lease-renewal-lost") {
      vi.mocked(
        fixture.repository.renewSessionRotationLease,
      ).mockResolvedValue(null);
    } else if (failure === "reauth-failed") {
      fixture.refreshSession.mockRejectedValue(new Error("reauth failed"));
    } else if (failure === "persistence-failed") {
      fixture.sessionStore.persistRotated.mockRejectedValue(
        new Error("persistence failed"),
      );
    } else if (failure === "preflight-failed") {
      fixture.prepareRiotStorefront.mockRejectedValue({
        classification: "UNKNOWN",
        status: 503,
        storefrontRequest: "not-sent",
      });
    } else {
      vi.mocked(fixture.repository.markStorefrontAttempt).mockResolvedValue(
        null,
      );
    }

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(
      fixture.repository.releaseSessionRotationLease,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).toHaveBeenCalledWith(connection(), rotationLease);
    expect(fixture.getStore).not.toHaveBeenCalled();
    if (failure === "lease-renewal-lost") {
      expect(fixture.refreshSession).not.toHaveBeenCalled();
      expect(fixture.sessionStore.persistRotated).not.toHaveBeenCalled();
    } else if (failure === "preflight-failed") {
      expect(fixture.repository.markStorefrontAttempt).not.toHaveBeenCalled();
      expect(fixture.repository.failRefresh).toHaveBeenCalledWith(
        manualClaim,
        connection(),
        "manual",
        rotationLease,
        { reason: "STOREFRONT_FAILED", retryable: true },
      );
    }
  });

  it("uses the renewed lease fence for reauth, attempt marking, and raw persistence", async () => {
    const fixture = setup();
    const renewedLease = {
      ...rotationLease,
      claimedAt: new Date("2026-08-14T00:05:00.500Z"),
    };
    vi.mocked(
      fixture.repository.renewSessionRotationLease,
    ).mockResolvedValue(renewedLease);

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(
      vi.mocked(fixture.repository.renewSessionRotationLease).mock
        .invocationCallOrder[0],
    ).toBeLessThan(fixture.refreshSession.mock.invocationCallOrder[0]);
    expect(fixture.sessionStore.persistRotated).toHaveBeenCalledWith(
      connection().userId,
      connection().id,
      expect.objectContaining({ material: new Uint8Array([2]) }),
      connection().connectionEpoch,
      renewedLease.token,
    );
    expect(fixture.repository.markStorefrontAttempt).toHaveBeenCalledWith(
      claim,
      connection(),
      "cron",
      renewedLease,
    );
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ rotationLease: renewedLease }),
    );
  });

  it.each([
    ["ACCOUNT_UNAVAILABLE", "ACCOUNT_UNAVAILABLE"],
    ["CLAIM_HELD", "MANUAL_CLAIM_HELD"],
  ] as const)(
    "maps a manual %s claim result to %s",
    async (claimReason, expectedReason) => {
      const fixture = setup({ trigger: "manual" });
      vi.mocked(fixture.repository.claim).mockResolvedValue({
        claim: null,
        reason: claimReason,
      });

      const summary = await new DailyStorefrontWorker(
        fixture.dependencies,
      ).run();

      expect(summary.accounts).toMatchObject([
        { outcome: "skipped", reason: expectedReason },
      ]);
      expect(fixture.refreshSession).not.toHaveBeenCalled();
      expect(fixture.getStore).not.toHaveBeenCalled();
      expect(
        fixture.repository.releaseSessionRotationLease,
      ).toHaveBeenCalledWith(connection(), rotationLease);
    },
  );

  it("persists a valid no-match storefront before the notification sender runs", async () => {
    const fixture = setup();

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledTimes(2);
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenNthCalledWith(
      1,
      {
        checkedAt,
        claim,
        connection: connection(),
        consumeManualClaim: true,
        rotationLease,
        storefront: expect.objectContaining({ shopHash: "b".repeat(64) }),
        trigger: "cron",
      },
    );
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenNthCalledWith(
      2,
      {
        checkedAt,
        claim,
        connection: connection(),
        consumeManualClaim: false,
        rotationLease: null,
        storefront: expect.objectContaining({ shopHash: "a".repeat(64) }),
        trigger: "cron",
      },
    );
    expect(fixture.dependencies.sendStorefront).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(fixture.repository.recordStorefrontRefresh).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      fixture.pipeline.mock.invocationCallOrder[0],
    );
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).not.toHaveBeenCalled();
    expect(summary.accounts).toEqual([
      {
        classification: "OK",
        connectionId: connection().id,
        emailsSent: 0,
        matchesFound: 0,
        notificationStatus: "not-needed",
        outcome: "checked",
        reason: null,
        refreshPersisted: true,
        storeDate: claim.storeDate,
        trigger: "cron",
      },
    ]);
  });

  it("propagates a manual trigger and releases a failed manual claim without leaking the error", async () => {
    const fixture = setup({ trigger: "manual" });
    fixture.refreshSession.mockRejectedValue(
      new Error("cookie=secret-session-material"),
    );

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(fixture.repository.claim).toHaveBeenCalledWith(
      connection(),
      "manual",
      rotationLease,
    );
    expect(fixture.repository.failRefresh).toHaveBeenCalledWith(
      manualClaim,
      connection(),
      "manual",
      rotationLease,
      { reason: "REAUTH_FAILED", retryable: true },
    );
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).toHaveBeenCalledWith(connection(), rotationLease);
    expect(summary).toMatchObject({ failed: 1, trigger: "manual" });
    expect(summary.accounts).toMatchObject([
      {
        classification: "ERROR",
        connectionId: connection().id,
        outcome: "failed",
        reason: "REAUTH_FAILED",
        refreshPersisted: false,
        trigger: "manual",
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain("secret-session-material");
    expect(JSON.stringify(summary)).not.toContain(connection().userId);
    expect(JSON.stringify(summary)).not.toContain(manualClaim.id);
    expect(JSON.stringify(summary)).not.toContain(manualClaim.claimToken!);
    expect(fixture.repository.persistPuuid).not.toHaveBeenCalled();
  });

  it("terminal-closes a manual failure after the sole Riot request starts", async () => {
    const fixture = setup({ trigger: "manual" });
    fixture.getStore.mockRejectedValue({
      classification: "UNKNOWN",
      status: 503,
      storefrontRequest: "completed",
    });

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(fixture.repository.failRefresh).toHaveBeenCalledWith(
      manualClaim,
      connection(),
      "manual",
      rotationLease,
      {
        reason: "STOREFRONT_FAILED",
        releaseAttemptedLease: true,
        retryable: false,
      },
    );
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.repository.releaseSessionRotationLease).not.toHaveBeenCalled();
    expect(fixture.refreshSession).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(fixture.repository.applyLifecycle).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.failRefresh).mock.invocationCallOrder[0],
    );
  });

  it("preserves an ambiguous attempted lease so another trigger cannot overlap it", async () => {
    const fixture = setup();
    fixture.getStore.mockRejectedValue({
      classification: "ERROR",
      status: null,
      storefrontRequest: "ambiguous",
    });

    await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(fixture.repository.failRefresh).toHaveBeenCalledWith(
      claim,
      connection(),
      "cron",
      rotationLease,
      {
        reason: "STOREFRONT_FAILED",
        releaseAttemptedLease: false,
        retryable: false,
      },
    );
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.repository.releaseSessionRotationLease).not.toHaveBeenCalled();
    expect(
      vi.mocked(fixture.repository.applyLifecycle).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.failRefresh).mock.invocationCallOrder[0],
    );
  });

  it("releases after raw persistence failure without repeating the storefront request", async () => {
    const fixture = setup({ trigger: "manual" });
    vi.mocked(fixture.repository.recordStorefrontRefresh).mockRejectedValue(
      new Error("database unavailable"),
    );

    const summary = await new DailyStorefrontWorker(
      fixture.dependencies,
    ).run();

    expect(summary.accounts).toMatchObject([
      {
        outcome: "failed",
        reason: "STOREFRONT_FAILED",
        refreshPersisted: false,
      },
    ]);
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledTimes(2);
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.repository.failRefresh).toHaveBeenCalledWith(
      manualClaim,
      connection(),
      "manual",
      rotationLease,
      {
        reason: "STOREFRONT_FAILED",
        releaseAttemptedLease: true,
        retryable: false,
      },
    );
    expect(fixture.repository.releaseSessionRotationLease).not.toHaveBeenCalled();
    expect(
      vi.mocked(fixture.repository.applyLifecycle).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(fixture.repository.failRefresh).mock.invocationCallOrder[0],
    );
  });

  it("does not release a manual allowance after the storefront was persisted", async () => {
    const fixture = setup({ trigger: "manual" });
    vi.mocked(fixture.dependencies.sendStorefront).mockRejectedValue(
      new Error("resend secret"),
    );

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledTimes(2);
    expect(fixture.repository.failRefresh).not.toHaveBeenCalled();
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      checked: 1,
      failed: 0,
      notificationFailures: 1,
      refreshed: 1,
    });
    expect(summary.accounts).toMatchObject([
      {
        notificationStatus: "failed",
        outcome: "checked",
        reason: "DELIVERY_FAILED",
        refreshPersisted: true,
      },
    ]);
  });

  it("replays an ambiguous manual persistence response with the same claim", async () => {
    const fixture = setup({ trigger: "manual" });
    vi.mocked(fixture.repository.recordStorefrontRefresh)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(undefined);

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(summary).toMatchObject({ checked: 1, refreshed: 1 });
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        claim: manualClaim,
        consumeManualClaim: true,
        rotationLease,
        trigger: "manual",
      }),
    );
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        claim: manualClaim,
        consumeManualClaim: true,
        rotationLease,
        trigger: "manual",
      }),
    );
    expect(fixture.repository.markStorefrontAttempt).toHaveBeenCalledTimes(1);
    expect(fixture.getStore).toHaveBeenCalledTimes(1);
    expect(fixture.repository.failRefresh).not.toHaveBeenCalled();
  });

  it("lets a durable duplicate claim skip a duplicate cron with zero further Riot calls", async () => {
    const fixture = setup();
    vi.mocked(fixture.repository.claim)
      .mockResolvedValueOnce({ claim, reason: null })
      .mockResolvedValueOnce({ claim: null, reason: "CLAIM_HELD" });
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
    expect(
      fixture.repository.releaseSessionRotationLease,
    ).toHaveBeenCalledWith(connection(), rotationLease);
  });

  it("does not poison session health when the attempt fence storage call fails", async () => {
    const fixture = setup();
    vi.mocked(fixture.repository.markStorefrontAttempt).mockRejectedValue(
      new Error("database unavailable"),
    );

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(summary.accounts).toMatchObject([
      { classification: null, outcome: "failed", reason: "ATTEMPT_FENCED" },
    ]);
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

    await expect(
      new DailyStorefrontWorker(fixture.dependencies).run(),
    ).resolves.toMatchObject({
      failed: 1,
    });
    expect(fixture.getStore).not.toHaveBeenCalled();
    expect(fixture.repository.applyLifecycle).not.toHaveBeenCalled();
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

    await expect(new DailyStorefrontWorker(fixture.dependencies).run()).resolves.toMatchObject({
      checked: 1,
      failed: 1,
      processed: 2,
      refreshed: 1,
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

  it("keeps the primary reauth failure and continues when expiry email delivery fails", async () => {
    const first = connection();
    const second = connection({
      connectionEpoch: "55555555-5555-4555-8555-555555555555",
      id: "66666666-6666-4666-8666-666666666666",
      userId: "44444444-4444-4444-8444-444444444444",
    });
    const fixture = setup({ connections: [first, second] });
    fixture.refreshSession
      .mockRejectedValueOnce({ classification: "DEAD", status: 302 })
      .mockResolvedValueOnce(session(2));
    vi.mocked(fixture.repository.applyLifecycle).mockResolvedValueOnce({
      applied: true,
      terminalTransition: true,
    });
    vi.mocked(fixture.dependencies.sendExpiry).mockRejectedValue(
      new Error("resend-key-sensitive"),
    );

    const summary = await new DailyStorefrontWorker(fixture.dependencies).run();

    expect(summary).toMatchObject({ checked: 1, failed: 1, processed: 2 });
    expect(summary.accounts[0]).toMatchObject({
      classification: "DEAD",
      outcome: "failed",
      reason: "REAUTH_FAILED",
    });
    expect(summary.accounts[1]).toMatchObject({
      classification: "OK",
      outcome: "checked",
      refreshPersisted: true,
    });
    expect(JSON.stringify(summary)).not.toContain("resend-key-sensitive");
  });

  it("does not poison session health when the fetch-free pipeline fails", async () => {
    const fixture = setup();
    fixture.pipeline.mockRejectedValue(new Error("catalog unavailable"));

    await expect(
      new DailyStorefrontWorker(fixture.dependencies).run(),
    ).resolves.toMatchObject({
      accounts: [
        expect.objectContaining({
          notificationStatus: "failed",
          outcome: "checked",
          reason: "CATALOG_FAILED",
          refreshPersisted: true,
        }),
      ],
      checked: 1,
      failed: 0,
      notificationFailures: 1,
      refreshed: 1,
    });
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.repository.applyLifecycle).toHaveBeenCalledWith(
      connection(),
      "OK",
      "CONNECTED",
    );
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledTimes(1);
    expect(fixture.repository.recordStorefrontRefresh).toHaveBeenCalledWith({
      checkedAt,
      claim,
      connection: connection(),
      consumeManualClaim: true,
      rotationLease,
      storefront: expect.objectContaining({ shopHash: "b".repeat(64) }),
      trigger: "cron",
    });
  });
});
