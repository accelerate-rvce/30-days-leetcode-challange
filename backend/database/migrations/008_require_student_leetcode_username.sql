-- Students must have a LeetCode handle before their profile can be created.
-- A trigger (rather than a CHECK constraint) is used so existing incomplete
-- rows can still receive unrelated updates such as the email sync.
alter table profiles drop constraint if exists profiles_student_leetcode_username_required;

create or replace function require_student_leetcode_username()
returns trigger
language plpgsql
as $$
begin
  if new.role <> 'admin'
     and (new.leetcode_username is null or btrim(new.leetcode_username) = '') then
    raise exception 'student LeetCode username is required'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_student_leetcode_username on profiles;
create trigger profiles_require_student_leetcode_username
  before insert or update of leetcode_username on profiles
  for each row execute function require_student_leetcode_username();
