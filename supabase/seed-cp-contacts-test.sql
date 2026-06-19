insert into public.cp_contacts (
  organization,
  cp_name,
  status,
  joined_date,
  agreement_end_date,
  row_data,
  source
)
values
  (
    'Right Impact',
    'Right Impact',
    'Active',
    '2/8/2021',
    '4/11/2026',
    '{"Organization":"Right Impact","CP name":"Right Impact","Status":"Active","Joined Date":"2/8/2021","Agreement End Date":"4/11/2026"}'::jsonb,
    'cli_seed_test'
  ),
  (
    'DO IT/PMK',
    'DO IT/PMK',
    'Active',
    '11/13/2019',
    '12/31/2027',
    '{"Organization":"DO IT/PMK","CP name":"DO IT/PMK","Status":"Active"}'::jsonb,
    'cli_seed_test'
  );

select organization, source, status from public.cp_contacts order by organization;
