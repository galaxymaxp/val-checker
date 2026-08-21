# VAL Checker

VAL Checker watches selected VALORANT skins and emails an authenticated user
when one appears in that user's daily storefront. Phase 6 is open for
single-user dogfooding under a staged rollout; the decision history and earlier
closed gates remain in [the roadmap](docs/roadmap.md).

## Operating policy

Public magic-link signup remains open. The primary connection candidate is a
temporary, isolated Chromium browser controlled through the website. It shows
Riot Games' real login page, captures the resulting complete cookie jar only on
the server, feeds that jar into the existing encrypted session pipeline, and is
then destroyed. Manual cookie JSON remains the advanced fallback.
Riot session submission is a separate, fail-closed capability from public
signup and Riot-independent features.

Cloud connection is fail-closed behind `RIOT_CLOUD_CONNECT_ENABLED`. While
`RIOT_CLOUD_CONNECT_PUBLIC=false`, only identities in
`RIOT_CONNECT_ALLOWED_USER_IDS` or `RIOT_CONNECT_ALLOWED_EMAILS` may start a
session. The server derives identity from verified Supabase claims and repeats
authorization at every route boundary. The direct credential and Electron
implementations remain temporarily only as rollback paths: they must not be
removed until the real Singapore canary proves login, identity, storefront,
destruction, and a later cookie reauthentication. See
[the cloud-browser architecture and canary runbook](docs/cloud-browser-riot-connection.md).

Signing in does not read a storefront. One application login may connect
multiple Riot accounts; every account keeps its own encrypted session, store,
health, and refresh state. The server resolves the stable Riot PUUID before a
live session row is inserted or replaced so reconnecting cannot mint another
allowance.

The rollout starts with the operator's own account only for approximately three
weeks. Additional users may be added explicitly to the allowlist only after that
dogfood period. Removing someone from the allowlist prevents a new connection;
disconnect remains available so stored material can always be deleted.

The automatic worker performs at most one storefront attempt per connected Riot
account and UTC store day, scheduled for 00:05 UTC. A separately identified
manual refresh is available at most once per Riot PUUID and UTC store day; an
automatic run never spends it. Both entry points use the same worker pipeline.
The database claims, owner/connection/epoch checks, and attempt fences are the
authority—browser state is not.

A shared per-connection session-rotation lease also serializes automatic,
manual, and internal triggers before Riot reauthentication. A pre-storefront
lease can recover after five minutes; after the storefront fence, only a normal
terminal release, the next UTC store day, or an exact reconnect can clear it.
This prevents concurrent triggers from rotating and overwriting the same
encrypted session.

A failure before the fenced Riot storefront request can be retried, and a stale
pre-request claim is recoverable after five minutes. Once a request starts, the
manual allowance stays exhausted even if Riot or the server fails: this is the
necessary crash-safe policy that prevents a second storefront request when the
first request's outcome is ambiguous. A valid storefront is persisted before
catalog matching or email delivery, including when there are no watchlist
matches.

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
| `RIOT_CLOUD_CONNECT_ENABLED` | Server only | Emergency kill switch for temporary browser connection. Defaults closed unless exactly `true`. |
| `RIOT_CLOUD_CONNECT_PUBLIC` | Server only | When `false`, cloud connection also requires the existing canary allowlist. |
| `RIOT_CLOUD_BROWSER_URL` | Server only | HTTPS origin of the separately deployed Singapore browser service. |
| `RIOT_CLOUD_BROWSER_API_KEY` | Server only | Bearer key for the browser service control API; never expose it to clients. |
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

The unit and fixture test paths do not make Riot requests or send real email.
Never add captured cookies, tokens, PUUIDs, jars, or production secrets to a
fixture, snapshot, command, or debug route.

## Database migrations

Schema changes live in `supabase/migrations` and are tested locally in timestamp
order. The hosted project has known migration-ledger drift: earlier migrations
were applied directly and later renamed to match remote timestamps. Before any
hosted change, reconcile the filenames against
`supabase_migrations.schema_migrations` and verify the actual `pg_catalog`
schema. Do not rename an applied migration, run `supabase db push`, or apply the
new storefront-refresh migration until that reconciliation is reviewed.

The pending `20260817065234_storefront_refresh_controls.sql` migration is
forward-only and intentionally unapplied. It adds the manual-refresh ledger,
claim/RPC fences, refresh trigger metadata, catalog-independent offer details,
stable PUUID uniqueness, pending reconnect targeting, and supporting indexes.

## Deployment

1. Reconcile the hosted migration ledger, obtain approval for the reviewed
   forward migration, apply it through the agreed deployment process, and sync
   the public catalog from a trusted server environment.
2. Configure every required environment variable above in the Vercel project.
   Environment changes apply only to subsequent deployments.
3. Verify the Resend sending domain and set `RESEND_FROM_EMAIL` to an identity on
   that domain.
4. Set the Riot allowlist to the operator's identity only for the initial
   approximately three-week dogfood period.
5. Deploy the Next.js application. The committed Vercel cron configuration runs
   the protected worker route daily at 00:05 UTC. Do not add another scheduler or
   expose that protected cron route as a user action. Manual refresh uses an
   authenticated server action with an exact owned connection ID.

`CRON_SECRET` protects the scheduled route, while per-connection automatic and
per-PUUID manual claims enforce their independent UTC-day limits even if a
scheduler or browser invocation is duplicated. Neither control replaces the
Riot connect allowlist.

## Operational visibility

Each daily pass writes one `riot_run_logs` row per account it touches, so a
dogfood day can be reviewed without reading Vercel logs. Every row records the
timestamp, trigger (`cron`, `manual`, or `operator`), outcome (`checked`,
`skipped`, or `failed`), Riot session classification, how many watchlist matches
were found, and how many emails were actually sent.

The `reason` column uses a closed vocabulary such as `NOT_ALLOWLISTED`,
`ACCOUNT_UNAVAILABLE`, `DAILY_CLAIM_HELD`, `MANUAL_CLAIM_HELD`,
`SESSION_LEASE_HELD`, `CATALOG_FAILED`, `REAUTH_FAILED`, or
`STOREFRONT_FAILED`. Raw error messages
are deliberately never stored, so a log row cannot carry cookies, tokens, or a
PUUID. The table is service-only and is read with an elevated key, for example
through the Supabase dashboard:

```sql
select ran_at, connection_id, trigger, outcome, reason, classification,
       matches_found, emails_sent
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
