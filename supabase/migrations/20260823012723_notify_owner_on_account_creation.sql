begin;

create table public.account_creation_notifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  signup_at timestamptz not null,
  delivery_attempted_at timestamptz,
  emailed_at timestamptz
);

alter table public.account_creation_notifications enable row level security;

revoke all on table public.account_creation_notifications
from public, anon, authenticated;

grant select, insert, update on table public.account_creation_notifications
to service_role;

create function public.queue_account_creation_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_creation_notifications (user_id, signup_at)
  values (new.id, new.created_at)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_account_creation_notification()
from public, anon, authenticated;

create trigger queue_account_creation_notification
after insert on auth.users
for each row execute function public.queue_account_creation_notification();

create function public.claim_account_creation_notification(p_user_id uuid)
returns table (signup_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  update public.account_creation_notifications as notification
  set delivery_attempted_at = now()
  where notification.user_id = p_user_id
    and notification.delivery_attempted_at is null
  returning notification.signup_at;
$$;

revoke all on function public.claim_account_creation_notification(uuid)
from public, anon, authenticated;

grant execute on function public.claim_account_creation_notification(uuid)
to service_role;

comment on table public.account_creation_notifications is
  'Service-only outbox ensuring the owner notification is attempted once per new Auth user.';

comment on function public.claim_account_creation_notification(uuid) is
  'Atomically claims the sole owner-email attempt for a newly created Auth user.';

commit;
