-- One-time owner-only team account status RPC.
-- Apply AFTER supabase/owner-access.sql and sql/email-access.sql.
-- Read-only: this does not create, change, or delete any account or role.
begin;

create or replace function public.progress_team_accounts()
returns table (
  email text,
  access_role text,
  registration_state text,
  email_verified boolean,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $team$
begin
  -- The RPC bypasses auth.users RLS, so the owner guard MUST be server-side.
  if auth.uid() is null
     or public.progress_is_designated_owner() is distinct from true
     or not exists (
       select 1
       from public.progress_members m
       where m.user_id = auth.uid() and m.role = 'owner'
     ) then
    raise exception '관리자만 팀원 계정을 조회할 수 있습니다.' using errcode = '42501';
  end if;

  return query
  select records.email, records.access_role, records.registration_state,
         records.email_verified, records.last_sign_in_at
  from (
    -- A member who actually has access to the team database.
    select lower(u.email)::text as email,
           m.role::text as access_role,
           'member'::text as registration_state,
           (u.email_confirmed_at is not null) as email_verified,
           u.last_sign_in_at
    from public.progress_members m
    join auth.users u on u.id = m.user_id
    where u.email is not null

    union all

    -- Email was approved in advance, but still has no applied membership.
    select lower(p.email)::text as email,
           p.role::text as access_role,
           'pending'::text as registration_state,
           (u.email_confirmed_at is not null) as email_verified,
           u.last_sign_in_at
    from public.progress_pending_access p
    left join auth.users u on lower(u.email) = lower(p.email)
    where not exists (
      select 1
      from public.progress_members m
      join auth.users enrolled on enrolled.id = m.user_id
      where lower(enrolled.email) = lower(p.email)
    )
  ) as records
  order by case when records.access_role = 'owner' then 0 else 1 end,
           records.email;
end;
$team$;

revoke all on function public.progress_team_accounts() from public, anon;
grant execute on function public.progress_team_accounts() to authenticated;
notify pgrst, 'reload schema';
commit;
