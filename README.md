# VAL Checker

VAL Checker watches selected VALORANT skins and emails an authenticated user
when one appears in that user's daily storefront. Account signup and Riot
connection are available to every authenticated VAL Checker user; the decision
history and earlier closed gates remain in [the roadmap](docs/roadmap.md).

## Operating policy

Public magic-link and Google signup remain open to everyone, and any
authenticated VAL Checker account may use the Riot connection flow. The server
derives the owner from verified Supabase claims before it reads session
material. One-time capture tokens, explicit consent, bounded input validation,
owner-scoped database access, and encrypted session storage remain required.

The private browser extension is the primary connection method. It opens Riot's
real sign-in page in the user's normal desktop browser, so Google sign-in,
MFA, and CAPTCHA remain normal human interactions on Riot's site. The extension
does not read the password, MFA code, CAPTCHA, keyboard, or mouse. After Riot's
successful redirect, it sends the complete renewable cookie jar directly from
its background context to an owner-bound, single-use VAL Checker endpoint. The
jar is never exposed to the VAL Checker webpage. Manual cookie JSON remains the
advanced and mobile fallback.

The Singapore cloud-browser canary is disabled because Google rejects the
embedded automated browser and Riot authentication was not reliable enough to
pass the canary success gate. Its code remains for research, fail-closed behind
`RIOT_CLOUD_CONNECT_ENABLED=false`; it is not presented in the production
connection UI. See [the cloud-browser architecture and canary runbook](docs/cloud-browser-riot-connection.md).

After a successful connection, VAL Checker performs an initial storefront
check. One application login may connect multiple Riot accounts; every account
keeps its own encrypted session, store, health, and refresh state. The server
resolves the stable Riot PUUID before a live session row is inserted or replaced
so reconnecting cannot mint another allowance.

No manual enrollment is required for Riot connection. Every stored Riot account
remains bound to the authenticated VAL Checker owner, and disconnect remains
available so stored material can always be deleted.

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
| `RIOT_CLOUD_CONNECT_ENABLED` | Server only | Experimental temporary-browser kill switch. Keep `false` in production while the canary is unproven. |
| `RIOT_CLOUD_BROWSER_URL` | Server only | HTTPS origin of the separately deployed Singapore browser service. |
| `RIOT_CLOUD_BROWSER_API_KEY` | Server only | Bearer key for the browser service control API; never expose it to clients. |
| `RIOT_TLS_CIPHERS` | Server only | Optional TLS cipher order for Riot's auth host. Leave unset unless sign-in begins returning 403. |
| `RESEND_API_KEY` | Server only | Resend API key used for owner and storefront notifications. |
| `RESEND_FROM_EMAIL` | Server only | Sender identity on a verified Resend domain. |
| `VAL_CHECKER_OWNER_EMAIL` | Server only | Recipient for one-time new-account notifications. |
| `CRON_SECRET` | Server only | Random Vercel cron authentication secret of at least 16 characters. |

Configure at least one public Supabase key and one elevated Supabase key. Keep old
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
   material and a test-only authenticated identity locally.

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

## Private browser extension

One shared implementation in `browser-extension/src` produces two packages via
`pnpm run extension:build`:

| Build    | Browsers                             | Archives                                                          |
| -------- | ------------------------------------ | ----------------------------------------------------------------- |
| chromium | Chrome, Edge, Brave, Opera, Opera GX | `val-checker-chrome.zip`, `-edge`, `-brave`, `-opera`, `-opera-gx` |
| firefox  | Firefox                              | `val-checker-firefox-unsigned.zip`                                 |

Chromium browsers share one build, but each gets its own download name so no
one has to recognise "chromium" as their browser.

The connection card detects the browser and offers the right package with that
browser's own wording, extensions URL, and steps; a manual picker is always
present so a failed detection never blocks the download. Unrecognised browsers
get a Chrome/Chromium-or-Firefox choice, Safari is told it is unsupported, and
mobile browsers are told the flow is desktop-only rather than being handed an
archive they cannot use.

Chromium archives contain a single `UNZIP ME` folder with `manifest.json`
directly inside it, so extracting produces exactly the folder **Load unpacked**
needs. Nobody has to create, rename, move, or reorganise anything. The Firefox
archive is deliberately flat instead: an add-on package must carry
`manifest.json` at its root, and Firefox rejects a nested one as corrupt.

For Chromium browsers, unzip the archive first, open the browser's extensions
page, enable Developer mode, choose **Load unpacked**, and select the extracted
`UNZIP ME` folder. Firefox has no signed add-on yet, so its
artifact is a development build loaded through
`about:debugging#/runtime/this-firefox`; see `browser-extension/README.md` for
the production distribution steps that are still outstanding.

After that one-time setup, **Sign in with Riot** handles the full flow: Riot tab
open, human sign-in, cookie capture, direct submission, Riot tab close, and
dashboard refresh. The pairing token expires after ten minutes and is consumed
atomically on its first submission. The extension flow is desktop-only; the
advanced JSON fallback remains available where cookie-export tooling exists.

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
3. Verify the Resend sending domain, set `RESEND_FROM_EMAIL` to an identity on
   that domain, and set `VAL_CHECKER_OWNER_EMAIL` to the site owner's recipient
   address.
4. Deploy the Next.js application. The committed Vercel cron configuration runs
   the protected worker route daily at 00:05 UTC. Do not add another scheduler or
   expose that protected cron route as a user action. Manual refresh uses an
   authenticated server action with an exact owned connection ID.

`CRON_SECRET` protects the scheduled route, while per-connection automatic and
per-PUUID manual claims enforce their independent UTC-day limits even if a
scheduler or browser invocation is duplicated. These cadence controls complement
the authenticated owner and connection checks.

## Operational visibility

Each daily pass writes one `riot_run_logs` row per account it touches, so a
dogfood day can be reviewed without reading Vercel logs. Every row records the
timestamp, trigger (`cron`, `manual`, or `operator`), outcome (`checked`,
`skipped`, or `failed`), Riot session classification, how many watchlist matches
were found, and how many emails were actually sent.

The `reason` column uses a closed vocabulary such as `ACCOUNT_UNAVAILABLE`,
`DAILY_CLAIM_HELD`, `MANUAL_CLAIM_HELD`,
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
