import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const invoiceTable = Deno.env.get("XERO_INVOICES_TABLE") || "xero_invoices";
const creditNoteTable = Deno.env.get("XERO_CREDIT_NOTES_TABLE") || "xero_credit_notes";
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

async function readAllRows(
  adminClient: ReturnType<typeof createClient>,
  tableName: string,
  documentType: "invoice" | "credit_note"
) {
  const rows: Record<string, unknown>[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await adminClient
      .from(tableName)
      .select("*")
      .range(from, to);

    if (error) throw new Error(`${tableName}: ${error.message}`);

    rows.push(
      ...(data || []).map((row) => ({
        ...row,
        document_type: documentType,
        source_table: tableName
      }))
    );

    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function readOptionalRows(
  adminClient: ReturnType<typeof createClient>,
  tableName: string,
  documentType: "invoice" | "credit_note"
) {
  try {
    return {
      rows: await readAllRows(adminClient, tableName, documentType),
      error: null
    };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : `${tableName}: unknown error`
    };
  }
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
    const [invoiceResult, creditNoteResult] = await Promise.all([
      readOptionalRows(result.adminClient, invoiceTable, "invoice"),
      readOptionalRows(result.adminClient, creditNoteTable, "credit_note")
    ]);

    const invoiceRows = invoiceResult.rows;
    const creditNoteRows = creditNoteResult.rows;
    const rows = [...invoiceRows, ...creditNoteRows];

    if (!rows.length && (invoiceResult.error || creditNoteResult.error)) {
      return json(
        {
          error: "Could not retrieve Xero data",
          details: {
            invoices: invoiceResult.error,
            credit_notes: creditNoteResult.error
          }
        },
        500
      );
    }

    return json({
      rows,
      count: rows.length,
      invoice_count: invoiceRows.length,
      credit_note_count: creditNoteRows.length,
      tables: {
        invoices: invoiceTable,
        credit_notes: creditNoteTable
      },
      warnings: {
        invoices: invoiceResult.error,
        credit_notes: creditNoteResult.error
      }
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Could not retrieve Xero data" },
      500
    );
  }
});
