import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CookieToSet {
  name: string;
  options?: {
    httpOnly?: boolean;
    path?: string;
    sameSite?: "lax" | "strict" | "none";
  };
  value: string;
}

interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieToSet[]): void;
}

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  getPublicSupabaseConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/src/lib/supabase/public-env", () => ({
  getPublicSupabaseConfig: mocks.getPublicSupabaseConfig,
}));

import { refreshAuthSession } from "@/src/lib/supabase/proxy";

describe("Supabase auth refresh proxy", () => {
  let cookieAdapter: CookieAdapter | undefined;

  beforeEach(() => {
    cookieAdapter = undefined;
    mocks.createServerClient.mockReset();
    mocks.getClaims.mockReset();
    mocks.getPublicSupabaseConfig.mockReset();
    mocks.getPublicSupabaseConfig.mockReturnValue({
      key: "local-public-key",
      url: "http://127.0.0.1:54321",
    });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      cookieAdapter = options.cookies as CookieAdapter;
      return { auth: { getClaims: mocks.getClaims } };
    });
  });

  it("passes request cookies through and propagates refreshed cookies", async () => {
    let cookiesRead: { name: string; value: string }[] = [];
    mocks.getClaims.mockImplementation(async () => {
      cookiesRead = cookieAdapter?.getAll() ?? [];
      cookieAdapter?.setAll([
        {
          name: "renewed-auth",
          options: { httpOnly: true, path: "/", sameSite: "lax" },
          value: "fresh-value",
        },
      ]);
      return { data: { claims: { sub: "verified-user" } } };
    });
    const request = new NextRequest("http://localhost/dashboard/profile", {
      headers: { cookie: "incoming-auth=old-value" },
    });

    const response = await refreshAuthSession(request);

    expect(cookiesRead).toContainEqual({ name: "incoming-auth", value: "old-value" });
    expect(request.cookies.get("renewed-auth")?.value).toBe("fresh-value");
    expect(response.cookies.get("renewed-auth")).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      value: "fresh-value",
    });
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "local-public-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(mocks.getClaims).toHaveBeenCalledOnce();
  });

  it("preserves refreshed cookies on an unauthenticated redirect", async () => {
    mocks.getClaims.mockImplementation(async () => {
      cookieAdapter?.setAll([
        {
          name: "renewed-auth",
          options: { httpOnly: true, path: "/", sameSite: "lax" },
          value: "fresh-value",
        },
      ]);
      return { data: { claims: {} } };
    });
    const request = new NextRequest("http://localhost/dashboard/settings");

    const response = await refreshAuthSession(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in?next=%2Fdashboard%2Fsettings",
    );
    expect(response.cookies.get("renewed-auth")).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      value: "fresh-value",
    });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
  });
});
