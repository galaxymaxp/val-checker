import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260821100542_riot_cloud_connection_sessions.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("cloud connection migration", () => {
  it("stores only non-secret control metadata", () => {
    expect(migration).not.toMatch(/password\s+(text|bytea)/i);
    expect(migration).not.toMatch(/cookie_jar|access_token|entitlement_token|mfa_code/i);
  });

  it("enables owner-scoped RLS and hides the provider id from client grants", () => {
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/to authenticated[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
    const clientGrant = migration.match(/grant select \(([\s\S]*?)\) on public\.riot_cloud_connection_sessions to authenticated/i)?.[1];
    expect(clientGrant).toBeDefined();
    expect(clientGrant).not.toContain("provider_session_id");
  });

  it("constrains lifetime and terminal states", () => {
    expect(migration).toMatch(/expires_at > created_at/i);
    expect(migration).toContain("'connected'");
    expect(migration).toContain("'expired'");
    expect(migration).toContain("'cancelled'");
  });
});
