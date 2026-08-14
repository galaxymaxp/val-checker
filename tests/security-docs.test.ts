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
    expect(security).toMatch(/malicious or compromised fixtures/i);
    expect(security).toMatch(/session revocation and expiry/i);
    expect(security).toMatch(/Riot enforcement and abuse detection/i);
    expect(security).toMatch(/outside Supabase/i);
    expect(security).toMatch(/explicit server-only allowlist/i);
    expect(security).toMatch(/Public signup and Riot-independent features are not allowlisted/i);
    expect(security).toMatch(/residual risk and limitations/i);
  });

  it("keeps the credential ship gate distinct from public signup", () => {
    const readme = readRepositoryFile("README.md");

    expect(readme).toMatch(/build gate is removed/i);
    expect(readme).toMatch(/ship gate is retained and remains closed/i);
    expect(readme).toMatch(/abuse-detection canary/i);
    expect(readme).toMatch(/No real Riot credentials or session material/i);
    expect(readme).toMatch(/public website signup remains available/i);
    expect(readme).toMatch(/must not be converted to invite-only/i);
    expect(readme).toMatch(/connection service repeats the\s+authorization/is);
  });
});
