# VAL Checker

VAL Checker is being built in staged, fixture-driven phases. Phase 4.5 validates and normalizes the scrubbed real Riot storefront fixture; Phase 5 now has an offline session foundation. See the [roadmap](docs/roadmap.md) for phase boundaries, gate history, and the current blocker.

## Riot consent and session storage

Riot cookie/session account-access material can permit account access while it remains valid. Before a connection, the application explains what would be stored, why it is needed, that it is encrypted at rest, and how the user can disconnect and revoke it. Riot's **Sign out everywhere** control is the authoritative guidance for invalidating existing Riot sessions.

Stored session material is encrypted with AES-256-GCM using a fresh nonce and the owning `user_id` as authenticated additional data. Supabase stores only ciphertext, nonce, and an explicit key version. Encryption keys are loaded from runtime secret configuration with `SESSION_ENCRYPTION_CURRENT_VERSION` and versioned `SESSION_ENCRYPTION_KEY_V<n>` variables; keys must never be stored in Supabase or committed to the repository.

The working session provider accepts injected fixture/test bytes only. The deployed connection UI does not accept real credentials or real session material, QR authentication remains an explicit unsupported stub, and no live Riot request path is implemented.

Riot connection eligibility is enforced separately on the server with explicit,
comma-separated `RIOT_CONNECT_ALLOWED_USER_IDS` and
`RIOT_CONNECT_ALLOWED_EMAILS` runtime values. The IDs and emails come from
verified Supabase claims, not client input or editable user metadata. Missing or
empty lists allow nobody, and malformed entries fail closed. The dashboard uses
the check only to explain availability; the connection service repeats the
authorization before fixture capture or storage, so the UI is not the security
boundary. Disconnect is deliberately not allowlisted.

## Build and ship gates

The former single 14-day durability gate has been split because session storage, consent, encryption, connect/disconnect behavior, and expiry handling do not depend on the observed Riot session lifetime:

- The **build gate is removed**. Fixture-driven Phase 5 development and tests may proceed without determining whether a Riot session lasts 5 days or 21 days.
- The **ship gate is retained and remains closed**. No real Riot credentials or session material may be accepted, stored, used, or deployed until the external durability spike has not failed in a way that resembles Riot enforcement or abuse detection.

The durability spike continues as an abuse-detection canary. It is evidence for the credential-bearing ship decision, not a gate on offline development or Riot-independent features.

Normal public website signup remains available and is separate from both the Riot credential ship gate and the Riot connect allowlist. Public signup, website authentication, catalog browsing, watchlists, and other Riot-independent functionality must not be converted to invite-only or placed behind a general website allowlist.

## Requirements

- Node.js 22 or newer
- pnpm 11.19.0
- Docker Desktop or Podman for local Supabase integration tests

Install dependencies with `pnpm install`.

## Tests

Run unit tests without Supabase:

```shell
pnpm test:unit
```

Integration tests use only the local Supabase stack. Start it before running them:

```shell
pnpm supabase:start
pnpm test:integration
```

Run both suites with:

```shell
pnpm test
```

Because the full command includes integration tests, the local Supabase stack must already be running. Stop it afterward with `pnpm supabase:stop` when it is no longer needed.

The test suites do not make live Riot requests or depend on other external services. Never put real Riot credentials, cookies, tokens, jars, session material, or encryption keys into tests.
