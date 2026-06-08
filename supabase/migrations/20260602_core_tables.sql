-- Core application tables for FABS × ProFace.
-- The `public` schema was missing these, so analysis history never saved and
-- subscription access (hasAccess) was always false. Idempotent: safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: one row per auth user — contact info + subscription state.
-- Read by lib/auth.tsx checkAccess(); written by signUp() upsert.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  phone               text,
  subscription_status text not null default 'pending',  -- 'pending' | 'pro'
  created_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

grant select, insert, update on public.profiles to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- face_analyses: history of completed analyses.
-- Written by lib/analysisStore.saveAnalysisForUser(); read by the dashboard
-- (fetchAnalysesForUser) and detail/feature pages (fetchAnalysisById).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.face_analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  image_url       text,        -- compressed 320px JPEG data URL (thumbnail)
  analysis_result jsonb,       -- full AnalysisReport
  created_at      timestamptz not null default now()
);

create index if not exists face_analyses_user_created_idx
  on public.face_analyses (user_id, created_at desc);

alter table public.face_analyses enable row level security;

drop policy if exists face_analyses_select_own on public.face_analyses;
create policy face_analyses_select_own on public.face_analyses
  for select using (auth.uid() = user_id);

drop policy if exists face_analyses_insert_own on public.face_analyses;
create policy face_analyses_insert_own on public.face_analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists face_analyses_delete_own on public.face_analyses;
create policy face_analyses_delete_own on public.face_analyses
  for delete using (auth.uid() = user_id);

grant select, insert, delete on public.face_analyses to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-create a profile row on signup (fallback to the client-side upsert).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, subscription_status)
  values (new.id, new.email, 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that already exist in auth.users.
insert into public.profiles (id, email, subscription_status)
select u.id, u.email, 'pending'
from auth.users u
on conflict (id) do nothing;
