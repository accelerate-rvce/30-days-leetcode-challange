-- Students must have a LeetCode handle before their profile can be created or
-- updated. Use NOT VALID so pre-existing incomplete signups remain visible for
-- review/cleanup instead of making the migration fail.
alter table profiles drop constraint if exists profiles_student_leetcode_username_required;
alter table profiles
  add constraint profiles_student_leetcode_username_required
  check (
    role = 'admin'
    or (leetcode_username is not null and btrim(leetcode_username) <> '')
  )
  not valid;
