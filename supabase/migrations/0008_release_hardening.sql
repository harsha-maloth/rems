drop function if exists public.email_for_username(text);

revoke select on public.certificates from public, anon, authenticated;
grant select (id, name, regno, dept, year, section, position, cert_link, event_name, college, club_id)
  on public.certificates to anon, authenticated;

insert into public.app_settings (key, value) values
  ('form_hourly_cap', '300'),
  ('form_daily_cap',  '2000'),
  ('mail_daily_cap',  '300')
on conflict (key) do nothing;

create index if not exists form_responses_form_created_idx
  on public.form_responses (form_id, created_at);

create or replace function public._form_responses_throttle()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  hourly int := coalesce((select value::int from public.app_settings where key = 'form_hourly_cap'), 300);
  daily  int := coalesce((select value::int from public.app_settings where key = 'form_daily_cap'), 2000);
begin
  if (select count(*) from public.form_responses
        where form_id = new.form_id and created_at > now() - interval '1 hour') >= hourly
     or (select count(*) from public.form_responses
        where form_id = new.form_id and created_at > now() - interval '1 day') >= daily then
    raise exception 'This form is receiving too many answers right now. Please try again later.'
      using errcode = '54000';
  end if;
  return new;
end $$;

revoke execute on function public._form_responses_throttle() from public, anon, authenticated;

drop trigger if exists form_responses_throttle on public.form_responses;
create trigger form_responses_throttle
  before insert on public.form_responses
  for each row execute function public._form_responses_throttle();

create table if not exists public.mail_log (
  id         bigint generated always as identity primary key,
  club_id    bigint not null references public.clubs(id) on delete cascade,
  sent_by    uuid,
  recipients int not null check (recipients >= 0),
  created_at timestamptz not null default now()
);
create index if not exists mail_log_club_created_idx on public.mail_log (club_id, created_at);
alter table public.mail_log enable row level security;

revoke all on public.mail_log from public, anon, authenticated;

create or replace function public.mail_quota_take(p_club bigint, p_n int)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cap     int := coalesce((select value::int from public.app_settings where key = 'mail_daily_cap'), 300);
  used    int;
  allowed int;
begin
  if auth.uid() is null or not public.has_perm(p_club, 'mail.send') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_n is null or p_n <= 0 then return 0; end if;

  perform pg_advisory_xact_lock(hashtext('mail_quota'), p_club::int);
  select coalesce(sum(recipients), 0) into used
    from public.mail_log where club_id = p_club and created_at > now() - interval '1 day';
  allowed := greatest(0, least(p_n, cap - used));
  if allowed > 0 then
    insert into public.mail_log (club_id, sent_by, recipients) values (p_club, auth.uid(), allowed);
  end if;
  return allowed;
end $$;

revoke execute on function public.mail_quota_take(bigint, int) from public, anon, authenticated;
grant  execute on function public.mail_quota_take(bigint, int) to authenticated;
