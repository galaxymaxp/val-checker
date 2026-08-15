import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const createClient = vi.fn(() => ({ auth: {} }));
const createBrowserClient = vi.fn(() => ({ auth: {} }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

vi.mock("@/src/lib/supabase/public-env", () => ({
  getPublicSupabaseConfig: () => ({
    key: "test-publishable-key",
    url: "https://project.supabase.co",
  }),
}));

describe("emailed sign-in link request", () => {
  it("requests the link outside the PKCE flow", async () => {
    const { createMagicLinkRequestClient } = await import(
      "@/src/lib/supabase/browser"
    );

    createMagicLinkRequestClient();

    // PKCE keeps a code_verifier in the requesting browser, so a link opened
    // anywhere else fails with "invalid flow state, no valid flow state found".
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "test-publishable-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: "implicit",
          persistSession: false,
        }),
      }),
    );
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("does not route the request through createBrowserClient, which forces PKCE", () => {
    // Guard against a regression that a mocked assertion cannot catch:
    // @supabase/ssr sets flowType "pkce" *after* spreading caller options, so
    // passing flowType through createBrowserClient is silently discarded.
    const ssrSource = readFileSync(
      new URL(
        "../node_modules/@supabase/ssr/dist/main/createBrowserClient.js",
        import.meta.url,
      ),
      "utf8",
    );
    expect(ssrSource).toContain('flowType: "pkce"');

    const source = readFileSync(
      new URL("../src/lib/supabase/browser.ts", import.meta.url),
      "utf8",
    );
    const requestClient = source.slice(
      source.indexOf("export function createMagicLinkRequestClient"),
    );
    expect(requestClient).toContain("createClient(");
    expect(requestClient).not.toContain("createBrowserClient(");
  });
});
