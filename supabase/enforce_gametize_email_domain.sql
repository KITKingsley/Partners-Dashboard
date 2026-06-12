-- Restrict Supabase Auth to @gametize.com emails (sign-up and email changes).
-- OAuth first-time sign-in also creates an auth.users row, so INSERT is covered.

create or replace function public.enforce_gametize_email_domain()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if new.email is null or lower(trim(new.email)) not like '%@gametize.com' then
    raise exception 'Only @gametize.com email addresses are allowed to sign up or sign in'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_gametize_email_domain_insert on auth.users;

create trigger enforce_gametize_email_domain_insert
  before insert on auth.users
  for each row
  execute function public.enforce_gametize_email_domain();

drop trigger if exists enforce_gametize_email_domain_update on auth.users;

create trigger enforce_gametize_email_domain_update
  before update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.enforce_gametize_email_domain();
