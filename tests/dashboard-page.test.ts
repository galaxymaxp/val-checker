import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const redirect = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getClaims } }),
}));

vi.mock("next/navigation", () => ({ redirect }));

describe("dashboard page", () => {
  beforeEach(() => {
    getClaims.mockReset();
    redirect.mockReset();
  });

  it("renders after an authenticated magic-link session", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-id" } } });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const content = await DashboardPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(content.type).toBe("main");
  });

  it("keeps a server-side redirect as a second protection layer", async () => {
    getClaims.mockResolvedValue({ data: null });
    const { default: DashboardPage } = await import("@/app/dashboard/page");
    await DashboardPage();

    expect(redirect).toHaveBeenCalledWith("/sign-in?next=/dashboard");
  });
});
