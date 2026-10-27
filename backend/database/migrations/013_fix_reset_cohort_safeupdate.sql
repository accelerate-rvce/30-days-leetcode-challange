-- Supersedes the original reset_cohort function for projects that already
-- applied migration 009. Supabase projects commonly run pg-safeupdate, which
-- rejects DELETE/UPDATE without a WHERE clause even inside a security-definer
-- function. The original reset therefore failed with:
--   DELETE requires a WHERE clause
-- This version keeps the same contract but gives every bulk statement an
-- explicit WHERE true so the reset can complete.
create or replace function public.reset_cohort()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_one challenges%rowtype;
  v_new_start timestamptz := now();
  v_deadline timestamptz;
  v_delta interval;
  v_completions integer := 0;
  v_jobs integer := 0;
  v_alerts integer := 0;
  v_profiles integer := 0;
  v_challenges integer := 0;
begin
  select * into v_day_one
  from challenges
  where day = 1;

  if not found then
    raise exception 'day_one_missing';
  end if;

  v_deadline := v_new_start + interval '24 hours';
  v_delta := v_new_start - v_day_one.published_at;

  delete from verification_jobs where true;
  get diagnostics v_jobs = row_count;

  delete from completions where true;
  get diagnostics v_completions = row_count;

  delete from admin_alerts where true;
  get diagnostics v_alerts = row_count;

  -- Profiles, LeetCode handles, emails, years, and auth accounts stay intact.
  update profiles
  set points = 0,
      streak = 0,
      longest_streak = 0
  where true;
  get diagnostics v_profiles = row_count;

  -- Never delete challenge rows: the cohort keeps its existing question bank.
  -- Keep the relative spacing of any questions already scheduled, then pin
  -- Day 1 to a clean 24-hour window starting now.
  update challenges
  set published_at = published_at + v_delta,
      deadline_at = deadline_at + v_delta,
      verification_queued_at = null
  where true;
  get diagnostics v_challenges = row_count;

  update challenges
  set published_at = v_new_start,
      deadline_at = v_deadline,
      verification_queued_at = null
  where day = 1;

  insert into site_settings(key, value, updated_at)
  values
    ('waitlist_enabled', 'false'::jsonb, v_new_start),
    ('sprint_started_at', to_jsonb(v_new_start), v_new_start),
    ('launch_at', to_jsonb(v_new_start), v_new_start)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'startedAt', v_new_start,
    'deadlineAt', v_deadline,
    'day', 1,
    'challengeId', v_day_one.id,
    'completionsDeleted', v_completions,
    'jobsDeleted', v_jobs,
    'alertsDeleted', v_alerts,
    'profilesReset', v_profiles,
    'challengesShifted', v_challenges,
    'challengesKept', v_challenges
  );
end;
$$;

revoke all on function public.reset_cohort() from public, anon, authenticated;
grant execute on function public.reset_cohort() to service_role;

notify pgrst, 'reload schema';
