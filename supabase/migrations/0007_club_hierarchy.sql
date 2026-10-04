-- =====================================================================
-- 0007 (Platform Phase 3): club portal and hierarchy
-- Run once in: Supabase Dashboard -> SQL Editor (after 0001 to 0006)
--
-- What this does
--   * role_templates: standard positions (President ... Core Member) a club can adopt in one click.
--   * Hierarchy rules, enforced here and not in the page:
--       - level 1 is the top; you may only act on positions BELOW your own level;
--       - you may only hand out permissions you hold yourself (no climbing);
--       - a team-scoped position (wing lead) acts only inside its own team;
--       - a club can never be left without a level-1 holder (except by a platform admin).
--   * Functions for the club portal: save_position, delete_position, apply_role_templates,
--     appoint, end_term, handover, add_member, set_member_team, remove_member, club_members,
--     club_positions. Direct writes to positions / position_terms stay platform-admin only.
--   * Ending a term takes effect at once (no "valid until end of today" window).
--   * create_club now seeds the standard positions.
--
-- Not in this phase: recruitment forms and offers (phase 4), events and tasks (phase 5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Role templates
-- ---------------------------------------------------------------------
create table public.role_templates (
  key         text primary key,
  title       text not null,
  level       int  not null check (level between 1 and 20),
  scope       text not null check (scope in ('club','team')),
  permissions text[] not null default '{}'
);
alter table public.role_templates enable row level security;
create policy role_templates_read on public.role_templates for select to authenticated using (true);

insert into public.role_templates (key, title, level, scope, permissions) values
  ('president', 'President', 1, 'club',
     (select array_agg(key order by key) from public.permissions)),
  ('vice_president', 'Vice President', 2, 'club',
     array['audit.view','announcement.post','certificate.issue','event.create','finance.view','form.manage',
           'intake.score','link.manage','mail.send','member.approve','member.remove','member.view',
           'position.assign','team.manage']),
  ('secretary', 'Secretary', 2, 'club',
     array['announcement.post','certificate.issue','event.create','form.manage','link.manage','mail.send',
           'member.approve','member.view']),
  ('treasurer', 'Treasurer', 2, 'club',
     array['audit.view','finance.view','member.view']),
  ('wing_lead', 'Wing Lead', 3, 'team',
     array['intake.score','member.approve','member.view','position.assign']),
  ('core_member', 'Core Member', 4, 'team',
     array['member.view']);

-- Existing clubs (e.g. the starting Main club) get the standard positions too; titles that
-- already exist (President) are kept as they are. Unfilled positions grant nothing.
insert into public.positions (club_id, title, level, scope, permissions)
  select c.id, r.title, r.level, r.scope, r.permissions
  from public.clubs c cross join public.role_templates r
  on conflict (club_id, title) do nothing;

-- ---------------------------------------------------------------------
-- 2. Helpers (internal: no one outside the database may call them)
-- ---------------------------------------------------------------------

-- Close a term so it stops counting immediately. has_perm treats ends_on as "last valid day",
-- so closing means ends_on = yesterday. A term that started today has no valid past day, so it
-- is deleted (the audit trigger still records it).
create or replace function public._close_term(p_term bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.position_terms;
begin
  select * into t from public.position_terms where id = p_term;
  if not found then return; end if;
  if t.ends_on is not null and t.ends_on < current_date then return; end if;   -- already closed
  if t.starts_on >= current_date then
    delete from public.position_terms where id = p_term;
  else
    update public.position_terms set ends_on = current_date - 1 where id = p_term;
  end if;
end;
$$;

-- Does the caller (or a platform admin) have authority over this position in this club/team?
--   caller needs 'position.assign' in a current term whose level is ABOVE the target level,
--   club-scoped terms apply to any team, team-scoped terms only to their own team,
--   and every permission on the target must already be held by the caller (for that team).
create or replace function public._may_manage(p_club bigint, p_position bigint, p_team bigint)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare tgt public.positions;
begin
  if auth.uid() is null then return false; end if;
  select * into tgt from public.positions where id = p_position and club_id = p_club;
  if not found then return false; end if;
  if public.is_admin() then return true; end if;

  return exists (
    select 1
    from public.position_terms t
    join public.positions p on p.id = t.position_id and p.club_id = t.club_id
    join public.clubs c     on c.id = t.club_id
    where t.profile_id = auth.uid() and t.club_id = p_club and c.status = 'active'
      and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)
      and 'position.assign' = any (p.permissions)
      and (p.scope = 'club' or (p_team is not null and t.team_id = p_team))
      and p.level < tgt.level
  )
  and not exists (
    select 1 from unnest(tgt.permissions) k
    where not exists (
      select 1
      from public.position_terms t
      join public.positions p on p.id = t.position_id and p.club_id = t.club_id
      where t.profile_id = auth.uid() and t.club_id = p_club
        and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)
        and (p.scope = 'club' or (p_team is not null and t.team_id = p_team))
        and k = any (p.permissions)
    )
  );
