-- Riot IDs so accounts can be shown as PlayerOne#NA1 instead of a
-- user-editable label or a numbered fallback. Riot returns the game name and
-- tag line from the same /userinfo response that already yields the PUUID, so
-- resolving them costs no additional request.
--
-- These are display values, not identity. The PUUID remains the only thing
-- keyed on: players may rename, and two accounts can hold the same game name
-- at different points in time, so nothing unique is asserted here.
begin;

alter table public.riot_connections
add column game_name text,
add column tag_line text,
-- A Riot ID is a pair. Half of one is never displayable, so refuse to store it.
add constraint riot_connections_riot_id_pair_check check (
  (game_name is null and tag_line is null)
  or (game_name is not null and tag_line is not null)
),
-- Bound length at the database edge too. These strings come from an external
-- service and are rendered in the dashboard, so the column should not be a
-- place where unbounded attacker-influenced text can accumulate.
add constraint riot_connections_game_name_length_check check (
  game_name is null or char_length(game_name) between 1 and 32
),
add constraint riot_connections_tag_line_length_check check (
  tag_line is null or char_length(tag_line) between 1 and 8
);

comment on column public.riot_connections.game_name is
  'Riot display name resolved from /userinfo. Display only; never an identity key.';

comment on column public.riot_connections.tag_line is
  'Riot tag line without the leading #. Display only; always set together with game_name.';

commit;
