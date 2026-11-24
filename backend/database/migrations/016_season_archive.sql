-- Season archive mode + post-season feedback.
--
-- season_mode controls whether the live sprint is still scoring:
--   'auto'  -> archived automatically once Day 30's deadline has passed
--   'ended' -> archived now, regardless of the schedule
--   'live'  -> force scoring back on (useful for corrections or a new season)
-- The backend computes the effective season_ended flag, so no extra column is
-- needed and the existing site_settings table keeps working.
insert into site_settings(key, value) values
  ('season_mode', '"auto"'),
  ('season_label', '"Season 01"')
on conflict (key) do nothing;

create table if not exists season_feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  name text,
  email text,
  season text not null default 'Season 01',
  want_season_two text not null default 'maybe' check (want_season_two in ('yes', 'maybe', 'no')),
  rating integer check (rating between 1 and 5),
  liked text,
  improvements text,
  suggestions text,
  created_at timestamptz not null default now()
);

create index if not exists season_feedback_created_idx on season_feedback (created_at desc);
create index if not exists season_feedback_profile_idx on season_feedback (profile_id);

alter table season_feedback enable row level security;

-- Feedback is written and read through the service-role backend only.
-- Enabling RLS with no anon/authenticated policies keeps the table private
-- from the browser while the API still has full access.
revoke all on table public.season_feedback from anon, authenticated;

notify pgrst, 'reload schema';
