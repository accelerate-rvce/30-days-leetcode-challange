create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_profile_id uuid not null references profiles(id) on delete cascade,
  action text not null,
  target_profile_id uuid references profiles(id) on delete set null,
  target_challenge_id uuid references challenges(id) on delete set null,
  status text not null check (status in ('success', 'error', 'info')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_target_idx on admin_audit_logs(target_profile_id, target_challenge_id);
alter table admin_audit_logs enable row level security;

alter table challenges drop constraint if exists challenges_day_key;
alter table challenges add constraint challenges_day_key unique(day) deferrable initially deferred;

create or replace function admin_reorder_challenges(p_order jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  item jsonb;
  position integer := 0;
begin
  if jsonb_array_length(p_order) = 0 or jsonb_array_length(p_order) > 30 or jsonb_array_length(p_order) <> (select count(*) from challenges) then
    raise exception 'invalid_challenge_order';
  end if;
  if (select count(distinct (value->>'id')) from jsonb_array_elements(p_order)) <> jsonb_array_length(p_order) then
    raise exception 'duplicate_challenge_order';
  end if;
  for item in select * from jsonb_array_elements(p_order) loop
    position := position + 1;
    update challenges set day = position where id = (item->>'id')::uuid;
    if not found then raise exception 'challenge_not_found'; end if;
  end loop;
end;
$$;
