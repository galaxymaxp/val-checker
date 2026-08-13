import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
  }),
}));

describe("magic-link confirmation route", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
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
