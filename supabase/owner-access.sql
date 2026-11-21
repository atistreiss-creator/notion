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
 if not exists(select 1 from public.progress_members where user_id=auth.uid() and role='owner') then raise exception '관리자만 변경할 수 있습니다.'; end if;
 if access_role is null or access_role not in ('editor','viewer') then raise exception '허용되지 않는 권한입니다.'; end if;
 select id into strict target from auth.users where lower(email)=lower(trim(target_email)) and email_confirmed_at is not null;
 insert into public.progress_members as m(user_id,role) values(target,access_role)
 on conflict(user_id) do update set role=excluded.role where m.role <> 'owner';
 if not found then raise exception '관리자 권한은 변경할 수 없습니다.'; end if;
exception when no_data_found then raise exception '먼저 해당 이메일로 로그인하고 인증을 완료해 주세요.';
end $$;
revoke all on function public.progress_set_access(text,text) from public,anon;
grant execute on function public.progress_set_access(text,text) to authenticated;
commit;