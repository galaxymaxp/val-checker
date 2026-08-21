begin;

-- Deep-link handshake for the Electron desktop capture (roadmap Version 2.4).
-- The browser (signed into Supabase) mints a one-time token and launches the
-- desktop app via valchecker://capture?token=...; the desktop app captures the
-- Riot cookie jar and POSTs { token, jar } back. The token is the only proof of
-- which user the jar belongs to, so it is a bearer credential:
--
--   * Only a SHA-256 hash is stored. The raw value exists in the deep link and
--     in the desktop app's POST body, never in this table or in any log.
--   * Single use: consumption is one conditional UPDATE that claims the row
--     only while consumed_at is null and expires_at is in the future.
--   * Short-lived: rows expire five minutes after minting.
create table public.desktop_capture_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

comment on table public.desktop_capture_tokens is
  'One-time desktop capture hand-off tokens, stored as SHA-256 hashes. Never contains the raw token or any session material.';

create index desktop_capture_tokens_user_id_idx
  on public.desktop_capture_tokens (user_id);

-- RLS enabled with no policies: service role only, matching riot_connections.
alter table public.desktop_capture_tokens enable row level security;

revoke all on table public.desktop_capture_tokens from anon, authenticated;

grant all on table public.desktop_capture_tokens to service_role;

create or replace function public.purge_expired_desktop_capture_tokens()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.desktop_capture_tokens
  where expires_at <= now();

  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke all on function public.purge_expired_desktop_capture_tokens()
from public, anon, authenticated;
grant execute on function public.purge_expired_desktop_capture_tokens()
to service_role;

comment on function public.purge_expired_desktop_capture_tokens() is
  'Deletes capture tokens past their expiry. Called opportunistically on the mint path so no scheduled job is required.';

commit;
