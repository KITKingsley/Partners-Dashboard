-- Storage bucket for Credit Usage report files (Project / Admin Logs)
insert into storage.buckets (id, name, public, file_size_limit)
values ('credit-reports', 'credit-reports', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Authenticated users can upload credit reports" on storage.objects;
drop policy if exists "Authenticated users can read credit reports" on storage.objects;

create policy "Authenticated users can upload credit reports"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'credit-reports');

create policy "Authenticated users can read credit reports"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'credit-reports');

create table if not exists public.credit_report_uploads (
  id uuid primary key default gen_random_uuid(),
  cp text not null,
  cp_partner text not null,
  report_type text not null check (report_type in ('project', 'admin_logs')),
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists credit_report_uploads_cp_idx
  on public.credit_report_uploads (cp);

create index if not exists credit_report_uploads_cp_partner_idx
  on public.credit_report_uploads (cp_partner);

alter table public.credit_report_uploads add column if not exists cp text;
update public.credit_report_uploads set cp = cp_partner where cp is null and cp_partner is not null;

create index if not exists credit_report_uploads_report_type_idx
  on public.credit_report_uploads (report_type);

create index if not exists credit_report_uploads_uploaded_at_idx
  on public.credit_report_uploads (uploaded_at desc);

alter table public.credit_report_uploads enable row level security;

drop policy if exists "Users can read credit report uploads" on public.credit_report_uploads;
drop policy if exists "Users can insert credit report uploads" on public.credit_report_uploads;
drop policy if exists "Users can delete credit report uploads" on public.credit_report_uploads;

create policy "Users can read credit report uploads"
  on public.credit_report_uploads
  for select
  to authenticated
  using (true);

create policy "Users can insert credit report uploads"
  on public.credit_report_uploads
  for insert
  to authenticated
  with check (true);

create policy "Users can delete credit report uploads"
  on public.credit_report_uploads
  for delete
  to authenticated
  using (true);
