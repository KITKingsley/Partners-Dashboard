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

  function getAllowedEmailDomain() {
    return String(config.allowedEmailDomain || "gametize.com").trim().toLowerCase();
  }

  function isAllowedEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    const domain = getAllowedEmailDomain();
    return normalized.endsWith(`@${domain}`);
  }

  async function enforceAllowedEmail() {
    const client = getClient();
    if (!client) return false;

    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email) return false;

    if (isAllowedEmail(data.user.email)) return true;

    await client.auth.signOut();
    return false;
  }

  function getAppOrigin() {
    const configured = String(config.appUrl || "").trim().replace(/\/$/, "");
    if (configured) return configured;
    return window.location.origin;
  }

  function getAuthRedirectUrl(path = "/") {
    const origin = getAppOrigin();
    if (path === "/" || path === "") {
      return `${origin}/`;
    }
    return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function getOAuthRedirectUrl() {
    return getAuthRedirectUrl("/");
  }

  async function handleAuthRedirect() {
    const client = getClient();
    if (!client) return false;

    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    }

    if (window.location.hash.includes("access_token")) {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) {
        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
      }
    }

    return false;
  }

  async function requireAuth() {
    const client = getClient();
    if (!client) return;

    try {
      await handleAuthRedirect();
    } catch (error) {
      console.error("OAuth redirect failed:", error);
      window.location.href = "login.html";
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      window.location.href = "login.html";
      return;
    }

    const allowed = await enforceAllowedEmail();
    if (!allowed) {
      window.location.href = "login.html?error=domain";
    }
  }

  async function signIn(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (!isAllowedEmail(data.user?.email)) {
      await client.auth.signOut();
      throw new Error(`Sign in is limited to @${getAllowedEmailDomain()} email addresses.`);
    }
  }

  async function signInWithGoogle() {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getOAuthRedirectUrl(),
        queryParams: {
          hd: getAllowedEmailDomain()
        }
      }
    });
    if (error) throw error;
  }

  async function signUp(email, password) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!isAllowedEmail(normalizedEmail)) {
      throw new Error(`Sign up is limited to @${getAllowedEmailDomain()} email addresses.`);
    }

    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl("/")
      }
    });
    if (error) throw error;
    return data;
  }

  async function resetPassword(email) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl("/login.html")
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

  function normalizeCpContactRow(row) {
    const organization = String(
      pick(row, ["Organization", "organization", "CP name", "CP Name", "Partner", "Partner Name"], "")
    ).trim();

    if (!organization) return null;

    return {
      ...row,
      Organization: organization,
      "CP name": String(pick(row, ["CP name", "CP Name"], organization) || organization).trim()
    };
  }

  function mapCpContactToDbRow(row, source = "dashboard") {
    const normalized = normalizeCpContactRow(row);
    if (!normalized) return null;

    const now = new Date().toISOString();

    return {
      organization: normalized.Organization,
      cp_name: String(normalized["CP name"] || normalized.Organization || "").trim() || null,
      status: String(pick(normalized, ["Status", "status"], "")).trim() || null,
      joined_date: String(pick(normalized, ["Joined Date", "joined_date"], "")).trim() || null,
      agreement_end_date: String(pick(normalized, ["Agreement End Date", "agreement_end_date"], "")).trim() || null,
      contact_emails: String(pick(normalized, [
        "Contact Emails",
        "contact_emails",
        "Email",
        "Customer Email",
        "Email Address"
      ], "")).trim() || null,
      email_domain: String(pick(normalized, ["Email Domain", "email_domain"], "")).trim() || null,
      note: String(pick(normalized, ["Note", "Notes", "note"], "")).trim() || null,
      row_data: normalized,
      source,
      synced_at: now,
      updated_at: now
    };
  }

  function normalizeCpContactFromDbRow(dbRow) {
    const rowData = (dbRow?.row_data && typeof dbRow.row_data === "object")
      ? { ...dbRow.row_data }
      : {};

    return normalizeCpContactRow({
      ...rowData,
      Organization: dbRow.organization || rowData.Organization,
      "CP name": dbRow.cp_name || rowData["CP name"],
      Status: dbRow.status || rowData.Status,
      "Joined Date": dbRow.joined_date || rowData["Joined Date"],
      "Agreement End Date": dbRow.agreement_end_date || rowData["Agreement End Date"],
      "Contact Emails": dbRow.contact_emails || rowData["Contact Emails"],
      "Email Domain": dbRow.email_domain || rowData["Email Domain"],
      Note: dbRow.note || rowData.Note
    });
  }

  async function fetchCpContactsFromTable() {
    const tableName = config.cpContactsTable || "cp_contacts";
    const payload = await fetchTableRows(tableName);
    const dbRows = payload.rows || [];
    const dbIdsByOrganization = {};
    const rows = dbRows
      .map((row) => {
        const organization = String(row.organization || "").trim();
        if (organization) dbIdsByOrganization[organization] = row.id;
        return normalizeCpContactFromDbRow(row);
      })
      .filter(Boolean);

    const updatedAt = dbRows
      .map((row) => row.updated_at)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return {
      rows,
      dbIdsByOrganization,
      count: rows.length,
      source: "cp_contacts_table",
      updated_at: updatedAt
    };
  }

  async function upsertCpContact(row, options = {}) {
    const client = getClient();
    const table = config.cpContactsTable || "cp_contacts";
    if (!client || !table) {
      throw new Error("CP contacts table is not configured.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) {
      throw new Error("Sign in before saving partners.");
    }

    const dbRow = mapCpContactToDbRow(row, options.source || "dashboard");
    if (!dbRow) {
      throw new Error("Organization name is required.");
    }

    let id = options.id || null;
    const previousOrganization = String(options.previousOrganization || "").trim();

    if (!id && previousOrganization) {
      const { data } = await client
        .from(table)
        .select("id")
        .eq("organization", previousOrganization)
        .maybeSingle();
      id = data?.id || null;
    }

    if (!id) {
      const { data } = await client
        .from(table)
        .select("id")
        .eq("organization", dbRow.organization)
        .maybeSingle();
      id = data?.id || null;
    }

    const now = new Date().toISOString();
    dbRow.updated_at = now;
    dbRow.source = options.source || "dashboard";

    if (id) {
      const { data, error } = await client
        .from(table)
        .update(dbRow)
        .eq("id", id)
        .select("id, organization, updated_at")
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await client
      .from(table)
      .insert(dbRow)
      .select("id, organization, updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteCpContact(options = {}) {
    const client = getClient();
    const table = config.cpContactsTable || "cp_contacts";
    if (!client || !table) {
      throw new Error("CP contacts table is not configured.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) {
      throw new Error("Sign in before deleting partners.");
    }

    const id = options.id || null;
    const organization = String(options.organization || "").trim();
    if (!id && !organization) {
      throw new Error("Partner id or organization is required.");
    }

    let query = client.from(table).delete();
    if (id) query = query.eq("id", id);
    else query = query.eq("organization", organization);

    const { error } = await query;
    if (error) throw error;
    return { deleted: true };
  }

  async function saveCpContactsToSupabase(rows, source = "dashboard") {
    const client = getClient();
    const table = config.cpContactsTable || "cp_contacts";
    if (!client || !table) {
      throw new Error("CP contacts table is not configured.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session) {
      throw new Error("Sign in before saving CP contacts.");
    }

    try {
      const payload = await callEdgeFunction("get-cp-contacts", {
        method: "POST",
        body: { rows, source }
      });
      if (payload?.rows?.length) return payload;
    } catch (edgeError) {
      console.warn("Could not save CP contacts through edge function:", edgeError);
    }

    const payload = (rows || [])
      .map((row) => mapCpContactToDbRow(row, source))
      .filter(Boolean);

    if (!payload.length) {
      throw new Error("No CP contact rows to save.");
    }

    const { error: deleteError } = await client.from(table).delete().neq("id", 0);
    if (deleteError) throw deleteError;

    const chunkSize = 250;
    let insertedRows = 0;
    for (let start = 0; start < payload.length; start += chunkSize) {
      const chunk = payload.slice(start, start + chunkSize);
      const { error } = await client.from(table).insert(chunk);
      if (error) throw error;
      insertedRows += chunk.length;
    }

    return fetchCpContactsFromTable().then((cached) => ({
      ...cached,
      saved_count: insertedRows
    }));
  }

  async function syncCpContacts(options = {}) {
    const forceRefresh = options.refresh === true;

    if (!forceRefresh) {
      try {
        const cached = await fetchCpContactsFromTable();
        if (cached.rows?.length) return cached;
      } catch (tableError) {
        console.warn("CP contacts table read failed:", tableError);
      }
    }

    try {
      const payload = await callEdgeFunction("get-cp-contacts", {
        method: forceRefresh ? "POST" : "GET",
        body: forceRefresh ? { refresh: true } : undefined
      });
      if (payload?.rows?.length) return payload;
    } catch (error) {
      console.warn("get-cp-contacts edge function failed:", error);

      try {
        const cached = await fetchCpContactsFromTable();
        if (cached.rows?.length) {
          return {
            ...cached,
            warning: error.message || "Live CP contacts sync failed. Loaded cached Supabase data."
          };
        }
      } catch (tableError) {
        console.warn("cp_contacts table fallback failed:", tableError);
      }

      const fallbackRows = buildCpContactsFallbackRows();
      if (fallbackRows.length) {
        return saveCpContactsToSupabase(fallbackRows, "dashboard_fallback");
      }

      throw error;
    }

    const fallbackRows = buildCpContactsFallbackRows();
    if (fallbackRows.length) {
      return saveCpContactsToSupabase(fallbackRows, "dashboard_fallback");
    }

    throw new Error("No CP contacts available.");
  }

  async function getCpContacts(options = {}) {
    if (options.sync === true) {
      return syncCpContacts(options);
    }

    try {
      return await fetchCpContactsFromTable();
    } catch (error) {
      if (options.allowSyncFallback === true) {
        return syncCpContacts(options);
      }
      throw error;
    }
  }

  function buildCpContactsFallbackRows() {
    const rows = [];
    const seen = new Set();

    const addRow = (organization, extra = {}) => {
      const name = String(organization || "").trim();
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      rows.push({
        Organization: name,
        "CP name": name,
        ...extra
      });
    };

    (window.DASHBOARD_DATA?.rows || []).forEach((row) => {
      addRow(row.Organization, {
        "Customer Email": String(row["Customer Email"] || "").trim(),
        Email: String(row["Customer Email"] || "").trim()
      });
    });

    Object.entries(window.DASHBOARD_DATA?.partnersByOrganization || {}).forEach(([organization, meta]) => {
      addRow(organization, {
        Status: meta?.status || "",
        "Joined Date": meta?.joinedDate || "",
        "Agreement End Date": meta?.agreementEndDate || ""
      });
    });

    if (window.PartnersView?.getPartnerNames) {
      window.PartnersView.getPartnerNames().forEach((organization) => addRow(organization));
    }

    return rows;
  }

  async function getCreditUsageLogs() {
    if (!config.creditUsageTable) {
      return { rows: [], count: 0 };
    }
    return fetchTableRows(config.creditUsageTable);
  }

  async function getPartnerCreditBalances() {
    if (!config.partnerCreditBalancesTable) {
      return { rows: [], count: 0 };
    }
    return fetchTableRows(config.partnerCreditBalancesTable);
  }

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuid(value) {
    return UUID_PATTERN.test(String(value || "").trim());
  }

  function toCreditsUserLimitNumber(value) {
    const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function mapCreditsUserLimitFromDb(row) {
    return {
      id: row.id,
      partnerName: row.partner_name || "",
      pic: row.pic || "",
      project: row.project || "",
      licenseEndDate: row.license_end_date || "",
      creditsAllocated: Math.max(0, toCreditsUserLimitNumber(row.credits_allocated)),
      creditsUsed: Math.max(0, toCreditsUserLimitNumber(row.credits_used)),
      termsAndCondition: row.terms_and_condition || ""
    };
  }

  function mapCreditsUserLimitToDb(row, userId) {
    const id = isUuid(row?.id) ? row.id : crypto.randomUUID();
    return {
      id,
      partner_name: String(row?.partnerName || "").trim(),
      pic: String(row?.pic || "").trim(),
      project: String(row?.project || "").trim(),
      license_end_date: String(row?.licenseEndDate || "").trim() || null,
      credits_allocated: Math.max(0, toCreditsUserLimitNumber(row?.creditsAllocated)),
      credits_used: Math.max(0, toCreditsUserLimitNumber(row?.creditsUsed)),
      terms_and_condition: String(row?.termsAndCondition || "").trim(),
      updated_at: new Date().toISOString(),
      updated_by: userId || null
    };
  }

  async function getCreditsUserLimitRows() {
    const table = config.creditsUserLimitTable || "credits_user_limit";
    if (!table) {
      return { rows: [], count: 0 };
    }

    const payload = await fetchTableRows(table);
    const rows = (payload.rows || [])
      .map(mapCreditsUserLimitFromDb)
      .sort((left, right) => left.partnerName.localeCompare(right.partnerName, undefined, { sensitivity: "base" }));

    return { rows, count: rows.length };
  }

  async function saveCreditsUserLimitRows(rows = []) {
    const client = getClient();
    const table = config.creditsUserLimitTable || "credits_user_limit";
    if (!client || !table) {
      throw new Error("Credits user limit table is not configured.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      throw new Error("Sign in before saving user limit rows.");
    }

    const userId = sessionData.session.user.id;
    const payload = (rows || []).map((row) => mapCreditsUserLimitToDb(row, userId));

    const { data: existing, error: existingError } = await client
      .from(table)
      .select("id");
    if (existingError) {
      throw new Error(existingError.message || "Could not read existing user limit rows.");
    }

    const nextIds = new Set(payload.map((row) => row.id));
    const deleteIds = (existing || [])
      .map((row) => row.id)
      .filter((id) => !nextIds.has(id));

    if (deleteIds.length) {
      const { error: deleteError } = await client.from(table).delete().in("id", deleteIds);
      if (deleteError) {
        throw new Error(deleteError.message || "Could not remove deleted user limit rows.");
      }
    }

    if (payload.length) {
      const chunkSize = 250;
      for (let start = 0; start < payload.length; start += chunkSize) {
        const chunk = payload.slice(start, start + chunkSize);
        const { error } = await client.from(table).upsert(chunk, { onConflict: "id" });
        if (error) {
          throw new Error(error.message || "Could not save user limit rows.");
        }
      }
    }

    return getCreditsUserLimitRows();
  }

  function healthMonthStatusStorageKey(partnerKey, monthLabel) {
    return `${String(partnerKey || "all").trim()}|${String(monthLabel || "").trim()}`;
  }

  async function getCreditHealthMonthStatuses() {
    const table = config.creditHealthMonthStatusTable || "credit_health_month_status";
    if (!table) return {};

    const payload = await fetchTableRows(table);
    const store = {};

    (payload.rows || []).forEach((row) => {
      const partnerKey = String(row.partner_key || "all").trim() || "all";
      const monthLabel = String(row.month_label || "").trim();
      if (!monthLabel) return;
      store[healthMonthStatusStorageKey(partnerKey, monthLabel)] =
        row.status === "debited" ? "debited" : "pending";
    });

    return store;
  }

  async function saveCreditHealthMonthStatus(partnerKey, monthLabel, status) {
    const client = getClient();
    const table = config.creditHealthMonthStatusTable || "credit_health_month_status";
    if (!client || !table) {
      throw new Error("Credit health month status table is not configured.");
    }

    const partner = String(partnerKey || "all").trim() || "all";
    const month = String(monthLabel || "").trim();
    if (!month) {
      throw new Error("Month label is required.");
    }

    const normalizedStatus = status === "debited" ? "debited" : "pending";

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      throw new Error("Sign in before saving month status.");
    }

    const { error } = await client.from(table).upsert(
      {
        partner_key: partner,
        month_label: month,
        status: normalizedStatus,
        updated_at: new Date().toISOString(),
        updated_by: sessionData.session.user.id
      },
      { onConflict: "partner_key,month_label" }
    );

    if (error) {
      throw new Error(error.message || "Could not save month status.");
    }

    return {
      partnerKey: partner,
      monthLabel: month,
      status: normalizedStatus
    };
  }

  function uploadPartnerKey(upload) {
    return String(upload?.cp || upload?.cp_partner || "").trim();
  }

  function creditReportRowIdentityKey(row) {
    const uploadId = String(row?.upload_id || "").trim();
    const sheet = String(row?.sheet_name || "").trim();
    const data = row?.row_data || {};
    let projectId = "";

    for (const [key, value] of Object.entries(data)) {
      const normalized = normalizeReportFieldKey(key);
      if (normalized === "projectid" || normalized === "id") {
        const text = String(value || "").trim();
        if (text && text.toLowerCase() !== "project id") {
          projectId = text;
          break;
        }
      }
    }

    if (!projectId) {
      for (const [key, value] of Object.entries(data)) {
        if (normalizeReportFieldKey(key) === "title") {
          const text = String(value || "").trim();
          if (text && text.toLowerCase() !== "title") {
            projectId = `title:${text}`;
            break;
          }
        }
      }
    }

    const rowIndex = Number(row?.row_index) || 0;
    return `${uploadId}|${sheet}|${projectId || `row:${rowIndex}`}`;
  }

  function isMeaningfulCreditReportRow(row) {
    const data = row?.row_data || {};
    let hasProjectId = false;
    let hasTitle = false;

    for (const [key, value] of Object.entries(data)) {
      const normalized = normalizeReportFieldKey(key);
      const text = String(value || "").trim();
      if (!text) continue;
      if (normalized === "projectid" && text.toLowerCase() !== "project id") {
        hasProjectId = true;
      }
      if (normalized === "title" && text.toLowerCase() !== "title") {
        hasTitle = true;
      }
    }

    return hasProjectId || hasTitle;
  }

  function dedupeCreditReportRows(rows) {
    const kept = new Map();

    (rows || []).filter((row) => {
      if (String(row?.report_type || "").trim() === "admin_logs") return true;
      return isMeaningfulCreditReportRow(row);
    }).forEach((row) => {
      const key = String(row?.report_type || "").trim() === "admin_logs"
        ? `${row.upload_id}|${row.sheet_name}|row:${row.row_index}`
        : creditReportRowIdentityKey(row);
      const existing = kept.get(key);
      if (!existing || Number(row.row_index) < Number(existing.row_index)) {
        kept.set(key, row);
      }
    });

    return [...kept.values()].sort((left, right) => {
      const sheetCompare = String(left.sheet_name || "").localeCompare(String(right.sheet_name || ""));
      if (sheetCompare !== 0) return sheetCompare;
      return Number(left.row_index) - Number(right.row_index);
    });
  }

  async function fetchCreditReportRowsForUploadIds(client, rowsTable, uploadIds, options = {}) {
    const pageSize = 1000;
    const parallelPages = 5;
    const requireProjectIdentity = options.requireProjectIdentity === true;

    async function fetchUploadRows(uploadId) {
      const rows = [];
      let page = 0;

      while (true) {
        const requests = [];
        for (let index = 0; index < parallelPages; index += 1) {
          const from = (page + index) * pageSize;
          let query = client
            .from(rowsTable)
            .select("id, upload_id, cp, report_type, sheet_name, row_index, row_data")
            .eq("upload_id", uploadId)
            .order("row_index", { ascending: true })
            .range(from, from + pageSize - 1);

          if (requireProjectIdentity) {
            query = query.or("row_data->>Project ID.neq.,row_data->>Title.neq.");
          }

          requests.push(query);
        }

        const responses = await Promise.all(requests);
        let reachedEnd = false;

        responses.forEach(({ data, error }) => {
          if (error) throw error;
          if (!data?.length) {
            reachedEnd = true;
            return;
          }
          rows.push(...data);
          if (data.length < pageSize) reachedEnd = true;
        });

        if (reachedEnd) break;
        page += parallelPages;
      }

      return rows;
    }

    const rows = [];
    for (const uploadId of uploadIds) {
      rows.push(...await fetchUploadRows(uploadId));
    }

    return dedupeCreditReportRows(rows);
  }

  async function getLatestCreditReportRows(reportType) {
    const client = getClient();
    const uploadsTable = config.creditReportUploadsTable || "credit_report_uploads";
    const rowsTable = config.creditReportRowsTable || "credit_report_rows";
    const type = String(reportType || "").trim();

    if (!client || !type) {
      return { rows: [], count: 0, uploads: [], error: "" };
    }

    const { data: uploads, error: uploadsError } = await client
      .from(uploadsTable)
      .select("id, cp, cp_partner, uploaded_at, file_name, report_type")
      .eq("report_type", type)
      .order("uploaded_at", { ascending: false });

    if (uploadsError) throw uploadsError;

    const latestUploadByCp = new Map();
    (uploads || []).forEach((upload) => {
      const cp = uploadPartnerKey(upload);
      if (!cp || latestUploadByCp.has(cp)) return;
      latestUploadByCp.set(cp, upload);
    });

    const latestUploads = [...latestUploadByCp.values()];
    const uploadIds = latestUploads.map((upload) => upload.id).filter(Boolean);
    if (!uploadIds.length) {
      return { rows: [], count: 0, uploads: latestUploads, error: "" };
    }

    const rows = await fetchCreditReportRowsForUploadIds(client, rowsTable, uploadIds, {
      requireProjectIdentity: type === "project"
    });

    return {
      rows,
      count: rows.length,
      uploads: latestUploads
    };
  }

  async function getLatestProjectReportRows() {
    return getLatestCreditReportRows("project");
  }

  async function getLatestAdminLogReportRows() {
    return getLatestCreditReportRows("admin_logs");
  }

  async function getCreditReportUploadSummary() {
    const client = getClient();
    const uploadsTable = config.creditReportUploadsTable || "credit_report_uploads";
    if (!client) return [];

    const { data, error } = await client
      .from(uploadsTable)
      .select("cp, cp_partner, report_type, file_name, uploaded_at")
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    const latestByCpAndType = new Map();
    (data || []).forEach((upload) => {
      const cp = uploadPartnerKey(upload);
      const reportType = String(upload.report_type || "").trim();
      if (!cp || !reportType) return;
      const key = `${cp}::${reportType}`;
      if (latestByCpAndType.has(key)) return;
      latestByCpAndType.set(key, {
        cp,
        reportType,
        fileName: upload.file_name,
        uploadedAt: upload.uploaded_at
      });
    });

    return [...latestByCpAndType.values()];
  }

  const CREDIT_LOG_UPLOADS_STORAGE_KEY = "dashboard-credit-log-uploads";

  function readStoredCreditLogUploads() {
    try {
      const raw = localStorage.getItem(CREDIT_LOG_UPLOADS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function recordCreditLogUpload(cp, fileName) {
    const cpKey = String(cp || "").trim();
    const name = String(fileName || "").trim();
    if (!cpKey || !name) return;

    const entries = readStoredCreditLogUploads().filter((entry) => entry.cp !== cpKey);
    entries.unshift({
      cp: cpKey,
      fileName: name,
      uploadedAt: new Date().toISOString(),
      reportType: "credit_logs"
    });

    try {
      localStorage.setItem(CREDIT_LOG_UPLOADS_STORAGE_KEY, JSON.stringify(entries.slice(0, 100)));
    } catch {
      // Ignore storage quota errors.
    }
  }

  function getCreditLogUploadSummary() {
    return readStoredCreditLogUploads().map((entry) => ({
      cp: entry.cp,
      reportType: entry.reportType || "credit_logs",
      fileName: entry.fileName,
      uploadedAt: entry.uploadedAt
    }));
  }

  async function getCreditUploadSummary() {
    let reportUploads = [];
    try {
      reportUploads = await getCreditReportUploadSummary();
    } catch (error) {
      console.warn("Could not load credit report upload summary:", error);
    }

    return [...reportUploads, ...getCreditLogUploadSummary()].sort(
      (left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0)
    );
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

  function parseCsvRows(text) {
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

    return rows.filter((items) => items.some((item) => item.trim() !== ""));
  }

  function extractProjectFromDescription(description) {
    const text = String(description || "");
    const idMatch = text.match(/\(ID:\s*([^)]+)\)/i);
    const projectId = idMatch ? idMatch[1].trim() : "";
    let projectName = "";

    if (idMatch && idMatch.index > 0) {
      const before = text.slice(0, idMatch.index).trim();
      const colonParts = before.split(":");
      projectName = (colonParts.length > 1 ? colonParts[colonParts.length - 1] : before).trim();
    }

    return { projectId, projectName };
  }

  const CREDIT_LOG_MONTHS =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const CREDIT_LOG_DATE_START = new RegExp(
    `^(\\d{1,2}\\s+(?:${CREDIT_LOG_MONTHS})\\s+\\d{4})\\b`,
    "i"
  );
  const CREDIT_LOG_NOISE = [
    /^👋/,
    /^Powered by Gametize/i,
    /^Ninja HQ - Account Balance/i,
    /^https?:\/\//i,
    /^-- \d+ of \d+ --$/,
    /^\d{1,2}\/\d{1,2}\/\d{2},/,
    /^Date\s+Description\s+Amount\s+Actions$/i,
    /^All Account Balance Transactions$/i,
    /^Customer Name:/i,
    /^Customer Email:/i,
    /^Account Balance$/i,
    /^\$[\d,]+\.\d{2}$/,
    /^USD$/i
  ];

  function isCreditLogNoiseLine(line) {
    const text = String(line || "").trim();
    if (!text) return true;
    return CREDIT_LOG_NOISE.some((pattern) => pattern.test(text));
  }

  async function extractPdfText(file) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) {
      throw new Error("PDF support failed to load. Refresh the page and try again.");
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = [...content.items].sort((left, right) => {
        const yDiff = right.transform[5] - left.transform[5];
        if (Math.abs(yDiff) > 2) return yDiff;
        return left.transform[4] - right.transform[4];
      });

      let lastY = null;
      let pageText = "";

      items.forEach((item) => {
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          pageText += "\n";
        } else if (lastY !== null && pageText && !pageText.endsWith("\n")) {
          pageText += " ";
        }
        pageText += item.str;
        lastY = y;
      });

      pages.push(pageText);
    }

    return pages.join("\n");
  }

  function parseCreditLogAmountToken(text) {
    const matches = [...String(text || "").matchAll(/-?\$[\d,]+\.\d{2}/g)];
    return matches.length ? matches[matches.length - 1][0] : "";
  }

  function parseCreditLogTransactionBlock(blockLines) {
    const full = blockLines.join(" ").replace(/\s+/g, " ").trim();
    const dateMatch = full.match(CREDIT_LOG_DATE_START);
    if (!dateMatch) return null;

    const date = dateMatch[1];
    let rest = full.slice(dateMatch[0].length).trim();

    let actionLabel = "";
    if (/\bView Related Invoice\.?\s*$/i.test(rest)) {
      actionLabel = "View Related Invoice";
      rest = rest.replace(/\s*View Related Invoice\.?\s*$/i, "").trim();
    } else if (/\bInvoice not available\.?\s*$/i.test(rest)) {
      actionLabel = "Invoice not available";
      rest = rest.replace(/\s*Invoice not available\.?\s*$/i, "").trim();
    }

    rest = rest.replace(/\s+USD\s*$/i, "").trim();

    const amountToken = parseCreditLogAmountToken(rest);
    if (!amountToken) return null;

    const amount = toNumber(amountToken);
    const description = rest.replace(amountToken, "").replace(/\s+USD\s*$/i, "").trim();
    if (!description) return null;

    return {
      Date: date,
      Description: description,
      Amount: amount,
      Actions: actionLabel
    };
  }

  const CREDIT_LOG_MONTH_TO_NUMBER = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };

  function parseCreditLogDate(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    const dmyMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dmyMatch) {
      const month = CREDIT_LOG_MONTH_TO_NUMBER[dmyMatch[2].toLowerCase()];
      if (month) {
        return `${dmyMatch[3]}-${month}-${String(dmyMatch[1]).padStart(2, "0")}`;
      }
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return null;
  }

  function splitCreditLogPdfChunks(text) {
    const normalized = String(text || "")
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/\u00a0/g, " ");

    const splitPattern = new RegExp(
      `(?<![\\d/])(?=\\d{1,2}\\s+(?:${CREDIT_LOG_MONTHS})\\s+\\d{4}\\b)`,
      "gi"
    );

    return normalized
      .split(splitPattern)
      .map((chunk) => chunk.trim())
      .filter((chunk) => CREDIT_LOG_DATE_START.test(chunk) && !/^Customer Name:/i.test(chunk));
  }

  function parseCreditLogsPdfText(text) {
    const chunks = splitCreditLogPdfChunks(text);
    const transactions = chunks
      .map((chunk) => {
        const lines = chunk
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line && !isCreditLogNoiseLine(line));
        return parseCreditLogTransactionBlock(lines);
      })
      .filter(Boolean);

    return { transactions };
  }

  function parseCreditLogHeaderBalance(text) {
    const normalized = String(text || "").replace(/\r/g, "");
    const labeledMatch = normalized.match(/Account Balance\s*(?:\r?\n|\s)+\s*(-?\$[\d,]+\.\d{2})/i);
    if (labeledMatch) return toNumber(labeledMatch[1]);

    const preamble = normalized.split(/All Account Balance Transactions/i)[0] || normalized;
    const amounts = [...preamble.matchAll(/-?\$[\d,]+\.\d{2}/g)];
    return amounts.length ? toNumber(amounts[amounts.length - 1][0]) : null;
  }

  function appendHeaderBalanceSnapshot(rows, headerBalance) {
    const balance = toNumber(headerBalance);
    if (!Number.isFinite(balance) || balance < 0) return rows;

    const hasSnapshot = rows.some((row) => /account balance as of/i.test(String(row.description || "")));
    if (hasSnapshot) return rows;

    const latestDate = rows
      .map((row) => row.transaction_date)
      .filter(Boolean)
      .sort()
      .pop() || new Date().toISOString().slice(0, 10);
    const [year, month, day] = latestDate.split("-");

    return [
      ...rows,
      {
        transaction_date: latestDate,
        description: `Account balance as of ${day}/${month}/${year}`,
        amount: balance,
        actions: null
      }
    ];
  }

  function parseCreditLogsRaw(text) {
    const allRows = parseCsvRows(text);
    let headerIndex = -1;

    for (let index = 0; index < allRows.length; index += 1) {
      const row = allRows[index];
      const label = String(row[0] || "").trim().toLowerCase();
      if (label === "date" && String(row[1] || "").trim().toLowerCase() === "description") {
        headerIndex = index;
        break;
      }
    }

    if (headerIndex === -1) {
      return { transactions: parseCsv(text) };
    }

    const headers = allRows[headerIndex].map((header) => header.trim());
    const transactions = [];

    for (let index = headerIndex + 1; index < allRows.length; index += 1) {
      const row = allRows[index];
      if (!row.some((cell) => String(cell || "").trim())) continue;

      const record = {};
      headers.forEach((header, cellIndex) => {
        record[header] = String(row[cellIndex] || "").trim();
      });
      transactions.push(record);
    }

    return { transactions };
  }

  function processCreditLogRows(sourceRows, cpPartner) {
    return sourceRows
      .map((row) => {
        const description = String(pick(row, ["Description", "description"], "")).trim();
        const amount = toNumber(pick(row, ["Amount", "amount"], 0));
        const actions = String(pick(row, ["Actions", "actions", "Action", "action"], "")).trim();
        const transactionDate = parseCreditLogDate(pick(row, ["Date", "date", "transaction_date"], ""));

        if (!description || !transactionDate) return null;

        return {
          transaction_date: transactionDate,
          description,
          amount,
          actions: actions || null
        };
      })
      .filter(Boolean);
  }

  async function replaceCreditLogRows(rows, cpPartner) {
    const client = getClient();
    if (!client || !config.creditUsageTable) {
      throw new Error("Supabase is not configured yet.");
    }

    const { error: deleteError } = await client
      .from(config.creditUsageTable)
      .delete()
      .eq("cp_partner", cpPartner);
    if (deleteError) throw deleteError;

    return insertCreditLogRows(rows, cpPartner);
  }

  async function insertCreditLogRows(rows, cpPartner) {
    const client = getClient();
    if (!client || !config.creditUsageTable) {
      throw new Error("Supabase is not configured yet.");
    }

    const payload = rows.map((row) => ({
      cp_partner: cpPartner,
      transaction_date: row.transaction_date,
      description: row.description,
      amount: row.amount,
      actions: row.actions
    }));

    const { error } = await client.from(config.creditUsageTable).insert(payload);
    if (error) throw error;
    return payload.length;
  }

  function slugifyPartner(value) {
    return String(value || "unknown")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  }

  function sanitizeStorageSegment(value) {
    return String(value || "unknown").trim().replace(/[\\/]+/g, "-") || "unknown";
  }

  function isExcelFile(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    return name.endsWith(".xlsx")
      || name.endsWith(".xls")
      || type.includes("spreadsheetml")
      || type === "application/vnd.ms-excel";
  }

  function getCreditReportStorageName(cpPartner, reportType) {
    const cpName = String(cpPartner || "").trim();
    const reportLabel = reportType === "project" ? "Project statistics" : "Admin Logs";
    return `${cpName} ${reportLabel}.xlsx`;
  }

  function serializeExcelCellValue(cell) {
    if (!cell) return "";

    const value = cell.v;
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (cell.w !== undefined && cell.w !== null && cell.w !== "") {
      return cell.w;
    }
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return value;
  }

  function decodeSheetRange(sheet) {
    const XLSX = window.XLSX;
    if (!sheet || !XLSX) return null;
    if (sheet["!ref"]) return XLSX.utils.decode_range(sheet["!ref"]);

    const addresses = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/.test(key));
    if (!addresses.length) return null;

    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = 0;
    let maxCol = 0;

    addresses.forEach((address) => {
      const { r, c } = XLSX.utils.decode_cell(address);
      minRow = Math.min(minRow, r);
      minCol = Math.min(minCol, c);
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
    });

    return { s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } };
  }

  function sheetToFullGrid(sheet) {
    const XLSX = window.XLSX;
    const range = decodeSheetRange(sheet);
    if (!range || !XLSX) return [];

    const rows = [];

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const row = [];
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        row.push(serializeExcelCellValue(sheet[address]));
      }
      rows.push(row);
    }

    return rows;
  }

  function buildExcelColumnKeys(headerRow) {
    const keys = [];
    const seen = new Map();

    headerRow.forEach((cell, index) => {
      const trimmed = String(cell ?? "").trim();
      const baseKey = trimmed || `Column ${index + 1}`;
      const count = seen.get(baseKey) || 0;
      keys.push(count ? `${baseKey} (${count + 1})` : baseKey);
      seen.set(baseKey, count + 1);
    });

    return keys;
  }

  function gridRowToRecord(row, columnKeys) {
    const record = {};
    const columnCount = Math.max(columnKeys.length, row.length);

    for (let index = 0; index < columnCount; index += 1) {
      const key = columnKeys[index] || `Column ${index + 1}`;
      const value = row[index];
      record[key] = value === null || value === undefined ? "" : value;
    }

    return record;
  }

  function normalizeExcelHeaderCell(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function findExcelHeaderRowIndex(grid) {
    for (let index = 0; index < Math.min(grid.length, 20); index += 1) {
      const values = (grid[index] || []).map(normalizeExcelHeaderCell);
      const hasTitle = values.some((value) => value === "title" || value === "project title");
      const hasCreation = values.some((value) =>
        value.includes("creation") && value.includes("date")
      );
      const hasMonth = values.some((value) => value === "month" || value === "evaluation month");

      if ((hasTitle && hasCreation) || (hasTitle && hasMonth)) {
        return index;
      }
    }

    return 0;
  }

  async function parseExcelReport(file) {
    const XLSX = window.XLSX;
    if (!XLSX) {
      throw new Error("Excel parser failed to load. Refresh the page and try again.");
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheets = [];

    workbook.SheetNames.forEach((sheetName) => {
      const grid = sheetToFullGrid(workbook.Sheets[sheetName]);
      const headerIndex = findExcelHeaderRowIndex(grid);
      const columnKeys = grid.length ? buildExcelColumnKeys(grid[headerIndex] || grid[0]) : [];
      const rows = grid.map((row, index) => ({
        rowIndex: index + 1,
        rowData: gridRowToRecord(row, columnKeys)
      }));

      sheets.push({ sheetName, rows });
    });

    return sheets;
  }

  function flattenExcelReportRows(sheets, uploadId, cpPartner, reportType) {
    const rows = [];

    sheets.forEach(({ sheetName, rows: sheetRows }) => {
      sheetRows.forEach(({ rowIndex, rowData }) => {
        rows.push({
          upload_id: uploadId,
          cp: cpPartner,
          report_type: reportType,
          sheet_name: sheetName,
          row_index: rowIndex,
          row_data: rowData
        });
      });
    });

    return rows;
  }

  async function insertCreditReportRows(rows) {
    const client = getClient();
    const table = config.creditReportRowsTable || "credit_report_rows";
    if (!client || !table) {
      throw new Error("Supabase report rows table is not configured.");
    }

    const chunkSize = 250;
    let insertedRows = 0;

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const { error } = await client.from(table).insert(chunk);
      if (error) throw error;
      insertedRows += chunk.length;
    }

    return insertedRows;
  }

  async function removeCreditReportUpload(client, reportsTable, rowsTable, bucket, uploadId, storagePath) {
    if (uploadId) {
      await client.from(rowsTable).delete().eq("upload_id", uploadId);
      await client.from(reportsTable).delete().eq("id", uploadId);
    }
    if (storagePath) {
      await client.storage.from(bucket).remove([storagePath]);
    }
  }

  const MONTHLY_SHEET_PATTERN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i;
  const reportMonthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  function normalizeReportFieldKey(key) {
    return String(key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function normalizeMonthLabel(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";

    const namedMonth = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (namedMonth) {
      const parsed = new Date(`${namedMonth[2]} ${namedMonth[1]} 1 00:00:00 UTC`);
      if (!Number.isNaN(parsed.getTime())) {
        return reportMonthFmt.format(parsed);
      }
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return reportMonthFmt.format(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)));
    }

    const isoMatch = text.match(/^(\d{4})-(\d{2})/);
    if (isoMatch) {
      const parsed = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, 1));
      if (!Number.isNaN(parsed.getTime())) {
        return reportMonthFmt.format(parsed);
      }
    }

    return text;
  }

  function monthLabelsMatch(left, right) {
    const leftLabel = normalizeMonthLabel(left);
    const rightLabel = normalizeMonthLabel(right);
    return Boolean(leftLabel && rightLabel && leftLabel === rightLabel);
  }

  function isMonthlySheetName(value) {
    return MONTHLY_SHEET_PATTERN.test(String(value || "").trim());
  }

  function isEvaluationMonthFieldKey(key) {
    const normalized = normalizeReportFieldKey(key);
    return normalized === "month"
      || normalized === "evalmonth"
      || (normalized.includes("evaluation") && normalized.includes("month"));
  }

  function setEvaluationMonthOnRowData(rowData, monthLabel) {
    const data = { ...(rowData || {}) };
    let updated = false;

    Object.keys(data).forEach((key) => {
      if (!isEvaluationMonthFieldKey(key)) return;
      data[key] = monthLabel;
      updated = true;
    });

    if (!updated) {
      data["Evaluation Month"] = monthLabel;
    }

    return data;
  }

  function tagRowWithEvaluationMonth(row, monthLabel) {
    return {
      ...row,
      sheet_name: monthLabel,
      row_data: setEvaluationMonthOnRowData(row.row_data, monthLabel)
    };
  }

  function rowMatchesEvaluationMonth(row, monthLabel) {
    const label = normalizeMonthLabel(monthLabel);
    if (!label) return false;

    if (monthLabelsMatch(row.sheet_name, label)) return true;

    const data = row.row_data || {};
    return Object.entries(data).some(([key, value]) => (
      isEvaluationMonthFieldKey(key) && monthLabelsMatch(value, label)
    ));
  }

  function extractRowsForTargetMonth(parsedSheets, uploadId, partner, type, targetMonth) {
    const label = normalizeMonthLabel(targetMonth);
    const matchingSheets = parsedSheets.filter((sheet) => monthLabelsMatch(sheet.sheetName, label));

    if (matchingSheets.length) {
      return flattenExcelReportRows(matchingSheets, uploadId, partner, type);
    }

    const sourceSheets = parsedSheets.filter((sheet) => !isMonthlySheetName(sheet.sheetName));
    if (!sourceSheets.length) {
      return [];
    }

    return flattenExcelReportRows(sourceSheets, uploadId, partner, type)
      .map((row) => tagRowWithEvaluationMonth(row, label));
  }

  function normalizeTargetMonths(options = {}) {
    const raw = Array.isArray(options.targetMonths)
      ? options.targetMonths
      : options.targetMonth
        ? [options.targetMonth]
        : [];

    return [...new Set(raw.map((month) => normalizeMonthLabel(month)).filter(Boolean))];
  }

  function rowMatchesAnyEvaluationMonth(row, monthLabels) {
    return monthLabels.some((label) => rowMatchesEvaluationMonth(row, label));
  }

  function extractRowsForTargetMonths(parsedSheets, uploadId, partner, type, targetMonths) {
    const rows = [];
    const seen = new Set();

    targetMonths.forEach((targetMonth) => {
      extractRowsForTargetMonth(parsedSheets, uploadId, partner, type, targetMonth).forEach((row) => {
        const key = `${row.sheet_name}|${row.row_index}|${JSON.stringify(row.row_data)}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(row);
      });
    });

    return rows;
  }

  function stripCreditReportRowForReinsert(row, uploadId, partner, type) {
    return {
      upload_id: uploadId,
      cp: partner,
      report_type: type,
      sheet_name: row.sheet_name,
      row_index: row.row_index,
      row_data: row.row_data
    };
  }

  async function fetchExistingCreditReportRowsForUploadIds(client, rowsTable, uploadIds, reportType = "") {
    if (!client || !uploadIds?.length) return [];

    const rows = [];
    for (const uploadId of uploadIds) {
      const batch = await fetchCreditReportRowsForUploadIds(client, rowsTable, [uploadId], {
        requireProjectIdentity: String(reportType || "").trim() === "project"
      });
      rows.push(...batch);
    }
    return rows;
  }

  async function uploadCreditReport(file, cpPartner, reportType, options = {}) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const partner = String(cpPartner || "").trim();
    const type = String(reportType || "").trim().toLowerCase();
    const mergeMonthOnly = options.mergeMonthOnly === true;
    const targetMonths = normalizeTargetMonths(options);
    const targetMonth = targetMonths[0] || "";

    if (!partner) {
      throw new Error("Select a channel partner before uploading a report.");
    }
    if (!["project", "admin_logs"].includes(type)) {
      throw new Error("Select a valid report type.");
    }
    if (mergeMonthOnly && type !== "project") {
      throw new Error("Month-specific updates are only available for Project reports.");
    }
    if (mergeMonthOnly && !targetMonths.length) {
      throw new Error("Select at least one evaluation month to update.");
    }
    if (!isExcelFile(file)) {
      throw new Error("Upload Report only accepts Excel files (.xlsx or .xls).");
    }

    const parsedSheets = await parseExcelReport(file);
    let reportRows = mergeMonthOnly
      ? extractRowsForTargetMonths(parsedSheets, "", partner, type, targetMonths)
      : flattenExcelReportRows(parsedSheets, "", partner, type);

    if (!reportRows.length) {
      const sheetSummary = parsedSheets
        .map((sheet) => `${sheet.sheetName || "Sheet"} (${sheet.rows.length} row(s))`)
        .join(", ");
      const monthSummary = targetMonths.join(", ");
      throw new Error(
        mergeMonthOnly
          ? `No rows were found for ${monthSummary} in this Excel report. Sheets parsed: ${sheetSummary || "none"}.`
          : sheetSummary
            ? `No data rows were found in this Excel report. Sheets parsed: ${sheetSummary}.`
            : "No data rows were found in this Excel report."
      );
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      throw new Error("Sign in before uploading a report.");
    }

    const bucket = config.creditReportsBucket || "credit-reports";
    const uploadId = crypto.randomUUID();
    const storageFileName = getCreditReportStorageName(partner, type);
    const cpFolder = sanitizeStorageSegment(partner);
    const storagePath = `${cpFolder}/${storageFileName}`;
    const rowsTable = config.creditReportRowsTable || "credit_report_rows";
    const reportsTable = config.creditReportUploadsTable || "credit_report_uploads";

    const { data: previousByCp, error: previousByCpError } = await client
      .from(reportsTable)
      .select("id, storage_path")
      .eq("report_type", type)
      .eq("cp", partner);
    if (previousByCpError) {
      throw new Error(previousByCpError.message || "Could not check existing report uploads.");
    }

    const { data: previousByPartner, error: previousByPartnerError } = await client
      .from(reportsTable)
      .select("id, storage_path")
      .eq("report_type", type)
      .eq("cp_partner", partner);
    if (previousByPartnerError) {
      throw new Error(previousByPartnerError.message || "Could not check existing report uploads.");
    }

    const previousUploads = [...new Map(
      [...(previousByCp || []), ...(previousByPartner || [])]
        .filter((upload) => upload?.id)
        .map((upload) => [upload.id, upload])
    ).values()];

    const previousIds = (previousUploads || []).map((upload) => upload.id).filter(Boolean);

    if (mergeMonthOnly && previousIds.length) {
      const existingRows = await fetchExistingCreditReportRowsForUploadIds(client, rowsTable, previousIds, type);
      const keptRows = existingRows
        .filter((row) => !rowMatchesAnyEvaluationMonth(row, targetMonths))
        .map((row) => stripCreditReportRowForReinsert(row, uploadId, partner, type));
      reportRows = [...keptRows, ...reportRows];
    }

    reportRows = dedupeCreditReportRows(reportRows);

    const { error: uploadError } = await client.storage.from(bucket).upload(storagePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    if (uploadError) {
      throw new Error(uploadError.message || "Could not store report file in Supabase.");
    }

    const { error: insertError } = await client.from(reportsTable).insert({
      id: uploadId,
      cp: partner,
      cp_partner: partner,
      report_type: type,
      file_name: storageFileName,
      storage_path: storagePath,
      mime_type: file.type || null,
      file_size: file.size || null,
      uploaded_by: sessionData.session.user.id
    });

    if (insertError) {
      await client.storage.from(bucket).remove([storagePath]);
      throw new Error(insertError.message || "Could not save report metadata.");
    }

    let insertedRows = 0;
    try {
      const rowsWithUploadId = reportRows.map((row) => ({ ...row, upload_id: uploadId }));
      insertedRows = await insertCreditReportRows(rowsWithUploadId);

      if (previousIds.length) {
        const { error: deletePreviousError } = await client
          .from(reportsTable)
          .delete()
          .in("id", previousIds);
        if (deletePreviousError) {
          throw new Error(deletePreviousError.message || "Could not replace the previous report upload.");
        }

        const previousPaths = [...new Set(
          (previousUploads || [])
            .map((upload) => upload.storage_path)
            .filter((path) => path && path !== storagePath)
        )];
        if (previousPaths.length) {
          await client.storage.from(bucket).remove(previousPaths);
        }
      }
    } catch (error) {
      await removeCreditReportUpload(client, reportsTable, rowsTable, bucket, uploadId, storagePath);
      throw error;
    }

    return {
      uploadId,
      storagePath,
      bucket,
      reportType: type,
      cpPartner: partner,
      insertedRows,
      sheetCount: parsedSheets.length,
      targetMonth: targetMonths.length === 1 ? targetMonths[0] : "",
      targetMonths
    };
  }

  async function uploadCreditLogs(file, cpPartner) {
    const partner = String(cpPartner || "").trim();
    if (!partner) {
      throw new Error("Select a channel partner before uploading credit logs.");
    }

    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    const pdfText = isPdf ? await extractPdfText(file) : "";
    const parsed = isPdf
      ? parseCreditLogsPdfText(pdfText)
      : parseCreditLogsRaw(await file.text());
    let rows = processCreditLogRows(parsed.transactions, partner);

    if (isPdf) {
      const headerBalance = parseCreditLogHeaderBalance(pdfText);
      if (headerBalance !== null) {
        rows = appendHeaderBalanceSnapshot(rows, headerBalance);
      }
    }

    if (!rows.length) {
      throw new Error(
        isPdf
          ? "No credit log transactions were found in this PDF. Export the Account Balance Transaction History report and try again."
          : "No credit log transactions were found in this file."
      );
    }

    const chunkSize = 250;
    let insertedRows = 0;
    let replacedExisting = false;

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      try {
        if (!replacedExisting) {
          const client = getClient();
          if (client) {
            await client.from(config.creditUsageTable).delete().eq("cp_partner", partner);
          }
          replacedExisting = true;
        }
        const payload = await callEdgeFunction("upload-credit-logs", {
          method: "POST",
          body: {
            cpPartner: partner,
            rows: chunk
          }
        });
        insertedRows += payload.insertedRows || 0;
      } catch (edgeError) {
        console.warn("Edge upload failed, inserting directly:", edgeError);
        if (!replacedExisting) {
          insertedRows += await replaceCreditLogRows(chunk, partner);
          replacedExisting = true;
        } else {
          insertedRows += await insertCreditLogRows(chunk, partner);
        }
      }
    }

    recordCreditLogUpload(partner, file.name);

    return {
      originalRows: parsed.transactions.length,
      insertedRows,
      cpPartner: partner,
      fileName: file.name
    };
  }

  async function getLastStripeUploadDate() {
    const tableName = config.stripeInvoicesTable || "stripe_invoices";
    const client = getClient();
    if (!client) return null;

    const { data, error } = await client
      .from(tableName)
      .select("uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.uploaded_at || null;
  }

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
      .replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "")
      .trim();

    if (/^\(.*\)$/.test(text)) {
      const inner = text.slice(1, -1).trim();
      const number = Number.parseFloat(inner.replace(/^\$/, "").replace(/,/g, ""));
      return Number.isFinite(number) ? -Math.abs(number) : 0;
    }

    const signedMoney = text.match(/^(-?)\s*\$\s*([\d,]+(?:\.\d+)?)/);
    if (signedMoney) {
      const number = Number.parseFloat(signedMoney[2].replace(/,/g, ""));
      if (!Number.isFinite(number)) return 0;
      return signedMoney[1] === "-" ? -Math.abs(number) : number;
    }

    const plain = Number.parseFloat(text.replace(/,/g, ""));
    return Number.isFinite(plain) ? plain : 0;
  }

  async function showSessionControls() {
    const buttons = [...document.querySelectorAll("#signOutButton")];
    if (!buttons.length) return;

    const client = getClient();
    if (!client) {
      buttons.forEach((button) => {
        button.hidden = true;
      });
      return;
    }

    const { data } = await client.auth.getSession();
    buttons.forEach((button) => {
      button.hidden = !data.session;
      button.addEventListener("click", signOut);
    });
  }

  window.DashboardAuth = {
    getClient,
    isConfigured,
    isAllowedEmail,
    handleAuthRedirect,
    requireAuth,
    showSessionControls,
    signIn,
    signInWithGoogle,
    signUp,
    resetPassword,
    signOut,
    callEdgeFunction,
    fetchTableRows,
    fetchXeroTables,
    getCpContacts,
    syncCpContacts,
    saveCpContactsToSupabase,
    fetchCpContactsFromTable,
    upsertCpContact,
    deleteCpContact,
    getCreditUsageLogs,
    getPartnerCreditBalances,
    getCreditsUserLimitRows,
    saveCreditsUserLimitRows,
    getCreditHealthMonthStatuses,
    saveCreditHealthMonthStatus,
    getLatestProjectReportRows,
    getLatestAdminLogReportRows,
    getCreditUploadSummary,
    recordCreditLogUpload,
    getXeroInvoices,
    getDashboardXeroRows,
    refreshDashboardXeroRows,
    getLastStripeUploadDate,
    uploadStripeInvoices,
    uploadCreditLogs,
    uploadCreditReport
  };
}());
