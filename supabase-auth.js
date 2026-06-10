(function () {
  const config = window.DASHBOARD_AUTH_CONFIG || {};

  function isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  }

  function getClient() {
    if (!isConfigured() || !window.supabase) return null;
    if (!window.dashboardSupabaseClient) {
      window.dashboardSupabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    }
    return window.dashboardSupabaseClient;
  }

  async function requireAuth() {
    const client = getClient();
    if (!client) return;

    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      window.location.href = "login.html";
    }
  }

  async function signIn(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail.endsWith("@gametize.com")) {
      throw new Error("Sign up is currently limited to approved email addresses.");
    }

    const { data, error } = await client.auth.signUp({ email: normalizedEmail, password });
    if (error) throw error;
    return data;
  }

  async function resetPassword(email) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const redirectTo = `${window.location.origin}/login.html`;
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo
    });
    if (error) throw error;
  }

  async function signOut() {
    const client = getClient();
    if (!client) return;
    await client.auth.signOut();
    window.location.href = "login.html";
  }

  async function callEdgeFunction(name, options = {}) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const { data: sessionData, error } = await client.auth.getSession();
    if (error || !sessionData.session) {
      throw new Error("Sign in before calling this function.");
    }

    const { data, error: functionError } = await client.functions.invoke(name, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        ...(options.headers || {})
      },
      body: options.body
    });

    if (functionError) {
      if (functionError.context instanceof Response) {
        const details = await functionError.context.json().catch(() => null);
        throw new Error(details?.error || details?.details || functionError.message || "Function call failed.");
      }
      throw new Error(functionError.message || "Function call failed.");
    }

    return data || {};
  }

  async function fetchTableRows(tableName) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const rows = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await client
        .from(tableName)
        .select("*")
        .range(from, to);

      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    return { rows, count: rows.length };
  }

  async function fetchXeroTables() {
    const invoicePayload = await fetchTableRows(config.xeroSalesTable);
    const invoiceRows = invoicePayload.rows.map((row) => ({
      ...row,
      document_type: row.document_type || "invoice",
      source_table: config.xeroSalesTable
    }));

    if (!config.xeroCreditNotesTable) {
      return {
        rows: invoiceRows,
        count: invoiceRows.length,
        invoice_count: invoiceRows.length,
        credit_note_count: 0
      };
    }

    const creditNotePayload = await fetchTableRows(config.xeroCreditNotesTable);
    const creditNoteRows = creditNotePayload.rows.map((row) => ({
      ...row,
      document_type: row.document_type || "credit_note",
      source_table: config.xeroCreditNotesTable
    }));

    return {
      rows: invoiceRows.concat(creditNoteRows),
      count: invoiceRows.length + creditNoteRows.length,
      invoice_count: invoiceRows.length,
      credit_note_count: creditNoteRows.length
    };
  }

  async function getXeroInvoices() {
    try {
      return await callEdgeFunction("get-xero-invoices");
    } catch (error) {
      if (!config.xeroSalesTable) throw error;
      console.warn("Edge Function failed, trying authenticated table select:", error);
      const fallbackPayload = await fetchXeroTables();
      if (!fallbackPayload.count) {
        throw new Error(
          `${error.message || "Could not load Xero rows from Edge Function"}; direct table fallback returned 0 rows.`
        );
      }
      return fallbackPayload;
    }
  }

  async function getDashboardXeroRows() {
    return fetchTableRows("dashboard_xero_rows");
  }

  async function refreshDashboardXeroRows() {
    return callEdgeFunction("refresh-dashboard-xero-rows", {
      method: "POST"
    });
  }

  async function getCpContacts() {
    return callEdgeFunction("get-cp-contacts");
  }

  const organizationCanonicalRules = [
    {
      canonical: "doit",
      aliases: [
        "doit",
        "doit.mx",
        "Doit",
        "PMK Psicomarketing",
        "Psicomarketing"
      ]
    },
    {
      canonical: "InPsyful Learning & Solutions/ Talent Intelligence",
      aliases: [
        "InPsyful Learning & Solutions",
        "Inpsyful Learning and Solutions",
        "Talent Intelligence"
      ]
    }
  ];

  async function uploadStripeInvoices(file, cpRows = []) {
    const parsedRows = parseCsv(await file.text());
    const processedRows = processStripeRows(parsedRows, cpRows);
    const rows = processedRows.rows;
    const uploadId = crypto.randomUUID();
    const chunkSize = 250;
    let insertedRows = 0;

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const payload = await callEdgeFunction("upload-stripe-invoices", {
        method: "POST",
        body: {
          filename: file.name,
          uploadId,
          startRow: start + 1,
          rows: chunk
        }
      });
      insertedRows += payload.insertedRows || 0;
    }

    return {
      uploadId,
      originalRows: parsedRows.length,
      filteredRows: rows.length,
      insertedRows,
      removedRows: parsedRows.length - rows.length
    };
  }

  function processStripeRows(sourceRows, cpRows) {
    const lookup = buildCpLookup(cpRows);

    const rows = sourceRows
      .filter((row) => toNumber(pick(row, ["subtotal", "Subtotal", "Subtotal Amount"])) > 0)
      .filter((row) => !String(pick(row, ["id", "ID"], "")).startsWith("INV"))
      .map((row) => {
        const organization = canonicalOrganization(matchCpOrganization(row, lookup));
        if (!organization) return null;

        const normalized = { ...row, Organization: organization };
        const id = String(pick(normalized, ["id", "ID"], ""));
        const subtotal = toNumber(pick(normalized, ["subtotal", "Subtotal", "Subtotal Amount"]));
        let discount = toNumber(pick(normalized, [
          "Total Discount Amount",
          "total_discount_amount",
          "Discount",
          "discount"
        ]));

        if (id === "in_1Gz8nNDEzGPOQfRsc7fBVMNj") {
          discount += 100;
          normalized["Total Discount Amount"] = money(discount);
        }

        const total = subtotal - discount;
        const tax = toNumber(pick(normalized, ["Tax Amount", "tax_amount", "Tax", "tax"]));
        const totalBeforeGst = isZeroStripePeriod(organization, normalized)
          ? 0
          : total - tax;
        const creditsUsage =
          toNumber(pick(normalized, ["Ending Balance", "ending_balance"])) -
          toNumber(pick(normalized, ["Starting Balance", "starting_balance"]));

        normalized.Total = money(total);
        normalized["Total Amount"] = money(total);
        normalized["Total Before GST"] = money(totalBeforeGst);
        normalized["Credits Usage"] = money(creditsUsage);

        return normalized;
      })
      .filter(Boolean)
      .filter((row) => {
        return !isDateInRange(row, "Pico", "2021-08-02", "2022-09-10");
      });

    return { rows };
  }

  function buildCpLookup(cpRows) {
    const emailMap = new Map();
    const domainMap = new Map();

    cpRows.forEach((row) => {
      const organization = cpField(row, [
        "Organization",
        "Organisation",
        "CP name",
        "CP Name",
        "Partner",
        "Partner Name",
        "Company",
        "Company Name",
        "Channel Partner",
        "Account Name",
        "Name"
      ]);
      if (!organization) return;

      const email = cpField(row, [
        "Email",
        "Email Address",
        "Contact Email",
        "Customer Email",
        "Member Email"
      ]);
      const domain = cpField(row, ["Domain", "Email Domain", "Website", "Company Website"]) || domainFromEmail(email);

      if (email) emailMap.set(normalize(email), organization);
      if (domain) domainMap.set(normalizeDomain(domain), organization);
    });

    return { emailMap, domainMap };
  }

  function matchCpOrganization(row, lookup) {
    const email = pick(row, ["Customer Email", "customer_email", "Email", "email"]);
    const forced = forcedOrganizationForStripeRow(row, email);
    if (forced) return forced;
    return lookup.emailMap.get(normalize(email)) || lookup.domainMap.get(domainFromEmail(email)) || "";
  }

  function forcedOrganizationForStripeRow(row, email) {
    const organization = normalize(row.Organization || row.organization || "");
    const domain = domainFromEmail(email);

    if (organization.includes("finalix") || domain === "finalix.com") {
      return "Finalix";
    }

    if (organization.includes("pmk psicomarketing") || organization.includes("psicomarketing")) {
      return "doit";
    }

    return "";
  }

  function isZeroStripePeriod(organization, row) {
    return (
      isDateOnOrAfter(row, "FocusU", "2022-02-12", organization) ||
      isDateInRange(row, "Right Impact", "2024-02-07", "2024-04-30", organization) ||
      isDateInRange(row, "Finalix", "2023-12-31", "2024-04-30", organization)
    );
  }

  function isDateOnOrAfter(row, organization, startDate, organizationOverride = null) {
    const rowOrganization = organizationOverride || row.Organization || "";
    if (!normalize(rowOrganization).includes(normalize(organization))) return false;
    const date = parseDate(pick(row, ["Date (UTC)", "date_utc", "Date", "date"]));
    if (!date) return false;
    return date >= new Date(`${startDate}T00:00:00Z`);
  }

  function isDateInRange(row, organization, startDate, endDate, organizationOverride = null) {
    const rowOrganization = organizationOverride || row.Organization || "";
    if (!normalize(rowOrganization).includes(normalize(organization))) return false;
    const date = parseDate(pick(row, ["Date (UTC)", "date_utc", "Date", "date"]));
    if (!date) return false;
    return date >= new Date(`${startDate}T00:00:00Z`) && date <= new Date(`${endDate}T23:59:59Z`);
  }

  function parseDate(value) {
    const text = String(value || "").trim();
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function cpField(row, names) {
    const fields = Object.keys(row || {}).reduce((map, key) => {
      map[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = row[key];
      return map;
    }, {});
    for (const name of names) {
      const value = fields[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
      if (value !== undefined && value !== null && value !== "") return String(value).trim();
    }
    return "";
  }

  function pick(row, names, fallback = "") {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
    }
    return fallback;
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function compact(value) {
    return normalize(value).replace(/[^a-z0-9]/g, "");
  }

  function canonicalOrganization(value) {
    const compactValue = compact(value);
    if (!compactValue) return value;

    const rule = organizationCanonicalRules.find((item) =>
      item.aliases.some((alias) => {
        const compactAlias = compact(alias);
        return compactValue.includes(compactAlias) || compactAlias.includes(compactValue);
      })
    );

    return rule ? rule.canonical : value;
  }

  function domainFromEmail(value) {
    const email = normalize(value);
    if (!email.includes("@")) return "";
    return normalizeDomain(email.split("@").pop());
  }

  function normalizeDomain(value) {
    return normalize(value).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }

  function money(value) {
    return Number(value || 0).toFixed(2);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          value += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else if (char !== "\r") {
        value += char;
      }
    }

    row.push(value);
    rows.push(row);

    const [headers = [], ...bodyRows] = rows.filter((items) =>
      items.some((item) => item.trim() !== "")
    );

    return bodyRows.map((items) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header.trim()] = (items[index] || "").trim();
      });
      return record;
    });
  }

  function toNumber(value) {
    let text = String(value ?? "0")
      .replace(/\u00a0/g, " ")
      .replace(/[\u2212\u2013\u2014]/g, "-")
      .trim()
      .replace(/^\s*(USD|SGD|MYR|RM|\$)\s*/i, "")
      .replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "")
      .replace(/,/g, "");
    let negate = false;
    if (/^\(.*\)$/.test(text)) {
      negate = true;
      text = text.slice(1, -1).trim();
    }
    const number = Number.parseFloat(text);
    if (!Number.isFinite(number)) return 0;
    return negate ? -Math.abs(number) : number;
  }

  async function showSessionControls() {
    const button = document.querySelector("#signOutButton");
    if (!button) return;

    const client = getClient();
    if (!client) {
      button.hidden = true;
      return;
    }

    const { data } = await client.auth.getSession();
    button.hidden = !data.session;
    button.addEventListener("click", signOut);
  }

  window.DashboardAuth = {
    getClient,
    isConfigured,
    requireAuth,
    showSessionControls,
    signIn,
    signUp,
    resetPassword,
    signOut,
    callEdgeFunction,
    fetchTableRows,
    fetchXeroTables,
    getCpContacts,
    getXeroInvoices,
    getDashboardXeroRows,
    refreshDashboardXeroRows,
    uploadStripeInvoices
  };
}());
