-- =====================================================================
-- 0006 (Platform Phase 2): student identity and portal
-- Run once in: Supabase Dashboard -> SQL Editor (after 0001 to 0005)
--
-- What this does
--   * students: one row per admitted student (institute e-mail, enrolment number, department,
--     programme, batch, status). The university admin imports the list the institute provides.
--   * A sign-up gate on auth.users: a new account is only created when its e-mail is on the
--     admitted list (and unclaimed) or has been invited by a platform admin (staff). This is what
--     makes it safe to turn public sign-ups ON in Supabase Authentication.
--   * Claiming: when an admitted student signs up, the new profile is linked to their student row.
--   * university_admins: the role that may import and read the student list. Platform admins do
--     NOT read students by default; they can only add a university admin (audited).
--   * Student functions: can_claim, my_certificates, club_directory, complete_my_profile.
--
-- Keep "Confirm e-mail" ON in Supabase Authentication: it proves the person owns the address.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
-- No policies: only security-definer functions below read it, only SQL changes it.
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value) values ('institute_email_domain', 'iist.ac.in');

create or replace function public.institute_domain()
returns text language sql stable security definer set search_path = ''
as $$ select value from public.app_settings where key = 'institute_email_domain'; $$;

-- ---------------------------------------------------------------------
-- 2. Roles outside any club
-- ---------------------------------------------------------------------
create table public.university_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table public.university_admins enable row level security;

create or replace function public.is_university_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.university_admins u where u.profile_id = auth.uid()); $$;

create policy university_admins_select on public.university_admins for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
-- No write policy: add_university_admin() below is the only way in.
revoke insert, update, delete, truncate on public.university_admins from anon, authenticated;

create trigger university_admins_audit after insert or update or delete on public.university_admins
  for each row execute function public.audit_trigger();

