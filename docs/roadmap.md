# Valorant Store Checker — Build Spec (agent-ready)

**Version:** 2.0 · **Date:** 2026-08-14
**Audience:** a coding agent (Codex-style) executing tasks autonomously, plus the human reviewing.
**Mode:** Phase 6 is OPEN for allowlisted, single-user dogfooding. The Track C
blockers retained in the Version 2.0/2.1 text are historical and superseded by
the Version 2.2 decision below.

> **Historical specification notice:** The Version 2.0 text below is preserved as
> the decision record that governed Phases 1–4. Where it conflicts with the
> Version 2.1 or Version 2.2 decision addenda immediately below, the newest
> addendum controls.

## Version 2.2 decision addendum — Phase 6 ship gate opened

**Decision date:** 2026-08-14

### Durability gate retired

The 14-day durability gate is retired. Research found Riot's enforcement against
store checkers has taken the form of DMCA action against projects, not
account-level bans. The gate was therefore guarding a risk the available evidence
does not support. This decision supersedes the closed ship gate in Version 2.1
and the Track C blocker in §8 and §11; those sections remain below as the
historical record of why collection and use of real session material was
previously blocked.

The replacement control is a staged rollout:

- begin with the operator's own account only for approximately three weeks; and
- only after that dogfood period, add explicitly allowlisted users.

The Phase 6 ship gate is now **OPEN for single-user dogfooding**. Live Riot
requests are permitted only through the daily cron path and only for an
allowlisted account.

### Controls that remain load-bearing

- The existing fail-closed connect-flow allowlist remains. It gates dogfooding
  scope rather than account-ban risk: only allowlisted users may submit Riot
  session material. Public magic-link signup remains open, and non-allowlisted
  connection attempts must continue to be rejected.
- Server-side session encryption remains mandatory. Email delivery requires the
  service to retain the Riot session, unlike store checkers that keep sessions
  client-side, so AES-256-GCM with encryption keys held outside Supabase is the
  compensating control. It must not be weakened.
- Storefront access is limited to **one check per user per day**, scheduled
  shortly after the 00:00 UTC store rotation. There is no on-demand refresh
  endpoint, polling, or user-triggered fetch. This is an architectural
  constraint, not a configurable default. *(Superseded by the Version 2.3
  addendum above: the cap is now one request per connected account per
  rotation, and the dashboard may spend that same allowance when the schedule
  has not run.)*

Phase 6 implements the real Riot adapter and daily worker path under these
controls. The pending `skins.weapon_uuid` migration is still excluded until the
project owner separately approves it.

### Current operating and deployment contract

- Production starts with only the operator's verified Supabase user ID or email
  in the Riot connection allowlist for approximately three weeks. Additional
  users are added explicitly after that dogfood window; public magic-link signup
  remains open throughout.
- The only live Riot request path is the protected daily cron, scheduled for
  00:05 UTC. A per-user UTC-rotation database claim is authoritative even if the
  scheduler invokes the route more than once. No UI action, public API route,
  debug route, or polling loop may fetch a storefront.
- Runtime configuration uses a public Supabase URL and publishable/legacy anon
  key, a server-only Supabase secret/legacy service-role key, the versioned
  `SESSION_ENCRYPTION_KEY_V<n>` keyring and current version, the Riot connect
  allowlist, Resend credentials, and `CRON_SECRET`. The server-side values remain
  outside source control; encryption keys remain outside Supabase.
- Supabase schema changes are applied only from the reviewed migration history.
  The full local and deployment procedure is maintained in the root README.

## Version 2.3 decision addendum — per-account cadence and operator-triggered checks

**Decision date:** 2026-08-15

The Version 2.2 cadence read "one check per user per day" with "no on-demand
refresh endpoint, polling, or user-triggered fetch". Two changes were requested
by the project owner after that text was written, and both were confirmed after
the conflict was raised.

### Multiple Riot accounts per login

One login may now connect several Riot accounts. The cadence moves with it: the
cap becomes **one storefront request per connected account per UTC rotation**.
A login holding N accounts therefore makes up to N requests per day rather than
one, which is a deliberate increase in exposure proportional to accounts held.

