-- Live challenge updates.
--
-- The dashboard no longer polls for a new question. It subscribes to
-- `challenges` (public read policy already covers every role) and refreshes
-- when an admin publishes or edits one. Together with the client's scheduled
-- refresh at the next `published_at`, this is what makes a midnight question
-- appear in open tabs without a reload.
--
-- Idempotent: re-running is safe, and a plain Postgres without the Supabase
-- Realtime publication is left untouched.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping challenge Realtime setup';
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenges'
  ) then
    alter publication supabase_realtime add table public.challenges;
  end if;
end $$;

-- The dashboard asks for the lowest day inside its window and for the next
-- scheduled publish. Both are cheap today, and this index keeps them cheap as
-- the cohort history grows.
create index if not exists challenges_publish_window_idx
  on challenges(published_at, deadline_at, day);

notify pgrst, 'reload schema';
