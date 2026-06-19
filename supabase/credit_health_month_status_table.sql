create table if not exists public.credit_health_month_status (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null default 'all',
  month_label text not null,
  status text not null default 'pending' check (status in ('pending', 'debited')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (partner_key, month_label)
);

create index if not exists credit_health_month_status_partner_key_idx
  on public.credit_health_month_status (partner_key);

create index if not exists credit_health_month_status_month_label_idx
  on public.credit_health_month_status (month_label);

alter table public.credit_health_month_status enable row level security;

drop policy if exists "Users can read credit health month status rows" on public.credit_health_month_status;
drop policy if exists "Users can insert credit health month status rows" on public.credit_health_month_status;
drop policy if exists "Users can update credit health month status rows" on public.credit_health_month_status;
drop policy if exists "Users can delete credit health month status rows" on public.credit_health_month_status;

create policy "Users can read credit health month status rows"
  on public.credit_health_month_status
  for select
  to authenticated
  using (true);

create policy "Users can insert credit health month status rows"
  on public.credit_health_month_status
  for insert
  to authenticated
  with check (true);

create policy "Users can update credit health month status rows"
  on public.credit_health_month_status
  for update
  to authenticated
  using (true);

create policy "Users can delete credit health month status rows"
  on public.credit_health_month_status
  for delete
  to authenticated
  using (true);
