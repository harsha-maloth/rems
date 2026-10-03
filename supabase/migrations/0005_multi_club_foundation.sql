-- =====================================================================
-- 0005 (Platform Phase 1): multi-club foundation
-- Run once in: Supabase Dashboard -> SQL Editor (after 0001 to 0004)
--
-- What this does
--   * Adds clubs, teams, positions, memberships, position_terms and an append-only audit_log.
--   * Adds a fixed permission catalogue and ONE access function: has_perm(club, permission).
--   * Adds club_id to events, certificates, forms, mailing_lists, short_links and notification.
--   * Creates a starting club called "Main club", moves all existing data into it, makes every
--     existing profile a member, and gives every current admin the President position there.
--   * Rewrites every policy on those tables so a person only reaches the clubs where they hold
--     a position with the right permission. profiles.is_admin now means PLATFORM admin only.
--   * Certificate images in storage move to <club_id>/... paths (policy checks the first folder).
--
-- Not in this phase (see the platform plan): student identity (phase 2), appointing people with
-- hierarchy rules (phase 3). Until then positions, terms and memberships are written by the
-- platform admin through SQL or the create_club / appoint_president functions below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permission catalogue
-- ---------------------------------------------------------------------
create table public.permissions (
  key         text primary key,
  description text not null
);

insert into public.permissions (key, description) values
  ('member.view',        'See the member list and member profiles of the club'),
  ('member.approve',     'Approve, add and change memberships'),
  ('member.remove',      'Remove members'),
  ('position.assign',    'Appoint people to positions (hierarchy rules arrive in phase 3)'),
  ('team.manage',        'Create and edit teams and wings'),
  ('intake.score',       'Score applications during recruitment'),
  ('event.create',       'Create and edit events'),
  ('certificate.issue',  'Generate, replace and delete certificates'),
  ('mail.send',          'Manage mailing lists and send mail'),
  ('link.manage',        'Create and delete short links'),
  ('form.manage',        'Create forms and read or delete their responses'),
  ('announcement.post',  'Post alerts other than plain info to the club'),
  ('finance.view',       'See the club budget'),
  ('audit.view',         'Read the club audit log'),
  ('club.settings',      'Edit the club description and settings');

alter table public.permissions enable row level security;
create policy permissions_read on public.permissions for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 2. Club tables
-- ---------------------------------------------------------------------
create table public.clubs (
  id               bigint generated always as identity primary key,
  slug             text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name             text not null check (char_length(name) between 2 and 80),
  description      text not null default '',
  status           text not null default 'active' check (status in ('proposed','active','dormant','closed')),
  faculty_advisor  text,
  created_at       timestamptz not null default now()
);

create table public.teams (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  created_at  timestamptz not null default now(),
  unique (club_id, name),
  unique (id, club_id)
);

create table public.positions (
  id           bigint generated always as identity primary key,
  club_id      bigint not null references public.clubs(id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 80),
  parent_id    bigint,
  level        int  not null default 1 check (level between 1 and 20),
  permissions  text[] not null default '{}',
  scope        text not null default 'club' check (scope in ('club','team')),
  unique (club_id, title),
  unique (id, club_id),
  foreign key (parent_id, club_id) references public.positions (id, club_id)   -- parent is in the same club
);

create table public.memberships (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs(id) on delete cascade,
  profile_id uuid   not null references public.profiles(id) on delete cascade,
  team_id    bigint,
  status     text   not null default 'active' check (status in ('pending','active','left','removed')),
  joined_on  date   not null default current_date,
  left_on    date,
  unique (club_id, profile_id),
  foreign key (team_id, club_id) references public.teams (id, club_id)
);
create index memberships_profile_idx on public.memberships (profile_id);

-- One row per person per position per period. This is the history; has_perm reads it.
create table public.position_terms (
  id          bigint generated always as identity primary key,
  club_id     bigint not null references public.clubs(id) on delete cascade,
  position_id bigint not null,
  profile_id  uuid   not null references public.profiles(id) on delete cascade,
  team_id     bigint,                         -- needed when the position's scope is 'team'
  starts_on   date   not null default current_date,
  ends_on     date,
  check (ends_on is null or ends_on >= starts_on),
  foreign key (position_id, club_id) references public.positions (id, club_id) on delete cascade,
  foreign key (team_id, club_id)     references public.teams (id, club_id)
);
create index position_terms_profile_idx on public.position_terms (profile_id, club_id);

