# VAL Checker

VAL Checker watches selected VALORANT skins and emails an authenticated user
when one appears in that user's daily storefront. Phase 6 is open for
single-user dogfooding under a staged rollout; the decision history and earlier
closed gates remain in [the roadmap](docs/roadmap.md).

## Operating policy

Public magic-link signup remains open. Riot session submission is a separate,
fail-closed capability: only identities listed in
`RIOT_CONNECT_ALLOWED_USER_IDS` or `RIOT_CONNECT_ALLOWED_EMAILS` may connect an
account. The server derives the identity from verified Supabase claims and
checks the allowlist again before accepting session material.

Allowlisted users connect by signing in to Riot with a username and password.
That credential is transit-only: it is exchanged with Riot for a session cookie
jar, is never written to the database or the logs, and is discarded as soon as
Riot answers. Only the resulting jar is stored, encrypted as before. Enabling
MFA on the connected Riot account is recommended, and the sign-in flow prompts
for both emailed and authenticator codes. The raw cookie-export paste path
remains as a fallback but is restricted to `RIOT_ADMIN_USER_IDS` /
`RIOT_ADMIN_EMAILS`. See the Version 2.4 addendum in
[the roadmap](docs/roadmap.md) for the full decision.

Signing in does not read a storefront. The daily cap is unchanged: one
storefront request per connected account per UTC rotation.

The rollout starts with the operator's own account only for approximately three
weeks. Additional users may be added explicitly to the allowlist only after that
dogfood period. Removing someone from the allowlist prevents a new connection;
disconnect remains available so stored material can always be deleted.

The worker performs exactly one storefront attempt per user and UTC rotation,
scheduled for 00:05 UTC. Live Riot requests are allowed only through that daily
cron path and only for an allowlisted connected account. There is no on-demand
refresh endpoint, polling loop, user-triggered fetch, or debug route that calls
Riot. This cadence is an architectural constraint.

## Session security

Riot cookie/session material can permit account access while it remains valid.
The connect flow explains what is retained, why it is required for email alerts,
and how to disconnect. Riot's **Sign out everywhere** control remains the
authoritative way to invalidate existing Riot sessions outside VAL Checker.

Server-side session encryption is load-bearing. Every stored jar is encrypted
with AES-256-GCM using a fresh nonce and the owning `user_id` as authenticated
additional data. Supabase stores ciphertext, nonce, and key version only. The
versioned encryption keys must remain in server runtime secrets outside
Supabase, source control, logs, and telemetry. A successful reauthentication is
not considered complete until the full rotated jar has been encrypted and
persisted.

## Requirements

- Node.js 22 or newer
- pnpm 11.19.0
- Docker Desktop or Podman for local Supabase and integration tests
- A Supabase project for deployment
- A Resend account with a verified sending domain for deployment
- A Vercel project for the production cron deployment

Install the pinned dependencies:

```shell
pnpm install
```

## Environment variables

Copy `.env.example` to `.env.local` and fill it from your own local or hosted
services. Never commit `.env.local`, use production values in tests, or place a
server secret in a `NEXT_PUBLIC_` variable.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server | Preferred public Data API key. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | Legacy alternative when no publishable key is configured. |
| `SUPABASE_SECRET_KEY` | Server only | Preferred elevated key for service-only tables and Auth admin calls. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Legacy alternative when no Supabase secret key is configured. |
| `SESSION_ENCRYPTION_CURRENT_VERSION` | Server only | Positive integer identifying the key used for new encryption. |
| `SESSION_ENCRYPTION_KEY_V<n>` | Server only | Base64 encoding of exactly 32 random bytes for each retained key version, such as the initial `V1`. |
| `RIOT_CONNECT_ALLOWED_USER_IDS` | Server only | Comma-separated verified Supabase user UUIDs allowed to submit Riot session material. |
| `RIOT_CONNECT_ALLOWED_EMAILS` | Server only | Comma-separated verified Supabase emails allowed to submit Riot session material. |
| `RIOT_ADMIN_USER_IDS` | Server only | Comma-separated verified Supabase user UUIDs additionally allowed the raw cookie-export fallback. Empty grants nobody. |
| `RIOT_ADMIN_EMAILS` | Server only | Comma-separated verified Supabase emails additionally allowed the raw cookie-export fallback. Empty grants nobody. |
| `RIOT_TLS_CIPHERS` | Server only | Optional TLS cipher order for Riot's auth host. Leave unset unless sign-in begins returning 403. |
| `RESEND_API_KEY` | Server only | Resend API key used by the daily worker. |
| `RESEND_FROM_EMAIL` | Server only | Sender identity on a verified Resend domain. |
| `CRON_SECRET` | Server only | Random Vercel cron authentication secret of at least 16 characters. |