The anti-abuse property from Version 2.2 is preserved rather than dropped.
`claim_riot_daily_run` refuses a claim once the runs already taken today reach
the number of accounts the login currently holds, so disconnecting and
reconnecting cannot mint a fresh allowance. Without that guard the
per-connection key alone would have made the daily cap trivially resettable.

### Operator-triggered check when the schedule has not run

The dashboard may now run the daily check for the signed-in user when no
storefront has been recorded for the current rotation. This is a change to
*who* triggers the request, not to *how many* are permitted: the request still
passes through the same database claim, so it either spends the day's single
per-account allowance or does nothing. There is still no polling loop, no
public refresh endpoint, and no debug route that reaches Riot.

The scheduled 00:05 UTC cron remains the primary path. The dashboard trigger is
a fallback for the case where the schedule has not yet produced a result.

## Version 2.4 decision addendum — credential connect, transit-only

**Decision date:** 2026-08-15

Connecting an account previously required pasting a browser cookie export. That
is impractical from a phone: the `ssid` cookie is `httpOnly`, so no bookmarklet
or in-page script can read it, and capturing it needs a desktop cookie-export
extension. The project owner asked for a Riot sign-in form instead.

### Why not Riot's own OAuth

Riot Sign On was considered and rejected on capability, not on principle. RSO
issues an identity token whose scopes do not reach the storefront; the store
endpoint requires an entitlements token from the game authentication path, which
RSO does not mint. RSO would establish who a user is and nothing about their
shop, so it cannot replace this flow.

### The middleman model

VAL Checker accepts a Riot username and password, exchanges them with Riot for a
cookie jar, and stores only the jar. The credential is **transit-only**:

- it exists solely for the duration of one connect request;
- it is never written to Postgres — no column, no table, no JSON blob;
- it is never logged, never placed in an error message or stack trace, and never
  returned to the client; and
- it is confined to `src/lib/riot/login-provider.ts`. No other module receives
  it, and nothing downstream of that provider can observe it.

The jar produced by the exchange is identical in kind to a pasted export, so the
existing AES-256-GCM storage, keyring, rotation, and worker paths are unchanged.

Encryption of the credential itself was considered and rejected as ineffective.
The password is replayed to a third party rather than verified locally, so it
must be plaintext in process memory at the moment of the outbound request. Any
scheme the server can reverse leaves the server holding the plaintext, and
client-side encryption only relocates the key. The honest control is the narrow
window and the absence of storage, not a cipher. Zeroing is likewise not claimed:
JavaScript strings are immutable and cannot be reliably scrubbed from memory.

### Amendments to earlier text

- The `RiotAdapter` contract in §8 reads `authenticate() // from a captured jar,
  never a password`. That rule is amended: a password may be exchanged for a jar
  at connect time. It remains true that no password is ever stored, and that the
  adapter's own session handling continues to operate on jars alone.
- The Version 2.2 statement that "the only live Riot request path is the
  protected daily cron" is amended. There are now two live paths: the
  user-initiated authentication request at connect time, and the daily storefront
  check. The authentication request does not read a storefront.
- **The storefront cadence is unchanged.** The Version 2.3 cap of one storefront
  request per connected account per UTC rotation, enforced by
  `claim_riot_daily_run`, still governs every storefront read. Connecting does
  not fetch a shop and does not consume or refund the daily allowance.

### Multi-factor authentication

Riot answers most logins with an MFA challenge, and the flow must serve accounts
with Riot's authenticator, accounts with emailed codes, and accounts with no MFA
at all. An emailed code cannot be known before the credential is submitted, so
connect is two steps: submit credentials, receive the challenge, submit the code.

The intermediate pending-authentication cookie that links the two steps is not an
authenticated session, but it is still session material and is therefore
encrypted at rest with the existing cipher and `user_id` as AAD, in a
service-role-only table, and expires after ten minutes. No password is written to
it. Accounts without MFA complete in one step and never create such a row.

MFA on the connected Riot account is recommended rather than required. It is the
control that most reduces the value of a password intercepted during the transit
window.

### Cookie-jar paste retained, admin-only

