create index riot_cloud_connection_sessions_target_connection_id_idx
  on public.riot_cloud_connection_sessions (target_connection_id)
  where target_connection_id is not null;