-- Append-only record of who did what. No foreign key on club_id, so history outlives a club.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  club_id      bigint,
  actor        uuid,
  actor_name   text,
  action       text not null,
  target_table text,
  target_id    text,
  detail       jsonb
);
create index audit_log_club_idx on public.audit_log (club_id, id desc);

-- Positions may only carry permissions that exist in the catalogue.
create or replace function public.positions_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.permissions) k
              where not exists (select 1 from public.permissions p where p.key = k)) then
    raise exception 'Unknown permission in position "%"', new.title;
  end if;
  return new;
end;
$$;
create trigger positions_check_trg before insert or update on public.positions
  for each row execute function public.positions_check();

-- audit_log can never be changed or removed, by anyone.
create or replace function public.audit_log_frozen()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_frozen();

-- ---------------------------------------------------------------------
-- 3. Access functions
-- ---------------------------------------------------------------------

-- The ONE question the database asks: does the caller hold a current position in this club
-- that carries this permission? Closed, dormant and proposed clubs grant nothing.
create or replace function public.has_perm(p_club bigint, p_perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select true
    from public.position_terms t
    join public.positions p on p.id = t.position_id and p.club_id = t.club_id
    join public.clubs c     on c.id = t.club_id
    where t.profile_id = auth.uid()
      and t.club_id = p_club
      and c.status = 'active'
      and p.scope = 'club'
      and p_perm = any (p.permissions)
      and t.starts_on <= current_date
      and (t.ends_on is null or t.ends_on >= current_date)
    limit 1
  ), false);
$$;

-- Same question for one team: a club-wide position counts, and so does a team-scoped
-- position held for exactly that team.
create or replace function public.has_team_perm(p_team bigint, p_perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select true
    from public.teams tm
    join public.clubs c on c.id = tm.club_id
    join public.position_terms t on t.club_id = tm.club_id and t.profile_id = auth.uid()
    join public.positions p on p.id = t.position_id and p.club_id = t.club_id
    where tm.id = p_team
      and c.status = 'active'
      and p_perm = any (p.permissions)
      and (p.scope = 'club' or t.team_id = tm.id)
      and t.starts_on <= current_date
      and (t.ends_on is null or t.ends_on >= current_date)
    limit 1
  ), false);
$$;

-- Is the caller an active member, or a current position holder, of this club?
create or replace function public.is_member(p_club bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m
                  where m.club_id = p_club and m.profile_id = auth.uid() and m.status = 'active')
      or exists (select 1 from public.position_terms t
                  where t.club_id = p_club and t.profile_id = auth.uid()
                    and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date));
$$;

-- Clubs of the caller with the titles and permissions they hold: feeds the club switcher.
create or replace function public.my_clubs()
returns table (club_id bigint, club_slug text, club_name text, club_status text, titles text[], perms text[])
language sql stable security definer set search_path = ''
as $$
  with act as (
    select t.club_id, p.title, p.permissions, p.scope
    from public.position_terms t
    join public.positions p on p.id = t.position_id and p.club_id = t.club_id
    where t.profile_id = auth.uid()
      and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)
  )
  select c.id, c.slug, c.name, c.status,
         coalesce((select array_agg(distinct a.title) from act a where a.club_id = c.id), '{}'::text[]),
         coalesce((select array_agg(distinct k)
                     from act a, unnest(a.permissions) k
                    where a.club_id = c.id and a.scope = 'club' and c.status = 'active'), '{}'::text[])
  from public.clubs c
  where exists (select 1 from act a where a.club_id = c.id)
     or exists (select 1 from public.memberships m
                 where m.club_id = c.id and m.profile_id = auth.uid() and m.status = 'active')
  order by c.name;
$$;

-- Platform admin only (or the SQL editor, where auth.uid() is null).
create or replace function public.create_club(p_name text, p_slug text, p_description text default '')
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare cid bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Platform admins only' using errcode = '42501';
  end if;
  insert into public.clubs (name, slug, description) values (p_name, p_slug, coalesce(p_description, ''))
    returning id into cid;
  insert into public.positions (club_id, title, level, permissions)
    values (cid, 'President', 1, (select array_agg(key order by key) from public.permissions));
  return cid;
end;
$$;

