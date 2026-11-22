-- Esquema de Pasito en Supabase (ya aplicado al proyecto "pasito").
-- Para dar acceso de administración a una cuenta (no se guarda aquí):
--   insert into public.admin_emails(email) values ('correo@ejemplo.com');

-- Perfiles de usuario
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  settings jsonb not null default '{}'::jsonb,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- Pasos por día (auto: pasos por minuto del contador; manual: registros a mano)
create table public.day_steps (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  steps integer not null default 0 check (steps between 0 and 500000),
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  auto jsonb not null default '{}'::jsonb,
  manual jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Insignias conseguidas
create table public.badges (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  badge_id text not null,
  unlocked_at timestamptz not null default now(),
  count integer not null default 1,
  primary key (user_id, badge_id)
);

-- Correos con acceso de administración (no accesible desde la app)
create table public.admin_emails (email text primary key);

alter table public.profiles enable row level security;
alter table public.day_steps enable row level security;
alter table public.badges enable row level security;
alter table public.admin_emails enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_emails a where lower(a.email) = lower(auth.jwt() ->> 'email'));
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Políticas: cada uno lo suyo; la administración puede leer todo
create policy "perfil: leer propio o admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "perfil: crear propio" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "perfil: editar propio" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "días: leer propios o admin" on public.day_steps for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "días: crear propios" on public.day_steps for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "días: editar propios" on public.day_steps for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "días: borrar propios" on public.day_steps for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "insignias: leer propias o admin" on public.badges for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "insignias: crear propias" on public.badges for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "insignias: editar propias" on public.badges for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Perfil automático al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Borrar la propia cuenta y todos sus datos
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Resumen de todos los usuarios (solo administración)
create or replace function public.admin_user_stats()
returns table (
  user_id uuid, email text, full_name text, photo text, avatar text, daily_goal integer,
  created_at timestamptz, last_seen_at timestamptz,
  total_steps bigint, days_active bigint, steps_7d bigint, steps_30d bigint,
  best_day integer, active_seconds_7d bigint, last_day date, badges bigint
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
