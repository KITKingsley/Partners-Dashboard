import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const contactsTable = Deno.env.get("CP_CONTACTS_TABLE") || "cp_contacts";
const appsScriptUrl = Deno.env.get("CP_CONTACTS_APPS_SCRIPT_URL") || "";
const pageSize = 1000;

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders
  });
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      error: json({ error: "Missing Authorization header" }, 401)
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      error: json({ error: "Missing Supabase environment variables" }, 500)
    };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return {
      error: json({ error: userError?.message || "Invalid user session" }, 401)
    };
  }

  return {
    user,
    adminClient: createClient(supabaseUrl, serviceRoleKey)
  };
}

function normalizeContactRow(row: Record<string, unknown>) {
  const organization = String(
    row.Organization
      ?? row.organization
      ?? row["CP name"]
      ?? row["CP Name"]
      ?? row.Partner
      ?? ""
  ).trim();

  if (!organization) return null;

  return {
    ...row,
    Organization: organization,
    "CP name": String(row["CP name"] ?? row["CP Name"] ?? organization).trim()
  };
}

function mapContactToDbRow(row: Record<string, unknown>, source = "apps_script") {
  const normalized = normalizeContactRow(row);
  if (!normalized) return null;

  const now = new Date().toISOString();

  return {
    organization: String(normalized.Organization || "").trim(),
    cp_name: String(normalized["CP name"] || normalized.Organization || "").trim() || null,
    status: String(normalized.Status || "").trim() || null,
    joined_date: String(normalized["Joined Date"] || "").trim() || null,
    agreement_end_date: String(normalized["Agreement End Date"] || "").trim() || null,
    contact_emails: String(
      normalized["Contact Emails"]
        ?? normalized.Email
        ?? normalized["Customer Email"]
        ?? normalized["Email Address"]
        ?? ""
    ).trim() || null,
    email_domain: String(normalized["Email Domain"] || "").trim() || null,
    note: String(normalized.Note || normalized.Notes || "").trim() || null,
    row_data: normalized,
    source,
    synced_at: now,
    updated_at: now
  };
}

async function readCachedContacts(adminClient: ReturnType<typeof createClient>) {
  const rows: Record<string, unknown>[] = [];
  let latestSyncedAt: string | null = null;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await adminClient
      .from(contactsTable)
      .select("organization, cp_name, status, joined_date, agreement_end_date, contact_emails, email_domain, note, row_data, source, synced_at, updated_at")
      .order("organization", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    (data || []).forEach((row) => {
      const rowData = (row.row_data && typeof row.row_data === "object")
        ? row.row_data as Record<string, unknown>
        : {};

      const normalized = normalizeContactRow({
        ...rowData,
        Organization: row.organization,
        "CP name": row.cp_name,
        Status: row.status,
        "Joined Date": row.joined_date,
        "Agreement End Date": row.agreement_end_date,
        "Contact Emails": row.contact_emails,
        "Email Domain": row.email_domain,
        Note: row.note
      });

      if (normalized) rows.push(normalized);
      if (row.synced_at && (!latestSyncedAt || row.synced_at > latestSyncedAt)) {
        latestSyncedAt = row.synced_at;
      }
    });

    if (!data || data.length < pageSize) break;
  }

  return { rows, synced_at: latestSyncedAt };
}

async function fetchContactsFromAppsScript() {
  if (!appsScriptUrl) {
    return { rows: [], error: "CP_CONTACTS_APPS_SCRIPT_URL is not configured." };
  }

  const response = await fetch(appsScriptUrl, {
    method: "GET",
    redirect: "follow"
  });

  if (!response.ok) {
    return {
      rows: [],
      error: `Apps Script failed (${response.status})`
    };
  }

  const payload = await response.json().catch(() => null);
  const sourceRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];

  const rows = sourceRows
    .map((row) => normalizeContactRow(row as Record<string, unknown>))
    .filter(Boolean) as Record<string, unknown>[];

  return { rows, error: null };
}

async function cacheContacts(
  adminClient: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
  source = "apps_script"
) {
  const { error: deleteError } = await adminClient.from(contactsTable).delete().neq("id", 0);
  if (deleteError) throw new Error(deleteError.message);

  const payload = rows
    .map((row) => mapContactToDbRow(row, source))
    .filter(Boolean);

  const chunkSize = 250;
  for (let start = 0; start < payload.length; start += chunkSize) {
    const chunk = payload.slice(start, start + chunkSize);
    const { error } = await adminClient.from(contactsTable).insert(chunk);
    if (error) throw new Error(error.message);
  }

  return payload.length;
}

async function syncContacts(adminClient: ReturnType<typeof createClient>, forceRefresh = false) {
  let liveError: string | null = null;
  let liveCount = 0;

  if (forceRefresh || appsScriptUrl) {
    const live = await fetchContactsFromAppsScript();
    liveError = live.error;

    if (live.rows.length) {
      liveCount = await cacheContacts(adminClient, live.rows, "apps_script");
    }
  }

  const cached = await readCachedContacts(adminClient);

  return {
    rows: cached.rows,
    count: cached.rows.length,
    synced_at: cached.synced_at,
    live_synced_count: liveCount,
    warning: cached.rows.length ? liveError : liveError || "No CP contacts available."
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const result = await requireUser(req);
  if ("error" in result) return result.error;

  try {
    let forceRefresh = req.method === "POST";

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.refresh === false) forceRefresh = false;
      if (body?.rows && Array.isArray(body.rows)) {
        const savedCount = await cacheContacts(result.adminClient, body.rows, String(body.source || "dashboard"));
        const cached = await readCachedContacts(result.adminClient);
        return json({
          rows: cached.rows,
          count: cached.rows.length,
          source: "cp_contacts_table",
          saved_count: savedCount,
          synced_at: cached.synced_at
        });
      }
    }

    const synced = await syncContacts(result.adminClient, forceRefresh);

    if (!synced.rows.length) {
      return json(
        {
          error: synced.warning || "No CP contacts available.",
          details: "Apps Script sync failed and cp_contacts is empty."
        },
        500
      );
    }

    return json({
      rows: synced.rows,
      count: synced.count,
      source: synced.live_synced_count ? "apps_script" : "cp_contacts_table",
      synced_at: synced.synced_at,
      warning: synced.live_synced_count ? null : synced.warning
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Could not load CP contacts"
      },
      500
    );
  }
});