The pasted-export path is kept as a fallback, because the authentication endpoint
sits behind Cloudflare fingerprinting and may begin refusing requests from
datacenter IPs without warning; losing it would otherwise leave no way to
connect. It is restricted to administrators, so ordinary allowlisted users see
only the sign-in form. The existing fail-closed connect allowlist continues to
gate both paths.

## Version 2.5 decision addendum — interface rebuild, phased

**Decision date:** 2026-08-16

### Why a rebuild rather than a restyle

The dashboard renders the consent copy, the Riot sign-in form, the daily shop
and the full skin catalog into a single `catalog-shell` at one density. The page
runs to several thousand pixels because the catalog is unbounded, and the
consent wall sits between the user and every task on the page. That is an
information-architecture problem, not a stylesheet problem: restyling the
current layout would produce a better-looking version of the same unusable page.

A component system is nonetheless adopted, because the project is committing to
Tailwind and shadcn/ui for the long run and the migration cost only grows as
more hand-written CSS accumulates against the current 851-line `globals.css`.

The two decisions are sequenced deliberately: **structure first, styling
second.** Restyling a layout that is about to be split apart is wasted work, so
no component migration begins until the surfaces it will migrate are stable.

### Constraints that remain load-bearing

- No phase may introduce a Riot request path. The daily cron and the existing
  operator-triggered check remain the only ones, under the per-account
  per-rotation claim from the Version 2.3 addendum.
- The fail-closed connect allowlist keeps gating both connection paths, and the
  admin-only cookie-export fallback (Version 2.4) stays reachable.
- The §10 copy constraints apply to every screen this work touches.
- Each phase lands with the suite green. No phase may leave the app unusable
  between merges; a half-migrated interface is an acceptable state, a broken
  one is not.

### Phase 7.1 — Route split
Move the Riot connection flow off the catalog page onto its own route. The
dashboard keeps the daily shop and the collection; connecting, disconnecting and
the MFA challenge live together on the connection route. The consent copy
collapses behind a disclosure that is expanded by default only when no account
is connected.
**Acceptance:** connecting an account is reachable from a dedicated route and no
longer renders above the catalog; the dashboard renders for a connected user
with no consent wall; no new Riot request path exists.

### Phase 7.2 — Catalog containment
Bound the catalog. Pagination or virtualization so rendered height is
independent of catalog size, with the search and All / Watched-Only filters
lifted into a persistent control bar rather than scrolling away with the list.
**Acceptance:** rendered row count stays bounded as the catalog grows; search
and the Watched-Only toggle behave as in §3.1; the existing catalog-browse tests
pass unchanged.

### Phase 7.3 — Tailwind adopted alongside the existing CSS
Install Tailwind and express the current dark palette as design tokens. No
rewrite in this phase: `globals.css` and Tailwind coexist, so the diff is
additive and reviewable.
**Acceptance:** the build succeeds with Tailwind configured; every existing
screen renders as it did before the phase; tokens reproduce the current palette.

### Phase 7.4 — shadcn/ui primitives on the connection flow
Initialize shadcn/ui and add only the primitives the app actually uses. Migrate
the connection route first: it is the smallest surface, the one with the most
form state, and the one where the failure copy from the credential-connect work
must read clearly.
**Acceptance:** the connection route renders on shadcn primitives; the existing
connection-panel behaviour tests pass unchanged; every credential failure
classification still surfaces its own distinct message.

### Phase 7.5 — Remaining surfaces migrated, dead CSS retired
Migrate the dashboard, the daily shop panel, the catalog and the sign-in screen.
Delete the class rules left behind as each surface moves, so `globals.css`
finishes reduced to tokens and base styles.
**Acceptance:** no surface depends on a hand-written class rule that has no
remaining consumer; `globals.css` contains only tokens and base styles.

### Phase 7.6 — Accessibility and copy pass
Contrast, focus order, keyboard reachability and touch target sizing across the
migrated interface, plus a copy review against §10.
**Acceptance:** text meets WCAG AA contrast; every interactive control is
keyboard reachable with a visible focus state; the §10 copy constraints hold on
every screen that mentions reconnection or Riot affiliation.

## Version 2.1 decision addendum — build and ship gates separated

**Decision date:** 2026-08-14

### Historical gate and why it changed

