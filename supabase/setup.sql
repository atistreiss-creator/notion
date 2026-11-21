-- LG U+ production progress board / Supabase setup (run ONCE in SQL Editor)
-- Access is restricted by membership to invited Supabase Auth user IDs.
-- The public GitHub site MUST NOT contain a service_role key.
begin;

create table if not exists public.progress_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now()
);
create table if not exists public.progress_people (
  name text primary key check (length(trim(name)) between 1 and 60),
  color text not null default 'gray'
    check (color in ('blue','yellow','purple','teal','pink','gray')),
  updated_at timestamptz not null default now()
);
create table if not exists public.progress_tasks (
  id text primary key check (length(id) between 1 and 100),
  name text not null check (length(trim(name)) between 1 and 100),
  assignee text not null default '',
  status text not null default '예정'
    check (status in ('예정','진행 중','검수 중','완료')),
  progress integer not null default 0 check (progress between 0 and 100),
  updated_at timestamptz not null default now()
);

create or replace function public.progress_touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists progress_tasks_updated_at on public.progress_tasks;
create trigger progress_tasks_updated_at before update on public.progress_tasks
for each row execute function public.progress_touch_updated_at();

drop trigger if exists progress_people_updated_at on public.progress_people;
create trigger progress_people_updated_at before update on public.progress_people
for each row execute function public.progress_touch_updated_at();

alter table public.progress_members enable row level security;
alter table public.progress_tasks enable row level security;
alter table public.progress_people enable row level security;

drop policy if exists "Members can read own membership" on public.progress_members;
create policy "Members can read own membership" on public.progress_members
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Members can edit tasks" on public.progress_tasks;
create policy "Members can edit tasks" on public.progress_tasks
for all to authenticated
using (exists (select 1 from public.progress_members m where m.user_id = (select auth.uid())))
with check (exists (select 1 from public.progress_members m where m.user_id = (select auth.uid())));

drop policy if exists "Members can edit people" on public.progress_people;
create policy "Members can edit people" on public.progress_people
for all to authenticated
using (exists (select 1 from public.progress_members m where m.user_id = (select auth.uid())))
with check (exists (select 1 from public.progress_members m where m.user_id = (select auth.uid())));

revoke all on public.progress_members, public.progress_people, public.progress_tasks from anon;
grant select on public.progress_members to authenticated;
grant select, insert, update, delete on public.progress_people, public.progress_tasks to authenticated;

insert into public.progress_people(name, color)
values ('정민수', 'blue'), ('김소영', 'yellow')
on conflict (name) do nothing;

alter table public.progress_people replica identity full;
alter table public.progress_tasks replica identity full;

do $body$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'progress_tasks'
    ) then
      alter publication supabase_realtime add table public.progress_tasks;
    end if;
    if not exists(
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'progress_people'
    ) then
      alter publication supabase_realtime add table public.progress_people;
    end if;
  end if;
end;
$body$;

commit;

-- AFTER inviting the two people via Authentication > Users,
-- assign each user to the workspace. Replace example emails in YOUR
-- PRIVATE SQL editor only. Do not commit real emails or secrets.
-- insert into public.progress_members(user_id, role)
-- select id, 'editor' from auth.users
-- where lower(email) in (lower('designer1@example.com'), lower('designer2@example.com'))
-- on conflict(user_id) do nothing;
