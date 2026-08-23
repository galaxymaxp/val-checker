import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const loadWishlistInventory = vi.fn();
const loadRiotAccountsWithClient = vi.fn();
const loadStorefrontDashboardStatus = vi.fn();
const loadDailyShops = vi.fn();
const loadShowcaseSkins = vi.fn();
const redirect = vi.fn();
const disconnectRiotSession = vi.fn();
const setSkinWatched = vi.fn();
const admin = { from: vi.fn() };

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims }, from: vi.fn() }),
}));

vi.mock("@/src/lib/catalog/inventory", () => ({ loadWishlistInventory }));
vi.mock("@/src/lib/catalog/showcase", () => ({ loadShowcaseSkins }));
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
}));
vi.mock("next/navigation", () => ({ redirect }));

/** Component names of the sections the page renders, in document order. */
function sectionNames(tree: { props: { children: unknown } }): string[] {
  const children = tree.props.children;

  return (Array.isArray(children) ? children : [children]).flatMap(
    (child: unknown) => {
      const type = (child as { type?: unknown } | null)?.type;

      return typeof type === "function" ? [type.name] : [];
    },
  );
}

describe("dashboard page", () => {
  beforeEach(() => {
    getClaims.mockReset();
    loadWishlistInventory.mockReset();
    loadRiotAccountsWithClient.mockReset();
    loadStorefrontDashboardStatus.mockReset();
    loadDailyShops.mockReset();
    loadDailyShops.mockResolvedValue([]);
    loadShowcaseSkins.mockReset();
    loadShowcaseSkins.mockResolvedValue([]);
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
    expect(loadWishlistInventory).toHaveBeenCalledWith(
      expect.anything(),
      "user-id",
      null,
    );
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

  it("loads only the selected Riot account's wishlist", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "user@example.com", sub: "user-id" } },
    });
    loadRiotAccountsWithClient.mockResolvedValue([
      { id: "connection-one" },
      { id: "connection-two" },
    ]);
    const { default: DashboardPage } = await import("@/app/dashboard/page");

    await DashboardPage({
      searchParams: Promise.resolve({ account: "connection-two" }),
    });

    expect(loadWishlistInventory).toHaveBeenCalledWith(
      expect.anything(),
      "user-id",
      "connection-two",
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
    expect(loadShowcaseSkins).not.toHaveBeenCalled();
  });

  it("shows the skin showcase only while no Riot account is connected", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "user@example.com", sub: "user-id" } },
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");

    const empty = await DashboardPage();
    expect(loadShowcaseSkins).toHaveBeenCalledTimes(1);
    expect(sectionNames(empty)).toContain("EmptyRiotSkinShowcase");

    loadRiotAccountsWithClient.mockResolvedValue([{ id: "connection-one" }]);
    const connected = await DashboardPage();

    // Gone from the tree entirely, not hidden behind a style: an account
    // holder never renders the section and never pays for its catalog read.
    expect(sectionNames(connected)).not.toContain("EmptyRiotSkinShowcase");
    expect(loadShowcaseSkins).toHaveBeenCalledTimes(1);
  });

  it("puts the showcase between the Riot account card and the arsenal", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { email: "user@example.com", sub: "user-id" } },
    });
    const { default: DashboardPage } = await import("@/app/dashboard/page");

    const names = sectionNames(await DashboardPage());

    expect(names.indexOf("EmptyRiotSkinShowcase")).toBe(
      names.indexOf("RiotAccountSwitcher") + 1,
    );
    expect(names.indexOf("EmptyRiotSkinShowcase")).toBeLessThan(
      names.indexOf("InventoryGrid"),
    );
  });
});
