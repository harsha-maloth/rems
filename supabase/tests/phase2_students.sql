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
  exception when insufficient_privilege or raise_exception or check_violation or invalid_parameter_value then return;
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
create function t.text_is(label text, got text, want text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL (%): got %, wanted %', label, got, want; end if; end $$;
grant execute on all functions in schema t to anon, authenticated;

select public.invite_staff('uma@staff.test');
select public.invite_staff('pete@staff.test');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'uma@staff.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'pete@staff.test');
update public.profiles set is_admin = true where email = 'pete@staff.test';
insert into public.university_admins (profile_id) values ('00000000-0000-0000-0000-0000000000a1');

select t.must_fail('outsider signs up', $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'mallory@gmail.test')$$);
select t.must_fail('null e-mail signs up', $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', null)$$);

select t.as_user('00000000-0000-0000-0000-0000000000a1');

select t.count_is('uma imports 2 good + 3 bad rows',
 $$select (public.import_students('[
   {"institute_email":"Sam@iist.ac.in","enrolment_no":"sc23b001","full_name":"Sam Student","department":"Avionics","programme":"BTech","batch":"2023"},
   {"institute_email":"sara@iist.ac.in","enrolment_no":"SC23B002","full_name":"Sara Student","department":"Physics","programme":"BTech","batch":"2023"},
   {"institute_email":"wrong@gmail.com","enrolment_no":"SC23B003","full_name":"Wrong Domain"},
   {"institute_email":"dup@iist.ac.in","enrolment_no":"SC23B001","full_name":"Same Enrolment As Sam"},
   {"institute_email":"noname@iist.ac.in","enrolment_no":"SC23B004","full_name":""}
 ]'::jsonb)->>'inserted')::int$$, 2);
select t.count_is('only good rows stored', $$select count(*) from public.students$$, 2);
select t.text_is('e-mail lowercased, enrolment uppercased',
  (select institute_email || '/' || enrolment_no from public.students where full_name = 'Sam Student'), 'sam@iist.ac.in/SC23B001');
select t.count_is('re-import updates instead of inserting',
 $$select (public.import_students('[{"institute_email":"sam@iist.ac.in","enrolment_no":"SC23B001","full_name":"Sam Student","department":"Avionics"}]'::jsonb)->>'updated')::int$$, 1);
select t.must_fail('oversized import', $$select public.import_students((select jsonb_agg('{}'::jsonb) from generate_series(1,1001)))$$);
select t.must_fail('direct insert into students', $$insert into public.students (institute_email, enrolment_no, full_name) values ('x@iist.ac.in','X1','X')$$);
select t.must_fail('direct update of students',   $$update public.students set status = 'alumni'$$);
select t.must_fail('direct delete of students',   $$delete from public.students$$);
select t.count_is('uma reads the whole list', $$select count(*) from public.students$$, 2);

reset role; select t.as_anon();
select t.is_true ('anon: admitted e-mail can claim', public.can_claim('SAM@iist.ac.in'));
select t.is_false('anon: unknown e-mail cannot claim', public.can_claim('nobody@iist.ac.in'));
select t.is_false('anon: outsider cannot claim', public.can_claim('wrong@gmail.com'));
select t.text_is('anon sees the institute domain', public.institute_domain(), 'iist.ac.in');
select t.must_fail('anon reads students', $$select * from public.students$$);
select t.must_fail('anon imports', $$select public.import_students('[]'::jsonb)$$);
select t.must_fail('anon club directory', $$select * from public.club_directory()$$);
select t.must_fail('anon certificates', $$select * from public.my_certificates()$$);

reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'sam@iist.ac.in');
select t.text_is('sam is linked to the profile', (select profile_id::text from public.students where institute_email = 'sam@iist.ac.in'), '00000000-0000-0000-0000-0000000000b1');
select t.text_is('sam became a student', (select status from public.students where institute_email = 'sam@iist.ac.in'), 'student');
select t.is_true('claim time recorded', (select claimed_at is not null from public.students where institute_email = 'sam@iist.ac.in'));
select t.text_is('profile name comes from the list', (select full_name from public.profiles where email = 'sam@iist.ac.in'), 'Sam Student');
select t.must_fail('second account for the same e-mail', $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b9', 'sam@iist.ac.in')$$);
select t.is_false('claimed e-mail can no longer be claimed', public.can_claim('sam@iist.ac.in'));

reset role;
update public.students set status = 'withdrawn' where institute_email = 'sara@iist.ac.in';
select t.must_fail('withdrawn student signs up', $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b8', 'sara@iist.ac.in')$$);
update public.students set status = 'applicant' where institute_email = 'sara@iist.ac.in';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'sara@iist.ac.in');

select set_config('t.club', public.create_club('Portal Club', 'portal-club', 'We test portals.')::text, false);
select public.create_club('Dormant Club', 'dormant-club');
update public.clubs set status = 'dormant' where slug = 'dormant-club';
insert into public.events (event_name, date, club_id) values ('Portal Event', current_date, current_setting('t.club')::bigint);
insert into public.certificates (name, email, position, cert_link, event_name, club_id) values
  ('Sam Student',   'sam@iist.ac.in',   'Participant', 'http://x/sam.png',   'Portal Event', current_setting('t.club')::bigint),
  ('Sam Student',   'SAM@IIST.AC.IN',   'Winner',      'http://x/sam2.png',  'Portal Event', current_setting('t.club')::bigint),
  ('Sara Student',  'sara@iist.ac.in',  'Participant', 'http://x/sara.png',  'Portal Event', current_setting('t.club')::bigint),
  ('Stranger',      'who@else.test',    'Participant', 'http://x/who.png',   'Portal Event', current_setting('t.club')::bigint);

select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.count_is('sam sees only his own student row', $$select count(*) from public.students$$, 1);
select t.count_is('sam sees exactly his two certificates', $$select count(*) from public.my_certificates()$$, 2);
select t.count_is('sam sees none of the others', $$select count(*) from public.my_certificates() where cert_link in ('http://x/sara.png','http://x/who.png')$$, 0);
select t.text_is('certificate row carries the club name', (select club_name from public.my_certificates() limit 1), 'Portal Club');
select t.must_fail('sam reads certificate e-mails', $$select email from public.certificates$$);
select t.count_is('directory lists the active club', $$select count(*) from public.club_directory() where slug = 'portal-club'$$, 1);
select t.count_is('directory hides the dormant club', $$select count(*) from public.club_directory() where slug = 'dormant-club'$$, 0);
select t.must_fail('sam imports students', $$select public.import_students('[]'::jsonb)$$);
select t.must_fail('sam edits his student row', $$update public.students set status = 'alumni'$$);
select t.must_fail('sam adds himself as university admin', $$insert into public.university_admins (profile_id) values ('00000000-0000-0000-0000-0000000000b1')$$);
select t.must_fail('sam calls add_university_admin', $$select public.add_university_admin('sam@iist.ac.in')$$);
select t.must_fail('sam invites staff', $$select public.invite_staff('x@y.test')$$);
select t.must_fail('sam reads settings', $$select * from public.app_settings$$);
select t.must_fail('sam reads invites', $$select * from public.signup_invites$$);
select t.is_false('profile not complete without phone and name', public.complete_my_profile());
update public.profiles set phno = '9999999999', first_name = 'Sam' where id = auth.uid();
select t.is_true('profile complete after phone and name', public.complete_my_profile());
select t.is_true('completion time recorded', (select profile_completed_at is not null from public.students));
select t.count_is('sam is in no club yet', $$select count(*) from public.my_clubs()$$, 0);

reset role; select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.count_is('sara sees only her own row', $$select count(*) from public.students$$, 1);
select t.text_is('and it is hers', (select institute_email from public.students), 'sara@iist.ac.in');
select t.count_is('sara sees one certificate', $$select count(*) from public.my_certificates()$$, 1);
select t.text_is('and it is hers', (select cert_link from public.my_certificates()), 'http://x/sara.png');

reset role; select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.count_is('platform admin cannot read students', $$select count(*) from public.students$$, 0);
select t.must_fail('platform admin cannot import', $$select public.import_students('[]'::jsonb)$$);
select t.must_fail('platform admin cannot write students', $$delete from public.students$$);
select public.invite_staff('new@staff.test');
select t.is_true('platform admin made an invite (checked later)', true);
select public.add_university_admin('pete@staff.test');
select t.is_true('and the new university admin can read the list', (select count(*) = 2 from public.students));

reset role;
select t.is_true('audit holds the role change', exists (select 1 from public.audit_log where target_table = 'university_admins'));
select t.is_true('audit holds the import', exists (select 1 from public.audit_log where action = 'import_students'));

select 'ALL CHECKS PASSED' as result;
rollback;
