import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const stripeTable = Deno.env.get("STRIPE_INVOICES_TABLE") || "stripe_invoices";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders
  });
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: json({ error: "Missing logged-in user token" }, 401)
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      error: json({ error: "Missing Supabase environment variables" }, 500)
    };
  }

  const userClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser(token);

  if (userError || !user) {
    return {
      error: json(
        {
          error: "Invalid logged-in user token",
          details: userError?.message || null
        },
        401
      )
    };
  }

  return {
    user,
    adminClient: createClient(supabaseUrl, serviceRoleKey)
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const result = await requireUser(req);
  if ("error" in result) return result.error;

  let body: {
    filename?: string;
    uploadId?: string;
    startRow?: number;
    rows?: Record<string, string>[];
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const filename = String(body.filename || "stripe-invoices.csv").trim();
  const uploadId = String(body.uploadId || crypto.randomUUID());
  const startRow = Number.isFinite(body.startRow) ? Number(body.startRow) : 1;
  const sourceRows = Array.isArray(body.rows) ? body.rows : [];

  if (!sourceRows.length) {
    return json({ error: "No Stripe rows were provided" }, 400);
  }

  const uploadedAt = new Date().toISOString();
  const rows = sourceRows.map((row, index) => ({
    upload_id: uploadId,
    source_file: filename,
    row_index: startRow + index,
    uploaded_by: result.user.id,
    uploaded_at: uploadedAt,
    stripe_invoice_id: row.id || row.ID || row["Invoice ID"] || row.invoice_id || null,
    organization: row.Organization || row.organization || null,
    customer_email: row["Customer Email"] || row.customer_email || row.email || null,
    date_utc: row["Date (UTC)"] || row.date_utc || row.date || null,
    subtotal: row.subtotal || row.Subtotal || row["Subtotal"] || null,
    tax_amount: row["Tax Amount"] || row.Tax || row.tax || row.tax_amount || null,
    total_amount: row["Total Amount"] || row.Total || row.total || row.total_amount || null,
    total_before_gst: row["Total Before GST"] || row.total_before_gst || null,
    total_discount_amount:
      row["Total Discount Amount"] || row.total_discount_amount || row.discount || null,
    credits_usage: row["Credits Usage"] || row.credits_usage || null,
    raw_data: row
  }));

  const { error } = await result.adminClient
    .from(stripeTable)
    .insert(rows);

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({
    uploadId,
    insertedRows: rows.length,
    table: stripeTable,
    filename
  });
});
