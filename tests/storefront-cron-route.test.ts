import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runConfiguredDailyStorefrontCron = vi.fn();

vi.mock("@/src/lib/worker/storefront-runtime", () => ({
  runConfiguredDailyStorefrontCron,
}));

describe("daily storefront cron route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "exact-cron-secret");
    runConfiguredDailyStorefrontCron.mockReset();
    runConfiguredDailyStorefrontCron.mockResolvedValue({
      accounts: [
        {
          classification: "OK",
          connectionId: "22222222-2222-4222-8222-222222222222",
          emailsSent: 0,
          matchesFound: 0,
          notificationStatus: "not-needed",
          outcome: "checked",
          reason: null,
          refreshPersisted: true,
          storeDate: "2026-08-17",
          trigger: "cron",
        },
      ],
      checked: 1,
      failed: 0,
      notificationFailures: 0,
      processed: 1,
      refreshed: 1,
      skipped: 0,
      trigger: "cron",
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails closed before creating worker dependencies when the secret is missing or wrong", async () => {
    const { GET } = await import("@/app/api/cron/storefront/route");
    for (const authorization of [undefined, "Bearer wrong", "exact-cron-secret"]) {
      const headers = authorization ? { authorization } : undefined;
      const response = await GET(
        new Request("https://example.test/api/cron/storefront?user=target", {
          headers,
        }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
    }
    expect(runConfiguredDailyStorefrontCron).not.toHaveBeenCalled();

    vi.stubEnv("CRON_SECRET", "");
    const missingConfiguration = await GET(
      new Request("https://example.test/api/cron/storefront", {
        headers: { authorization: "Bearer " },
      }),
    );
    expect(missingConfiguration.status).toBe(401);
    expect(runConfiguredDailyStorefrontCron).not.toHaveBeenCalled();

    vi.stubEnv("CRON_SECRET", "too-short");
    const unsafeConfiguration = await GET(
      new Request("https://example.test/api/cron/storefront", {
        headers: { authorization: "Bearer too-short" },
      }),
    );
    expect(unsafeConfiguration.status).toBe(401);
    expect(runConfiguredDailyStorefrontCron).not.toHaveBeenCalled();
  });

  it("accepts only the exact bearer secret and returns aggregate-safe counts", async () => {
    const { GET } = await import("@/app/api/cron/storefront/route");
    const response = await GET(
      new Request("https://example.test/api/cron/storefront?user=ignored", {
        headers: { authorization: "Bearer exact-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      checked: 1,
      failed: 0,
      notificationFailures: 0,
      processed: 1,
      refreshed: 1,
      skipped: 0,
      status: "ok",
      trigger: "cron",
    });
    expect(runConfiguredDailyStorefrontCron).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(
      "[storefront-cron] completed",
      expect.objectContaining({
        checked: 1,
        refreshed: 1,
      }),
    );
    expect(console.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accounts: expect.anything() }),
    );
    expect(JSON.stringify(body)).not.toContain(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("redacts worker failures and exports no mutation route", async () => {
    runConfiguredDailyStorefrontCron.mockRejectedValue(
      new Error("cookie token puuid sensitive"),
    );
    const route = await import("@/app/api/cron/storefront/route");
    const response = await route.GET(
      new Request("https://example.test/api/cron/storefront", {
        headers: { authorization: "Bearer exact-cron-secret" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
    expect(console.error).toHaveBeenCalledWith(
      "[storefront-cron] invocation unavailable",
    );
    expect("POST" in route).toBe(false);
  });
});
