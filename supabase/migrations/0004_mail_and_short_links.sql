create table if not exists public.short_links (
  id          bigint generated always as identity primary key,
  slug        text not null unique
              check (slug ~ '^[A-Za-z0-9_-]{3,40}$'),
  url         text not null
              check (url ~* '^https?://' and char_length(url) <= 2000),
  created_by  text,
  created_at  timestamptz not null default now(),
  clicks      bigint not null default 0
);

alter table public.short_links enable row level security;

drop policy if exists short_links_admin on public.short_links;
create policy short_links_admin on public.short_links for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.resolve_short_link(s text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  target text;
begin
  if s is null or s !~ '^[A-Za-z0-9_-]{3,40}$' then
    return null;
  end if;
  update public.short_links set clicks = clicks + 1
   where slug = s
  returning url into target;
  return target;
end;
$$;

revoke execute on function public.resolve_short_link(text) from public, anon, authenticated;
grant  execute on function public.resolve_short_link(text) to anon, authenticated;

delete from public.mailing_list_members a
 using public.mailing_list_members b
 where a.list_id = b.list_id
   and lower(a.email) = lower(b.email)
   and a.id > b.id;

create unique index if not exists mailing_members_unique_email
  on public.mailing_list_members (list_id, lower(email));
