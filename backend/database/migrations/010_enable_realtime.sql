-- Instant UI updates.
--
-- The verification worker writes the result of a check to `completions`. The
-- browser subscribes to that table with Supabase Realtime instead of polling
-- /api/progress, so the "Check Now" button resolves as soon as the worker
-- commits the verdict.
--
-- Idempotent: re-running is safe, and a database without the Supabase Realtime
-- publication (a plain Postgres for local work) is left untouched.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping Realtime setup';
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'completions'
  ) then
    alter publication supabase_realtime add table public.completions;
  end if;
end $$;
