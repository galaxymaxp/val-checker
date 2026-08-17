import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { RiotAccountView } from "@/src/lib/riot/connection-state";
import { loadStorefrontDashboardStatus } from "@/src/lib/storefront/dashboard-status";
import type { Database } from "@/src/types/database";

vi.mock("server-only", () => ({}));

const userId = "11111111-1111-4111-8111-111111111111";

function fixtureClient(input: {
  identities?: readonly (Pick<
    Database["public"]["Tables"]["riot_connections"]["Row"],
    "id" | "puuid"
  > &
    Partial<
      Pick<
        Database["public"]["Tables"]["riot_connections"]["Row"],
        | "rotation_lease_claimed_at"
        | "rotation_lease_store_date"
        | "rotation_lease_storefront_attempted_at"
        | "rotation_lease_token"
      >
    >)[];
  logs?: readonly Record<string, unknown>[];
  manuals?: readonly Record<string, unknown>[];
}) {
  const manualIn = vi.fn(() => ({
    order: () => ({
      limit: async () => ({ data: input.manuals ?? [], error: null }),
    }),
  }));
  const from = vi.fn((table: string) => {
    if (table === "riot_connections") {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: input.identities ?? [], error: null }),
          }),
        }),
      };
    }
    if (table === "riot_manual_refreshes") {
      return {
        select: () => ({
          in: manualIn,
        }),
      };
    }
    if (table === "riot_run_logs") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: input.logs ?? [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    client: {
      from,
      rpc: vi.fn(async () => ({
        data: [
          {
            next_reset_at: "2026-08-18T00:00:00.000Z",
            store_date: "2026-08-17",
          },
        ],
        error: null,
      })),
    } as unknown as SupabaseClient<Database>,
    from,
    manualIn,
  };
}

const connected: RiotAccountView = {
  authStatus: "CONNECTED",
  connectedAt: "2026-08-15T00:00:00.000Z",
  id: "22222222-2222-4222-8222-222222222222",
  label: "Main",
  lastRefreshAt: null,
  region: "ap",
};

