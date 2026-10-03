-- Sample rows for testing the public pages (Phase 3). Run in the Supabase SQL Editor.
-- Delete them afterwards with the block at the bottom.

insert into public.events (event_name, date, is_inter) values
  ('sample hackathon', '2026-09-20', false),
  ('sample inter quiz', '2026-09-27', true);

insert into public.certificates (name, regno, dept, year, section, email, position, cert_link, event_name, college) values
  ('asha nair',   'SC24B001', 'avionics',  2, 'a', 'asha@example.com',  'participant', 'https://example.com/cert-1.png', 'sample hackathon', null),
  ('rahul menon', 'SC23B042', 'aerospace', 3, 'b', 'rahul@example.com', 'winner',      'https://example.com/cert-2.png', 'sample hackathon', null),
  ('meera joseph', null, null, 1, null, 'meera@example.com', 'runner', 'https://example.com/cert-3.png', 'sample inter quiz', 'sample college of engineering');

insert into public.forms (slug, name, description, event_type, number_participants, fields) values
  ('sample-workshop', 'Sample Workshop', 'Register for the sample workshop.', 'individual', 1,
   '["name","email","phoneno","dept","year"]'),
  ('sample-team-event', 'Sample Team Event', 'Two people per team.', 'team', 2,
   '["name","email"]');

-- ---- cleanup (run when you are done testing) ----
-- delete from public.certificates where event_name in ('sample hackathon', 'sample inter quiz');
-- delete from public.events       where event_name in ('sample hackathon', 'sample inter quiz');
-- delete from public.forms        where slug in ('sample-workshop', 'sample-team-event');  -- also removes their responses