-- Makes the profile with this e-mail a member and President of the club (open-ended term).
create or replace function public.appoint_president(p_club bigint, p_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare pid uuid; pos bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Platform admins only' using errcode = '42501';
  end if;
  select id into pid from public.profiles where lower(email) = lower(p_email);
  if pid is null then raise exception 'No profile with e-mail %', p_email; end if;
  select id into pos from public.positions where club_id = p_club and title = 'President';
  if pos is null then raise exception 'Club % has no President position', p_club; end if;
  insert into public.memberships (club_id, profile_id) values (p_club, pid)
    on conflict (club_id, profile_id) do update set status = 'active', left_on = null;
  if not exists (select 1 from public.position_terms
                  where club_id = p_club and position_id = pos and profile_id = pid and ends_on is null) then
    insert into public.position_terms (club_id, position_id, profile_id) values (p_club, pos, pid);
  end if;
end;
$$;

-- Used by the audit triggers below.
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r record; j jsonb; cid bigint;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  j := to_jsonb(r);
  cid := case when tg_table_name = 'clubs' then (j->>'id')::bigint else (j->>'club_id')::bigint end;
  insert into public.audit_log (club_id, actor, actor_name, action, target_table, target_id, detail)
  values (cid, auth.uid(), public.current_login_name(), lower(tg_op), tg_table_name, j->>'id', j);
  return r;
end;
$$;

-- Used by the storage policies: certificate files live under <club_id>/...
create or replace function public.storage_club(object_name text)
returns bigint
language sql immutable set search_path = ''
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9]{1,15}$'
              then split_part(object_name, '/', 1)::bigint end;
$$;

-- ---------------------------------------------------------------------
-- 4. Starting club, and club_id on the existing tables
-- ---------------------------------------------------------------------
alter table public.events         add column club_id bigint references public.clubs(id);
alter table public.certificates   add column club_id bigint references public.clubs(id);
alter table public.forms          add column club_id bigint references public.clubs(id);
alter table public.mailing_lists  add column club_id bigint references public.clubs(id);
alter table public.short_links    add column club_id bigint references public.clubs(id);
alter table public.notification   add column club_id bigint references public.clubs(id);

do $$
declare cid bigint; pid bigint;
begin
  insert into public.clubs (slug, name, description)
  values ('main', 'Main club',
          'Holds everything that existed before multi-club support. Rename it and add the other clubs.')
  returning id into cid;

  insert into public.positions (club_id, title, level, permissions)
  values (cid, 'President', 1, (select array_agg(key order by key) from public.permissions))
  returning id into pid;

  insert into public.memberships (club_id, profile_id) select cid, id from public.profiles;
  insert into public.position_terms (club_id, position_id, profile_id)
    select cid, pid, id from public.profiles where is_admin;

  update public.events        set club_id = cid;
  update public.certificates  set club_id = cid;
  update public.forms         set club_id = cid;
  update public.mailing_lists set club_id = cid;
  update public.short_links   set club_id = cid;
  update public.notification  set club_id = cid;
end;
$$;

alter table public.events         alter column club_id set not null;
alter table public.certificates   alter column club_id set not null;
alter table public.forms          alter column club_id set not null;
alter table public.mailing_lists  alter column club_id set not null;
alter table public.short_links    alter column club_id set not null;
alter table public.notification   alter column club_id set not null;

create index events_club_idx        on public.events (club_id);
create index certificates_club_idx  on public.certificates (club_id);
create index forms_club_idx         on public.forms (club_id);
create index mailing_lists_club_idx on public.mailing_lists (club_id);
create index short_links_club_idx   on public.short_links (club_id);
create index notification_club_idx  on public.notification (club_id, id desc);

-- Mailing list names only need to be unique inside one club.
alter table public.mailing_lists drop constraint mailing_lists_name_key;
alter table public.mailing_lists add  constraint mailing_lists_club_name_key unique (club_id, name);

-- Event names, form slugs and short-link slugs stay globally unique on purpose: the public pages
-- (certificate search, register.html?form=, /s/NAME) identify them by that text alone.

-- Anonymous visitors may read the new column on certificates too (it is not private).
grant select (club_id) on public.certificates to anon;

-- Signed-in users must not read other people's certificate e-mails either (they could before,
-- because "signed in" meant "staff"; student accounts arrive in phase 2).
revoke select on public.certificates from authenticated;
grant select (id, name, regno, dept, year, section, position, cert_link, event_name, college, club_id)
  on public.certificates to authenticated;

-- ---------------------------------------------------------------------
-- 5. Audit triggers (created after the data move so the migration itself is not logged)
-- ---------------------------------------------------------------------
create trigger clubs_audit          after insert or update or delete on public.clubs
  for each row execute function public.audit_trigger();
create trigger teams_audit          after insert or update or delete on public.teams
  for each row execute function public.audit_trigger();
create trigger positions_audit      after insert or update or delete on public.positions
  for each row execute function public.audit_trigger();
