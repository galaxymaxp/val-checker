-- Build Spec section 4, task 1.3: schema and RLS are deliberately atomic.
begin;

create type public.auth_status as enum (
  'CONNECTED',
  'REAUTH_REQUIRED',
  'RIOT_UNAVAILABLE',
  'RATE_LIMITED',
  'NETWORK_BLOCKED'
);

create table public.weapons (
  weapon_uuid uuid primary key,
  display_name text not null,
  category text
);

create table public.skins (
  skin_uuid uuid primary key,
  display_name text not null,
  weapon_uuid uuid references public.weapons (weapon_uuid),
  content_tier text,
  display_icon text,
  first_seen_at timestamptz not null default now()
);

create table public.skin_levels (
  level_uuid uuid primary key,
  skin_uuid uuid not null references public.skins (skin_uuid),
  ordinal integer,
  first_seen_at timestamptz not null default now()
);

create index skin_levels_skin_uuid_idx on public.skin_levels (skin_uuid);

create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skin_uuid uuid not null references public.skins (skin_uuid),
  created_at timestamptz not null default now(),
  unique (user_id, skin_uuid)
);

create table public.riot_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  puuid text,
  region text,
  shard text,
  encrypted_jar bytea not null,
  jar_nonce bytea not null,
  session_key_version integer not null default 1,
  auth_status public.auth_status not null default 'CONNECTED',
  consecutive_failures integer not null default 0,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table public.shop_checks (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.riot_connections (id) on delete cascade,
  checked_at timestamptz not null default now(),
  shop_hash text not null,
  offer_skin_uuids uuid[] not null default '{}'::uuid[],
  total_cost integer,
  expires_at timestamptz,
  night_market jsonb,
  bundle jsonb
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skin_uuid uuid not null references public.skins (skin_uuid),
  shop_check_id uuid not null references public.shop_checks (id) on delete cascade,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  unique (user_id, skin_uuid, shop_check_id)
);

alter table public.weapons enable row level security;
alter table public.skins enable row level security;
alter table public.skin_levels enable row level security;

create policy "catalog readable"
on public.weapons
for select
to authenticated
using (true);

create policy "catalog readable"
on public.skins
for select
to authenticated
using (true);

create policy "catalog readable"
on public.skin_levels
for select
to authenticated
using (true);

alter table public.watchlist enable row level security;

create policy "own watchlist"
on public.watchlist
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter table public.notifications enable row level security;

create policy "own notifications read"
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Build Spec section 4: these operational tables remain service-role only.
alter table public.riot_connections enable row level security;
alter table public.shop_checks enable row level security;

-- Supabase's 2026 Data API change separates grants from RLS. Start from no
-- public access, then grant only the operations each application role needs.
revoke all on table
  public.weapons,
  public.skins,
  public.skin_levels,
  public.watchlist,
  public.riot_connections,
  public.shop_checks,
  public.notifications
from anon, authenticated;

grant select on table
  public.weapons,
  public.skins,
  public.skin_levels,
  public.notifications
to authenticated;

grant select, insert, update, delete on table public.watchlist to authenticated;

grant all on table
  public.weapons,
  public.skins,
  public.skin_levels,
  public.watchlist,
  public.riot_connections,
  public.shop_checks,
  public.notifications
to service_role;

grant usage on type public.auth_status to service_role;

commit;