Version 2.0 used one durability gate for two different questions: whether Phase 5
could be built, and whether the product could safely accept real Riot
account-access material. It blocked all of Track C until an external VPS reauth
loop reached at least 14 unattended days without manual login or MFA. That
reasoning remains recorded in §0.2, §1, §8, and §11 below rather than being
silently erased.

The single gate was too broad. Session TTL does not change the Phase 5 design:
consent, encryption, key separation, connect/disconnect behavior, revocation,
and expiry handling are required whether a Riot session lasts 5 days or 21 days.
The external spike still answers a separate and important shipping-risk question:
whether failures look like ordinary expiry or like Riot enforcement/abuse
detection caused by the operating model.

### Current gates

- **BUILD GATE — REMOVED.** Fixture-driven, test-driven Phase 5 foundation work
  may proceed without a session-TTL result. External boundaries must be injected
  or mocked, and no live Riot request is permitted.
- **SHIP GATE — RETAINED AND CLOSED.** No real user's Riot credentials, cookies,
  jars, tokens, or session material may be accepted, stored, used, or deployed
  until the external durability spike has not failed in a way that resembles
  Riot enforcement or abuse detection rather than ordinary session expiry. The
  spike continues as an abuse-detection canary.
- **Public signup remains available.** The Version 2.0 website-wide
  invite-only statement in §8 is superseded. Public website signup, ordinary
  site auth, catalog browsing, watchlists, and other Riot-independent
  functionality remain open. Riot **connection**, however, is protected by a
  separate fail-closed server-side allowlist of verified user IDs and emails;
  that narrow authorization boundary does not satisfy or replace the ship gate.

Encryption keys remain outside Supabase. Fixture-driven Phase 5 work must never
persist keys in Supabase, introduce real credential/session material, make live
Riot requests, or deploy credential-bearing functionality.

### Phase 4.5 delivered state

The merged Phase 4.5 work added the scrubbed authoritative real storefront
fixture and a Zod boundary for its observed storefront sections. It:

- recognizes daily rewards as SkinLevel items using item-type UUID
  `e7c63390-eda7-46e0-bb7a-a6abdacd2433`;
- extracts normalized level UUIDs from
  `SingleItemStoreOffers[].Rewards[].ItemID`, without relying on positional
  `SingleItemOffers` values;
- hands those levels through the existing SkinLevel-to-Skin resolver and fails
  closed with `UnknownSkinLevelsError` for any unmapped level;
- preserves per-offer, currency-keyed prices rather than assuming VP;
- treats the absent `BonusStore` as optional and non-null when present; and
- ignores the newer, substantial `PluginStores` structure instead of rejecting
  the payload.

The authoritative fixture does not define the shape of a present Night Market
`BonusStore`; that remains an explicit schema question. Featured bundles are not
surfaced yet, and any future bundle surface must deduplicate the repeated bundle
representations by bundle ID.

### Phase 5 lifecycle decision — three-failure rule made operational

> **Historical blocker:** The initial Phase 5 implementation correctly stopped
> here because no merged material defined the requested v2.1 counter correction
> precisely enough to implement without guessing. The investigation and missing
> details are preserved below. The project owner's superseding decision after
> that investigation now supplies the authoritative semantics.

The Phase 5 foundation request references a “v2.1 consecutive-failure-counter
correction,” but the merged repository and its PR/commit history do not define it.
The only authoritative counter statement currently available is the historical
Version 2.0 sentence in §8: “3 consecutive failures → `REAUTH_REQUIRED`.” That is
not precise enough to implement the requested regression safely because it does
not specify:

- which of `UNKNOWN`, `ERROR`, or other non-`OK` results increment the counter;
- the exact threshold correction and comparison semantics;
- when an `OK` result resets the counter;
- how existing lifecycle/account states affect counting and transitions; or
- the historical bug that the required regression test must reproduce.

Accordingly, at that point no lifecycle decision function or guessed counter
behavior was added, and independent Phase 5 foundation items continued.

The project owner subsequently made the merged Version 2.0 rule operational and
authoritative, superseding the unavailable v2.1 detail:

- `OK` resets `consecutive_failures` to zero;
- `DEAD` is authoritative and immediately transitions to disconnected with no
  further checks; it is never added to the failure counter;
