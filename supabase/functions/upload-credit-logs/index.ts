import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const creditUsageTable = Deno.env.get("CREDIT_USAGE_TABLE") || "credit_usage_logs";

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
    cpPartner?: string;
    rows?: Record<string, unknown>[];
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const cpPartner = String(body.cpPartner || "").trim();
  const sourceRows = Array.isArray(body.rows) ? body.rows : [];

  if (!cpPartner) {
    return json({ error: "cpPartner is required" }, 400);
  }

  if (!sourceRows.length) {
    return json({ error: "No credit log rows were provided" }, 400);
  }

  const rows = sourceRows.map((row) => ({
    cp_partner: cpPartner,
    transaction_date: row.transaction_date ?? row.transactionDate ?? row.date ?? null,
    description: row.description ?? null,
    amount: row.amount ?? 0,
    actions: row.actions ?? row.action_label ?? row.actionLabel ?? null
  }));

  const { error } = await result.adminClient.from(creditUsageTable).insert(rows);

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({
    insertedRows: rows.length,
    table: creditUsageTable,
    cpPartner
  });
});
