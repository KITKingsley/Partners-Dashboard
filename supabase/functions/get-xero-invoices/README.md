# get-xero-invoices

Authenticated Supabase Edge Function that reads `xero_invoices` with the service role key and returns the rows to signed-in dashboard users.

Deploy from a machine with the Supabase CLI:

```powershell
supabase functions deploy get-xero-invoices
```

The function expects Supabase's standard function environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The dashboard can call it with:

```js
const payload = await window.DashboardAuth.callEdgeFunction("get-xero-invoices");
```
