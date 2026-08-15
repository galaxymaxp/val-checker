import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const canRiotConnect = vi.fn();
const loadCatalogForBrowse = vi.fn();
const loadRiotConnectionStateWithClient = vi.fn();
const loadWatchedSkinUuids = vi.fn();
const loadDailyShop = vi.fn();
const redirect = vi.fn();
const disconnectRiotSession = vi.fn();
const setSkinWatched = vi.fn();
const admin = { from: vi.fn() };

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims }, from: vi.fn() }),
}));

vi.mock("@/src/lib/catalog/browse", () => ({ loadCatalogForBrowse }));
vi.mock("@/src/lib/riot/connect-allowlist", () => ({ canRiotConnect }));
vi.mock("@/src/lib/riot/connection-state", () => ({
  loadRiotConnectionStateWithClient,
}));
vi.mock("@/src/lib/supabase/server-admin", () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock("@/src/lib/watchlist/load", () => ({ loadWatchedSkinUuids }));
vi.mock("@/src/lib/storefront/daily-shop", () => ({ loadDailyShop }));
const signOut = vi.fn();

vi.mock("@/app/dashboard/actions", () => ({ setSkinWatched, signOut }));
vi.mock("@/app/dashboard/riot-actions", () => ({ disconnectRiotSession }));
vi.mock("next/navigation", () => ({ redirect }));

describe("dashboard page", () => {
  beforeEach(() => {
    getClaims.mockReset();
    canRiotConnect.mockReset();
    loadCatalogForBrowse.mockReset();
    loadRiotConnectionStateWithClient.mockReset();
    loadWatchedSkinUuids.mockReset();
    loadDailyShop.mockReset();
    loadDailyShop.mockResolvedValue(null);
    redirect.mockReset();
    loadCatalogForBrowse.mockResolvedValue([]);
    canRiotConnect.mockReturnValue(false);
    loadRiotConnectionStateWithClient.mockResolvedValue("disconnected");
    loadWatchedSkinUuids.mockResolvedValue([]);
  });

  it("renders after an authenticated magic-link session", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "user@example.com", sub: "user-id" } },
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const content = await DashboardPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(content.type).toBe("main");
    expect(loadRiotConnectionStateWithClient).toHaveBeenCalledWith(
      admin,
      "user-id",
    );
    expect(canRiotConnect).toHaveBeenCalledWith({
      email: "user@example.com",
      userId: "user-id",
    });
  });

  it("keeps a server-side redirect as a second protection layer", async () => {
    getClaims.mockResolvedValue({ data: null });
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/sign-in?next=/dashboard");
    expect(loadCatalogForBrowse).not.toHaveBeenCalled();
    expect(loadRiotConnectionStateWithClient).not.toHaveBeenCalled();
    expect(loadWatchedSkinUuids).not.toHaveBeenCalled();
  });
});
