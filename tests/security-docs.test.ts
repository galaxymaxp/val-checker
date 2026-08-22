import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("security documentation", () => {
  it("documents the session threat model and key separation", () => {
    const security = readRepositoryFile("SECURITY.md");

    expect(security).toMatch(/database compromise/i);
    expect(security).toMatch(/application or server compromise/i);
    expect(security).toMatch(/encryption key compromise and rotation/i);
    expect(security).toMatch(/cross-user ciphertext substitution/i);
    expect(security).toMatch(/user_id.*authenticated additional data \(AAD\)/is);
    expect(security).toMatch(/logs, exceptions, and telemetry/i);
    expect(security).toMatch(/malicious submissions, fixtures, and test data/i);
    expect(security).toMatch(/session revocation and expiry/i);
    expect(security).toMatch(/Riot enforcement and abuse detection/i);
    expect(security).toMatch(/outside Supabase/i);
    expect(security).toMatch(/AES-256-GCM encryption is load-bearing/i);
    expect(security).toMatch(
      /Any authenticated VAL Checker account may use the Riot connection flow/i,
    );
    expect(security).toMatch(/verified Supabase subject/i);
    expect(security).toMatch(/one automatic attempt per connection/i);
    expect(security).toMatch(
      /one\s+separate manual storefront attempt per stable Riot PUUID/is,
    );
    expect(security).toMatch(/deterministic idempotency key/i);
    expect(security).toMatch(/residual risk and limitations/i);
  });

  it("documents unrestricted authenticated connection and the hard cadence boundary", () => {
    const readme = readRepositoryFile("README.md");
    const security = readRepositoryFile("SECURITY.md");

    expect(readme).toMatch(
      /any\s+authenticated VAL Checker account may use the Riot connection flow/is,
    );
    expect(readme).toMatch(/owner-scoped database access/i);
    expect(readme).toMatch(
      /at most one storefront attempt per connected Riot\s+account and UTC store day/is,
    );
    expect(readme).toMatch(
      /manual refresh is available at most once per Riot PUUID and UTC store day/i,
    );
    expect(readme).toMatch(/automatic run never spends it/i);
    expect(readme).toMatch(/scheduled for 00:05 UTC/i);
    expect(readme).toMatch(
      /Manual refresh uses an\s+authenticated server action with an exact owned connection ID/is,
    );
    expect(readme).toMatch(/Server-side session encryption is load-bearing/i);
    expect(readme).toMatch(/riot_run_logs/);
    expect(readme).toMatch(/Raw error messages\s+are deliberately never stored/i);
    expect(readme).not.toMatch(/ship gate is retained and remains closed/i);
    expect(security).not.toMatch(/ship gate remains closed/i);
  });

  it("preserves the superseded gate history in the roadmap", () => {
    const roadmap = readRepositoryFile("docs/roadmap.md");

    expect(roadmap).toMatch(/Version 2\.2 decision addendum/i);
    expect(roadmap).toMatch(/14-day durability gate is retired/i);
    expect(roadmap).toMatch(/Historical Version 2\.0 Track C blocker/i);
    expect(roadmap).toMatch(/SHIP GATE — RETAINED AND CLOSED/i);
    expect(roadmap).toMatch(/superseded by Version 2\.2/i);
  });

  it("lists required configuration without checked-in values", () => {
    const example = readRepositoryFile(".env.example");
    const readme = readRepositoryFile("README.md");
    const variables = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SESSION_ENCRYPTION_CURRENT_VERSION",
      "SESSION_ENCRYPTION_KEY_V1",
      "RIOT_CLOUD_CONNECT_ENABLED",
      "RIOT_CLOUD_BROWSER_URL",
      "RIOT_CLOUD_BROWSER_API_KEY",
      "RIOT_TLS_CIPHERS",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "VAL_CHECKER_OWNER_EMAIL",
      "CRON_SECRET",
    ];

    for (const variable of variables) {
      expect(example).toMatch(new RegExp(`^${variable}=$`, "m"));
      expect(readme).toContain(`\`${variable}\``);
    }

    expect(example).not.toMatch(/RIOT_CONNECT_ALLOWED_/);
    expect(example).not.toContain("RIOT_CLOUD_CONNECT_PUBLIC");
    expect(readme).not.toMatch(/RIOT_CONNECT_ALLOWED_/);
    expect(readme).not.toContain("RIOT_CLOUD_CONNECT_PUBLIC");

    const configuredLines = example
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(configuredLines.every((line) => line.endsWith("="))).toBe(true);
    expect(readme).toMatch(/supabase migration up --local/i);
    expect(readme).toMatch(/known migration-ledger drift/i);
    expect(readme).toMatch(/Do not rename an applied migration, run `supabase db push`/i);
  });
});
