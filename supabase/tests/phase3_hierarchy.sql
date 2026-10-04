begin;

create schema t;
grant usage on schema t to anon, authenticated;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function t.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function t.must_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when insufficient_privilege or raise_exception or check_violation or invalid_parameter_value
                 or unique_violation or foreign_key_violation or no_data_found then return;
  end;
  raise exception 'FAIL (%): was allowed but should be denied -> %', label, stmt;
end $$;
create function t.count_is(label text, stmt text, want bigint) returns void language plpgsql as $$
declare got bigint;
begin
  execute stmt into got;
  if got is distinct from want then raise exception 'FAIL (%): got %, wanted % -> %', label, got, want, stmt; end if;
end $$;
create function t.is_true(label text, got boolean) returns void language plpgsql as $$
begin if got is distinct from true then raise exception 'FAIL (%): expected true', label; end if; end $$;
create function t.is_false(label text, got boolean) returns void language plpgsql as $$
begin if got is distinct from false then raise exception 'FAIL (%): expected false', label; end if; end $$;

create function t.x() returns bigint language sql stable security definer as $$ select current_setting('t.x')::bigint $$;
create function t.y() returns bigint language sql stable security definer as $$ select current_setting('t.y')::bigint $$;
create function t.pos(p_title text) returns bigint language sql stable security definer as
  $$ select id from public.positions where club_id = current_setting('t.x')::bigint and title = p_title $$;
create function t.top(p_club bigint) returns int language sql stable security definer as
  $$ select public._top_holders(p_club) $$;
create function t.ypos(p_title text) returns bigint language sql stable security definer as
  $$ select id from public.positions where club_id = current_setting('t.y')::bigint and title = p_title $$;
create function t.team(p_name text) returns bigint language sql stable security definer as
  $$ select id from public.teams where club_id = current_setting('t.x')::bigint and name = p_name $$;
create function t.term(p_email text, p_title text) returns bigint language sql stable security definer as
  $$ select tm.id from public.position_terms tm
       join public.profiles pr on pr.id = tm.profile_id
       join public.positions po on po.id = tm.position_id
      where pr.email = p_email and po.title = p_title and tm.club_id = current_setting('t.x')::bigint
        and (tm.ends_on is null or tm.ends_on >= current_date)
      order by tm.id desc limit 1 $$;
grant execute on all functions in schema t to anon, authenticated;

insert into public.signup_invites (email)
  select e || '@h.test' from unnest(array['pres','vp','lead','bob','carol','mallory','pres2','pete','newp','dan']) e;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'pres@h.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'vp@h.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'lead@h.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'bob@h.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'carol@h.test'),
  ('00000000-0000-0000-0000-0000000000c6', 'mallory@h.test'),
  ('00000000-0000-0000-0000-0000000000c7', 'pres2@h.test'),
  ('00000000-0000-0000-0000-0000000000c8', 'pete@h.test'),
  ('00000000-0000-0000-0000-0000000000c9', 'newp@h.test'),
  ('00000000-0000-0000-0000-0000000000ca', 'dan@h.test');
update public.profiles set is_admin = true where email = 'pete@h.test';

select set_config('t.x', public.create_club('Hier Club', 'hier-x')::text, false);
select set_config('t.y', public.create_club('Other Club', 'hier-y')::text, false);
select public.appoint_president(t.x(), 'pres@h.test');
select public.appoint_president(t.y(), 'pres2@h.test');
insert into public.teams (club_id, name) values (t.x(), 'Alpha'), (t.x(), 'Beta');

select t.count_is('new club has the 6 standard positions', format('select count(*) from public.positions where club_id = %s', t.x()), 6);
select t.is_true('wing lead is team scoped', (select scope = 'team' and level = 3 from public.positions where id = t.pos('Wing Lead')));
select t.count_is('only one level-1 position', format('select count(*) from public.positions where club_id = %s and level = 1', t.x()), 1);

