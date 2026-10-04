-- =====================================================================
-- Phase 1 exit test: two clubs, several accounts, nothing leaks across clubs.
-- Run in: Supabase SQL Editor (or psql) AFTER migrations 0001 to 0005.
-- Everything happens inside one transaction that is rolled back at the end,
-- so no test data is left behind. Any failed check stops the script with a
-- message that starts with FAIL. If it reaches the last line, all checks passed.
-- Run this before every release that touches policies or the schema.
-- =====================================================================
begin;

create schema t;
grant usage on schema t to anon, authenticated;

create function t.a() returns bigint language sql stable as $$ select current_setting('t.a')::bigint $$;
create function t.b() returns bigint language sql stable as $$ select current_setting('t.b')::bigint $$;
create function t.team1() returns bigint language sql stable as $$ select current_setting('t.team1')::bigint $$;
create function t.team2() returns bigint language sql stable as $$ select current_setting('t.team2')::bigint $$;

-- Pretend to be a signed-in user (call while still the superuser).
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

-- The statement must be refused: by privileges, Row Level Security, or a deliberate RAISE.
create function t.must_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege or raise_exception then
    return;
  end;
  raise exception 'FAIL (%): was allowed but should be denied -> %', label, stmt;
end $$;

-- The statement must touch exactly n rows (0 = Row Level Security hid them).
create function t.must_touch(label text, stmt text, want int) returns void language plpgsql as $$
declare got int;
begin
  execute stmt;
  get diagnostics got = row_count;
  if got <> want then
    raise exception 'FAIL (%): touched % rows, wanted % -> %', label, got, want, stmt;
  end if;
end $$;

-- A count query must return want.
create function t.count_is(label text, stmt text, want bigint) returns void language plpgsql as $$
declare got bigint;
begin
  execute stmt into got;
  if got is distinct from want then
    raise exception 'FAIL (%): got %, wanted % -> %', label, got, want, stmt;
  end if;
end $$;

create function t.is_true(label text, got boolean) returns void language plpgsql as $$
begin
  if got is distinct from true then raise exception 'FAIL (%): expected true', label; end if;
end $$;
create function t.is_false(label text, got boolean) returns void language plpgsql as $$
begin
  if got is distinct from false then raise exception 'FAIL (%): expected false', label; end if;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------------
-- Accounts
--   alice  President of Club A          bob   President of Club B
--   carol  plain member of Club A       dave  platform admin, no club position
--   erin   President of A, term ended   frank wing lead (team scope) in A
-- ---------------------------------------------------------------------
-- From migration 0006 on, an account may only be created for an invited or admitted e-mail.
do $$ begin
  if to_regclass('public.signup_invites') is not null then
    insert into public.signup_invites (email)
    select e || '@test.local' from unnest(array['alice','bob','carol','dave','erin','frank']) e;
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'erin@test.local'),
  ('00000000-0000-0000-0000-00000000000f', 'frank@test.local');
update public.profiles set is_admin = true where email = 'dave@test.local';

select set_config('t.a', public.create_club('Test Club A', 'test-a')::text, false);
select set_config('t.b', public.create_club('Test Club B', 'test-b')::text, false);
select public.appoint_president(t.a(), 'alice@test.local');
select public.appoint_president(t.b(), 'bob@test.local');

insert into public.memberships (club_id, profile_id) values
  (t.a(), '00000000-0000-0000-0000-00000000000c'),
  (t.a(), '00000000-0000-0000-0000-00000000000f');
select public.appoint_president(t.a(), 'erin@test.local');
update public.position_terms set starts_on = current_date - 30, ends_on = current_date - 1
 where profile_id = '00000000-0000-0000-0000-00000000000e';

insert into public.teams (club_id, name) values (t.a(), 'Mechanical'), (t.a(), 'Electronics');
select set_config('t.team1', (select id::text from public.teams where club_id = t.a() and name = 'Mechanical'), false);
select set_config('t.team2', (select id::text from public.teams where club_id = t.a() and name = 'Electronics'), false);
insert into public.positions (club_id, title, level, permissions, scope)
  values (t.a(), 'Wing lead', 3, '{member.view}', 'team');
insert into public.position_terms (club_id, position_id, profile_id, team_id)
  select t.a(), id, '00000000-0000-0000-0000-00000000000f', t.team1()
    from public.positions where club_id = t.a() and title = 'Wing lead';

-- Data in both clubs, written as the superuser.
insert into public.events (event_name, date, club_id) values ('Event A', current_date, t.a()), ('Event B', current_date, t.b());
insert into public.certificates (name, email, cert_link, event_name, club_id) values
  ('Ann', 'ann@a.test', 'http://x/a.png', 'Event A', t.a()), ('Bea', 'bea@b.test', 'http://x/b.png', 'Event B', t.b());