- `UNKNOWN` and `ERROR` each increment `consecutive_failures`;
- a count greater than or equal to 3 transitions to `REAUTH_REQUIRED`; and
- a below-threshold ambiguous failure does not disconnect the account.

This narrower decision preserves the merged “3 consecutive failures →
`REAUTH_REQUIRED`” rule while making its reset, classification, and threshold
semantics testable. It supersedes only the unavailable v2.1 counter specification;
the historical decision not to invent those details remains part of this record.

---

## 0. Historical Version 2.0 agent operating rules

These were the hard constraints for the Version 2.0 Track B implementation and
are retained as decision history. The Version 2.2 addendum controls current
Phase 6 work.

1. **Work one task at a time.** Each task below has an ID (e.g. `1.3`) and an **Acceptance** block. Implement, then satisfy Acceptance (write/run the test or command), then move on. Do not batch phases.
2. **Stop at the end of Phase 4 and report.** Do NOT begin Phase 5 or anything under Track C (§8). Those depend on an external experiment that has not returned. If you believe a Track-C task is unblocked, stop and ask the human instead of proceeding.
3. **Never commit secrets.** The very first commit must contain a `.gitignore` covering `.env*`, `cookies*.json`, `jar_live.json`, `*.pem`, `*.key`. If any secret-bearing file is already tracked, stop and report.
4. **Never log credentials.** No cookie values, tokens, `Authorization` headers, or the encrypted jar may be written to logs, error messages, or test output. Redact to name-only.
5. **Do not run migrations against a remote/production database.** Use the local Supabase stack (`supabase start`). If a task seems to require a remote DB, stop and ask.
6. **Ask before destructive operations** — dropping tables, deleting data, force-pushing, rewriting history.
7. **No invented external URLs.** (Track C only.) Every Riot endpoint must map to a documented `valapidocs.techchrism.me` endpoint cited in a code comment. This phase (B) touches only `valorant-api.com`, which is public catalog data with no auth.
8. **Cite the spec, not this behaviour.** When you make a design choice, reference the section here that drove it in your PR description.

**Definition of "done" for a task** = its Acceptance block passes AND `pnpm test` and `pnpm build` are green AND no secret is tracked.

---

## 1. Status snapshot

### Proven (do not rebuild or re-litigate)
- Browser-captured cookie jar reused server-side: **yes** (26 cookies, `ssid` present).
- Cookie-reauth returns a usable token without fresh login: **yes** (`GET /authorize`, `allow_redirects=False`, 301 → `playvalorant.com/opt_in#access_token=…`).
- Rotation/persistence chain holds locally: **yes** (55/55 `OK` over ~13.5h, cookie count steady at 26).

### Unknown in Version 2.0 (external experiment, not that agent's job)
- Does an AP-region session survive ~21 days unattended from a datacenter IP without MFA? → measured by a separate VPS spike. **At that time, Track C stayed blocked until this returned.**

### In scope for the Version 2.0 agent at that time
- Phases 1–4: foundation, catalog sync + resolver, collection frontend, watchlist. **None of it touches Riot.**

---

## 2. Stack & repository layout

**Stack**
- Next.js (App Router) + TypeScript, deployed to Vercel (frontend + light API routes only).
- Supabase (Postgres + Auth + RLS). Local dev via Supabase CLI.
- pnpm. Vitest for tests. Zod for runtime validation at all external boundaries.
- Worker (Track C) is a **separate deployable** targeting a VPS — it is NOT a Vercel function. Scaffold its folder now; leave it empty of Riot logic.

**Layout**
```
/
├─ .gitignore                      # task 1.1, first commit
├─ app/                            # Next.js App Router (Vercel)
│  ├─ (auth)/…                     # magic-link sign-in
│  ├─ dashboard/…                  # collection UI (Phase 3)
│  └─ api/…                        # server routes (service-role reads live here)
├─ src/
│  ├─ lib/
│  │  ├─ supabase/                 # browser + server clients
│  │  ├─ catalog/                  # valorant-api sync + resolver (Phase 2)
│  │  └─ riot/                     # RiotAdapter interface ONLY for now (Phase 5, stubbed)
│  └─ types/
├─ supabase/
│  └─ migrations/                  # SQL migrations (schema + RLS together)
├─ worker/                         # separate VPS deployable — empty scaffold for now
└─ tests/
```