create or replace function public.add_university_admin(p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare pid uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Platform admins only' using errcode = '42501';
  end if;
  select id into pid from public.profiles where lower(email) = lower(trim(p_email));
  if pid is null then raise exception 'No profile with e-mail %', p_email; end if;
  insert into public.university_admins (profile_id) values (pid) on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Students
-- ---------------------------------------------------------------------
create table public.students (
  id                   bigint generated always as identity primary key,
  institute_email      text not null unique,
  enrolment_no         text not null unique,
  full_name            text not null check (char_length(full_name) between 1 and 200),
  department           text,
  programme            text,
  batch                text,
  status               text not null default 'applicant'
                       check (status in ('applicant','student','alumni','withdrawn')),
  profile_id           uuid unique references public.profiles(id) on delete set null,
  claimed_at           timestamptz,
  profile_completed_at timestamptz,
  created_at           timestamptz not null default now()
);

-- Normalise and validate every write, whoever makes it.
create or replace function public.students_check()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.institute_email := lower(trim(new.institute_email));
  new.enrolment_no    := upper(trim(new.enrolment_no));
  new.full_name       := trim(new.full_name);
  if new.institute_email !~ '^[^\s@]+@[^\s@]+$'
     or split_part(new.institute_email, '@', 2) is distinct from public.institute_domain() then
    raise exception 'E-mail must be an @% address', public.institute_domain() using errcode = '23514';
  end if;
  if new.enrolment_no = '' then
    raise exception 'Enrolment number is empty' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger students_check_trg before insert or update on public.students
  for each row execute function public.students_check();

alter table public.students enable row level security;
-- A student reads only their own row; the university admin reads all. Nobody writes directly:
-- the list is changed through import_students().
create policy students_select on public.students for select to authenticated
  using (profile_id = auth.uid() or public.is_university_admin());
revoke insert, update, delete, truncate on public.students from anon, authenticated;
revoke all on public.students from anon;

-- ---------------------------------------------------------------------
-- 4. Sign-up gate and claiming
-- ---------------------------------------------------------------------
create table public.signup_invites (
  email      text primary key check (email = lower(email)),
  invited_at timestamptz not null default now()
);
alter table public.signup_invites enable row level security;
revoke all on public.signup_invites from anon, authenticated;

create or replace function public.invite_staff(p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Platform admins only' using errcode = '42501';
  end if;
  insert into public.signup_invites (email) values (lower(trim(p_email))) on conflict do nothing;
end;
$$;

-- Runs before an auth user is created (public sign-up AND "Add user" in the dashboard).
create or replace function public.signup_gate()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare em text := lower(trim(coalesce(new.email, '')));
begin
  if em <> '' and (
       exists (select 1 from public.students s
                where s.institute_email = em and s.profile_id is null and s.status in ('applicant','student'))
    or exists (select 1 from public.signup_invites i where i.email = em)) then
    return new;
  end if;
  raise exception 'This e-mail is not allowed to create an account' using errcode = '42501';
end;
$$;
create trigger auth_users_signup_gate before insert on auth.users
  for each row execute function public.signup_gate();

-- Same as 0001, plus: link the new profile to the admitted-student row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base  text := coalesce(nullif(new.raw_user_meta_data->>'login_name', ''), split_part(new.email, '@', 1));
  uname text := base;
begin
  while exists (select 1 from public.profiles where lower(login_name) = lower(uname)) loop
    uname := base || floor(random() * 1000)::int;
  end loop;
  insert into public.profiles (id, login_name, email, full_name)
  values (new.id, uname, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
                   (select s.full_name from public.students s where s.institute_email = lower(new.email))));
  update public.students
     set profile_id = new.id,
         claimed_at = now(),
         status     = case when status = 'applicant' then 'student' else status end
   where institute_email = lower(new.email) and profile_id is null;
  return new;
end;
$$;

-- Lets the sign-up page say "not on the list" before it tries. Answers yes/no only.
create or replace function public.can_claim(p_email text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.students s
                  where s.institute_email = lower(trim(p_email))
                    and s.profile_id is null and s.status in ('applicant','student'));
$$;

-- ---------------------------------------------------------------------
-- 5. University admin: import the list the institute provides
-- ---------------------------------------------------------------------
-- p_rows: JSON array (at most 1000) of {institute_email, enrolment_no, full_name, department, programme, batch}.
-- Existing e-mails are updated (status and account link are kept). Bad rows are reported, not fatal.
create or replace function public.import_students(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb; i int := 0; ins int := 0; upd int := 0; existed boolean;
  bad jsonb := '[]'::jsonb; em text;
begin
  if not public.is_university_admin() then
    raise exception 'University admins only' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Send an array of at most 1000 rows' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    em := lower(trim(coalesce(r->>'institute_email', '')));
    begin
      select exists (select 1 from public.students where institute_email = em) into existed;
      insert into public.students (institute_email, enrolment_no, full_name, department, programme, batch)
      values (em, coalesce(r->>'enrolment_no', ''), coalesce(r->>'full_name', ''),
              nullif(trim(r->>'department'), ''), nullif(trim(r->>'programme'), ''), nullif(trim(r->>'batch'), ''))
      on conflict (institute_email) do update set
        enrolment_no = excluded.enrolment_no, full_name = excluded.full_name,
        department = excluded.department, programme = excluded.programme, batch = excluded.batch;
      if existed then upd := upd + 1; else ins := ins + 1; end if;
    exception when others then
      bad := bad || jsonb_build_array(jsonb_build_object('row', i, 'email', em, 'error',
               case when sqlstate = '23505' then 'Enrolment number already used by another student'
                    when sqlstate = '23502' then 'A required value is empty'
                    else left(sqlerrm, 160) end));
    end;
  end loop;
  insert into public.audit_log (actor, actor_name, action, target_table, detail)
  values (auth.uid(), public.current_login_name(), 'import_students', 'students',
          jsonb_build_object('inserted', ins, 'updated', upd, 'rejected', jsonb_array_length(bad)));
  return jsonb_build_object('inserted', ins, 'updated', upd, 'rejected', bad);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Student portal data
-- ---------------------------------------------------------------------
-- Every certificate issued to the caller's e-mail, across all clubs. The e-mail column itself
-- stays unreadable; this is the only way to look certificates up by e-mail.
create or replace function public.my_certificates()
returns table (id bigint, event_name text, event_date date, "position" text, cert_link text, club_name text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.event_name, e.date, c.position, c.cert_link, cl.name
  from public.certificates c
  join public.profiles p on p.id = auth.uid() and lower(p.email) = lower(c.email)
  left join public.events e on e.event_name = c.event_name
  left join public.clubs cl on cl.id = c.club_id
  order by e.date desc nulls last, c.id desc;
$$;

-- Active clubs any signed-in person may browse.
create or replace function public.club_directory()
returns table (id bigint, slug text, name text, description text, faculty_advisor text, is_member boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.slug, c.name, c.description, c.faculty_advisor, public.is_member(c.id)
  from public.clubs c
  where auth.uid() is not null and c.status = 'active'
  order by c.name;
$$;

-- The student says "my profile is complete": needs a name and a phone number saved first.
create or replace function public.complete_my_profile()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare ok boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select coalesce(nullif(trim(p.phno), ''), '') <> '' and coalesce(nullif(trim(p.first_name), ''), '') <> ''
    into ok from public.profiles p where p.id = auth.uid();
  if not coalesce(ok, false) then return false; end if;
  update public.students set profile_completed_at = coalesce(profile_completed_at, now())
   where profile_id = auth.uid();
  return found;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Function permissions
-- ---------------------------------------------------------------------
revoke execute on function
  public.institute_domain(), public.is_university_admin(), public.add_university_admin(text),
  public.students_check(), public.invite_staff(text), public.signup_gate(), public.can_claim(text),
  public.import_students(jsonb), public.my_certificates(), public.club_directory(),
  public.complete_my_profile(), public.handle_new_user()
  from public, anon, authenticated;

grant execute on function public.institute_domain(), public.can_claim(text) to anon, authenticated;
grant execute on function
  public.is_university_admin(), public.add_university_admin(text), public.invite_staff(text),
  public.import_students(jsonb), public.my_certificates(), public.club_directory(),
  public.complete_my_profile()
  to authenticated;

-- Staff who already have accounts need no invite. Anyone you create from now on in
-- Authentication -> Users must first be invited:  select public.invite_staff('person@example.com');