Configure at least one public Supabase key, one elevated Supabase key, and one
Riot allowlist entry for dogfooding. An empty allowlist permits nobody. Keep old
`SESSION_ENCRYPTION_KEY_V<n>` values available while any stored row still uses
that version. The initial deployment uses `SESSION_ENCRYPTION_KEY_V1`; changing
`SESSION_ENCRYPTION_CURRENT_VERSION` affects new writes but does not decrypt or
migrate old rows by itself.

## Local setup

1. Start the local Supabase stack:

   ```shell
   pnpm supabase:start
   ```

2. Populate `.env.local` from `.env.example` using the local URL and public and
   elevated keys reported by your own local stack. Use only generated test key
   material and a test-only allowlisted identity locally.

3. Apply any migration added since the stack was last started:

   ```shell
   pnpm exec supabase migration up --local
   ```

4. Populate the public catalog when needed:

   ```shell
   pnpm sync:catalog
   ```

5. Start Next.js:

   ```shell
   pnpm dev
   ```

The local and fixture test paths do not make Riot requests or send real email.
Never add captured cookies, tokens, PUUIDs, jars, or production secrets to a
fixture, snapshot, command, or debug route.

## Database migrations

Schema changes live in `supabase/migrations` and are applied in timestamp order.
Test pending migrations locally before deployment. For a hosted Supabase
project, authenticate and link the correct project, preview the pending changes,
then apply them:

```shell
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

Review the linked project before pushing. Do not use a linked database reset on
production. The pending `skins.weapon_uuid` migration is deliberately excluded
until the project owner approves it.

## Deployment

1. Apply the reviewed Supabase migrations and sync the public catalog from a
   trusted server environment.
2. Configure every required environment variable above in the Vercel project.
   Environment changes apply only to subsequent deployments.
3. Verify the Resend sending domain and set `RESEND_FROM_EMAIL` to an identity on
   that domain.
4. Set the Riot allowlist to the operator's identity only for the initial
   approximately three-week dogfood period.
5. Deploy the Next.js application. The committed Vercel cron configuration runs
   the protected worker route daily at 00:05 UTC. Do not add another scheduler or
   expose that route as a user action.

`CRON_SECRET` protects the scheduled route, while the database's per-user UTC
rotation claim enforces the one-attempt cadence even if a scheduler invocation
is duplicated. Neither control replaces the Riot connect allowlist.

## Operational visibility

Each daily pass writes one `riot_run_logs` row per account it touches, so a
dogfood day can be reviewed without reading Vercel logs. Every row records the
timestamp, the outcome (`checked`, `skipped`, or `failed`), the Riot session
classification, how many watchlist matches were found, and how many emails were
actually sent.

The `reason` column uses a closed vocabulary such as `NOT_ALLOWLISTED`,
`DAILY_CLAIM_HELD`, `REAUTH_FAILED`, or `STOREFRONT_FAILED`. Raw error messages
are deliberately never stored, so a log row cannot carry cookies, tokens, or a
PUUID. The table is service-only and is read with an elevated key, for example
through the Supabase dashboard:

```sql
select ran_at, outcome, reason, classification, matches_found, emails_sent
from public.riot_run_logs
order by ran_at desc
limit 50;
```

Connection identifiers in the log are snapshots rather than foreign keys, so the
history survives a disconnect and reconnect. A failed log insert is swallowed on
purpose: losing a row must never fail an otherwise successful check or stop the
remaining accounts.

## Tests

Run the network-free unit suite:

```shell
pnpm test:unit
```

Start local Supabase before integration tests:

```shell
pnpm supabase:start
pnpm exec supabase migration up --local
pnpm test:integration
```

Run both suites with `pnpm test`; run static checks with `pnpm lint` and
`pnpm typecheck`. Stop the local stack with `pnpm supabase:stop` when finished.
