/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.fn();
const signInWithOtp = vi.fn();

vi.mock("@/src/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signInWithOAuth } }),
  createMagicLinkRequestClient: () => ({ auth: { signInWithOtp } }),
}));

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";

afterEach(cleanup);

beforeEach(() => {
  signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
});

describe("sign-in form", () => {
  it("offers Google, an email field, and a link request button", () => {
    render(<SignInForm />);

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /email me a sign-in link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /email address/i }),
    ).toBeInTheDocument();
  });

  it("allows an unrestricted account signup with the typed email", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(
      screen.getByRole("textbox", { name: /email address/i }),
      "operator@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /email me a sign-in link/i }),
    );

    const confirmation = await screen.findByText(/check your inbox/i);
    expect(confirmation).toBeInTheDocument();
    // The confirmation must be announced to assistive tech without stealing focus.
    expect(
      confirmation.closest("[aria-live='polite']") ?? confirmation,
    ).toHaveAttribute("aria-live", "polite");

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "operator@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/confirm?next=/dashboard",
        shouldCreateUser: true,
      },
    });
  });

  it("surfaces a failed link request as an alert", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "rate limited" } });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(
      screen.getByRole("textbox", { name: /email address/i }),
      "operator@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /email me a sign-in link/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not send a sign-in link/i,
    );
  });

  it("starts Google OAuth from the Google button", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
