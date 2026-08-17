import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260817065234_storefront_refresh_controls.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const replaced = migration.indexOf(
    `create or replace function public.${name}`,
  );
  const start =
    replaced >= 0
      ? replaced
      : migration.indexOf(`create function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", start) + 3);
}

describe("storefront refresh controls migration", () => {
  it("keys the manual allowance to a global Riot identity and serializes claims", () => {
    expect(migration).toMatch(
      /create unique index riot_connections_puuid_key[\s\S]*where puuid is not null;/i,
    );
    expect(migration).toMatch(
      /unique \(riot_puuid, store_date\)/i,
    );
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration).toMatch(
      /where riot_manual_refreshes\.storefront_attempted_at is null[\s\S]*riot_manual_refreshes\.status = 'retryable_failed'[\s\S]*riot_manual_refreshes\.status = 'claimed'[\s\S]*current_timestamp - interval '5 minutes'/i,
    );
  });

  it("recovers only stale automatic claims that never crossed the attempt fence", () => {
    const dailyClaim = functionBody("claim_riot_daily_run");

    expect(dailyClaim).toMatch(
      /exists \([\s\S]*stale\.storefront_attempted_at is null[\s\S]*stale\.claimed_at < current_timestamp - interval '5 minutes'/i,
    );
    expect(dailyClaim).toMatch(
      /on conflict on constraint riot_daily_runs_connection_id_store_date_key[\s\S]*do update set[\s\S]*connection_epoch = excluded\.connection_epoch[\s\S]*where riot_daily_runs\.storefront_attempted_at is null[\s\S]*current_timestamp - interval '5 minutes'/i,
    );
  });

  it("serializes every trigger behind one exact, token-fenced session lease", () => {
    expect(migration).toMatch(
      /alter table public\.riot_connections[\s\S]*add column rotation_lease_token uuid[\s\S]*add column rotation_lease_claimed_at timestamptz[\s\S]*add column rotation_lease_store_date date[\s\S]*add column rotation_lease_storefront_attempted_at timestamptz/i,
    );

    const acquire = functionBody("claim_riot_session_rotation");
    expect(acquire).toMatch(/lease_status text/i);
    expect(acquire).toContain("'account_unavailable'");
    expect(acquire).toContain("'held'");
    expect(acquire).toContain("'acquired'");
    expect(acquire).toMatch(
      /connection\.user_id = p_user_id[\s\S]*connection\.id = p_connection_id[\s\S]*connection\.connection_epoch = p_connection_epoch/i,
    );
    expect(acquire).toMatch(
      /rotation_lease_token = gen_random_uuid\(\)/i,
    );
    expect(acquire).toMatch(
      /rotation_lease_store_date < utc_store_date[\s\S]*or \([\s\S]*rotation_lease_storefront_attempted_at is null[\s\S]*rotation_lease_claimed_at[\s\S]*current_timestamp - interval '5 minutes'/i,
    );

    const release = functionBody("release_riot_session_rotation");
    expect(release).toMatch(
      /connection\.user_id = p_user_id[\s\S]*connection\.id = p_connection_id[\s\S]*connection\.connection_epoch = p_connection_epoch[\s\S]*connection\.rotation_lease_token = p_lease_token/i,
    );
    expect(release).toMatch(
      /rotation_lease_token = null[\s\S]*rotation_lease_claimed_at = null[\s\S]*rotation_lease_store_date = null[\s\S]*rotation_lease_storefront_attempted_at = null/i,
    );
    expect(release).toMatch(
      /connection\.rotation_lease_token = p_lease_token[\s\S]*connection\.rotation_lease_storefront_attempted_at is null/i,
    );

    const renew = functionBody("renew_riot_session_rotation");
    expect(renew).toMatch(
      /set rotation_lease_claimed_at = statement_timestamp\(\)/i,
    );
    expect(renew).toMatch(
      /connection\.user_id = p_user_id[\s\S]*connection\.id = p_connection_id[\s\S]*connection\.connection_epoch = p_connection_epoch[\s\S]*connection\.rotation_lease_token = p_lease_token[\s\S]*rotation_lease_storefront_attempted_at is null/i,
    );
  });

  it("requires the exact live lease token before either trigger-specific claim", () => {
    const dailyClaim = functionBody("claim_riot_daily_run");
    expect(dailyClaim).toMatch(/p_rotation_lease_token uuid/i);
    expect(dailyClaim).toMatch(
      /connection\.rotation_lease_token = p_rotation_lease_token[\s\S]*connection\.rotation_lease_store_date = utc_store_date[\s\S]*connection\.rotation_lease_storefront_attempted_at is null[\s\S]*for update/i,
    );

    const manualClaim = functionBody("claim_riot_manual_refresh");
    expect(manualClaim).toMatch(/p_rotation_lease_token uuid/i);
    expect(manualClaim).toMatch(
      /pg_advisory_xact_lock[\s\S]*connection\.connection_epoch = p_connection_epoch[\s\S]*connection\.rotation_lease_token = p_rotation_lease_token[\s\S]*connection\.rotation_lease_store_date = utc_store_date[\s\S]*for update/i,
    );
  });

  it("requires the live session lease token at both storefront attempt fences", () => {
    for (const functionName of [
      "mark_riot_manual_storefront_attempt",
      "mark_riot_storefront_attempt",
    ]) {
      const body = functionBody(functionName);
      expect(body).toMatch(/p_rotation_lease_token uuid/i);
      expect(body).toMatch(/connection\.user_id = p_user_id/i);
      expect(body).toMatch(/connection\.id = p_connection_id/i);
      expect(body).toMatch(
        /connection\.connection_epoch = p_connection_epoch/i,
      );
      expect(body).toMatch(
        /connection\.rotation_lease_token = p_rotation_lease_token/i,
      );
      expect(body).toMatch(
        /marked_at timestamptz := date_trunc\('milliseconds', statement_timestamp\(\)\)/i,
      );
    }
  });

  it("returns an explicit manual account-unavailable result apart from a held allowance", () => {
    const manualClaim = functionBody("claim_riot_manual_refresh");
    expect(manualClaim).toMatch(/claim_status text/i);
    expect(manualClaim).toContain("'account_unavailable'");
    expect(manualClaim).toContain("'held'");
    expect(manualClaim).toContain("'claimed'");
  });

  it("keeps operational data and RPCs service-role only", () => {
    expect(migration).toMatch(
      /alter table public\.riot_manual_refreshes enable row level security;/i,
    );
    expect(migration).toMatch(
      /revoke all on table public\.riot_manual_refreshes[\s\S]*from public, anon, authenticated, service_role;[\s\S]*grant select, insert, update on table public\.riot_manual_refreshes[\s\S]*to service_role;/i,
    );

    for (const functionName of [
      "claim_riot_session_rotation",
      "renew_riot_session_rotation",
      "claim_riot_manual_refresh",
      "close_riot_storefront_attempt",
      "fail_riot_manual_refresh",
      "get_riot_store_day",
      "mark_riot_manual_storefront_attempt",
      "mark_riot_storefront_attempt",
      "record_storefront_refresh",
      "release_riot_session_rotation",
    ]) {
      const body = functionBody(functionName);
      expect(body).toContain("security invoker");
      expect(body).toContain("set search_path = ''");
    }

    expect(migration).not.toMatch(/security definer/i);
  });

  it("persists every canonical storefront before optional manual completion", () => {
    expect(migration).toMatch(
      /add column offer_details jsonb not null default '\[\]'::jsonb;/i,
    );
    expect(migration).toMatch(
      /check \(jsonb_typeof\(offer_details\) = 'array'\)/i,
    );
    expect(migration).toMatch(
      /on conflict on constraint shop_checks_connection_rotation_date_key[\s\S]*do update set[\s\S]*offer_details = excluded\.offer_details/i,
    );
    expect(migration).toMatch(
      /manual\.status = 'requesting'[\s\S]*manual\.status = 'succeeded'/i,
    );
  });

  it("atomically token-fences raw persistence and terminal-close lease release", () => {
    const record = functionBody("record_storefront_refresh");
    expect(record).toMatch(/p_rotation_lease_token uuid default null/i);
    expect(record).toMatch(
      /connection\.rotation_lease_token = p_rotation_lease_token[\s\S]*connection\.rotation_lease_store_date = p_rotation_date[\s\S]*connection\.rotation_lease_storefront_attempted_at = p_checked_at[\s\S]*for update/i,
    );
    expect(record.indexOf("insert into public.shop_checks")).toBeLessThan(
      record.indexOf("update public.riot_connections", record.indexOf("insert into public.shop_checks")),
    );
    expect(record).toMatch(
      /update public\.riot_connections as connection[\s\S]*rotation_lease_token = null[\s\S]*connection\.rotation_lease_token = p_rotation_lease_token[\s\S]*connection\.rotation_lease_storefront_attempted_at = p_checked_at/i,
    );

    const close = functionBody("close_riot_storefront_attempt");
    expect(close).toMatch(
      /connection\.user_id = p_user_id[\s\S]*connection\.id = p_connection_id[\s\S]*connection\.connection_epoch = p_connection_epoch[\s\S]*connection\.rotation_lease_token = p_rotation_lease_token[\s\S]*rotation_lease_storefront_attempted_at is not null[\s\S]*for update/i,
    );
    expect(close).toMatch(
      /storefront_failed_at = terminal_at[\s\S]*storefront_attempted_at = leased_attempted_at/i,
    );
    expect(close).toMatch(
      /manual\.storefront_attempted_at = leased_attempted_at[\s\S]*update public\.riot_connections as connection[\s\S]*rotation_lease_token = null/i,
    );
  });

  it("allows enrichment only as an exact-snapshot decoration", () => {
    const record = functionBody("record_storefront_refresh");
    const enrichmentStart = record.indexOf(
      "if p_rotation_lease_token is null then",
    );
    const rawInsertStart = record.indexOf("insert into public.shop_checks");
    expect(enrichmentStart).toBeGreaterThanOrEqual(0);
    expect(rawInsertStart).toBeGreaterThan(enrichmentStart);
    const enrichment = record.slice(enrichmentStart, rawInsertStart);
    expect(enrichment).toMatch(
      /update public\.shop_checks as shop[\s\S]*where shop\.connection_id = p_connection_id[\s\S]*shop\.rotation_date = p_rotation_date[\s\S]*shop\.checked_at = p_checked_at[\s\S]*shop\.shop_hash = p_shop_hash/i,
    );
    const enrichmentSet = enrichment.slice(
      enrichment.indexOf("set"),
      enrichment.indexOf("where shop.connection_id"),
    );
    expect(enrichmentSet).not.toMatch(/checked_at\s*=/i);
    expect(enrichment).toContain("The storefront enrichment target is stale.");
  });

  it("adds the connection handoff, trigger vocabulary, and missing FK index", () => {
    expect(migration).toMatch(
      /alter table public\.riot_pending_auth[\s\S]*add column connection_id uuid;/i,
    );
    expect(migration).toMatch(
      /create index notifications_shop_check_id_idx[\s\S]*\(shop_check_id\);/i,
    );
    expect(migration).toMatch(
      /add column trigger text not null default 'cron';/i,
    );
    expect(migration).toMatch(
      /trigger in \('cron', 'manual', 'operator'\)/i,
    );
    expect(migration).toContain("'MANUAL_CLAIM_HELD'");
    expect(migration).toContain("'ACCOUNT_UNAVAILABLE'");
    expect(migration).toContain("'CATALOG_FAILED'");
    expect(migration).toContain("'SESSION_LEASE_HELD'");
  });
});
