import { describe, expect, it, vi } from "vitest";

const createBrowserClient = vi.fn(() => ({ auth: {} }));

vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

vi.mock("@/src/lib/supabase/public-env", () => ({
  getPublicSupabaseConfig: () => ({
    key: "test-publishable-key",
    url: "https://project.supabase.co",
  }),
}));

describe("browser Supabase client", () => {
  it("requests emailed sign-in links outside the PKCE flow", async () => {
    const { createBrowserSupabaseClient } = await import(
      "@/src/lib/supabase/browser"
    );

    createBrowserSupabaseClient();

    // PKCE keeps a code_verifier in the requesting browser, so a link opened in
    // any other browser fails with "invalid flow state, no valid flow state
    // found". An emailed link has to survive being opened anywhere.
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "test-publishable-key",
      expect.objectContaining({
        auth: expect.objectContaining({ flowType: "implicit" }),
      }),
    );
  });
});
