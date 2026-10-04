revoke select on public.certificates from anon;

grant select (id, name, regno, dept, year, section, position, cert_link, event_name, college)
  on public.certificates to anon;
