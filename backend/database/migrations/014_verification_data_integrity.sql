-- Data-integrity follow-up for the verification pipeline.
--
-- 1. Before terminal not-found handling was added, a failed verification job
--    left its completion in `pending`. Those rows look like an open check to
--    students and inflate the admin "awaiting / failed" count forever. Mark
--    only completions whose job already reached the terminal failed state.
-- 2. LeetCode handles are checked for duplicates in the API, but that check is
--    racy. A partial unique index makes the database enforce one handle per
--    profile, normalized the same way the API compares them.

update public.completions c
set status = 'not_verified'
from public.verification_jobs j
where j.profile_id = c.profile_id
  and j.challenge_id = c.challenge_id
  and j.status = 'failed'
  and c.status = 'pending';

create unique index if not exists profiles_leetcode_username_unique_idx
on public.profiles (lower(btrim(leetcode_username)))
where leetcode_username is not null
  and btrim(leetcode_username) <> '';

notify pgrst, 'reload schema';