insert into public.forms (slug, name, club_id) values ('form_a', 'Form A', t.a()), ('form_b', 'Form B', t.b());
insert into public.form_responses (form_id, data)
  select id, '{"name":"x"}' from public.forms where slug in ('form_a', 'form_b');
insert into public.mailing_lists (name, club_id) values ('List A', t.a()), ('List B', t.b());
insert into public.mailing_list_members (list_id, name, email)
  select id, 'm', 'm@' || name || '.test' from public.mailing_lists where name in ('List A', 'List B');
insert into public.short_links (slug, url, club_id) values ('link-a', 'https://a.test', t.a()), ('link-b', 'https://b.test', t.b());
insert into public.notification (username, message, club_id)
  values ('alice', 'hello A', t.a()), ('bob', 'hello B', t.b());

-- ---------------------------------------------------------------------
-- has_perm answers
-- ---------------------------------------------------------------------
reset role; select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.is_true ('alice has mail.send in A',        public.has_perm(t.a(), 'mail.send'));
select t.is_false('alice has no mail.send in B',     public.has_perm(t.b(), 'mail.send'));
select t.is_false('unknown permission is false',     public.has_perm(t.a(), 'no.such.permission'));

reset role; select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.is_false('carol (member only) has no mail.send', public.has_perm(t.a(), 'mail.send'));
select t.is_true ('carol is a member of A',          public.is_member(t.a()));
select t.is_false('carol is not a member of B',      public.is_member(t.b()));

reset role; select t.as_user('00000000-0000-0000-0000-00000000000e');
select t.is_false('erin (term ended) has no mail.send', public.has_perm(t.a(), 'mail.send'));

reset role; select t.as_user('00000000-0000-0000-0000-00000000000d');
select t.is_false('platform admin has no club permission by default', public.has_perm(t.a(), 'mail.send'));

reset role; select t.as_user('00000000-0000-0000-0000-00000000000f');
select t.is_true ('wing lead has member.view for own team',   public.has_team_perm(t.team1(), 'member.view'));
select t.is_false('wing lead has no member.view for other team', public.has_team_perm(t.team2(), 'member.view'));
select t.is_false('team-scoped position gives nothing club-wide', public.has_perm(t.a(), 'member.view'));

reset role;
update public.clubs set status = 'dormant' where id = t.a();
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.is_false('dormant club grants nothing', public.has_perm(t.a(), 'mail.send'));
reset role;
update public.clubs set status = 'active' where id = t.a();

-- ---------------------------------------------------------------------
-- alice (President of A) against Club B
-- ---------------------------------------------------------------------
reset role; select t.as_user('00000000-0000-0000-0000-00000000000a');

-- reads that must be empty for B
select t.count_is('alice sees only her club', 'select count(*) from public.clubs where slug like ''test-%''', 1);
select t.count_is('alice cannot see B mailing lists',  format('select count(*) from public.mailing_lists where club_id = %s', t.b()), 0);
select t.count_is('alice sees A mailing lists',        format('select count(*) from public.mailing_lists where club_id = %s', t.a()), 1);
select t.count_is('alice cannot see B list members',   'select count(*) from public.mailing_list_members where email like ''%List B.test''', 0);
select t.count_is('alice cannot see B short links',    format('select count(*) from public.short_links where club_id = %s', t.b()), 0);
select t.count_is('alice cannot see B responses',      'select count(*) from public.form_responses r join public.forms f on f.id = r.form_id where f.slug = ''form_b''', 0);
select t.count_is('alice sees A responses',            'select count(*) from public.form_responses r join public.forms f on f.id = r.form_id where f.slug = ''form_a''', 1);
select t.count_is('alice cannot see B memberships',    format('select count(*) from public.memberships where club_id = %s', t.b()), 0);
select t.count_is('alice cannot see B positions',      format('select count(*) from public.positions where club_id = %s', t.b()), 0);
select t.count_is('alice cannot see B audit log',      format('select count(*) from public.audit_log where club_id = %s', t.b()), 0);
select t.is_true ('alice A audit log is not empty',    (select count(*) > 0 from public.audit_log where club_id = t.a()));
select t.count_is('alice cannot see B notifications',  format('select count(*) from public.notification where club_id = %s', t.b()), 0);
select t.must_fail('alice reads certificate e-mails',  'select email from public.certificates');
select t.must_fail('dashboard stats for B',            format('select public.dashboard_stats(%s)', t.b()));
select t.must_fail('alerts for B',                     format('select * from public.recent_alerts(5, %s)', t.b()));
select t.is_true ('alice dashboard stats for A work',  (public.dashboard_stats(t.a())->>'members_count')::int >= 3);

