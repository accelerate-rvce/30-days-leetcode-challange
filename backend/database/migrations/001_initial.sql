create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  leetcode_username text,
  academic_year text not null check (academic_year in ('First Year','Second Year','Third Year','Fourth Year')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(), day integer not null unique check (day between 1 and 30),
  title text not null, slug text not null, difficulty text not null check (difficulty in ('Easy','Medium','Hard')),
  topic text not null, points integer not null check (points > 0), published_at timestamptz not null,
  deadline_at timestamptz not null, verification_queued_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists completions (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references profiles(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade, status text not null default 'pending' check (status in ('pending','verified','not_verified','delayed','error')),
  attempted_at timestamptz not null default now(), verified_at timestamptz, submission_at timestamptz, awarded_points integer check (awarded_points in (70, 100)), evidence jsonb, created_at timestamptz not null default now(),
  unique(profile_id, challenge_id)
);

create table if not exists verification_jobs (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references profiles(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade, status text not null default 'queued', attempts integer not null default 0,
  available_at timestamptz not null default now(), locked_at timestamptz, last_error text, created_at timestamptz not null default now(),
  unique(profile_id, challenge_id)
);

create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(), challenge_id uuid references challenges(id) on delete set null,
  severity text not null check (severity in ('warning', 'error')), message text not null,
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create index if not exists completions_challenge_status_idx on completions(challenge_id, status);
create index if not exists verification_jobs_available_idx on verification_jobs(status, available_at);
create index if not exists admin_alerts_open_idx on admin_alerts(resolved_at, created_at desc);

alter table profiles enable row level security;
alter table challenges enable row level security;
alter table completions enable row level security;
alter table verification_jobs enable row level security;
alter table admin_alerts enable row level security;

create policy "public can read challenges" on challenges for select using (true);
create policy "users read own profile" on profiles for select using (auth.uid() = id);
create policy "users read own completions" on completions for select using (auth.uid() = profile_id);
