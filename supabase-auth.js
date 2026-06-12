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

  async function getCpContacts() {
    return callEdgeFunction("get-cp-contacts");
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

  async function getLatestProjectReportRows() {
    const client = getClient();
    const uploadsTable = config.creditReportUploadsTable || "credit_report_uploads";
    const rowsTable = config.creditReportRowsTable || "credit_report_rows";

    if (!client) {
      return { rows: [], count: 0, uploads: [] };
    }

    const { data: uploads, error: uploadsError } = await client
      .from(uploadsTable)
      .select("id, cp, uploaded_at, file_name")
      .eq("report_type", "project")
      .order("uploaded_at", { ascending: false });

    if (uploadsError) throw uploadsError;

    const latestUploadByCp = new Map();
    (uploads || []).forEach((upload) => {
      const cp = String(upload.cp || "").trim();
      if (!cp || latestUploadByCp.has(cp)) return;
      latestUploadByCp.set(cp, upload);
    });

    const uploadIds = [...latestUploadByCp.values()].map((upload) => upload.id);
    if (!uploadIds.length) {
      return { rows: [], count: 0, uploads: [] };
    }

    const rows = [];
    const pageSize = 1000;
    const idChunkSize = 50;

    for (let chunkStart = 0; chunkStart < uploadIds.length; chunkStart += idChunkSize) {
      const chunkIds = uploadIds.slice(chunkStart, chunkStart + idChunkSize);

      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data, error } = await client
          .from(rowsTable)
          .select("id, upload_id, cp, report_type, sheet_name, row_index, row_data")
          .in("upload_id", chunkIds)
          .gte("row_index", 1)
          .order("cp", { ascending: true })
          .order("row_index", { ascending: true })
          .range(from, to);

        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
    }

    return {
      rows,
      count: rows.length,
      uploads: [...latestUploadByCp.values()]
    };
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

  async function parseExcelReport(file) {
    const XLSX = window.XLSX;
    if (!XLSX) {
      throw new Error("Excel parser failed to load. Refresh the page and try again.");
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheets = [];

    workbook.SheetNames.forEach((sheetName) => {
      const grid = sheetToFullGrid(workbook.Sheets[sheetName]);
      const columnKeys = grid.length ? buildExcelColumnKeys(grid[0]) : [];
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

  async function uploadCreditReport(file, cpPartner, reportType) {
    const client = getClient();
    if (!client) {
      throw new Error("Supabase is not configured yet.");
    }

    const partner = String(cpPartner || "").trim();
    const type = String(reportType || "").trim().toLowerCase();
    if (!partner) {
      throw new Error("Select a channel partner before uploading a report.");
    }
    if (!["project", "admin_logs"].includes(type)) {
      throw new Error("Select a valid report type.");
    }
    if (!isExcelFile(file)) {
      throw new Error("Upload Report only accepts Excel files (.xlsx or .xls).");
    }

    const parsedSheets = await parseExcelReport(file);
    const reportRows = flattenExcelReportRows(parsedSheets, "", partner, type);
    if (!reportRows.length) {
      const sheetSummary = parsedSheets
        .map((sheet) => `${sheet.sheetName || "Sheet"} (${sheet.rows.length} row(s))`)
        .join(", ");
      throw new Error(
        sheetSummary
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

    const { data: previousUploads, error: previousUploadsError } = await client
      .from(reportsTable)
      .select("id, storage_path")
      .eq("cp", partner)
      .eq("report_type", type);
    if (previousUploadsError) {
      throw new Error(previousUploadsError.message || "Could not check existing report uploads.");
    }

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

      const previousIds = (previousUploads || []).map((upload) => upload.id).filter(Boolean);
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
      sheetCount: parsedSheets.length
    };
  }

  async function uploadCreditLogs(file, cpPartner) {
    const partner = String(cpPartner || "").trim();
    if (!partner) {
      throw new Error("Select a channel partner before uploading credit logs.");
    }

    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    const parsed = isPdf
      ? parseCreditLogsPdfText(await extractPdfText(file))
      : parseCreditLogsRaw(await file.text());
    const rows = processCreditLogRows(parsed.transactions, partner);

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

    return {
      originalRows: parsed.transactions.length,
      insertedRows,
      cpPartner: partner
    };
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
    getCreditUsageLogs,
    getPartnerCreditBalances,
    getLatestProjectReportRows,
    getXeroInvoices,
    getDashboardXeroRows,
    refreshDashboardXeroRows,
    uploadStripeInvoices,
    uploadCreditLogs,
    uploadCreditReport
  };
}());