-- writes into B must be refused or touch nothing
select t.must_fail('insert event in B',      format('insert into public.events (event_name, date, club_id) values (''Hack'', current_date, %s)', t.b()));
select t.must_fail('insert certificate in B',format('insert into public.certificates (name, email, cert_link, event_name, club_id) values (''h'',''h@h.t'',''http://x'',''Event B'',%s)', t.b()));
select t.must_fail('insert form in B',       format('insert into public.forms (slug, name, club_id) values (''hack'',''Hack'',%s)', t.b()));
select t.must_fail('insert list in B',       format('insert into public.mailing_lists (name, club_id) values (''Hack'',%s)', t.b()));
select t.must_fail('insert link in B',       format('insert into public.short_links (slug, url, club_id) values (''hack'',''https://h.t'',%s)', t.b()));
select t.must_fail('insert alert in B',      format('insert into public.notification (username, message, club_id) values (''alice'',''x'',%s)', t.b()));
select t.must_fail('insert member in B',     format('insert into public.memberships (club_id, profile_id) values (%s, ''00000000-0000-0000-0000-00000000000a'')', t.b()));
select t.must_touch('update B event',        'update public.events set date = date where event_name = ''Event B''', 0);
select t.must_touch('delete B certificate',  'delete from public.certificates where event_name = ''Event B''', 0);
select t.must_touch('delete B list',         'delete from public.mailing_lists where name = ''List B''', 0);
select t.must_touch('delete B link',         'delete from public.short_links where slug = ''link-b''', 0);
select t.must_touch('delete B responses',    'delete from public.form_responses r using public.forms f where f.id = r.form_id and f.slug = ''form_b''', 0);
select t.must_fail ('move own event into B', format('update public.events set club_id = %s where event_name = ''Event A''', t.b()));
select t.must_fail ('move own list into B',  format('update public.mailing_lists set club_id = %s where name = ''List A''', t.b()));

-- the same writes inside A work
select t.must_touch('insert event in A',  format('insert into public.events (event_name, date, club_id) values (''New A'', current_date, %s)', t.a()), 1);
select t.must_touch('insert list in A',   format('insert into public.mailing_lists (name, club_id) values (''List A2'', %s)', t.a()), 1);
select t.must_touch('insert link in A',   format('insert into public.short_links (slug, url, club_id) values (''link-a2'', ''https://a2.test'', %s)', t.a()), 1);
select t.must_touch('insert form in A',   format('insert into public.forms (slug, name, club_id) values (''form_a2'', ''Form A2'', %s)', t.a()), 1);
select t.must_touch('delete own link',    'delete from public.short_links where slug = ''link-a2''', 1);

-- no privilege escalation, no tampering
select t.must_fail('alice makes herself a position',   format('insert into public.positions (club_id, title, permissions) values (%s, ''God'', ''{audit.view}'')', t.a()));
select t.must_fail('alice grants herself a term',      format('insert into public.position_terms (club_id, position_id, profile_id) select %s, id, ''00000000-0000-0000-0000-00000000000a'' from public.positions limit 1', t.a()));
select t.must_fail('alice creates a club',             'insert into public.clubs (slug, name) values (''rogue'', ''Rogue'')');
select t.must_fail('alice calls create_club',          'select public.create_club(''Rogue'', ''rogue'')');
select t.must_fail('alice calls appoint_president',    format('select public.appoint_president(%s, ''alice@test.local'')', t.b()));
select t.must_fail('alice edits the audit log',        'update public.audit_log set action = ''x''');
select t.must_fail('alice deletes from the audit log', 'delete from public.audit_log');
select t.must_fail('alice writes to the audit log',    'insert into public.audit_log (action) values (''forged'')');
select t.must_fail('alice adds a profile admin flag',  'update public.profiles set is_admin = true where id = auth.uid()');

-- storage: her own folder only
select t.must_touch('upload to A folder',  format('insert into storage.objects (bucket_id, name) values (''certificates'', ''%s/ev/run/Certificate-1.png'')', t.a()), 1);
select t.must_fail ('upload to B folder',  format('insert into storage.objects (bucket_id, name) values (''certificates'', ''%s/ev/run/Certificate-1.png'')', t.b()));
select t.must_fail ('upload to legacy path', 'insert into storage.objects (bucket_id, name) values (''certificates'', ''old-event/run/Certificate-1.png'')');