create trigger memberships_audit    after insert or update or delete on public.memberships
  for each row execute function public.audit_trigger();
create trigger position_terms_audit after insert or update or delete on public.position_terms
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- 6. Functions that used to be global now take a club
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_stats();
drop function if exists public.recent_alerts(int);

create or replace function public.dashboard_stats(p_club bigint)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  latest    record;
  reg_count bigint := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_member(p_club) then raise exception 'Not a member of this club' using errcode = '42501'; end if;

  select e.event_name into latest from public.events e
   where e.club_id = p_club order by e.date desc limit 1;

  if latest.event_name is not null then
    select count(*) into reg_count
    from public.form_responses r
    join public.forms f on f.id = r.form_id
    where f.club_id = p_club
      and (lower(f.name) = lower(latest.event_name)
           or f.slug = regexp_replace(lower(latest.event_name), '[^0-9a-z_]+', '_', 'g'));
  end if;

  return json_build_object(
    'events_count',       (select count(*) from public.events where club_id = p_club),
    'members_count',      (select count(*) from public.memberships where club_id = p_club and status = 'active'),
    'latest_event',       coalesce(latest.event_name, ''),
    'registration_count', reg_count
  );
end;
$$;

create or replace function public.recent_alerts(max_rows int, p_club bigint)
returns table (username text, message text, type text, click_url text, "timestamp" timestamptz, imgsrc text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_member(p_club) then raise exception 'Not a member of this club' using errcode = '42501'; end if;
  return query
    select n.username, n.message, n.type, n.click_url, n."timestamp", p.imgsrc
    from public.notification n
    left join public.profiles p on p.login_name = n.username
    where n.club_id = p_club
    order by n."timestamp" desc
    limit least(greatest(max_rows, 1), 50);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Function permissions (new functions are executable by everyone unless told otherwise)
-- ---------------------------------------------------------------------
revoke execute on function
  public.positions_check(), public.audit_log_frozen(), public.audit_trigger(),
  public.has_perm(bigint, text), public.has_team_perm(bigint, text), public.is_member(bigint),
  public.my_clubs(), public.create_club(text, text, text), public.appoint_president(bigint, text),
  public.storage_club(text), public.dashboard_stats(bigint), public.recent_alerts(int, bigint)
  from public, anon, authenticated;

grant execute on function
  public.has_perm(bigint, text), public.has_team_perm(bigint, text), public.is_member(bigint),
  public.my_clubs(), public.create_club(text, text, text), public.appoint_president(bigint, text),
  public.dashboard_stats(bigint), public.recent_alerts(int, bigint)
  to authenticated;

-- Used inside storage policies, which are evaluated for anon uploads attempts too.
grant execute on function public.storage_club(text) to anon, authenticated;
-- has_perm is also evaluated inside policies for the anon role (it simply answers false).
grant execute on function public.has_perm(bigint, text) to anon;

-- ---------------------------------------------------------------------
-- 8. Row Level Security: new tables
-- ---------------------------------------------------------------------
alter table public.clubs          enable row level security;
alter table public.teams          enable row level security;
alter table public.positions      enable row level security;
alter table public.memberships    enable row level security;
alter table public.position_terms enable row level security;
alter table public.audit_log      enable row level security;

-- Structure (clubs, positions, terms, memberships, teams) is written by the platform admin until
-- phase 3 adds appointment rules; club officers get the narrower rights shown here.
create policy clubs_select on public.clubs for select to authenticated
  using (public.is_member(id) or public.is_admin());
create policy clubs_admin_write on public.clubs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy teams_select on public.teams for select to authenticated
  using (public.is_member(club_id) or public.is_admin());
create policy teams_write on public.teams for all to authenticated
  using (public.has_perm(club_id, 'team.manage') or public.is_admin())
  with check (public.has_perm(club_id, 'team.manage') or public.is_admin());

create policy positions_select on public.positions for select to authenticated
  using (public.is_member(club_id) or public.is_admin());
create policy positions_admin_write on public.positions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy memberships_select on public.memberships for select to authenticated
  using (profile_id = auth.uid() or public.has_perm(club_id, 'member.view') or public.is_admin());
create policy memberships_write on public.memberships for all to authenticated
  using (public.has_perm(club_id, 'member.approve') or public.is_admin())
  with check (public.has_perm(club_id, 'member.approve') or public.is_admin());

create policy terms_select on public.position_terms for select to authenticated
  using (profile_id = auth.uid() or public.has_perm(club_id, 'member.view') or public.is_admin());
create policy terms_admin_write on public.position_terms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy audit_select on public.audit_log for select to authenticated
  using (public.has_perm(club_id, 'audit.view') or (club_id is null and public.is_admin()));
-- No insert/update/delete policy: only the security-definer triggers write to it.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Row Level Security: existing tables become club-scoped
-- ---------------------------------------------------------------------
-- events: public read stays (certificate search); write needs a position in that club.
drop policy events_admin_write on public.events;
create policy events_club_write on public.events for all to authenticated
  using (public.has_perm(club_id, 'event.create') or public.has_perm(club_id, 'certificate.issue'))
  with check (public.has_perm(club_id, 'event.create') or public.has_perm(club_id, 'certificate.issue'));

drop policy certificates_admin_write on public.certificates;
create policy certificates_club_write on public.certificates for all to authenticated
  using (public.has_perm(club_id, 'certificate.issue'))
  with check (public.has_perm(club_id, 'certificate.issue'));

-- forms: public read stays (register.html needs the definition); write per club.
drop policy forms_admin_write on public.forms;
create policy forms_club_write on public.forms for all to authenticated
  using (public.has_perm(club_id, 'form.manage'))
  with check (public.has_perm(club_id, 'form.manage'));

-- form_responses: public insert stays; read, change and delete follow the form's club.
drop policy form_responses_admin_all on public.form_responses;
create policy form_responses_club_select on public.form_responses for select to authenticated
  using (exists (select 1 from public.forms f where f.id = form_id and public.has_perm(f.club_id, 'form.manage')));
create policy form_responses_club_update on public.form_responses for update to authenticated
  using (exists (select 1 from public.forms f where f.id = form_id and public.has_perm(f.club_id, 'form.manage')))
  with check (exists (select 1 from public.forms f where f.id = form_id and public.has_perm(f.club_id, 'form.manage')));
create policy form_responses_club_delete on public.form_responses for delete to authenticated
  using (exists (select 1 from public.forms f where f.id = form_id and public.has_perm(f.club_id, 'form.manage')));

-- mailing lists and their members.
drop policy mailing_lists_admin on public.mailing_lists;
create policy mailing_lists_club on public.mailing_lists for all to authenticated
  using (public.has_perm(club_id, 'mail.send')) with check (public.has_perm(club_id, 'mail.send'));

drop policy mailing_members_admin on public.mailing_list_members;
create policy mailing_members_club on public.mailing_list_members for all to authenticated
  using (exists (select 1 from public.mailing_lists l where l.id = list_id and public.has_perm(l.club_id, 'mail.send')))
  with check (exists (select 1 from public.mailing_lists l where l.id = list_id and public.has_perm(l.club_id, 'mail.send')));

-- short links.
drop policy short_links_admin on public.short_links;
create policy short_links_club on public.short_links for all to authenticated
  using (public.has_perm(club_id, 'link.manage')) with check (public.has_perm(club_id, 'link.manage'));

-- notification: members post to their own club; anything but 'info' needs announcement.post.
drop policy notification_insert on public.notification;
drop policy notification_admin_all on public.notification;
create policy notification_insert on public.notification for insert to authenticated
  with check (username = public.current_login_name()
              and public.is_member(club_id)
              and (type = 'info' or public.has_perm(club_id, 'announcement.post')));
create policy notification_club_delete on public.notification for delete to authenticated
  using (public.has_perm(club_id, 'announcement.post'));

-- ---------------------------------------------------------------------
-- 10. Storage: certificate files live under <club_id>/...
-- ---------------------------------------------------------------------
-- Files uploaded before this migration have no club folder (the first folder is the event name).
-- Only the platform admin may change those; new uploads must use the club's own folder.
drop policy "certificates admin insert" on storage.objects;
drop policy "certificates admin update" on storage.objects;
drop policy "certificates admin delete" on storage.objects;

create policy "certificates club insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates' and (
    public.has_perm(public.storage_club(name), 'certificate.issue')
    or (public.storage_club(name) is null and public.is_admin())));
create policy "certificates club update" on storage.objects for update to authenticated
  using (bucket_id = 'certificates' and (
    public.has_perm(public.storage_club(name), 'certificate.issue')
    or (public.storage_club(name) is null and public.is_admin())));
create policy "certificates club delete" on storage.objects for delete to authenticated
  using (bucket_id = 'certificates' and (
    public.has_perm(public.storage_club(name), 'certificate.issue')
    or (public.storage_club(name) is null and public.is_admin())));
