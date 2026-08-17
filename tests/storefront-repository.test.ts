import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/src/types/database";
import { SupabaseDailyStorefrontRepository } from "@/src/lib/worker/storefront-repository";
import type {
  DailyRunClaim,
  SessionRotationLease,
  WorkerConnection,
} from "@/src/lib/worker/storefront-worker";

vi.mock("server-only", () => ({}));

const connection: WorkerConnection = {
  authStatus: "CONNECTED",
  connectionEpoch: "22222222-2222-4222-8222-222222222222",
  consecutiveFailures: 0,
  createdAt: "2026-08-16T00:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  lastRefreshAt: null,
  region: "ap",
  userId: "11111111-1111-4111-8111-111111111111",
};

const manualClaim: DailyRunClaim = {
  claimToken: "55555555-5555-4555-8555-555555555555",
  claimedAt: new Date("2026-08-17T00:00:00.000Z"),
  id: "44444444-4444-4444-8444-444444444444",
  storeDate: "2026-08-17",
};

const rotationLease: SessionRotationLease = {
  claimedAt: new Date("2026-08-17T00:00:00.000Z"),
  storeDate: "2026-08-17",
  token: "66666666-6666-4666-8666-666666666666",
};

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("storefront repository trigger policy", () => {
  it("uses the manual claim only for manual and routes operator through automatic", async () => {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      void args;
      return {
        data:
        name === "claim_riot_manual_refresh"
          ? [
              {
                claimed_at: "2026-08-17T00:00:00.000Z",
                claim_token: manualClaim.claimToken,
                claim_status: "claimed",
                next_reset_at: "2026-08-18T00:00:00.000Z",
                run_id: manualClaim.id,
                store_date: manualClaim.storeDate,
              },
            ]
          : [
              {
                claimed_at: "2026-08-17T00:00:00.000Z",
                run_id: manualClaim.id,
                store_date: manualClaim.storeDate,
              },
            ],
        error: null,
      };
    });
    const repository = new SupabaseDailyStorefrontRepository(
      clientWithRpc(rpc),
    );

    await expect(
      repository.claim(connection, "manual", rotationLease),
    ).resolves.toMatchObject({
      claim: { claimToken: manualClaim.claimToken },
      reason: null,
    });
    await expect(
      repository.claim(connection, "operator", rotationLease),
    ).resolves.toMatchObject({
      claim: { claimToken: null },
      reason: null,
    });
    await expect(
      repository.claim(connection, "cron", rotationLease),
    ).resolves.toMatchObject({
      claim: { claimToken: null },
      reason: null,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_riot_manual_refresh",
      "claim_riot_daily_run",
      "claim_riot_daily_run",
    ]);
    for (const [, args] of rpc.mock.calls) {
      expect(args).toMatchObject({
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_rotation_lease_token: rotationLease.token,
        p_user_id: connection.userId,
      });
    }
  });

  it("keeps manual attempt/failure RPCs isolated from operator work", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name.startsWith("mark_")
        ? [{ attempted_at: "2026-08-17T00:05:00.000Z" }]
        : [],
      error: null,
    }));
    const repository = new SupabaseDailyStorefrontRepository(
      clientWithRpc(rpc),
    );

    await repository.markStorefrontAttempt(
      manualClaim,
      connection,
      "manual",
      rotationLease,
    );
    await repository.markStorefrontAttempt(
      { ...manualClaim, claimToken: null },
      connection,
      "operator",
      rotationLease,
    );
    await repository.failRefresh(
      { ...manualClaim, claimToken: null },
      connection,
      "operator",
      rotationLease,
      { reason: "UNEXPECTED", retryable: true },
    );
    await repository.failRefresh(
      manualClaim,
      connection,
      "manual",
      rotationLease,
      {
        reason: "REAUTH_FAILED",
        retryable: true,
      },
    );

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "mark_riot_manual_storefront_attempt",
      "mark_riot_storefront_attempt",
      "fail_riot_manual_refresh",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "mark_riot_manual_storefront_attempt",
      expect.objectContaining({
        p_claim_token: manualClaim.claimToken,
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_rotation_lease_token: rotationLease.token,
        p_run_id: manualClaim.id,
        p_user_id: connection.userId,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "mark_riot_storefront_attempt",
      expect.objectContaining({
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_rotation_lease_token: rotationLease.token,
        p_run_id: manualClaim.id,
        p_user_id: connection.userId,
      }),
    );
  });

  it.each(["cron", "manual", "operator"] as const)(
    "terminal-closes a handled %s storefront attempt with every live fence",
    async (trigger) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ closed_at: "2026-08-17T00:05:02.000Z" }],
        error: null,
      });
      const repository = new SupabaseDailyStorefrontRepository(
        clientWithRpc(rpc),
      );
      const runClaim =
        trigger === "manual"
          ? manualClaim
          : { ...manualClaim, claimToken: null };

      await repository.failRefresh(
        runClaim,
        connection,
        trigger,
        rotationLease,
        {
          reason: "STOREFRONT_FAILED",
          releaseAttemptedLease: true,
          retryable: false,
        },
      );

      expect(rpc).toHaveBeenCalledWith("close_riot_storefront_attempt", {
        p_claim_token:
          trigger === "manual" ? manualClaim.claimToken : null,
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_rotation_lease_token: rotationLease.token,
        p_run_id: manualClaim.id,
        p_trigger: trigger,
        p_user_id: connection.userId,
      });
    },
  );

  it("records an ambiguous manual attempt without clearing the lease and leaves automatic ambiguity untouched", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          failed_at: "2026-08-17T00:05:02.000Z",
          status: "requesting",
        },
      ],
      error: null,
    });
    const repository = new SupabaseDailyStorefrontRepository(
      clientWithRpc(rpc),
    );
    const ambiguousFailure = {
      reason: "STOREFRONT_FAILED" as const,
      releaseAttemptedLease: false,
      retryable: false as const,
    };

    await repository.failRefresh(
      manualClaim,
      connection,
      "manual",
      rotationLease,
      ambiguousFailure,
    );
    await repository.failRefresh(
      { ...manualClaim, claimToken: null },
      connection,
      "cron",
      rotationLease,
      ambiguousFailure,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fail_riot_manual_refresh", {
      p_claim_token: manualClaim.claimToken,
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_failure_reason: "STOREFRONT_FAILED",
      p_retryable: false,
      p_run_id: manualClaim.id,
      p_user_id: connection.userId,
    });
  });

  it("acquires, renews, and releases the shared session lease with the exact owner fence", async () => {
    const renewedAt = new Date("2026-08-17T00:04:59.000Z");
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "claim_riot_session_rotation"
          ? [
              {
                claimed_at: rotationLease.claimedAt.toISOString(),
                lease_status: "acquired",
                lease_token: rotationLease.token,
                store_date: rotationLease.storeDate,
              },
            ]
          : name === "renew_riot_session_rotation"
            ? [{ renewed_at: renewedAt.toISOString() }]
            : [],
      error: null,
    }));
    const repository = new SupabaseDailyStorefrontRepository(
      clientWithRpc(rpc),
    );

    await expect(
      repository.acquireSessionRotationLease(connection),
    ).resolves.toEqual({ lease: rotationLease, reason: null });
    await expect(
      repository.renewSessionRotationLease(connection, rotationLease),
    ).resolves.toEqual({ ...rotationLease, claimedAt: renewedAt });
    await expect(
      repository.releaseSessionRotationLease(connection, rotationLease),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_riot_session_rotation", {
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_user_id: connection.userId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "renew_riot_session_rotation", {
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_lease_token: rotationLease.token,
      p_user_id: connection.userId,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "release_riot_session_rotation", {
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_lease_token: rotationLease.token,
      p_user_id: connection.userId,
    });
  });

  it.each([
    ["held", "SESSION_LEASE_HELD"],
    ["account_unavailable", "ACCOUNT_UNAVAILABLE"],
  ] as const)(
    "maps a %s session lease response to %s",
    async (leaseStatus, reason) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [
          {
            claimed_at: null,
            lease_status: leaseStatus,
            lease_token: null,
            store_date: "2026-08-17",
          },
        ],
        error: null,
      });
      const repository = new SupabaseDailyStorefrontRepository(
        clientWithRpc(rpc),
      );

      await expect(
        repository.acquireSessionRotationLease(connection),
      ).resolves.toEqual({ lease: null, reason });
    },
  );

  it.each([
    ["held", "CLAIM_HELD"],
    ["account_unavailable", "ACCOUNT_UNAVAILABLE"],
  ] as const)(
    "preserves the manual %s claim reason instead of collapsing an empty claim",
    async (claimStatus, reason) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [
          {
            claim_status: claimStatus,
            claim_token: null,
            claimed_at: null,
            next_reset_at: "2026-08-18T00:00:00.000Z",
            run_id: null,
            store_date: "2026-08-17",
          },
        ],
        error: null,
      });
      const repository = new SupabaseDailyStorefrontRepository(
        clientWithRpc(rpc),
      );

      await expect(
        repository.claim(connection, "manual", rotationLease),
      ).resolves.toEqual({ claim: null, reason });
    },
  );

  it("enumerates only the exact owned target when both target fields are set", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> & {
      then?: (
        resolve: (value: { data: never[]; error: null }) => unknown,
      ) => Promise<unknown>;
    } = {
      eq: vi.fn(),
      order: vi.fn(),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.then = (resolve) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    const from = vi.fn(() => query);
    const repository = new SupabaseDailyStorefrontRepository(
      { from } as unknown as SupabaseClient<Database>,
      connection.userId,
      connection.id,
    );

    await expect(repository.listConnections()).resolves.toEqual([]);
    expect(query.eq).toHaveBeenNthCalledWith(1, "user_id", connection.userId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "id", connection.id);
  });

  it("rejects a partially specified target", () => {
    expect(
      () =>
        new SupabaseDailyStorefrontRepository(
          {} as SupabaseClient<Database>,
          connection.userId,
        ),
    ).toThrow("Daily storefront worker storage operation failed.");
  });

  it("uses the claim token only for the raw manual snapshot, then enriches safely", async () => {
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: [
        {
          manual_succeeded_at: args.p_manual_run_id
            ? "2026-08-17T00:05:02.000Z"
            : null,
          shop_check_id: "66666666-6666-4666-8666-666666666666",
        },
      ],
      error: null,
    }));
    const repository = new SupabaseDailyStorefrontRepository(
      clientWithRpc(rpc),
    );
    const checkedAt = new Date("2026-08-17T00:05:01.000Z");
    const shared = {
      checkedAt,
      claim: manualClaim,
      connection,
      trigger: "manual" as const,
    };

    await repository.recordStorefrontRefresh({
      ...shared,
      consumeManualClaim: true,
      rotationLease,
      storefront: {
        expiresAt: "2026-08-18T00:00:00.000Z",
        offers: [
          {
            costs: [{ amount: 875, currencyUuid: connection.id }],
            offerId: manualClaim.id,
            rewards: [
              { levelUuid: connection.connectionEpoch, quantity: 1, skinUuid: null },
            ],
          },
        ],
        shopHash: "a".repeat(64),
        skinUuids: [],
        storeDate: manualClaim.storeDate,
      },
    });
    await repository.recordStorefrontRefresh({
      ...shared,
      consumeManualClaim: false,
      rotationLease: null,
      storefront: {
        expiresAt: "2026-08-18T00:00:00.000Z",
        offers: [
          {
            costs: [{ amount: 875, currencyUuid: connection.id }],
            offerId: manualClaim.id,
            rewards: [
              {
                levelUuid: connection.connectionEpoch,
                quantity: 1,
                skinUuid: connection.id,
              },
            ],
          },
        ],
        shopHash: "a".repeat(64),
        skinUuids: [connection.id],
        storeDate: manualClaim.storeDate,
      },
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "record_storefront_refresh",
      expect.objectContaining({
        p_manual_claim_token: manualClaim.claimToken,
        p_manual_run_id: manualClaim.id,
        p_offer_skin_uuids: [],
        p_rotation_lease_token: rotationLease.token,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "record_storefront_refresh",
      expect.objectContaining({
        p_manual_claim_token: null,
        p_manual_run_id: null,
        p_offer_skin_uuids: [connection.id],
        p_rotation_lease_token: null,
      }),
    );
  });
});
