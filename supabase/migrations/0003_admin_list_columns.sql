-- =====================================================================
-- 0003: column list for the admin DB manager (db-manage.html)
-- Run once in: Supabase Dashboard -> SQL Editor
--
-- The manager needs column names and types even for empty tables, so it can
-- build the "add row" form. Admin-only, like admin_list_tables().
-- =====================================================================
create or replace function public.admin_list_columns(tbl text)
returns table (column_name text, data_type text, is_nullable boolean, is_identity boolean, has_default boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select c.column_name::text,
           c.data_type::text,
           (c.is_nullable = 'YES'),
           (c.is_identity = 'YES'),
           (c.column_default is not null)
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = tbl
    order by c.ordinal_position;
end;
$$;

-- New functions are executable by everyone by default: lock it down like 0001 does.
revoke execute on function public.admin_list_columns(text) from public, anon;
grant  execute on function public.admin_list_columns(text) to authenticated;
