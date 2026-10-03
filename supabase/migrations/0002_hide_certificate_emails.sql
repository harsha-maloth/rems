-- =====================================================================
-- 0002: keep certificate e-mail addresses private
-- Run once in: Supabase Dashboard -> SQL Editor
--
-- Why: the public CDS must be readable by anyone (anon role), and the row policy
-- "certificates_read" allows every row. Without this, anyone holding the public anon
-- key could request the `email` column through the API and collect student addresses.
-- The public pages never ask for it; this makes the database refuse it as well.
-- Signed-in members (authenticated role) are unaffected.
-- =====================================================================
revoke select on public.certificates from anon;

grant select (id, name, regno, dept, year, section, position, cert_link, event_name, college)
  on public.certificates to anon;
