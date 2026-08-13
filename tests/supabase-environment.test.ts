import { describe, expect, it } from "vitest";

import { parsePublicSupabaseConfig } from "@/src/lib/supabase/public-env";

describe("public Supabase configuration", () => {
  it("prefers the current publishable key while supporting the spec's legacy alias", () => {
    expect(
      parsePublicSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-test-key",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      key: "publishable-test-key",
    });
  });

  it("reports variable names without including supplied values", () => {
    expect(() =>
      parsePublicSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url-sensitive-value",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "private-test-value",
      }),
    ).toThrow("Invalid environment variable: NEXT_PUBLIC_SUPABASE_URL");
  });
});