describe("storefront dashboard status", () => {
  it("keeps automatic and manual status independent", async () => {
    const { client } = fixtureClient({
      identities: [{ id: connected.id, puuid: "riot-puuid" }],
      logs: [
        {
          classification: null,
          connection_id: connected.id,
          outcome: "skipped",
          ran_at: "2026-08-17T00:06:03.000Z",
          reason: "DAILY_CLAIM_HELD",
          run_id: null,
          trigger: "cron",
        },
        {
          classification: "OK",
          connection_id: connected.id,
          outcome: "checked",
          ran_at: "2026-08-17T00:05:03.000Z",
          reason: null,
          run_id: "77777777-7777-4777-8777-777777777777",
          trigger: "cron",
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      lastAutomaticAttemptAt: "2026-08-17T00:05:03.000Z",
      lastAutomaticSuccessAt: "2026-08-17T00:05:03.000Z",
      manualAvailability: "available",
      nextAutomaticAt: "2026-08-18T00:05:00.000Z",
      nextManualAt: "2026-08-18T00:00:00.000Z",
    });
  });

  it("shows post-attempt failure as exhausted, not successful or retryable", async () => {
    const { client } = fixtureClient({
      identities: [{ id: connected.id, puuid: "riot-puuid" }],
      manuals: [
        {
          claim_token: "33333333-3333-4333-8333-333333333333",
          claimed_at: "2026-08-17T01:00:00.000Z",
          connection_epoch: "44444444-4444-4444-8444-444444444444",
          connection_id: connected.id,
          failed_at: "2026-08-17T01:00:04.000Z",
          failure_reason: "STOREFRONT_FAILED",
          id: "55555555-5555-4555-8555-555555555555",
          riot_puuid: "riot-puuid",
          status: "requesting",
          store_date: "2026-08-17",
          storefront_attempted_at: "2026-08-17T01:00:02.000Z",
          succeeded_at: null,
          user_id: userId,
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      lastManualSuccessAt: null,
      manualAvailability: "exhausted",
    });
  });

  it("recovers a stale pre-attempt claim in the read model", async () => {
    const { client } = fixtureClient({
      identities: [{ id: connected.id, puuid: "riot-puuid" }],
      manuals: [
        {
          claim_token: "33333333-3333-4333-8333-333333333333",
          claimed_at: "2026-08-17T01:00:00.000Z",
          connection_epoch: "44444444-4444-4444-8444-444444444444",
          connection_id: connected.id,
          failed_at: null,
          failure_reason: null,
          id: "55555555-5555-4555-8555-555555555555",
          riot_puuid: "riot-puuid",
          status: "claimed",
          store_date: "2026-08-17",
          storefront_attempted_at: null,
          succeeded_at: null,
          user_id: userId,
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T01:06:00.000Z"),
    );

    expect(status.accounts[0]?.manualAvailability).toBe("available");
  });

  it("keeps a consumed allowance with the Riot identity after reconnect", async () => {
    const { client, manualIn } = fixtureClient({
      identities: [{ id: connected.id, puuid: "stable-riot-puuid" }],
      manuals: [
        {
          claim_token: "33333333-3333-4333-8333-333333333333",
          claimed_at: "2026-08-17T01:00:00.000Z",
          connection_epoch: "44444444-4444-4444-8444-444444444444",
          connection_id: "99999999-9999-4999-8999-999999999999",
          failed_at: null,
          failure_reason: null,
          id: "55555555-5555-4555-8555-555555555555",
          riot_puuid: "stable-riot-puuid",
          status: "succeeded",
          store_date: "2026-08-17",
          storefront_attempted_at: "2026-08-17T01:00:02.000Z",
          succeeded_at: "2026-08-17T01:00:04.000Z",
          user_id: "88888888-8888-4888-8888-888888888888",
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      lastManualSuccessAt: "2026-08-17T01:00:04.000Z",
      manualAvailability: "succeeded",
    });
    expect(manualIn).toHaveBeenCalledWith("riot_puuid", [
      "stable-riot-puuid",
    ]);
  });

  it("shows operator runs that consumed the automatic allowance", async () => {
    const { client } = fixtureClient({
      identities: [{ id: connected.id, puuid: "riot-puuid" }],
      logs: [
        {
          classification: "OK",
          connection_id: connected.id,
          outcome: "checked",
          ran_at: "2026-08-17T00:04:00.000Z",
          reason: "CATALOG_FAILED",
          run_id: "77777777-7777-4777-8777-777777777777",
          trigger: "operator",
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      lastAutomaticAttemptAt: "2026-08-17T00:04:00.000Z",
      lastAutomaticSuccessAt: "2026-08-17T00:04:00.000Z",
      recentFailureReason: "CATALOG_FAILED",
    });
  });

  it("keeps legacy accounts unavailable until a stable identity is hydrated", async () => {
    const { client, manualIn } = fixtureClient({
      identities: [{ id: connected.id, puuid: null }],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      manualAvailability: "unavailable",
      manualUnavailableReason: expect.stringMatching(/identity is verified/i),
    });
    expect(manualIn).not.toHaveBeenCalled();
  });

  it("does not advertise manual refresh during an ambiguous automatic attempt", async () => {
    const { client } = fixtureClient({
      identities: [
        {
          id: connected.id,
          puuid: "riot-puuid",
          rotation_lease_claimed_at: "2026-08-17T01:00:00.000Z",
          rotation_lease_store_date: "2026-08-17",
          rotation_lease_storefront_attempted_at:
            "2026-08-17T01:00:10.000Z",
          rotation_lease_token: "33333333-3333-4333-8333-333333333333",
        },
      ],
    });

    const status = await loadStorefrontDashboardStatus(
      client,
      userId,
      [connected],
      new Date("2026-08-17T02:00:00.000Z"),
    );

    expect(status.accounts[0]).toMatchObject({
      manualAvailability: "unavailable",
      manualUnavailableReason: expect.stringMatching(
        /next UTC reset or reconnect/i,
      ),
    });
  });
});
