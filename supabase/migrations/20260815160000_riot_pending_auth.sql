begin;

-- Credential connect (roadmap Version 2.4) is two steps whenever Riot answers
-- with an MFA challenge: submit credentials, then submit the emailed or
-- authenticator code. The pending-authentication cookie issued by step one has
-- to survive between two separate requests, and serverless instances share no
-- memory, so it is held here rather than in process state.
--
-- What this table holds is NOT an authenticated session: on its own the pending
-- cookie cannot reach an account. It is still session material, so it is
-- encrypted with the same AES-256-GCM keyring and user_id AAD as riot_connections.
--
-- What this table never holds is the password. The credential is transit-only
-- and is discarded once step one returns.
create table public.riot_pending_auth (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  encrypted_jar       bytea not null,
  jar_nonce           bytea not null,
  session_key_version int not null default 1,
  -- Carried across the two steps so the finished connection is saved with the
  -- region and label the operator chose on the first screen.
  region              text,
  label               text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  -- One challenge in flight per login. A fresh credential submit replaces any
  -- earlier pending row rather than accumulating them.
  unique (user_id)
);

comment on table public.riot_pending_auth is
  'Short-lived encrypted pending-authentication cookie linking the credential step to the MFA code step. Never contains a password.';

create index riot_pending_auth_expires_at_idx
  on public.riot_pending_auth (expires_at);

-- RLS enabled with no policies: service role only, matching riot_connections.
alter table public.riot_pending_auth enable row level security;

create or replace function public.purge_expired_riot_pending_auth()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.riot_pending_auth
  where expires_at <= now();

  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke all on function public.purge_expired_riot_pending_auth()
from public, anon, authenticated;
grant execute on function public.purge_expired_riot_pending_auth()
to service_role;

comment on function public.purge_expired_riot_pending_auth() is
  'Deletes pending-authentication rows past their expiry. Called opportunistically on the connect path so no scheduled job is required.';

commit;
