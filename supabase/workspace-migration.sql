-- Run AFTER supabase/setup.sql. Reusable project and content upgrade.
-- Existing progress tasks and collaborators are preserved; re-runnable.
begin;

create table if not exists public.progress_projects (
  id text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.progress_projects (id, name)
values ('lg-u-dna', 'LG U+ 1등 DNA 시상식')
on conflict (id) do nothing;

alter table public.progress_tasks
  add column if not exists project_id text not null default 'lg-u-dna';
create index if not exists progress_tasks_project_idx on public.progress_tasks(project_id);
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'progress_tasks_project_fk'
  ) then
    alter table public.progress_tasks
      add constraint progress_tasks_project_fk
      foreign key (project_id) references public.progress_projects(id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.progress_content (
  id text primary key check (length(id) between 1 and 100),
  project_id text not null references public.progress_projects(id) on delete cascade,
  kind text not null check (kind in ('resource','checklist','feedback','reference','note')),
  title text not null check (length(trim(title)) between 1 and 160),
  url text not null default '',
  body text not null default '',
  category text not null default '',
  completed boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists progress_content_project_idx
  on public.progress_content(project_id);

drop trigger if exists progress_projects_updated_at on public.progress_projects;
create trigger progress_projects_updated_at before update on public.progress_projects
for each row execute function public.progress_touch_updated_at();
drop trigger if exists progress_content_updated_at on public.progress_content;
create trigger progress_content_updated_at before update on public.progress_content
for each row execute function public.progress_touch_updated_at();

alter table public.progress_projects enable row level security;
alter table public.progress_content enable row level security;

-- Viewer role is read-only; owner/editor retain edit access.
alter table public.progress_members
  drop constraint if exists progress_members_role_check;
alter table public.progress_members
  add constraint progress_members_role_check
  check (role in ('owner','editor','viewer'));

drop policy if exists "Members can edit tasks" on public.progress_tasks;
drop policy if exists "Members can edit people" on public.progress_people;
drop policy if exists "Members can view tasks" on public.progress_tasks;
drop policy if exists "Editors can edit tasks" on public.progress_tasks;
drop policy if exists "Members can view people" on public.progress_people;
drop policy if exists "Editors can edit people" on public.progress_people;
drop policy if exists "Members can view projects" on public.progress_projects;
drop policy if exists "Editors can edit projects" on public.progress_projects;
drop policy if exists "Members can view content" on public.progress_content;
drop policy if exists "Editors can edit content" on public.progress_content;

create policy "Members can view tasks" on public.progress_tasks
for select to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()))
);
create policy "Editors can edit tasks" on public.progress_tasks
for all to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
) with check (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
);

create policy "Members can view people" on public.progress_people
for select to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()))
);
create policy "Editors can edit people" on public.progress_people
for all to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
) with check (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
);

create policy "Members can view projects" on public.progress_projects
for select to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()))
);
create policy "Editors can edit projects" on public.progress_projects
for all to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
) with check (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
);

create policy "Members can view content" on public.progress_content
for select to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()))
);
create policy "Editors can edit content" on public.progress_content
for all to authenticated using (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
) with check (
  exists (select 1 from public.progress_members m where m.user_id = (select auth.uid()) and m.role in ('owner','editor'))
);

revoke all on public.progress_projects, public.progress_content from anon;
grant select, insert, update, delete on public.progress_projects, public.progress_content to authenticated;

alter table public.progress_projects replica identity full;
alter table public.progress_content replica identity full;
do $migration$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='progress_projects') then
      alter publication supabase_realtime add table public.progress_projects;
    end if;
    if not exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='progress_content') then
      alter publication supabase_realtime add table public.progress_content;
    end if;
  end if;
end;
$migration$;

commit;
