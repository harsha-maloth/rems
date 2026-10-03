-- =====================================================================
-- ClubOrbit - initial schema (Supabase / Postgres)
-- Initial schema for the ClubOrbit tables, policies and functions.
-- Run in: Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Replaces the old `login` table. Passwords live in Supabase Auth, not here.
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  login_name  text not null unique,
  email       text not null unique,
  full_name   text,
  first_name  text,
  last_name   text,
  address     text,
  phno        text,
  signature   text,
  imgsrc      text,                       -- base64 data URL, same as original
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.events (
  id          bigint generated always as identity primary key,
  event_name  text not null unique,
  date        date not null,
  is_inter    boolean not null default false   -- original: isInter
);

create table public.certificates (
  id          bigint generated always as identity primary key,
  name        text not null,
  regno       text,
  dept        text,
  year        int,
  section     text,
  email       text not null,
  position    text,
  cert_link   text not null,
  event_name  text not null,
  college     text
);
create index certificates_event_idx on public.certificates (event_name);

-- Activity log. `userid` holds the login name, like the original.
create table public.logging (
  id          bigint generated always as identity primary key,
  "timestamp" timestamptz not null default now(),
  userid      text not null,
  log         text not null
);
create index logging_user_idx on public.logging (userid, id desc);

-- Dashboard alerts. Original column `user` is renamed (reserved word).
create table public.notification (
  id          bigint generated always as identity primary key,
  "timestamp" timestamptz not null default now(),
  username    text not null,
  message     text not null,
  type        text not null default 'info' check (type in ('info','success','warning')),
  click_url   text not null default '#'
);

