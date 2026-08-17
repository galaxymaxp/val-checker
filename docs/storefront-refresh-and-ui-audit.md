# Storefront refresh and product UI audit

## Confirmed root cause

The cron schedule and bearer authorization were structurally correct, but a
successful Riot storefront was not an independent persistence event. The only
`shop_checks` write happened inside notification reservation, and the delivery
service returned immediately when there were no new watchlist emails. A valid
store with no match (or an already-deduplicated match) therefore consumed its
daily claim without creating the row read by the dashboard.

Additional reliability findings were:

- the cron Riot client used the default Node fetch instead of the project's
  TLS-tuned transport;
- a pre-request crash could strand the daily claim;
- catalog drift could discard an otherwise valid store;
- missing Resend configuration could fail worker construction before useful
  work; and
- a protected cron invocation could return HTTP 200 even when individual
  accounts failed, with too little aggregate context to distinguish outcomes.

The implementation now persists a catalog-independent snapshot immediately
after a valid storefront response. Catalog/watchlist planning and email delivery
are downstream concerns and have separate closed failure reasons.

## Refresh architecture

One shared worker accepts `cron`, `manual`, or `operator` as its trigger. Cron
enumerates every eligible connection and isolates failures per account. Manual
requires one exact `(user_id, connection_id, connection_epoch)` target. Operator
has no public route and currently shares the automatic claim policy.

Automatic and manual claims are separate and use PostgreSQL's UTC date. Each has
an atomic storefront-attempt fence. Stale claims that never crossed that fence
can be recovered after five minutes; a claim that crossed it cannot be replayed.
The shop upsert and manual success transition occur in one database function.

A shared per-connection rotation lease sits above those independent daily
allowances. It is acquired before reauthentication and token-fences rotated-jar
persistence plus the storefront attempt. Competing cron/manual/operator work
that loses the lease makes no Riot request. Pre-attempt crash leases recover after five minutes;
attempted crash leases wait for the next UTC day or an exact reconnect.

Manual allowance is keyed by stable Riot PUUID plus store date, not a replaceable
application connection row. The resulting policy is:

- one automatic storefront attempt per connection per UTC store day;
- one manual storefront attempt per Riot PUUID per UTC store day;
- automatic work never consumes manual allowance;
- pre-attempt manual failures can retry; and
- post-attempt failure remains exhausted until 00:00 UTC because a process crash
  cannot prove whether another Riot request would be a duplicate.

## Multi-account audit

The schema and worker already partially supported multiple accounts: the unique
`user_id` constraint had been removed, daily runs were keyed by connection, and
the worker enumerated every row. The UI reduced those rows to a single boolean,
hid the connect form after any account connected, refreshed all accounts through
one user-wide action, and disconnected every row when no ID was supplied.

The revised UI lists every account, validates the selected query parameter
against owned rows, targets refresh/reconnect/disconnect by exact connection ID,
and keeps an obvious add-account path. Credential reconnect rotates the selected
row and preserves its identity; a different non-null PUUID cannot silently
replace it.

The current schema has a user-editable account label, region, and stable PUUID,
but no dedicated Riot game-name/tag-line columns. The UI therefore displays the
label (or a numbered fallback), not an automatically resolved `GameName#Tag`.
Adding those fields and a trusted Riot-profile resolver is a separate forward
migration after the hosted migration ledger is reconciled.

## UI/UX findings

The strongest issues were missing account identity and health context, a store
that mixed every account together, an auto-firing “Check now” control, fixed-size
cards on mobile, low-contrast tertiary text and boundaries, no durable loading
or error surface, and offer cards without weapon, tier, or price. Navigation also
used a second product name (`NIGHT.MARKET/WATCH`), weakening trust and finish.

The implemented slice adds account selection, per-account status and manual
availability, a fluid two/four-column offer grid, price/weapon/tier metadata,
skeleton and error boundaries, larger targets, stronger contrast, restrained
motion, and consistent VAL Checker naming. It is an information-architecture and
quality pass, not a wholesale visual rebrand.

## Design options

### A — Premium Minimal

Charcoal surfaces, generous whitespace, quiet borders, a neutral grotesk, and a
compact top navigation. Accounts use a restrained segmented selector; store
cards prioritize name and status over decoration. It is the most legible and
lowest-risk direction, but can feel less distinctive to gaming users. Effort:
low to medium.

### B — Tactical Gaming

Sharper geometry, condensed display type, denser status telemetry, stronger
section labels, and subtle competitive-game motifs. Accounts resemble a roster
and offers use more explicit rarity/status rails. It has the strongest game
personality but carries the highest risk of visual noise and imitation. Effort:
medium to high.

### C — Modern Collector

Large artwork, restrained gallery framing, fluid offer grids, collection-first
navigation, and an account selector that feels like switching curated shelves.
Metadata remains precise but secondary to the skins. This creates the clearest
product differentiation and makes the daily store the focal point, at the cost
of more image/layout work. Effort: medium.

Recommendation: Modern Collector, using Premium Minimal's restrained navigation,
status surfaces, contrast, and motion. The current implementation is the first
scoped step in that direction.

## Deployment gate

The forward migration is intentionally unapplied. Hosted Vercel logs, hosted
Supabase migration ledger, actual production schema, and live Riot/Cloudflare
behavior were not available in this checkout. Reconcile the known migration
ledger drift and inspect `pg_catalog` before applying any SQL; do not use an
unreviewed `supabase db push`.
