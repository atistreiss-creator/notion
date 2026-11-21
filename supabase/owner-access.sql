-- Run after the board schema. Bootstrap exactly one verified owner in the SQL editor.
-- Set the owner's user_id from Authentication > Users; never infer ownership from first login.
begin;
alter table public.progress_members drop constraint if exists progress_members_role_check;
alter table public.progress_members add constraint progress_members_role_check check(role in ('owner','viewer','editor'));
create unique index if not exists progress_one_owner on public.progress_members(role) where role='owner';
revoke insert,update,delete,truncate on public.progress_members from public,anon,authenticated;
do $$
declare tbl text; op text; pred text := 'exists (select 1 from public.progress_members m where m.user_id = auth.uid() and m.role in (''owner'',''editor''))';
begin
 foreach tbl in array array['progress_tasks','progress_people','progress_content','progress_projects'] loop
   if to_regclass('public.' || tbl) is null then continue; end if;
   execute format('alter table public.%I enable row level security',tbl);
   foreach op in array array['insert','update','delete'] loop
     execute format('drop policy if exists %I on public.%I','editor_required_'||op,tbl);
     execute format('create policy %I on public.%I as restrictive for %s to public %s %s','editor_required_'||op,tbl,op,
       case when op <> 'insert' then 'using ('||pred||')' else '' end,
       case when op <> 'delete' then 'with check ('||pred||')' else '' end);
   end loop;
 end loop;
end $$;
create or replace function public.progress_set_access(target_email text, access_role text)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not public.progress_is_designated_owner() or not exists(select 1 from public.progress_members where user_id=auth.uid() and role='owner') then raise exception '관리자만 변경할 수 있습니다.'; end if;
 if access_role is null or access_role not in ('editor','viewer') then raise exception '허용되지 않는 권한입니다.'; end if;
 select id into strict target from auth.users where lower(email)=lower(trim(target_email)) and email_confirmed_at is not null;
 insert into public.progress_members as m(user_id,role) values(target,access_role)
 on conflict(user_id) do update set role=excluded.role where m.role <> 'owner';
 if not found then raise exception '관리자 권한은 변경할 수 없습니다.'; end if;
exception when no_data_found then raise exception '먼저 해당 이메일로 로그인하고 인증을 완료해 주세요.';
end $$;
revoke all on function public.progress_set_access(text,text) from public,anon;
grant execute on function public.progress_set_access(text,text) to authenticated;
-- Bind administrative functions to the verified owner, including after an email change.
create or replace function public.progress_is_designated_owner() returns boolean
language sql stable security definer set search_path='' as $owner$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
 and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(lower(email),'UTF8')),'hex')='f0feb7997eb349986eefe36b3048ec6111145eb42b68cbcc87322709c8a11cf1')
$owner$;
revoke all on function public.progress_is_designated_owner() from public,anon;
grant execute on function public.progress_is_designated_owner() to authenticated;
create or replace function public.progress_claim_owner() returns boolean
language plpgsql security definer set search_path='' as $owner$
begin
 if not public.progress_is_designated_owner() then return false; end if;
 insert into public.progress_members(user_id,role) values(auth.uid(),'owner')
 on conflict(user_id) do update set role='owner';
 return true;
end $owner$;
revoke all on function public.progress_claim_owner() from public,anon;
grant execute on function public.progress_claim_owner() to authenticated;
create table if not exists public.progress_layout(project_id text not null, group_name text not null
 check(group_name in ('tasks','sections','resources')), positions jsonb not null check(jsonb_typeof(positions)='array' and jsonb_array_length(positions)<=100),
 primary key(project_id,group_name));
alter table public.progress_layout enable row level security;
revoke all on public.progress_layout from public,anon,authenticated;
grant select,insert,update on public.progress_layout to authenticated;
drop policy if exists layout_read on public.progress_layout;
create policy layout_read on public.progress_layout for select to authenticated using(exists(select 1 from public.progress_members where user_id=auth.uid()));
drop policy if exists layout_write on public.progress_layout;
create policy layout_write on public.progress_layout for all to authenticated using(public.progress_is_designated_owner()) with check(public.progress_is_designated_owner());
commit;