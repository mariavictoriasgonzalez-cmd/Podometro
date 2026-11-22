-- Endurece la integridad de los datos (ya aplicado al proyecto "pasito").

-- 1) Perfiles: nombre, correo y foto vienen de Google y no se pueden cambiar desde fuera
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (settings, consent_at, last_seen_at, updated_at) on public.profiles to authenticated;
drop policy if exists "perfil: crear propio" on public.profiles;
alter table public.profiles add constraint settings_size check (pg_column_size(settings) < 20000);

create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
     set email = new.email,
         full_name = coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', full_name),
         avatar_url = coalesce(new.raw_user_meta_data ->> 'avatar_url', avatar_url)
   where id = new.id;
  return new;
end;
$$;
revoke execute on function public.sync_profile_from_auth() from public, anon, authenticated;
create trigger on_auth_user_updated after update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth();

-- 2) y 3) Días: el servidor limpia los datos y calcula los totales; los pasos a mano van aparte
alter table public.day_steps add column auto_steps integer not null default 0;
alter table public.day_steps add column manual_steps integer not null default 0;

create or replace function public.day_steps_sanitize()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  clean_auto jsonb;
  clean_manual jsonb;
begin
  if new.day < date '2024-01-01' or new.day > current_date + 1 then
    raise exception 'fecha fuera de rango';
  end if;
  -- minutos 0..1439, como mucho 250 pasos por minuto
  select coalesce(jsonb_object_agg(k, least(v, 250)), '{}'::jsonb) into clean_auto
  from (
    select key as k, (value #>> '{}')::numeric::int as v
    from jsonb_each(case when jsonb_typeof(new.auto) = 'object' then new.auto else '{}'::jsonb end)
    where key ~ '^\d{1,4}$' and key::int between 0 and 1439
      and jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 1
  ) a;
  -- registros a mano: como mucho 50.000 pasos y 24 h cada uno, y 50 por día
  select coalesce(jsonb_agg(e), '[]'::jsonb) into clean_manual
  from (
    select jsonb_build_object(
             'id', left(e ->> 'id', 64),
             'start', (e ->> 'start')::numeric::bigint,
             'end', coalesce((e ->> 'end')::numeric::bigint, (e ->> 'start')::numeric::bigint),
             'steps', (e ->> 'steps')::numeric::int,
             'seconds', least(greatest(coalesce((e ->> 'seconds')::numeric::int, 0), 0), 86400),
             'source', 'manual') as e
    from jsonb_array_elements(case when jsonb_typeof(new.manual) = 'array' then new.manual else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object'
      and (e ->> 'steps') ~ '^\d+(\.\d+)?$' and (e ->> 'steps')::numeric between 1 and 50000
      and (e ->> 'start') ~ '^\d+(\.\d+)?$'
    limit 50
  ) m;
  new.auto := clean_auto;
  new.manual := clean_manual;
  new.auto_steps := coalesce((select sum(value::text::int) from jsonb_each(clean_auto)), 0);
  new.manual_steps := least(coalesce((select sum((e ->> 'steps')::int) from jsonb_array_elements(clean_manual) e), 0), 100000);
  new.steps := new.auto_steps + new.manual_steps;
  new.active_seconds := least(
    60 * (select count(*) from jsonb_each(clean_auto) where value::text::int >= 15)
    + coalesce((select sum((e ->> 'seconds')::int) from jsonb_array_elements(clean_manual) e), 0), 86400);
  new.updated_at := now();
  return new;
end;
$$;
create trigger day_steps_sanitize before insert or update on public.day_steps
  for each row execute function public.day_steps_sanitize();

-- Insignias: solo las concede el servidor
revoke insert, update, delete on public.badges from anon, authenticated;
drop policy if exists "insignias: crear propias" on public.badges;
drop policy if exists "insignias: editar propias" on public.badges;

create or replace function public.refresh_badges()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  st jsonb;
  goal int;
  dm int[]; wm int[]; tm int[];
  total bigint;
  best_streak int;
  n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select settings into st from public.profiles where id = uid;
  st := coalesce(st, '{}'::jsonb);
  goal := greatest(coalesce(nullif(st ->> 'dailyGoal', '')::int, 8000), 500);
  dm := coalesce((select array_agg(x::int) from jsonb_array_elements_text(st -> 'dailyMilestones') x where x ~ '^\d+$'), array[1000,5000,8000,10000,15000,20000]);
  wm := coalesce((select array_agg(x::int) from jsonb_array_elements_text(st -> 'weeklyMilestones') x where x ~ '^\d+$'), array[35000,50000,70000,100000]);
  tm := coalesce((select array_agg(x::int) from jsonb_array_elements_text(st -> 'totalMilestones') x where x ~ '^\d+$'), array[10000,50000,100000,250000,500000,1000000]);

  create temp table if not exists _earned (badge_id text primary key, cnt int) on commit drop;
  truncate _earned;

  select coalesce(sum(steps), 0) into total from public.day_steps where user_id = uid;

  -- hitos diarios (cuántos días), semanales (cuántas semanas) y acumulados
  insert into _earned
  select 'd' || m, count(*) from unnest(dm) m join public.day_steps d on d.user_id = uid and d.steps >= m and m > 0 group by m;
  insert into _earned
  select 'w' || m, count(*) from unnest(wm) m
    join (select date_trunc('week', day) wk, sum(steps) s from public.day_steps where user_id = uid group by 1) w on w.s >= m and m > 0
  group by m;
  insert into _earned select 't' || m, 1 from unnest(tm) m where total >= m and m > 0;

  -- rachas cumpliendo el objetivo
  select coalesce(max(len), 0) into best_streak from (
    select count(*) len from (
      select day, day - (row_number() over (order by day))::int grp
      from public.day_steps where user_id = uid and steps >= goal) g
    group by grp) r;
  insert into _earned select 's' || x, 1 from unnest(array[3,7,14,30]) x where best_streak >= x;

  -- especiales
  if total > 0 then insert into _earned values ('first', 1); end if;
  if exists (select 1 from public.day_steps where user_id = uid and steps >= 2 * goal) then insert into _earned values ('double', 1); end if;
  if exists (
    select 1 from public.day_steps sat join public.day_steps sun
      on sun.user_id = sat.user_id and sun.day = sat.day + 1
    where sat.user_id = uid and extract(isodow from sat.day) = 6 and sat.steps >= goal and sun.steps >= goal)
  then insert into _earned values ('weekend', 1); end if;

  -- caminatas detectadas: minutos con 15+ pasos, huecos de hasta 3 min, 5 min o más
  with mins as (
    select d.day, e.key::int m from public.day_steps d, jsonb_each(d.auto) e
    where d.user_id = uid and e.value::text::int >= 15),
  f as (select day, m, case when m - lag(m) over (partition by day order by m) <= 3 then 0 else 1 end brk from mins),
  isl as (select day, m, sum(brk) over (partition by day order by m) grp from f),
  walks as (select day, min(m) s, max(m) e, count(*) active from isl group by day, grp having max(m) - min(m) + 1 >= 5)
  insert into _earned
  select 'early', 1 where exists (select 1 from walks where s < 480)
  union all select 'night', 1 where exists (select 1 from walks where s >= 1260)
  union all select 'long', 1 where exists (select 1 from walks where active >= 60)
     or exists (select 1 from public.day_steps d, jsonb_array_elements(d.manual) e where d.user_id = uid and (e ->> 'seconds')::int >= 3600);

  insert into public.badges (user_id, badge_id, unlocked_at, count)
  select uid, badge_id, now(), cnt from _earned
  on conflict (user_id, badge_id) do update set count = excluded.count;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.refresh_badges() from public, anon;
grant execute on function public.refresh_badges() to authenticated;

-- Panel: separar pasos del contador y pasos a mano
drop function if exists public.admin_user_stats();
create or replace function public.admin_user_stats()
returns table (
  user_id uuid, email text, full_name text, photo text, avatar text, daily_goal integer,
  created_at timestamptz, last_seen_at timestamptz,
  total_steps bigint, days_active bigint, steps_7d bigint, steps_30d bigint,
  manual_steps_30d bigint, best_day integer, active_seconds_7d bigint, last_day date, badges bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.email, p.full_name, p.avatar_url,
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
