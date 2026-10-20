create table if not exists site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

-- Waitlist gate: when waitlist_enabled is true, non-admin users can
-- register (sign in + save profile) but cannot see challenges, attempt
-- questions, or trigger verification. Admins always bypass the gate.
insert into site_settings(key, value) values
  ('waitlist_enabled', 'true'),
  ('waitlist_message', '"Day 1 drops soon. Your dashboard unlocks automatically when the cohort launches."')
on conflict (key) do nothing;
