import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260823012723_notify_owner_on_account_creation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("account creation notification migration", () => {
  it("queues only an initial Auth user insert", () => {
    expect(migration).toMatch(
      /create trigger queue_account_creation_notification\s+after insert on auth\.users/i,
    );
    expect(migration).not.toMatch(/after update on auth\.users/i);
    expect(migration).toMatch(/user_id uuid primary key references auth\.users/i);
  });

  it("atomically permits only one delivery attempt", () => {
    expect(migration).toMatch(
      /create function public\.claim_account_creation_notification[\s\S]*delivery_attempted_at = now\(\)[\s\S]*delivery_attempted_at is null[\s\S]*returning notification\.signup_at/i,
    );
    expect(migration).toMatch(
      /revoke all on table public\.account_creation_notifications[\s\S]*from public, anon, authenticated/i,
    );
  });
});
