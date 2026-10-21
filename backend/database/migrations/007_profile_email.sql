-- Mirror the Supabase auth email onto profiles.
--
-- Emails already live in auth.users because sign-in is Google OAuth. Keeping a
-- copy on profiles lets admin views and exports include them without calling
-- the Auth admin API, and without changing any sign-in or profile-write code.

alter table profiles add column if not exists email text;

-- Existing registrations: profiles.id is already a foreign key to auth.users(id),
-- so this fills every past signup in one pass.
update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id
  and u.email is not null
  and p.email is distinct from lower(u.email);

create index if not exists profiles_email_idx on profiles (email);

-- New registrations: the API creates the profile after the auth user exists, so
-- derive the email here instead of asking every caller to pass it. This also
-- keeps the copy correct whenever a profile is updated.
create or replace function public.set_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  new.email := lower((select u.email from auth.users u where u.id = new.id));
  return new;
end;
$$;

drop trigger if exists profiles_set_email on public.profiles;
create trigger profiles_set_email
  before insert or update on public.profiles
  for each row execute function public.set_profile_email();

-- Keep the copy fresh if a student changes their Google account email.
create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.profiles
  set email = lower(new.email)
  where id = new.id
    and email is distinct from lower(new.email);
  return new;
end;
$$;

drop trigger if exists auth_user_email_sync on auth.users;
create trigger auth_user_email_sync
  after update of email on auth.users
  for each row execute function public.sync_profile_email_from_auth();

-- Ask PostgREST to pick up the new column immediately so the admin analytics
-- query works as soon as the migration finishes.
notify pgrst, 'reload schema';
