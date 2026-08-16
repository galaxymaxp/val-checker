-- Retire the legacy skins.content_tier text column. Rows synced before the
-- tier backfill kept the tier uuid there; move it into content_tier_uuid and
-- drop the old column so content_tier_uuid is the single source of truth.
begin;

update public.skins
  set content_tier_uuid = content_tier::uuid
  where content_tier_uuid is null and content_tier is not null;

alter table public.skins drop column content_tier;

commit;