-- ---------------------------------------------------------------------
-- carol (plain member) and erin (term ended): read-only at most
-- ---------------------------------------------------------------------
reset role; select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.count_is('carol sees no mailing lists',    'select count(*) from public.mailing_lists', 0);
select t.count_is('carol sees only her membership', 'select count(*) from public.memberships', 1);
select t.must_fail('carol creates a link',          format('insert into public.short_links (slug, url, club_id) values (''c'',''https://c.t'',%s)', t.a()));
select t.must_fail('carol creates an event',        format('insert into public.events (event_name, date, club_id) values (''C'', current_date, %s)', t.a()));
select t.must_fail('carol posts a warning alert',   format('insert into public.notification (username, message, type, club_id) values (''carol'',''x'',''warning'',%s)', t.a()));
select t.must_touch('carol posts an info alert',    format('insert into public.notification (username, message, club_id) values (''carol'',''hi'',%s)', t.a()), 1);
select t.must_fail ('carol posts into B',           format('insert into public.notification (username, message, club_id) values (''carol'',''hi'',%s)', t.b()));
select t.is_true   ('carol dashboard works for A',  public.dashboard_stats(t.a()) is not null);
select t.must_fail ('carol dashboard for B',        format('select public.dashboard_stats(%s)', t.b()));

reset role; select t.as_user('00000000-0000-0000-0000-00000000000e');
select t.count_is('erin (term ended) sees no mailing lists', 'select count(*) from public.mailing_lists', 0);
select t.must_fail('erin creates a link', format('insert into public.short_links (slug, url, club_id) values (''e'',''https://e.t'',%s)', t.a()));

-- ---------------------------------------------------------------------
-- bob mirrors alice
-- ---------------------------------------------------------------------
reset role; select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.count_is('bob cannot see A mailing lists', format('select count(*) from public.mailing_lists where club_id = %s', t.a()), 0);
select t.count_is('bob cannot see A audit log',     format('select count(*) from public.audit_log where club_id = %s', t.a()), 0);
select t.must_touch('bob cannot delete A link',     'delete from public.short_links where slug = ''link-a''', 0);
select t.must_fail ('bob cannot add to A',          format('insert into public.mailing_lists (name, club_id) values (''Hack'',%s)', t.a()));
select t.must_fail ('bob uploads to A folder',      format('insert into storage.objects (bucket_id, name) values (''certificates'', ''%s/x.png'')', t.a()));

-- ---------------------------------------------------------------------
-- dave (platform admin): manages structure, does not read club data
-- ---------------------------------------------------------------------
reset role; select t.as_user('00000000-0000-0000-0000-00000000000d');
select t.count_is('dave sees both clubs',                'select count(*) from public.clubs where slug in (''test-a'',''test-b'')', 2);
select t.count_is('dave cannot read A mailing lists',    'select count(*) from public.mailing_lists where name like ''List A%''', 0);
select t.count_is('dave cannot read A responses',        'select count(*) from public.form_responses', 0);
select t.is_true ('dave can create a club',              public.create_club('Test Club C', 'test-c') is not null);
select t.must_touch('dave adds a position',              format('insert into public.positions (club_id, title) values (%s, ''Archivist'')', t.a()), 1);
select t.must_fail ('dave cannot invent a permission',   format('insert into public.positions (club_id, title, permissions) values (%s, ''Odd'', ''{fly.to.moon}'')', t.a()));
select t.must_touch('dave manages legacy storage path',  'insert into storage.objects (bucket_id, name) values (''certificates'', ''old-event/run/Certificate-1.png'')', 1);

-- ---------------------------------------------------------------------
-- anonymous visitors: the public pages only
-- ---------------------------------------------------------------------
reset role; select t.as_anon();
select t.count_is('anon reads events',               'select count(*) from public.events where event_name in (''Event A'',''Event B'',''New A'')', 3);
select t.count_is('anon reads certificates (public columns)', 'select count(*) from (select id, name, event_name, cert_link from public.certificates) s where event_name in (''Event A'',''Event B'')', 2);
select t.must_fail('anon reads certificate e-mails', 'select email from public.certificates');
select t.count_is('anon reads no mailing lists',     'select count(*) from public.mailing_lists', 0);
select t.count_is('anon reads no short links',       'select count(*) from public.short_links', 0);
select t.count_is('anon reads no responses',         'select count(*) from public.form_responses', 0);
select t.count_is('anon reads no clubs',             'select count(*) from public.clubs', 0);
select t.must_touch('anon submits a registration',   'insert into public.form_responses (form_id, data) select id, ''{"name":"anon"}'' from public.forms where slug = ''form_a''', 1);
select t.must_fail ('anon creates a link',           format('insert into public.short_links (slug, url, club_id) values (''z'',''https://z.t'',%s)', t.a()));

-- the audit log cannot be altered even by the superuser
reset role;
do $$ begin
  begin
    update public.audit_log set action = 'x';
    raise exception 'FAIL (audit append-only): update was allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

select 'ALL CHECKS PASSED' as result;
rollback;