select t.as_user('00000000-0000-0000-0000-0000000000c1');
select public.appoint(t.x(), 'vp@h.test', t.pos('Vice President'));
select public.appoint(t.x(), 'lead@h.test', t.pos('Wing Lead'), t.team('Alpha'));
select t.must_fail('team position without a team',   format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Wing Lead')));
select t.must_fail('club position with a team',      format('select public.appoint(%s, %L, %s, %s)', t.x(), 'dan@h.test', t.pos('Secretary'), t.team('Alpha')));
select t.must_fail('same person, same position twice', format('select public.appoint(%s, %L, %s)', t.x(), 'vp@h.test', t.pos('Vice President')));
select t.must_fail('e-mail with no account',         format('select public.appoint(%s, %L, %s)', t.x(), 'nobody@h.test', t.pos('Secretary')));
select t.must_fail('nobody is appointed President',  format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('President')));
select t.must_fail('no appointing in the other club', format('select public.appoint(%s, %L, %s)', t.y(), 'dan@h.test', t.ypos('Secretary')));
select t.must_fail('President position cannot be edited here', format('select public.save_position(%s, %s, %L, 2, %L, %L)', t.x(), t.pos('President'), 'President', 'club', '{member.view}'::text));
select t.must_fail('level 1 cannot be created',      format('select public.save_position(%s, null, %L, 1, %L, %L)', t.x(), 'Co-President', 'club', '{member.view}'::text));
select t.must_fail('President position cannot be deleted', format('select public.delete_position(%s, %s)', t.x(), t.pos('President')));
select public.save_position(t.x(), null, 'Social Media Lead', 3, 'team', '{member.view,event.create}');
select t.count_is('president added a custom position', format('select count(*) from public.positions where club_id = %s and title = %L', t.x(), 'Social Media Lead'), 1);
select t.count_is('re-applying templates adds nothing', format('select public.apply_role_templates(%s)', t.x()), 0);
select t.must_fail('unknown permission is refused', format('select public.save_position(%s, null, %L, 3, %L, %L)', t.x(), 'Bad Role', 'club', '{no.such.perm}'::text));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.is_true('vp can mail', public.has_perm(t.x(), 'mail.send'));
select public.appoint(t.x(), 'carol@h.test', t.pos('Core Member'), t.team('Beta'));
select t.must_fail('vp appoints another vice president', format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Vice President')));
select t.must_fail('vp appoints a president',            format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('President')));
select t.must_fail('vp edits the president role',        format('select public.save_position(%s, %s, %L, 2, %L, %L)', t.x(), t.pos('President'), 'President', 'club', '{member.view}'::text));
select t.must_fail('vp edits a position at their own level', format('select public.save_position(%s, %s, %L, 2, %L, %L)', t.x(), t.pos('Secretary'), 'Secretary', 'club', '{member.view}'::text));
select t.must_fail('vp creates a role at their own level', format('select public.save_position(%s, null, %L, 2, %L, %L)', t.x(), 'Second VP', 'club', '{member.view}'::text));
select t.must_fail('vp grants a permission they lack',   format('select public.save_position(%s, null, %L, 3, %L, %L)', t.x(), 'Settings Lead', 'club', '{club.settings}'::text));
select t.must_fail('vp ends the president''s term',      format('select public.end_term(%s)', t.term('pres@h.test', 'President')));
select t.must_fail('vp ends their own term',             format('select public.end_term(%s)', t.term('vp@h.test', 'Vice President')));
select t.must_fail('vp cannot edit structure directly',  format('insert into public.position_terms (club_id, position_id, profile_id) values (%s, %s, %L)', t.x(), t.pos('Secretary'), '00000000-0000-0000-0000-0000000000ca'));
select t.count_is('vp cannot rewrite positions directly', format('with u as (update public.positions set permissions = %L where club_id = %s returning 1) select count(*) from u', '{member.view}'::text, t.x()), 0);

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.count_is('lead sees only Alpha before adding anyone', format('select count(*) from public.club_members(%s)', t.x()), 1);
select public.appoint(t.x(), 'bob@h.test', t.pos('Core Member'), t.team('Alpha'));
select t.count_is('lead now sees 2 people', format('select count(*) from public.club_members(%s)', t.x()), 2);
select t.count_is('lead sees nobody from Beta', format('select count(*) from public.club_members(%s) where team_name = %L', t.x(), 'Beta'), 0);
select t.count_is('lead sees nobody without a team', format('select count(*) from public.club_members(%s) where team_name is null', t.x()), 0);
select t.must_fail('lead appoints into Beta',            format('select public.appoint(%s, %L, %s, %s)', t.x(), 'dan@h.test', t.pos('Core Member'), t.team('Beta')));
select t.must_fail('lead appoints another wing lead',    format('select public.appoint(%s, %L, %s, %s)', t.x(), 'dan@h.test', t.pos('Wing Lead'), t.team('Alpha')));
select t.must_fail('lead appoints a club-wide role',     format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Secretary')));
select t.must_fail('lead pulls a member out of Beta',    format('select public.appoint(%s, %L, %s, %s)', t.x(), 'carol@h.test', t.pos('Core Member'), t.team('Alpha')));
select t.must_fail('lead adds a member to Beta',         format('select public.add_member(%s, %L, %s)', t.x(), 'dan@h.test', t.team('Beta')));
select t.must_fail('lead removes a member',              format('select public.remove_member(%s, %L)', t.x(), '00000000-0000-0000-0000-0000000000c5'::uuid));
select t.must_fail('lead edits positions',               format('select public.save_position(%s, null, %L, 5, %L, %L)', t.x(), 'Intern', 'team', '{member.view}'::text));
select t.must_fail('lead ends the vp''s term',           format('select public.end_term(%s)', t.term('vp@h.test', 'Vice President')));
select public.add_member(t.x(), 'dan@h.test', t.team('Alpha'));
select t.count_is('lead can add to Alpha', format('select count(*) from public.club_members(%s)', t.x()), 3);
select t.is_true('lead reads the position list', (select count(*) >= 6 from public.club_positions(t.x())));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c5');
select t.count_is('carol sees only Beta', format('select count(*) from public.club_members(%s)', t.x()), 1);
select t.must_fail('carol appoints', format('select public.appoint(%s, %L, %s, %s)', t.x(), 'dan@h.test', t.pos('Core Member'), t.team('Beta')));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c6');
select t.count_is('outsider sees no members',   format('select count(*) from public.club_members(%s)', t.x()), 0);
select t.count_is('outsider sees no positions', format('select count(*) from public.club_positions(%s)', t.x()), 0);
select t.must_fail('outsider appoints', format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Secretary')));
select t.must_fail('outsider adds a member', format('select public.add_member(%s, %L)', t.x(), 'dan@h.test'));
select t.must_fail('outsider applies templates', format('select public.apply_role_templates(%s)', t.x()));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c7');
select t.count_is('other club president sees no members', format('select count(*) from public.club_members(%s)', t.x()), 0);
select t.must_fail('other club president appoints here',  format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Secretary')));
select t.must_fail('other club president hands over here', format('select public.handover(%s, %s, null, %L)', t.x(), t.pos('President'), 'dan@h.test'));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c9');
select t.must_fail('a non-holder cannot take over the president seat', format('select public.handover(%s, %s, null, %L)', t.x(), t.pos('President'), 'newp@h.test'));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c1');
select t.must_fail('handover to an unknown e-mail changes nothing', format('select public.handover(%s, %s, null, %L)', t.x(), t.pos('President'), 'ghost@h.test'));
select t.is_true('old president still has power after the failed handover', public.has_perm(t.x(), 'club.settings'));
select public.handover(t.x(), t.pos('President'), null, 'newp@h.test');
select t.is_false('old president lost every permission at once', public.has_perm(t.x(), 'mail.send'));
select t.must_fail('old president can no longer appoint', format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Secretary')));

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c9');
select t.is_true('new president has full power', public.has_perm(t.x(), 'club.settings'));
select t.count_is('exactly one president now', format('select t.top(%s)', t.x()), 1);
select t.must_fail('new president cannot end their own term', format('select public.end_term(%s)', t.term('newp@h.test', 'President')));
select t.must_fail('new president cannot remove themselves', format('select public.remove_member(%s, %L)', t.x(), '00000000-0000-0000-0000-0000000000c9'::uuid));

select public.end_term(t.term('vp@h.test', 'Vice President'));
reset role;
update public.position_terms set starts_on = current_date - 5
 where profile_id = '00000000-0000-0000-0000-0000000000c3';
select t.as_user('00000000-0000-0000-0000-0000000000c9');
select public.end_term(t.term('lead@h.test', 'Wing Lead'));
reset role;
select t.is_true('closed term stays in the record, ended yesterday',
  (select ends_on = current_date - 1 from public.position_terms where profile_id = '00000000-0000-0000-0000-0000000000c3'));
select t.is_true('audit holds the deleted same-day term', exists (select 1 from public.audit_log where target_table = 'position_terms' and action = 'delete'));
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.is_false('ex-vice-president lost power at once', public.has_perm(t.x(), 'mail.send'));
reset role; select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.count_is('ex-wing-lead sees no members any more', format('select count(*) from public.club_members(%s)', t.x()), 0);

reset role; select t.as_user('00000000-0000-0000-0000-0000000000c9');
select t.must_fail('held position cannot be deleted', format('select public.delete_position(%s, %s)', t.x(), t.pos('Wing Lead')));
select public.delete_position(t.x(), t.pos('Social Media Lead'));
select t.count_is('unused position deleted', format('select count(*) from public.positions where club_id = %s and title = %L', t.x(), 'Social Media Lead'), 0);

select public.remove_member(t.x(), '00000000-0000-0000-0000-0000000000c5'::uuid);
reset role;
select t.is_true('carol is marked removed', (select status = 'removed' and left_on = current_date from public.memberships where profile_id = '00000000-0000-0000-0000-0000000000c5' and club_id = t.x()));
select t.count_is('carol holds no open term', format('select count(*) from public.position_terms where profile_id = %L and (ends_on is null or ends_on >= current_date)', '00000000-0000-0000-0000-0000000000c5'::uuid), 0);

select t.as_user('00000000-0000-0000-0000-0000000000c8');
select public.appoint(t.y(), 'dan@h.test', t.ypos('Secretary'));
select t.is_true('platform admin appointed in club Y', true);
reset role; select t.as_anon();
select t.must_fail('anon appoints',        format('select public.appoint(%s, %L, %s)', t.x(), 'dan@h.test', t.pos('Secretary')));
select t.must_fail('anon reads members',   format('select * from public.club_members(%s)', t.x()));
select t.must_fail('anon reads positions', format('select * from public.club_positions(%s)', t.x()));
select t.must_fail('anon hands over',      format('select public.handover(%s, %s, null, %L)', t.x(), t.pos('President'), 'dan@h.test'));
select t.must_fail('anon calls a helper',  format('select public._close_term(1)'));
select t.count_is('anon sees no role templates', 'select count(*) from public.role_templates', 0);

reset role;
select t.is_true('audit holds the appointments', exists (select 1 from public.audit_log where target_table = 'position_terms' and action = 'insert'));
select t.is_true('audit holds the new position', exists (select 1 from public.audit_log where target_table = 'positions' and detail->>'title' = 'Social Media Lead'));

select 'ALL CHECKS PASSED' as result;
rollback;
