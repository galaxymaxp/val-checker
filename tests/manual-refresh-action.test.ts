import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const assertAllowed = vi.fn();
const runDailyCheckForUser = vi.fn();
const revalidatePath = vi.fn();
const maybeSingle = vi.fn();
const connectionEq = vi.fn(() => ({ maybeSingle }));
const userEq = vi.fn(() => ({ eq: connectionEq }));
const select = vi.fn(() => ({ eq: userEq }));
const from = vi.fn(() => ({ select }));
const createAdminSupabaseClient = vi.fn(() => ({ from }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient,
}));
vi.mock("@/src/lib/riot/connect-allowlist", () => ({
  loadRiotConnectAllowlist: () => ({ assertAllowed }),
}));
vi.mock("@/src/lib/worker/on-demand-check", () => ({
  runDailyCheckForUser,
}));

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("manual storefront refresh server action", () => {
  beforeEach(() => {
    getClaims.mockReset();
    getClaims.mockResolvedValue({
      data: { claims: { email: "player@example.com", sub: userId } },
    });
    assertAllowed.mockReset();
    runDailyCheckForUser.mockReset();
    revalidatePath.mockReset();
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: { id: connectionId }, error: null });
    createAdminSupabaseClient.mockClear();
    from.mockClear();
    select.mockClear();
    userEq.mockClear();
    connectionEq.mockClear();
  });

  it("verifies ownership before refreshing one exact connection", async () => {
    runDailyCheckForUser.mockResolvedValue({
      ran: true,
      summary: {
        accounts: [
          {
            classification: "OK",
            connectionId,
            emailsSent: 0,
            matchesFound: 0,
            notificationStatus: "not-needed",
            outcome: "checked",
            reason: null,
            refreshPersisted: true,
            storeDate: "2026-08-17",
            trigger: "manual",
          },
        ],
        checked: 1,
        failed: 0,
        notificationFailures: 0,
        processed: 1,
        refreshed: 1,
        skipped: 0,
        trigger: "manual",
      },
    });
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront(connectionId)).resolves.toEqual({
      ok: true,
    });
    expect(userEq).toHaveBeenCalledWith("user_id", userId);
    expect(connectionEq).toHaveBeenCalledWith("id", connectionId);
    expect(runDailyCheckForUser).toHaveBeenCalledWith(userId, connectionId);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("does not build the worker for an unowned connection", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront(connectionId)).resolves.toEqual({
      error: "That Riot account is not connected.",
      ok: false,
    });
    expect(runDailyCheckForUser).not.toHaveBeenCalled();
  });

  it("returns a sanitized warning after a persisted shop with catalog drift", async () => {
    runDailyCheckForUser.mockResolvedValue({
      ran: true,
      summary: {
        accounts: [
          {
            classification: "OK",
            connectionId,
            emailsSent: 0,
            matchesFound: 0,
            notificationStatus: "failed",
            outcome: "checked",
            reason: "CATALOG_FAILED",
            refreshPersisted: true,
            storeDate: "2026-08-17",
            trigger: "manual",
          },
        ],
        checked: 1,
        failed: 0,
        notificationFailures: 1,
        processed: 1,
        refreshed: 1,
        skipped: 0,
        trigger: "manual",
      },
    });
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront(connectionId)).resolves.toEqual({
      ok: true,
      warning:
        "Skin details and watchlist matching are temporarily unavailable.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("reports a held manual allowance without implying a refresh", async () => {
    runDailyCheckForUser.mockResolvedValue({
      ran: false,
      summary: {
        accounts: [
          {
            classification: null,
            connectionId,
            emailsSent: 0,
            matchesFound: 0,
            notificationStatus: "not-attempted",
            outcome: "skipped",
            reason: "MANUAL_CLAIM_HELD",
            refreshPersisted: false,
            storeDate: null,
            trigger: "manual",
          },
        ],
        checked: 0,
        failed: 0,
        notificationFailures: 0,
        processed: 1,
        refreshed: 0,
        skipped: 1,
        trigger: "manual",
      },
    });
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront(connectionId)).resolves.toEqual({
      error: "This account’s manual refresh is already used or in progress today.",
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "SESSION_LEASE_HELD",
      "This Riot account is already refreshing, or a previous request has an uncertain outcome. Refresh the dashboard to see when manual refresh is available.",
    ],
    [
      "ACCOUNT_UNAVAILABLE",
      "This Riot account is not ready for manual refresh. Reconnect it or wait for its identity to be verified.",
    ],
  ] as const)("maps %s without implying the daily allowance was used", async (reason, error) => {
    runDailyCheckForUser.mockResolvedValue({
      ran: false,
      summary: {
        accounts: [
          {
            classification: null,
            connectionId,
            emailsSent: 0,
            matchesFound: 0,
            notificationStatus: "not-attempted",
            outcome: "skipped",
            reason,
            refreshPersisted: false,
            storeDate: null,
            trigger: "manual",
          },
        ],
        checked: 0,
        failed: 0,
        notificationFailures: 0,
        processed: 1,
        refreshed: 0,
        skipped: 1,
        trigger: "manual",
      },
    });
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront(connectionId)).resolves.toEqual({
      error,
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed ids before creating a service client", async () => {
    const { refreshRiotStorefront } = await import(
      "@/app/dashboard/riot-actions"
    );

    await expect(refreshRiotStorefront("not-a-uuid")).resolves.toEqual({
      error: "Choose a valid Riot account to refresh.",
      ok: false,
    });
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(runDailyCheckForUser).not.toHaveBeenCalled();
  });
});
