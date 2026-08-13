import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("dashboard authentication boundary", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-test-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", originalUrl);
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", originalPublishableKey);
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY", originalAnonKey);
  });

  it("redirects an unauthenticated dashboard request to sign-in", async () => {
    const response = await proxy(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in?next=%2Fdashboard",
    );
  });
});
