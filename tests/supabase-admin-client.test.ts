import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn(() => ({ kind: "admin-client" }));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

describe("admin Supabase client", () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "elevated-test-key");
  });

  it("cannot inherit or persist a user session", async () => {
    const { createAdminSupabaseClient } = await import(
      "@/src/lib/supabase/server-admin"
    );

    expect(createAdminSupabaseClient()).toEqual({ kind: "admin-client" });
    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "elevated-test-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });
});
