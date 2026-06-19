create table if not exists public.credits_user_limit (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null default '',
  pic text not null default '',
  project text not null default '',
  license_end_date date,
  credits_allocated numeric not null default 0,
  credits_used numeric not null default 0,
  terms_and_condition text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists credits_user_limit_partner_name_idx
  on public.credits_user_limit (partner_name);

create index if not exists credits_user_limit_license_end_date_idx
  on public.credits_user_limit (license_end_date);

alter table public.credits_user_limit enable row level security;

drop policy if exists "Users can read credits user limit rows" on public.credits_user_limit;
drop policy if exists "Users can insert credits user limit rows" on public.credits_user_limit;
drop policy if exists "Users can update credits user limit rows" on public.credits_user_limit;
drop policy if exists "Users can delete credits user limit rows" on public.credits_user_limit;

create policy "Users can read credits user limit rows"
  on public.credits_user_limit
  for select
  to authenticated
  using (true);

create policy "Users can insert credits user limit rows"
  on public.credits_user_limit
  for insert
  to authenticated
  with check (true);

create policy "Users can update credits user limit rows"
  on public.credits_user_limit
  for update
  to authenticated
  using (true);

create policy "Users can delete credits user limit rows"
  on public.credits_user_limit
  for delete
  to authenticated
  using (true);
