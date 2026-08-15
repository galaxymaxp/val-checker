begin;

-- Operational visibility for the dogfood period: one row per user per daily
-- worker pass, readable without trawling hosting logs.
create table public.riot_run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  run_id uuid,
  store_date date,
  ran_at timestamptz not null default now(),
  outcome text not null,
  reason text,
  classification text,
  matches_found integer not null default 0,
  emails_sent integer not null default 0,
  constraint riot_run_logs_outcome_check check (
    outcome in ('checked', 'failed', 'skipped')
  ),
  constraint riot_run_logs_classification_check check (
    classification is null
    or classification in ('OK', 'DEAD', 'UNKNOWN', 'ERROR')
  ),
  -- Closed vocabulary on purpose. No free-text error string is ever written
  -- here, so a stray message can never carry cookies, tokens, or a PUUID.
  constraint riot_run_logs_reason_check check (
    reason is null
    or reason in (
      'ATTEMPT_FENCED',
      'DAILY_CLAIM_HELD',
      'DELIVERY_FAILED',
      'LIFECYCLE_STALE',
      'NOT_ALLOWLISTED',
      'REAUTH_FAILED',
      'REAUTH_REQUIRED_SKIP',
      'SESSION_UNAVAILABLE',
      'STOREFRONT_FAILED',
      'UNEXPECTED'
    )
  ),
  constraint riot_run_logs_counts_check check (
    matches_found >= 0 and emails_sent >= 0
  )
);

comment on table public.riot_run_logs is
  'Service-only daily worker run log. Connection identifiers are intentional snapshots, not foreign keys, so the log survives disconnect.';

comment on column public.riot_run_logs.reason is
  'Closed vocabulary describing the skip or failure. Never a raw error message.';

create index riot_run_logs_user_ran_at_idx
  on public.riot_run_logs (user_id, ran_at desc);

alter table public.riot_run_logs enable row level security;

revoke all on table public.riot_run_logs
from public, anon, authenticated, service_role;
grant select, insert on table public.riot_run_logs to service_role;

commit;
