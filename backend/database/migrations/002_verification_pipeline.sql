alter table profiles add column if not exists points integer not null default 0;
alter table profiles add column if not exists streak integer not null default 0;
alter table profiles add column if not exists longest_streak integer not null default 0;
alter table completions add column if not exists leetcode_submission_id text;
alter table completions add column if not exists awarded_points integer check (awarded_points in (70, 100));

create index if not exists completions_pending_profile_idx on completions(profile_id, status);
create index if not exists verification_jobs_due_idx on verification_jobs(status, available_at, created_at);

create or replace function enqueue_verification_job(p_profile_id uuid, p_challenge_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from completions
    where profile_id = p_profile_id and challenge_id = p_challenge_id and status = 'pending'
  ) then return; end if;

  insert into verification_jobs(profile_id, challenge_id, status, attempts, available_at, locked_at, last_error)
  values (p_profile_id, p_challenge_id, 'queued', 0, now(), null, null)
  on conflict (profile_id, challenge_id) do update
    set status = 'queued', available_at = now(), locked_at = null, last_error = null
    where exists (
      select 1 from completions
      where profile_id = p_profile_id and challenge_id = p_challenge_id and status = 'pending'
    );
end;
$$;

create or replace function enqueue_due_verification_jobs()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into verification_jobs(profile_id, challenge_id, status, attempts, available_at)
  select c.profile_id, c.challenge_id, 'queued', 0, now()
  from completions c
  join challenges ch on ch.id = c.challenge_id
  where c.status = 'pending' and ch.deadline_at <= now()
  on conflict (profile_id, challenge_id) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function claim_verification_jobs(p_limit integer default 50, p_lock_seconds integer default 300)
returns table (
  id uuid, profile_id uuid, challenge_id uuid, leetcode_username text, slug text,
  published_at timestamptz, deadline_at timestamptz, attempts integer
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select v.id
    from verification_jobs v
    where (v.status in ('queued', 'retry') and v.available_at <= now())
       or (v.status = 'processing' and v.locked_at < now() - make_interval(secs => p_lock_seconds))
    order by v.available_at, v.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update verification_jobs v
    set status = 'processing', attempts = v.attempts + 1, locked_at = now()
    from candidates c
    where v.id = c.id
    returning v.*
  )
  select c.id, c.profile_id, c.challenge_id, p.leetcode_username, ch.slug,
         ch.published_at, ch.deadline_at, c.attempts
  from claimed c
  join profiles p on p.id = c.profile_id
  join challenges ch on ch.id = c.challenge_id;
end;
$$;

create or replace function finalize_verified_completion(
  p_job_id uuid, p_profile_id uuid, p_challenge_id uuid, p_submission_id text,
  p_submission_at timestamptz, p_awarded_points integer, p_evidence jsonb
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  inserted boolean := false;
begin
  if p_awarded_points not in (70, 100) then raise exception 'invalid_awarded_points'; end if;

  update completions
  set status = 'verified', verified_at = coalesce(verified_at, now()),
      submission_at = coalesce(submission_at, p_submission_at),
      leetcode_submission_id = coalesce(leetcode_submission_id, p_submission_id),
      awarded_points = coalesce(awarded_points, p_awarded_points), evidence = coalesce(evidence, p_evidence)
  where profile_id = p_profile_id and challenge_id = p_challenge_id and status <> 'verified';

  if found then
    update profiles set points = points + p_awarded_points where id = p_profile_id;
    inserted := true;
  end if;

  update verification_jobs set status = 'complete', locked_at = null, last_error = null where id = p_job_id;
  return inserted;
end;
$$;
