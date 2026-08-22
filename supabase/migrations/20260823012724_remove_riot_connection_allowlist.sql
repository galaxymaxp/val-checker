begin;

alter table public.riot_run_logs
drop constraint riot_run_logs_reason_check;

-- Keep historical rows intact while preventing the retired allowlist reason
-- from being written by any future worker run.
alter table public.riot_run_logs
add constraint riot_run_logs_reason_check check (
  reason is null
  or reason in (
    'ACCOUNT_UNAVAILABLE',
    'ATTEMPT_FENCED',
    'CATALOG_FAILED',
    'DAILY_CLAIM_HELD',
    'DELIVERY_FAILED',
    'LIFECYCLE_STALE',
    'MANUAL_CLAIM_HELD',
    'REAUTH_FAILED',
    'REAUTH_REQUIRED_SKIP',
    'SESSION_UNAVAILABLE',
    'SESSION_LEASE_HELD',
    'STOREFRONT_FAILED',
    'UNEXPECTED'
  )
) not valid;

commit;