---

## 3. Historical Version 2.0 environment variables

This table records the original plan. The Version 2.2 operating contract above
and the root README define the current versioned keyring, Resend, allowlist, and
cron configuration.

Create `.env.local` (gitignored) and a committed `.env.example` with empty values.

| Var | Scope | Phase | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client | 1 | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | 1 | |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | 1 | Never imported into a client component |
| `SESSION_ENCRYPTION_KEY` | worker only | 5 (blocked) | Lives OUTSIDE Supabase. Not needed yet |
| `RESEND_API_KEY` | worker only | 7 (blocked) | Not needed yet |

Guard: `SUPABASE_SERVICE_ROLE_KEY` must be unreachable from any `"use client"` module. Add a lint check or test asserting it is only referenced under `app/api/` and `src/lib/supabase/server*`.

---

## 4. Phase 1 — Foundation

Goal: a logged-in user reaches an empty dashboard; full schema exists with RLS; `riot_connections` is locked to the service role.

### 1.1 Repo + secret hygiene
Scaffold the Next.js/TS/pnpm project. First commit includes `.gitignore` (see §0.3) and `.env.example`.
**Acceptance:** `git log` shows `.gitignore` in the first commit; `git ls-files` lists no `.env*`, no `*.json` cookie files.

### 1.2 Supabase local + clients
Init Supabase locally. Add browser client (anon key) and server client (service role, server-only).
**Acceptance:** `supabase start` runs; a server route can read `select 1`; a client component cannot import the service-role client (test asserts this).

### 1.3 Schema migration (schema + RLS in ONE migration)
Write a single migration containing every table below **and** its RLS. RLS is never a follow-up migration.

```sql
-- enums
create type auth_status as enum (
  'CONNECTED','REAUTH_REQUIRED','RIOT_UNAVAILABLE','RATE_LIMITED','NETWORK_BLOCKED'
);

-- catalog (public data; readable by any authenticated user, writable only by service role)
create table weapons (
  weapon_uuid   uuid primary key,
  display_name  text not null,
  category      text
);

create table skins (
  skin_uuid     uuid primary key,
  display_name  text not null,
  weapon_uuid   uuid references weapons(weapon_uuid),
  content_tier  text,
  display_icon  text,
  first_seen_at timestamptz not null default now()
);

-- THE RESOLVER TABLE: storefront returns level UUIDs; watchlist stores skin UUIDs.
create table skin_levels (
  level_uuid    uuid primary key,
  skin_uuid     uuid not null references skins(skin_uuid),
  ordinal       int,
  first_seen_at timestamptz not null default now()
);
create index on skin_levels (skin_uuid);

-- user data
create table watchlist (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  skin_uuid  uuid not null references skins(skin_uuid),
  created_at timestamptz not null default now(),
  unique (user_id, skin_uuid)
);

-- sensitive: encrypted session material. Service-role only. No user-facing policy.
create table riot_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  puuid               text,
  region              text,          -- na|eu|ap|kr  (mapped, see §9)
  shard               text,
  encrypted_jar       bytea not null,
  jar_nonce           bytea not null,
  session_key_version int  not null default 1,
  auth_status         auth_status not null default 'CONNECTED',
  consecutive_failures int not null default 0,
  last_refresh_at     timestamptz,
  created_at          timestamptz not null default now(),
  unique (user_id)                   -- one connection per user for V1
);

-- operational: service-role only
create table shop_checks (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null references riot_connections(id) on delete cascade,
  checked_at       timestamptz not null default now(),
  shop_hash        text not null,
  offer_skin_uuids uuid[] not null default '{}',
  total_cost       int,
  expires_at       timestamptz,
  night_market     jsonb,           -- captured from day one even if surfaced later
  bundle           jsonb
);

-- user-visible alerts; unique constraint is the real dedup
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  skin_uuid     uuid not null references skins(skin_uuid),
  shop_check_id uuid not null references shop_checks(id) on delete cascade,
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz,
  unique (user_id, skin_uuid, shop_check_id)
);

-- ROW LEVEL SECURITY --------------------------------------------------------
alter table weapons     enable row level security;
alter table skins       enable row level security;
alter table skin_levels enable row level security;
create policy "catalog readable" on weapons     for select to authenticated using (true);
create policy "catalog readable" on skins       for select to authenticated using (true);
create policy "catalog readable" on skin_levels for select to authenticated using (true);
-- no insert/update/delete policies → writes denied to all but service role

alter table watchlist enable row level security;
create policy "own watchlist" on watchlist
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table notifications enable row level security;
create policy "own notifications read" on notifications
  for select to authenticated using (auth.uid() = user_id);

-- riot_connections and shop_checks: RLS enabled, NO policies → service-role only.
alter table riot_connections enable row level security;
alter table shop_checks      enable row level security;
```

