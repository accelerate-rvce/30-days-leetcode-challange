-- Queue correctness: one logical job per (profile, challenge), and never let a
-- second worker pick up a job that another worker is actively holding.
--
-- The original enqueue function requeued unconditionally on conflict. A student
-- pressing "Check Now" twice (or a stale admin retry) could therefore release a
-- job that an in-flight worker had already locked, so two workers fetched the
-- same LeetCode feed for the same job. Points stayed correct because
-- finalize_verified_completion is idempotent, but the duplicate request wasted
-- LeetCode budget and could race the completion status.
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
    )
    -- A live processing lock belongs to another worker. Requeueing it would
    -- duplicate the LeetCode request; the stale-lock path below only takes the
    -- job back after the same 5 minute window claim_verification_jobs uses.
    and (
      verification_jobs.status <> 'processing'
      or verification_jobs.locked_at is null
      or verification_jobs.locked_at < now() - interval '5 minutes'
    );
end;
$$;

revoke all on function public.enqueue_verification_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_verification_job(uuid, uuid) to service_role;

-- Claim order already uses (available_at, created_at); this keeps the scheduler
-- from scanning finished jobs as the table grows past a cohort.
create index if not exists verification_jobs_pending_claim_idx
  on verification_jobs(available_at, created_at)
  where status in ('queued', 'retry');

notify pgrst, 'reload schema';
