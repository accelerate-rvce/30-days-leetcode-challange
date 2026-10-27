-- Return solved counts in one grouped query.
--
-- PostgREST caps an unbounded select at max-rows (1,000 by default). The
-- leaderboard previously downloaded every verified completion row to count
-- solves per student, so the solved column and "verified solutions" metric
-- silently undercounted once the cohort passed 1,000 verified completions.
create or replace function public.leaderboard_verified_counts()
returns table (profile_id uuid, solved bigint)
language sql
security definer
set search_path = public
as $$
  select c.profile_id, count(*)::bigint as solved
  from completions c
  where c.status = 'verified'
  group by c.profile_id;
$$;

revoke all on function public.leaderboard_verified_counts() from public, anon, authenticated;
grant execute on function public.leaderboard_verified_counts() to service_role;

notify pgrst, 'reload schema';
