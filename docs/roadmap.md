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
  constraint, not a configurable default.

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
