begin;

alter table public.watchlist
add column connection_id uuid;

-- The former wishlist was global to the website user. Preserve it on one
-- deterministic account without copying it to sibling Riot accounts.
update public.watchlist as watched
set connection_id = connection.id
from (
  select distinct on (user_id) id, user_id
  from public.riot_connections
  order by user_id, created_at, id
) as connection
where connection.user_id = watched.user_id;

alter table public.riot_connections
add constraint riot_connections_id_user_id_key unique (id, user_id);

alter table public.watchlist
add constraint watchlist_connection_user_key
foreign key (connection_id, user_id)
references public.riot_connections (id, user_id)
on delete cascade;

alter table public.watchlist
drop constraint watchlist_user_id_skin_uuid_key;

alter table public.watchlist
add constraint watchlist_connection_id_skin_uuid_key
unique (connection_id, skin_uuid);

create unique index watchlist_legacy_user_id_skin_uuid_key
on public.watchlist (user_id, skin_uuid)
where connection_id is null;

drop policy "own watchlist" on public.watchlist;

create policy "own watchlist"
on public.watchlist
for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and connection_id is not null
);

comment on column public.watchlist.connection_id is
  'Riot connection whose storefront is matched against this watched skin. Legacy rows without a connection remain readable/deletable but cannot be newly created.';

commit;