**Acceptance (all must pass as automated tests):**
- Migration applies cleanly on a fresh local DB.
- With an anon key + a signed-in user JWT, `select * from riot_connections` returns **zero rows / permission denied** — assert with a real request, not by reading the SQL.
- Same for `shop_checks`.
- A user can insert into `watchlist` only with their own `user_id`; inserting another user's `user_id` is rejected by the `with check`.
- A user selecting `watchlist` sees only their own rows (create two users; each sees one).
- Any authenticated user can `select` from `skins`/`skin_levels`/`weapons`; none can `insert`.

### 1.4 Magic-link auth + empty dashboard
Supabase magic-link sign-in; protected `/dashboard` that renders for an authed user and redirects otherwise.
**Acceptance:** unauthenticated `/dashboard` redirects to sign-in; after magic-link, dashboard renders. One e2e or integration test covers the redirect.

---

## 5. Phase 2 — Catalog sync + the resolver

Goal: populate the catalog from public data and build the SkinLevel→Skin resolver **with its test**. This phase exists to kill one specific silent bug.

### 2.1 valorant-api client
Typed client for `valorant-api.com` (weapons + skins + skin levels). Validate responses with Zod. No auth involved.
**Acceptance:** a mocked-fixture test parses a sample payload into typed rows; malformed payloads throw at the boundary, not deep in app code.

### 2.2 Sync job
Idempotent upsert of `weapons`, `skins`, `skin_levels`, setting `first_seen_at` on first insert only. Runs via `pnpm sync:catalog`.
**Acceptance:** running the sync twice against local DB yields identical row counts and unchanged `first_seen_at` on existing rows.

### 2.3 The resolver (highest-risk deliverable)
Implement `resolveSkinUuids(levelUuids: string[]): Promise<string[]>` in `src/lib/catalog/`. It maps storefront **SkinLevel** UUIDs to parent **Skin** UUIDs via `skin_levels`.

**Why this phase exists:** the storefront returns *SkinLevel* UUIDs; the watchlist stores *Skin* UUIDs. Compared directly they never match, so the checker runs flawlessly and silently never alerts. This is the single most probable failure of the whole product and the hardest to notice.

**Acceptance (required test, a Phase-2 deliverable — not deferred):**
- Given a fixture storefront payload containing known level UUIDs, `resolveSkinUuids` returns the correct parent skin UUIDs.
- An unknown level UUID is handled explicitly (skipped + logged by name, or surfaced) — never silently dropped in a way that masks a stale catalog.
- A direct-equality test documents the trap: asserting raw level UUIDs do NOT equal watchlist skin UUIDs, proving the resolver is load-bearing.

---

## 6. Phase 3 — Collection frontend

Goal: browse the full catalog and toggle watch state in the UI (local state first).

### 3.1 Catalog browse UI
Weapon categories → weapon cards → skins, with search and an All / Watched-Only filter. Renders purely from the synced catalog; no Riot session anywhere.
**Acceptance:** with a seeded local catalog, the UI lists weapons and skins, search filters, and the Watched-Only toggle works against local state.

---

## 7. Phase 4 — Watchlist persistence

Goal: persist the watchlist in Supabase with optimistic updates, scoped by RLS.

### 4.1 Watchlist CRUD
Add/remove watch entries writing to `watchlist`; optimistic UI with rollback on error.
**Acceptance:** watch state survives reload; a second user cannot see or mutate the first user's watchlist (RLS-backed test); optimistic add rolls back on a forced server error.

