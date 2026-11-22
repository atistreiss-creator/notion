begin;
create table if not exists public.progress_pending_access (
  email text primary key,
  role text not null check (role in ('viewer','editor'))
);
alter table public.progress_pending_access enable row level security;
revoke all on public.progress_pending_access from public, anon, authenticated;

create or replace function public.progress_assign_email(target_email text, access_role text)
returns text language plpgsql security definer set search_path='' as $fn$
declare
  address text := lower(trim(target_email));
  recipient uuid;
begin
  if public.progress_is_designated_owner() is not true then raise exception '관리자 권한이 필요합니다.'; end if;
  if address is null or address !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or access_role is null or access_role not in ('viewer','editor') then raise exception '이메일과 권한을 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(address,0));
  select id into recipient from auth.users where lower(email)=address and email_confirmed_at is not null;
  if recipient = auth.uid() then raise exception '관리자 권한은 고정되어 있습니다.'; end if;
  if recipient is null then
    insert into public.progress_pending_access values(address,access_role)
    on conflict(email) do update set role=excluded.role;
    return 'pending';
  end if;
  insert into public.progress_members(user_id,role) values(recipient,access_role)
  on conflict(user_id) do update set role=excluded.role where progress_members.role <> 'owner';
  delete from public.progress_pending_access where email=address;
  return 'applied';
end $fn$;

create or replace function public.progress_accept_email() returns void
language plpgsql security definer set search_path='' as $fn$
declare
  address text;
  assigned text;
begin
  select lower(email) into address from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if address is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(address,0));
  delete from public.progress_pending_access where email=address returning role into assigned;
  if assigned is not null then
    insert into public.progress_members(user_id,role) values(auth.uid(),assigned)
    on conflict(user_id) do update set role=excluded.role where progress_members.role <> 'owner';
  end if;
end $fn$;
revoke all on function public.progress_assign_email(text,text), public.progress_accept_email() from public, anon;
grant execute on function public.progress_assign_email(text,text), public.progress_accept_email() to authenticated;
notify pgrst,'reload schema';
commit;