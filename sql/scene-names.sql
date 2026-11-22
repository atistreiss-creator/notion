begin;
create table if not exists public.styleframe_scene_names (
  project text not null,
  scene smallint not null check (scene between 1 and 10),
  name text not null check (length(name) <= 80),
  primary key(project,scene)
);
alter table public.styleframe_scene_names enable row level security;
revoke all on public.styleframe_scene_names from public, anon, authenticated;
grant select, insert, update on public.styleframe_scene_names to authenticated;
drop policy if exists scene_read on public.styleframe_scene_names;
create policy scene_read on public.styleframe_scene_names for select to authenticated
using (exists(select 1 from public.progress_members where user_id=auth.uid()));
drop policy if exists scene_write on public.styleframe_scene_names;
create policy scene_write on public.styleframe_scene_names for all to authenticated
using (exists(select 1 from public.progress_members where user_id=auth.uid() and role in ('owner','editor')))
with check (exists(select 1 from public.progress_members where user_id=auth.uid() and role in ('owner','editor')));
notify pgrst,'reload schema';
commit;