**END OF IN-SCOPE WORK. Stop here, run the full suite, open a PR, and report. Do not start §8.**

---

## 8. Historical Version 2.0 Track C blocker — BLOCKED at that time

> **Historical instruction, superseded by Version 2.2:** Do not implement any
> task in this section until the durability spike returns a pass. Definitions
> are retained to preserve the reasoning that governed Phases 1–4.

**Gate to unblock:** VPS reauth loop ≥14 consecutive unattended days, no manual login, no MFA prompt. Until the human confirms this, Track C stays closed.

- **Phase 5 — Connect flow + consent + encrypted storage.** Consent screen (states: what's stored, that stored material can access the account and bypass MFA, lifespan, revocation, non-affiliation with Riot). Disconnect includes Riot "Sign out everywhere". Encryption: AES-256-GCM, per-row nonce, `user_id` as AAD, `session_key_version` populated; **key held outside Supabase** (KMS/envelope preferred). Signup **allowlisted/invite-only** for V1. Ship `SECURITY.md` + README threat model.
- **Phase 6 — Worker loop** (on the VPS, not Vercel). Daily after 00:00 UTC rotation; jittered per-connection delay; on success **persist the full rotated jar**, resolve level→skin UUIDs (Phase 2), hash the shop, dedup via the `notifications` unique constraint, capture Night Market + bundle. 3 consecutive failures → `REAUTH_REQUIRED`.
- **Phase 7 — Email** (Resend, verified domain, bounce webhook). Reauth cadence: one email on entering `REAUTH_REQUIRED`, one reminder on day 7, then silence. Never more than two per episode.
- **Phase 8 — Auth-health UI.** Connection status + reconnect; honest copy about the real session ceiling (§ copy rules).
- **Phase 9 — Allowlisted 10-user test** with metrics collecting.

**RiotAdapter contract (Phase 5 — stub the interface now, implement later):**
```ts
// src/lib/riot/adapter.ts  — interface only until Track C unblocks
export interface RiotAdapter {
  authenticate(): Promise<Session>;      // from a captured jar, never a password
                                         // (amended by Version 2.4: a password may
                                         // be exchanged for a jar at connect time
                                         // and is never stored)
  refreshSession(s: Session): Promise<Session>;
  getEntitlements(s: Session): Promise<Entitlements>;
  getPUUID(s: Session): Promise<string>;
  getRegion(s: Session): Promise<string>;
  getStore(s: Session): Promise<Storefront>;   // returns level UUIDs
  healthCheck(): Promise<HealthStatus>;
}
// Rule: nothing outside this module imports a Riot URL, header, or type.
// Rule: getStore's result is passed through the Phase-2 resolver before any
//       comparison with a watchlist. The adapter never returns raw level UUIDs
//       to callers that expect skin UUIDs.
```

---

## 9. Standing engineering rules

- All Riot logic (Track C) lives behind `RiotAdapter`. No Riot URL/header/type leaks outside `src/lib/riot/`.
- The resolver boundary is inviolable: **skin UUIDs cross app boundaries, level UUIDs do not.**
- Never log credentials, cookies, tokens, or `Authorization` headers.
- `region` and `shard` are distinct. Map: `na|latam|br → na`, `eu → eu`, `ap → ap`, `kr → kr`.
- Validate every external payload with Zod at the boundary.
- Read SkinPeek **forks** for current auth behaviour (upstream archived 2025-06-04); upstream for architecture only. (Track C.)
- Encryption key lives outside Supabase. A key beside the DB credentials is obfuscation, not encryption. (Track C.)

---

## 10. Copy constraints (apply when Track C UI is built)

- Do NOT promise "weeks or months between logins." Observed ceiling: ~3 weeks for a full jar, ~1 week for `ssid` alone.
- DO state periodic reconnection is required and that an email will prompt it.
- DO state the service is unaffiliated with Riot Games.

---

## 11. First actions for the agent

1. Phase 1.1 → 1.4 in order, satisfying each Acceptance block.
2. Phase 2, with the resolver test (2.3) as a required deliverable.
3. Phases 3 and 4.
4. Stop, run `pnpm test` + `pnpm build`, open a PR summarising each phase against its Acceptance criteria, and report. **Do not enter Track C.**
