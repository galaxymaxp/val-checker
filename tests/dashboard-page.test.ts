import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const loadWishlistInventory = vi.fn();
const loadRiotAccountsWithClient = vi.fn();
const loadStorefrontDashboardStatus = vi.fn();
const loadDailyShops = vi.fn();
const redirect = vi.fn();
const disconnectRiotSession = vi.fn();
const setSkinWatched = vi.fn();
const admin = { from: vi.fn() };

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims }, from: vi.fn() }),
}));

vi.mock("@/src/lib/catalog/inventory", () => ({ loadWishlistInventory }));
vi.mock("@/src/lib/riot/connection-state", () => ({
  loadRiotAccountsWithClient,
}));
vi.mock("@/src/lib/storefront/dashboard-status", () => ({
  loadStorefrontDashboardStatus,
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock("@/src/lib/storefront/daily-shop", () => ({ loadDailyShops }));
const signOut = vi.fn();

vi.mock("@/app/dashboard/actions", () => ({ setSkinWatched, signOut }));
vi.mock("@/app/dashboard/riot-actions", () => ({
  checkDailyShopNow: vi.fn(),
  disconnectRiotSession,
  sendTestStorefrontEmail: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));

describe("dashboard page", () => {
  beforeEach(() => {
    getClaims.mockReset();
    loadWishlistInventory.mockReset();
    loadRiotAccountsWithClient.mockReset();
    loadStorefrontDashboardStatus.mockReset();
    loadDailyShops.mockReset();
    loadDailyShops.mockResolvedValue([]);
    redirect.mockReset();
    loadWishlistInventory.mockResolvedValue([]);
    loadRiotAccountsWithClient.mockResolvedValue([]);
    loadStorefrontDashboardStatus.mockResolvedValue({
      accounts: [],
      nextResetAt: "2026-08-18T00:00:00.000Z",
      storeDate: "2026-08-17",
    });
  });

  it("renders after an authenticated magic-link session", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "user@example.com", sub: "user-id" } },
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const content = await DashboardPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(content.type).toBe("main");
    expect(loadWishlistInventory).toHaveBeenCalled();
    expect(loadRiotAccountsWithClient).toHaveBeenCalledWith(
      admin,
      "user-id",
    );
    expect(loadStorefrontDashboardStatus).toHaveBeenCalledWith(
      admin,
      "user-id",
      [],
    );
  });

  it("keeps a server-side redirect as a second protection layer", async () => {
    getClaims.mockResolvedValue({ data: null });
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/sign-in?next=/dashboard");
    expect(loadWishlistInventory).not.toHaveBeenCalled();
    expect(loadRiotAccountsWithClient).not.toHaveBeenCalled();
    expect(loadStorefrontDashboardStatus).not.toHaveBeenCalled();
    expect(loadDailyShops).not.toHaveBeenCalled();
  });
});
