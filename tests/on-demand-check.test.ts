import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManualStorefrontTargetError,
  runDailyCheckForUser,
} from "@/src/lib/worker/on-demand-check";

const mocks = vi.hoisted(() => ({
  buildWorker: vi.fn(),
  run: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/worker/storefront-runtime", () => ({
  buildConfiguredDailyStorefrontWorker: mocks.buildWorker,
}));

function summary(checked: number) {
  return {
    accounts:
      checked > 0
        ? [
            {
              classification: "OK" as const,
              connectionId: "22222222-2222-4222-8222-222222222222",
              emailsSent: 0,
              matchesFound: 0,
              notificationStatus: "not-needed" as const,
              outcome: "checked" as const,
              reason: null,
              refreshPersisted: true,
              storeDate: "2026-08-17",
              trigger: "manual" as const,
            },
          ]
        : [],
    checked,
    failed: 0,
    notificationFailures: 0,
    processed: checked,
    refreshed: checked,
    skipped: 0,
    trigger: "manual" as const,
  };
}

describe("on-demand storefront refresh", () => {
  beforeEach(() => {
    mocks.buildWorker.mockReset().mockResolvedValue({ run: mocks.run });
    mocks.run.mockReset().mockResolvedValue(summary(1));
  });

  it("requires both the signed-in user and one exact Riot connection", async () => {
    await expect(runDailyCheckForUser("", "connection")).rejects.toBeInstanceOf(
      ManualStorefrontTargetError,
    );
    await expect(runDailyCheckForUser("user")).rejects.toBeInstanceOf(
      ManualStorefrontTargetError,
    );
    await expect(runDailyCheckForUser("user", "")).rejects.toBeInstanceOf(
      ManualStorefrontTargetError,
    );
    expect(mocks.buildWorker).not.toHaveBeenCalled();
  });

  it("builds a manual worker scoped to the exact owned connection", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const connectionId = "22222222-2222-4222-8222-222222222222";

    await expect(runDailyCheckForUser(userId, connectionId)).resolves.toEqual({
      ran: true,
      summary: summary(1),
    });
    expect(mocks.buildWorker).toHaveBeenCalledWith({
      connectionId,
      trigger: "manual",
      userId,
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("reports that no refresh ran when the manual database claim is held", async () => {
    const held = {
      ...summary(0),
      accounts: [
        {
          classification: null,
          connectionId: "22222222-2222-4222-8222-222222222222",
          emailsSent: 0,
          matchesFound: 0,
          notificationStatus: "not-attempted" as const,
          outcome: "skipped" as const,
          reason: "MANUAL_CLAIM_HELD" as const,
          refreshPersisted: false,
          storeDate: null,
          trigger: "manual" as const,
        },
      ],
      processed: 1,
      skipped: 1,
    };
    mocks.run.mockResolvedValue(held);

    await expect(
      runDailyCheckForUser(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual({ ran: false, summary: held });
  });
});
