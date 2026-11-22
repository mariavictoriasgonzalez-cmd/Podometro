-- El panel muestra también el nombre con el que la app saluda a cada persona (editable por ella),
-- además del nombre registrado de Google (fijo).
drop function if exists public.admin_user_stats();
create or replace function public.admin_user_stats()
returns table (
  user_id uuid, email text, full_name text, nickname text, photo text, avatar text, daily_goal integer,
  created_at timestamptz, last_seen_at timestamptz,
  total_steps bigint, days_active bigint, steps_7d bigint, steps_30d bigint,
  manual_steps_30d bigint, best_day integer, active_seconds_7d bigint, last_day date, badges bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.email, p.full_name, nullif(left(p.settings ->> 'name', 40), ''), p.avatar_url,
         p.settings ->> 'avatar', nullif(p.settings ->> 'dailyGoal', '')::integer,
         p.created_at, p.last_seen_at,
         coalesce(sum(d.steps), 0)::bigint,
         count(d.day) filter (where d.steps > 0),
         coalesce(sum(d.steps) filter (where d.day > current_date - 7), 0)::bigint,
         coalesce(sum(d.steps) filter (where d.day > current_date - 30), 0)::bigint,
         coalesce(sum(d.manual_steps) filter (where d.day > current_date - 30), 0)::bigint,
         coalesce(max(d.steps), 0),
         coalesce(sum(d.active_seconds) filter (where d.day > current_date - 7), 0)::bigint,
         max(d.day),
         (select count(*) from public.badges b where b.user_id = p.id)
  from public.profiles p
  left join public.day_steps d on d.user_id = p.id
  group by p.id
  order by p.last_seen_at desc nulls last;
end;
$$;
revoke execute on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_user_stats() to authenticated;