-- Replaces one-SQL-table-per-event. Fields are a JSON array of labels.
create table public.forms (
  id                  bigint generated always as identity primary key,
  slug                text not null unique,
  name                text not null,
  description         text not null default '',
  event_type          text not null default 'individual' check (event_type in ('individual','team')),
  number_participants int  not null default 1 check (number_participants between 1 and 20),
  fields              jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create table public.form_responses (
  id          bigint generated always as identity primary key,
  form_id     bigint not null references public.forms(id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  constraint form_responses_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint form_responses_data_small check (pg_column_size(data) < 20000)
);
create index form_responses_form_idx on public.form_responses (form_id, id);

-- Replaces one-SQL-table-per-mailing-list.
create table public.mailing_lists (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table public.mailing_list_members (
  id          bigint generated always as identity primary key,
  list_id     bigint not null references public.mailing_lists(id) on delete cascade,
  name        text,
  email       text not null
);
create index mailing_members_list_idx on public.mailing_list_members (list_id);

-- ---------------------------------------------------------------------
-- 2. Helper functions
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.current_login_name()
returns text
language sql stable security definer set search_path = ''
as $$
  select p.login_name from public.profiles p where p.id = auth.uid();
$$;

-- Create a profile whenever an auth user is created.
-- NEVER trusts metadata for is_admin: promote admins with SQL (see README).
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
  values (new.id, uname, new.email, nullif(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admins may edit their profile but not privilege / identity columns.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- auth.uid() is null for the SQL editor / service role: trusted, allow.
  if auth.uid() is not null and not public.is_admin() and (
       new.is_admin   is distinct from old.is_admin
    or new.login_name is distinct from old.login_name
    or new.email      is distinct from old.email
    or new.id         is distinct from old.id
  ) then
    raise exception 'Only admins can change is_admin, login_name or email';
  end if;
  return new;
end;
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- 3. RPCs used by the front end
-- ---------------------------------------------------------------------

-- Username -> email lookup so the login form can keep the original
-- "username + password" flow. NOTE: this lets anyone resolve a known
-- username to its email. See README "Security notes" for the trade-off.
create or replace function public.email_for_username(uname text)
returns text
language sql stable security definer set search_path = ''
as $$
  select p.email from public.profiles p where lower(p.login_name) = lower(uname) limit 1;
$$;

-- Dashboard counters, visible to any logged-in member without exposing rows.
create or replace function public.dashboard_stats()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  latest   record;
  reg_count bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select e.event_name into latest from public.events e order by e.date desc limit 1;

  if latest.event_name is not null then
    select count(*) into reg_count
    from public.form_responses r
    join public.forms f on f.id = r.form_id
    where lower(f.name) = lower(latest.event_name)
       or f.slug = regexp_replace(lower(latest.event_name), '[^0-9a-z_]+', '_', 'g');
  end if;

  return json_build_object(
    'events_count',       (select count(*) from public.events),
    'members_count',      (select count(*) from public.profiles),
    'latest_event',       coalesce(latest.event_name, ''),
    'registration_count', reg_count
  );
end;
$$;

-- Recent alerts joined with the sender's avatar, for the bell menu.
create or replace function public.recent_alerts(max_rows int default 5)
returns table (username text, message text, type text, click_url text, "timestamp" timestamptz, imgsrc text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  return query
    select n.username, n.message, n.type, n.click_url, n."timestamp", p.imgsrc
    from public.notification n
    left join public.profiles p on p.login_name = n.username
    order by n."timestamp" desc
    limit least(greatest(max_rows, 1), 50);
end;
$$;

-- Admin-only: list tables for the DB manager ("Maintenance" page).
create or replace function public.admin_list_tables()
returns table (table_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select t.table_name::text
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by t.table_name;
end;
$$;

-- Lock down function execution: only what each role needs.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.is_admin()                to anon, authenticated;
grant execute on function public.current_login_name()      to authenticated;
grant execute on function public.dashboard_stats()         to authenticated;
grant execute on function public.recent_alerts(int)        to authenticated;
grant execute on function public.admin_list_tables()       to authenticated;

-- ---------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.events               enable row level security;
alter table public.certificates         enable row level security;
alter table public.logging              enable row level security;
alter table public.notification         enable row level security;
alter table public.forms                enable row level security;
alter table public.form_responses       enable row level security;
alter table public.mailing_lists        enable row level security;
alter table public.mailing_list_members enable row level security;

-- profiles: see/edit your own row; admins see/edit everything.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- events + certificates: public read (the CDS), admin write.
create policy events_read on public.events for select to anon, authenticated using (true);
create policy events_admin_write on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy certificates_read on public.certificates for select to anon, authenticated using (true);
create policy certificates_admin_write on public.certificates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- logging: members read their own log; anyone logged in can append their own.
create policy logging_select on public.logging for select to authenticated
  using (userid = public.current_login_name() or public.is_admin());
create policy logging_insert on public.logging for insert to authenticated
  with check (userid = public.current_login_name());
create policy logging_admin_write on public.logging for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- notification: read goes through recent_alerts(); members post as themselves,
-- only admins may use types other than 'info'.
create policy notification_insert on public.notification for insert to authenticated
  with check (username = public.current_login_name() and (type = 'info' or public.is_admin()));
create policy notification_admin_all on public.notification for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- forms: public can read definitions (to render the form) and submit responses.
create policy forms_read on public.forms for select to anon, authenticated using (true);
create policy forms_admin_write on public.forms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy form_responses_insert on public.form_responses for insert to anon, authenticated
  with check (true);
create policy form_responses_admin_all on public.form_responses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- mailing lists: admin only.
create policy mailing_lists_admin on public.mailing_lists for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy mailing_members_admin on public.mailing_list_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 5. Storage: public bucket for generated certificate images
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', true)
on conflict (id) do nothing;

create policy "certificates public read" on storage.objects for select
  using (bucket_id = 'certificates');
create policy "certificates admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates' and public.is_admin());
create policy "certificates admin update" on storage.objects for update to authenticated
  using (bucket_id = 'certificates' and public.is_admin());
create policy "certificates admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'certificates' and public.is_admin());
