alter table profiles add column if not exists role text not null default 'student';
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('student', 'admin'));

create index if not exists profiles_role_idx on profiles(role);