end;
$$;

-- Best (lowest number) level the caller currently holds in the club, or null.
create or replace function public._my_level(p_club bigint)
returns int
language sql stable security definer set search_path = ''
as $$
  select min(p.level)
  from public.position_terms t
  join public.positions p on p.id = t.position_id and p.club_id = t.club_id
  where t.profile_id = auth.uid() and t.club_id = p_club
    and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date);
$$;

-- Best level a given person currently holds in the club, or null.
create or replace function public._level_of(p_club bigint, p_profile uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select min(p.level)
  from public.position_terms t
  join public.positions p on p.id = t.position_id and p.club_id = t.club_id
  where t.profile_id = p_profile and t.club_id = p_club
    and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date);
$$;

-- Profile id for an e-mail, or an error with a deliberately plain message.
create or replace function public._profile_by_email(p_email text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare pid uuid;
begin
  select id into pid from public.profiles where lower(email) = lower(trim(p_email));
  if pid is null then
    raise exception 'No account found for that e-mail. The person must sign up first.' using errcode = 'P0002';
  end if;
  return pid;
end;
$$;

-- A team-scoped caller may not pull someone out of ANOTHER team. Club-wide member managers may.
create or replace function public._guard_team_move(p_club bigint, p_profile uuid, p_team bigint)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_team is null or public.is_admin() or public.has_perm(p_club, 'member.approve') then return; end if;
  if exists (select 1 from public.memberships m
              where m.club_id = p_club and m.profile_id = p_profile and m.status = 'active'
                and m.team_id is not null and m.team_id <> p_team) then
    raise exception 'That person belongs to another team; ask a club officer to move them' using errcode = '42501';
  end if;
end;
$$;

-- Number of people holding a level-1 position in the club right now.
create or replace function public._top_holders(p_club bigint)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(distinct t.profile_id)::int
  from public.position_terms t
  join public.positions p on p.id = t.position_id and p.club_id = t.club_id
  where t.club_id = p_club and p.level = 1
    and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date);
$$;

-- ---------------------------------------------------------------------
-- 3. Positions: create from templates, edit, delete
-- ---------------------------------------------------------------------

