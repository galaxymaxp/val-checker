-- Phase B catalog metadata: content tiers, chroma variants, and the richer
-- weapon/skin/level columns the storefront and browse views render from.
begin;

create table public.content_tiers (
  content_tier_uuid uuid primary key,
  display_name text not null,
  dev_name text not null,
  rank integer not null,
  highlight_color text,
  display_icon text,
  first_seen_at timestamptz not null default now()
);

create table public.skin_chromas (
  chroma_uuid uuid primary key,
  skin_uuid uuid not null references public.skins (skin_uuid),
  ordinal integer not null,
  display_name text not null,
  variant_label text,
  display_icon text,
  full_render text,
  swatch text,
  streamed_video text,
  first_seen_at timestamptz not null default now()
);

create index skin_chromas_skin_uuid_idx on public.skin_chromas (skin_uuid, ordinal);

alter table public.weapons
  add column display_icon text,
  add column default_skin_uuid uuid,
  add column shop_category text,
  add column inventory_label text,
  add column inventory_ordinal integer;

-- content_tier (the raw upstream uuid string) stays for existing readers; the
-- new content_tier_uuid column carries the same value with a real foreign key.
alter table public.skins
  add column theme_uuid uuid,
  add column full_render text,
  add column wallpaper text,
  add column content_tier_uuid uuid references public.content_tiers (content_tier_uuid);

alter table public.skin_levels
  add column display_name text,
  add column level_item text,
  add column display_icon text,
  add column streamed_video text;

create index skins_weapon_uuid_idx on public.skins (weapon_uuid);
create index skins_content_tier_uuid_idx on public.skins (content_tier_uuid);

alter table public.content_tiers enable row level security;
alter table public.skin_chromas enable row level security;

create policy "catalog readable"
on public.content_tiers
for select
to authenticated
using (true);

create policy "catalog readable"
on public.skin_chromas
for select
to authenticated
using (true);

-- Supabase's 2026 Data API change separates grants from RLS. Start from no
-- public access, then grant only the operations each application role needs.
revoke all on table
  public.content_tiers,
  public.skin_chromas
from anon, authenticated;

grant select on table
  public.content_tiers,
  public.skin_chromas
to authenticated;

grant all on table
  public.content_tiers,
  public.skin_chromas
to service_role;

commit;
