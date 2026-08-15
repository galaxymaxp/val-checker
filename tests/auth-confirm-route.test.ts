import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
let capturedSetAll: ((cookies: readonly CookieToSet[]) => void) | undefined;

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: { setAll: (cookies: readonly CookieToSet[]) => void };
    },
  ) => {
    capturedSetAll = options.cookies.setAll;
    return { auth: { exchangeCodeForSession, verifyOtp } };
  },
}));

vi.mock("@/src/lib/supabase/public-env", () => ({
  getPublicSupabaseConfig: () => ({
    key: "test-publishable-key",
    url: "https://project.supabase.co",
  }),
}));

describe("magic-link confirmation route", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
    capturedSetAll = undefined;
  });

  it("verifies a token hash and redirects to the dashboard", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/auth/confirm?token_hash=one-time-token&type=email&next=/dashboard",
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "one-time-token",
      type: "email",
    });
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("exchanges PKCE codes and rejects external next URLs", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?code=pkce-code&next=//example.test"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("rejects backslash-based external next URLs", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/auth/confirm?code=pkce-code&next=%2F%5Cexample.test",
      ),
    );

    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("exchanges a PKCE token delivered in token_hash instead of verifying it", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/auth/confirm?token_hash=pkce_f549b9097b4eefec&type=magiclink&next=/dashboard",
      ),
    );

    // @supabase/ssr issues PKCE tokens for signInWithOtp, and verifyOtp cannot
    // accept them, so the route must exchange rather than verify.
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce_f549b9097b4eefec");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("writes session cookies onto the redirect it returns", async () => {
    exchangeCodeForSession.mockImplementation(async () => {
      // Supabase writes the session through setAll during the exchange.
      capturedSetAll?.([
        { name: "sb-access-token", options: { path: "/" }, value: "granted" },
      ]);
      return { error: null };
    });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/auth/confirm?token_hash=pkce_abc&type=magiclink&next=/dashboard",
      ),
    );

    // A redirect that carries no Set-Cookie sends the browser back to sign-in
    // forever, even though Supabase already created the session.
    expect(response.cookies.get("sb-access-token")?.value).toBe("granted");
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("returns a redacted sign-in error for invalid links", async () => {
    verifyOtp.mockResolvedValue({ error: new Error("upstream detail") });
    const { GET } = await import("@/app/auth/confirm/route");
    const response = await GET(
      new NextRequest("http://localhost/auth/confirm?token_hash=expired&type=email"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in?error=invalid_or_expired_link",
    );
  });
});