-- Adopt the standard positions (skips titles that already exist). Needs authority over level 1:
-- only the President (or a platform admin).
create or replace function public.apply_role_templates(p_club bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not (public.is_admin() or coalesce(public._my_level(p_club), 99) = 1) then
    raise exception 'Only the club President can add the standard positions' using errcode = '42501';
  end if;
  insert into public.positions (club_id, title, level, scope, permissions)
    select p_club, r.title, r.level, r.scope, r.permissions from public.role_templates r
    on conflict (club_id, title) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Create (p_id null) or edit a position. The caller must outrank the position being written
-- and may only grant permissions they hold. Level 1 is never created or edited here.
create or replace function public.save_position(
  p_club bigint, p_id bigint, p_title text, p_level int, p_scope text, p_permissions text[], p_parent bigint default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare me int; pid bigint; old public.positions; k text; pset text[];
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  p_title := trim(coalesce(p_title, ''));
  pset := coalesce(p_permissions, '{}');
  if p_level is null or p_level < 2 or p_level > 20 then
    raise exception 'Level must be between 2 and 20 (level 1 is the President)' using errcode = '22023';
  end if;
  if p_scope not in ('club','team') then raise exception 'Scope must be club or team' using errcode = '22023'; end if;

  me := public._my_level(p_club);
  if not public.is_admin() then
    if me is null or not exists (
         select 1 from public.position_terms t join public.positions p on p.id = t.position_id and p.club_id = t.club_id
          where t.profile_id = auth.uid() and t.club_id = p_club
            and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)
            and p.scope = 'club' and 'position.assign' = any (p.permissions)) then
      raise exception 'You may not edit positions in this club' using errcode = '42501';
    end if;
    if p_level <= me then
      raise exception 'You can only create positions below your own level (%)', me using errcode = '42501';
    end if;
    foreach k in array pset loop
      if not public.has_perm(p_club, k) then
        raise exception 'You cannot grant a permission you do not hold: %', k using errcode = '42501';
      end if;
    end loop;
  end if;

  if p_parent is not null and not exists (
       select 1 from public.positions where id = p_parent and club_id = p_club and level < p_level) then
    raise exception 'The parent position must be in this club and above this level' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.positions (club_id, title, level, scope, permissions, parent_id)
      values (p_club, p_title, p_level, p_scope, pset, p_parent) returning id into pid;
  else
    select * into old from public.positions where id = p_id and club_id = p_club;
    if not found then raise exception 'No such position in this club' using errcode = '22023'; end if;
    if old.level = 1 then raise exception 'The President position cannot be edited here' using errcode = '42501'; end if;
    if not public.is_admin() and old.level <= me then
      raise exception 'You can only edit positions below your own level' using errcode = '42501';
    end if;
    if old.scope <> p_scope and exists (select 1 from public.position_terms where position_id = p_id) then
      raise exception 'Scope cannot change while the position has been held; create a new position instead' using errcode = '22023';
    end if;
    update public.positions
       set title = p_title, level = p_level, scope = p_scope, permissions = pset, parent_id = p_parent
     where id = p_id returning id into pid;
  end if;
  return pid;
end;
$$;

-- Delete a position that was never held. History is never destroyed.
create or replace function public.delete_position(p_club bigint, p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare old public.positions;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into old from public.positions where id = p_id and club_id = p_club;
  if not found then raise exception 'No such position in this club' using errcode = '22023'; end if;
  if old.level = 1 then raise exception 'The President position cannot be deleted' using errcode = '42501'; end if;
  if not public.is_admin() and not (public._my_level(p_club) is not null
        and public._my_level(p_club) < old.level and public.has_perm(p_club, 'position.assign')) then
    raise exception 'You may not delete this position' using errcode = '42501';
  end if;
  if exists (select 1 from public.position_terms where position_id = p_id) then
    raise exception 'This position has been held by someone, so it is kept for the record. End its terms or leave it unused.' using errcode = '23503';
  end if;
  delete from public.positions where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Appoint, end a term, hand over
-- ---------------------------------------------------------------------

create or replace function public.appoint(p_club bigint, p_email text, p_position bigint, p_team bigint default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare pid uuid; pos public.positions; tid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into pos from public.positions where id = p_position and club_id = p_club;
  if not found then raise exception 'No such position in this club' using errcode = '22023'; end if;

  if pos.scope = 'team' then
    if p_team is null or not exists (select 1 from public.teams where id = p_team and club_id = p_club) then
      raise exception 'Choose a team of this club for this position' using errcode = '22023';
    end if;
  elsif p_team is not null then
    raise exception 'A club-wide position has no team' using errcode = '22023';
  end if;

  if not public._may_manage(p_club, p_position, p_team) then
    raise exception 'You may not appoint to this position' using errcode = '42501';
  end if;

  pid := public._profile_by_email(p_email);
  perform public._guard_team_move(p_club, pid, p_team);

  -- must be a member (created or reactivated here) and, for a team position, in that team
  insert into public.memberships (club_id, profile_id, team_id)
    values (p_club, pid, p_team)
    on conflict (club_id, profile_id) do update
      set status = 'active', left_on = null,
          team_id = coalesce(excluded.team_id, public.memberships.team_id);

  if exists (select 1 from public.position_terms
              where club_id = p_club and position_id = p_position and profile_id = pid
                and team_id is not distinct from p_team and ends_on is null) then
    raise exception 'That person already holds this position' using errcode = '23505';
  end if;

  insert into public.position_terms (club_id, position_id, profile_id, team_id)
    values (p_club, p_position, pid, p_team) returning id into tid;
  return tid;
end;
$$;

create or replace function public.end_term(p_term bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.position_terms; pos public.positions;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into t from public.position_terms where id = p_term;
  if not found then raise exception 'No such term' using errcode = '22023'; end if;
  select * into pos from public.positions where id = t.position_id;

  if not public._may_manage(t.club_id, t.position_id, t.team_id) then
    raise exception 'You may not end this term' using errcode = '42501';
  end if;
  if t.profile_id = auth.uid() and not public.is_admin() then
    raise exception 'You cannot end your own term; hand over to a successor instead' using errcode = '42501';
  end if;
  if pos.level = 1 and not public.is_admin() and public._top_holders(t.club_id) <= 1 then
    raise exception 'The club would be left without a President' using errcode = '42501';
  end if;
  perform public._close_term(p_term);
end;
$$;

-- One step: the current holder(s) of a position (in a team) are replaced by a successor.
-- Allowed to the outgoing holder (handing over their own seat) and to anyone who may manage the
-- position. The successor is appointed first, so a bad e-mail changes nothing.
create or replace function public.handover(p_club bigint, p_position bigint, p_team bigint, p_new_email text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare pid uuid; pos public.positions; tid bigint; r record; own boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into pos from public.positions where id = p_position and club_id = p_club;
  if not found then raise exception 'No such position in this club' using errcode = '22023'; end if;
  if pos.scope = 'team' and (p_team is null or not exists (select 1 from public.teams where id = p_team and club_id = p_club)) then
    raise exception 'Choose a team of this club for this position' using errcode = '22023';
  end if;
  if pos.scope = 'club' and p_team is not null then
    raise exception 'A club-wide position has no team' using errcode = '22023';
  end if;

  own := exists (select 1 from public.position_terms
                  where club_id = p_club and position_id = p_position and profile_id = auth.uid()
                    and team_id is not distinct from p_team
                    and starts_on <= current_date and (ends_on is null or ends_on >= current_date));
  if not (own or public._may_manage(p_club, p_position, p_team)) then
    raise exception 'You may not hand over this position' using errcode = '42501';
  end if;

  pid := public._profile_by_email(p_new_email);
  if exists (select 1 from public.position_terms
              where club_id = p_club and position_id = p_position and profile_id = pid
                and team_id is not distinct from p_team and ends_on is null) then
    raise exception 'That person already holds this position' using errcode = '23505';
  end if;
  perform public._guard_team_move(p_club, pid, p_team);

  insert into public.memberships (club_id, profile_id, team_id)
    values (p_club, pid, p_team)
    on conflict (club_id, profile_id) do update
      set status = 'active', left_on = null,
          team_id = coalesce(excluded.team_id, public.memberships.team_id);

  -- successor first, then close the outgoing term(s): only the caller's own when they hand over
  -- their own seat (co-holders stay), every other holder when a manager replaces the seat
  insert into public.position_terms (club_id, position_id, profile_id, team_id)
    values (p_club, p_position, pid, p_team) returning id into tid;
  for r in select id from public.position_terms
            where club_id = p_club and position_id = p_position and team_id is not distinct from p_team
              and profile_id <> pid and (ends_on is null or ends_on >= current_date)
              and (not own or profile_id = auth.uid()) loop
    perform public._close_term(r.id);
  end loop;
  return tid;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Members
-- ---------------------------------------------------------------------

create or replace function public.add_member(p_club bigint, p_email text, p_team bigint default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and club_id = p_club) then
    raise exception 'No such team in this club' using errcode = '22023';
  end if;
  if not (public.is_admin() or public.has_perm(p_club, 'member.approve')
          or (p_team is not null and public.has_team_perm(p_team, 'member.approve'))) then
    raise exception 'You may not add members here' using errcode = '42501';
  end if;
  pid := public._profile_by_email(p_email);
  perform public._guard_team_move(p_club, pid, p_team);
  insert into public.memberships (club_id, profile_id, team_id) values (p_club, pid, p_team)
    on conflict (club_id, profile_id) do update
      set status = 'active', left_on = null, team_id = coalesce(excluded.team_id, public.memberships.team_id);
end;
$$;

create or replace function public.set_member_team(p_club bigint, p_profile uuid, p_team bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and club_id = p_club) then
    raise exception 'No such team in this club' using errcode = '22023';
  end if;
  if not (public.is_admin() or public.has_perm(p_club, 'member.approve')) then
    raise exception 'You may not move members' using errcode = '42501';
  end if;
  update public.memberships set team_id = p_team where club_id = p_club and profile_id = p_profile;
  if not found then raise exception 'That person is not a member' using errcode = '22023'; end if;
end;
$$;

-- Removing a member also closes their open terms. You may only remove people below your level.
create or replace function public.remove_member(p_club bigint, p_profile uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare their int; mine int; r record;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not (public.is_admin() or public.has_perm(p_club, 'member.remove')) then
    raise exception 'You may not remove members' using errcode = '42501';
  end if;
  if p_profile = auth.uid() and not public.is_admin() then
    raise exception 'You cannot remove yourself; hand over your position and leave instead' using errcode = '42501';
  end if;
  their := public._level_of(p_club, p_profile);
  mine  := public._my_level(p_club);
  if not public.is_admin() and their is not null and (mine is null or their <= mine) then
    raise exception 'You can only remove people below your own level' using errcode = '42501';
  end if;
  if their = 1 and not public.is_admin() and public._top_holders(p_club) <= 1 then
    raise exception 'The club would be left without a President' using errcode = '42501';
  end if;
  update public.memberships set status = 'removed', left_on = current_date
   where club_id = p_club and profile_id = p_profile;
  if not found then raise exception 'That person is not a member' using errcode = '22023'; end if;
  for r in select id from public.position_terms
            where club_id = p_club and profile_id = p_profile and (ends_on is null or ends_on >= current_date) loop
    perform public._close_term(r.id);
  end loop;
end;
$$;

-- The member list. A club-wide viewer sees everyone; a wing lead sees only their own team(s).
create or replace function public.club_members(p_club bigint)
returns table (profile_id uuid, full_name text, login_name text, email text, team_id bigint, team_name text,
               status text, joined_on date, titles text[])
language sql stable security definer set search_path = ''
as $$
  select m.profile_id, p.full_name, p.login_name, p.email, m.team_id, tm.name, m.status, m.joined_on,
         coalesce((select array_agg(distinct pos.title order by pos.title)
                     from public.position_terms t
                     join public.positions pos on pos.id = t.position_id and pos.club_id = t.club_id
                    where t.club_id = m.club_id and t.profile_id = m.profile_id
                      and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)),
                  '{}'::text[])
  from public.memberships m
  join public.profiles p on p.id = m.profile_id
  left join public.teams tm on tm.id = m.team_id
  where m.club_id = p_club
    and auth.uid() is not null
    and (public.has_perm(p_club, 'member.view')
         or (m.team_id is not null and public.has_team_perm(m.team_id, 'member.view')))
  order by m.status, p.full_name nulls last, p.login_name;
$$;

-- Positions of a club with who holds them now. Any member of the club may read this.
create or replace function public.club_positions(p_club bigint)
returns table (position_id bigint, title text, level int, scope text, permissions text[], parent_id bigint,
               holders jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.title, p.level, p.scope, p.permissions, p.parent_id,
         coalesce((select jsonb_agg(jsonb_build_object(
                          'term_id', t.id, 'profile_id', t.profile_id,
                          'name', coalesce(pr.full_name, pr.login_name), 'email', pr.email,
                          'team_id', t.team_id, 'team_name', tm.name, 'since', t.starts_on)
                          order by t.starts_on)
                     from public.position_terms t
                     join public.profiles pr on pr.id = t.profile_id
                     left join public.teams tm on tm.id = t.team_id
                    where t.position_id = p.id and t.club_id = p.club_id
                      and t.starts_on <= current_date and (t.ends_on is null or t.ends_on >= current_date)), '[]'::jsonb)
  from public.positions p
  where p.club_id = p_club and auth.uid() is not null
    and (public.is_member(p_club) or public.is_admin())
  order by p.level, p.title;
$$;

-- ---------------------------------------------------------------------
-- 6. create_club now seeds the standard positions
-- ---------------------------------------------------------------------
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
  insert into public.positions (club_id, title, level, scope, permissions)
    select cid, r.title, r.level, r.scope, r.permissions from public.role_templates r;
  return cid;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function
  public._close_term(bigint), public._may_manage(bigint, bigint, bigint), public._my_level(bigint),
  public._level_of(bigint, uuid), public._profile_by_email(text), public._top_holders(bigint),
  public._guard_team_move(bigint, uuid, bigint),
  public.apply_role_templates(bigint),
  public.save_position(bigint, bigint, text, int, text, text[], bigint),
  public.delete_position(bigint, bigint),
  public.appoint(bigint, text, bigint, bigint), public.end_term(bigint),
  public.handover(bigint, bigint, bigint, text),
  public.add_member(bigint, text, bigint), public.set_member_team(bigint, uuid, bigint),
  public.remove_member(bigint, uuid), public.club_members(bigint), public.club_positions(bigint),
  public.create_club(text, text, text)
  from public, anon, authenticated;

grant execute on function
  public.apply_role_templates(bigint),
  public.save_position(bigint, bigint, text, int, text, text[], bigint),
  public.delete_position(bigint, bigint),
  public.appoint(bigint, text, bigint, bigint), public.end_term(bigint),
  public.handover(bigint, bigint, bigint, text),
  public.add_member(bigint, text, bigint), public.set_member_team(bigint, uuid, bigint),
  public.remove_member(bigint, uuid), public.club_members(bigint), public.club_positions(bigint),
  public.create_club(text, text, text)
  to authenticated;
-- The underscore helpers stay private: they are only called from inside the functions above.
