begin;
create table if not exists public.styleframes (
  id uuid primary key default gen_random_uuid(),
  project text not null, scene smallint not null check(scene between 1 and 10),
  name text not null check(length(name) between 1 and 255),
  image text not null check(length(image) <= 11200000 and image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'),
  created_at timestamptz not null default now()
);
create index if not exists styleframes_scene on public.styleframes(project,scene,created_at);
create table if not exists public.styleframe_comments (
  id uuid primary key default gen_random_uuid(),
  frame_id uuid not null references public.styleframes(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists styleframe_comments_frame on public.styleframe_comments(frame_id,created_at);
do $$
declare t text;
begin
  foreach t in array array['styleframes','styleframe_comments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists member_read on public.%I',t);
    execute format('create policy member_read on public.%I for select to authenticated using (exists(select 1 from public.progress_members where user_id=auth.uid()))',t);
    execute format('drop policy if exists editor_add on public.%I',t);
    execute format('create policy editor_add on public.%I for insert to authenticated with check (exists(select 1 from public.progress_members where user_id=auth.uid() and role in (''owner'',''editor'')))',t);
  end loop;
end $$;
grant insert(project,scene,name,image) on public.styleframes to authenticated;
grant insert(frame_id,body) on public.styleframe_comments to authenticated;
notify pgrst,'reload schema';
commit;
