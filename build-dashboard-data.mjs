import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const root = path.dirname(fileURLToPath(import.meta.url));
const xeroWorkbookPath = path.join(root, "Xero Sale Invoices.xlsx");

const excludedPteLtdInvoices = new Set([
  "INV23/0492",
  "INV23/0464",
  "CN-0465",
  "INV23/0461",
  "INV22/0384",
  "INV21/0286",
  "INV23/0502",
  "INV23/0484",
  "INV22/0406",
  "INV22/0391",
  "INV22/0357",
  "INV22/0333",
  "INV21/0327",
  "INV21/0317",
  "INV21/0318",
  "INV18/0036",
  "INV23/0449",
  "CN-0454",
  "INV24/0520",
  "INV23009",
  "INV22002"
]);
const excludedSdnBhdInvoices = new Set([
  "INV23006",
  "CN-024",
  "INV25/023",
  "INV24/018"
]);

function loadXeroSalesRowsFromWorkbook(workbookPath) {
  const workbook = XLSX.readFile(workbookPath);
  const rows = [];

  const pushRow = (source, documentType, numberField) => {
    const invoiceNumber = String(source[numberField] || "").trim();
    if (!invoiceNumber) return;

    const subTotal = number(source["Sub Total"]);
    rows.push({
      Entity: String(source.Entity || "").trim(),
      ContactName: String(source.Contact || "").trim(),
      InvoiceNumber: invoiceNumber,
      InvoiceDate: source.Date,
      DueDate: source["Due Date"] ?? "",
      Currency: String(source.Currency || "USD").trim(),
      Subtotal: subTotal,
      Quantity: 1,
      UnitAmount: subTotal,
      LineAmount: subTotal,
      TaxAmount: number(source["Total Tax"]),
      Total: number(source.Total),
      InvoiceAmountPaid: source["Amount Paid"] ?? source["Remaining Credit"] ?? "",
      Status: String(source.Status || "").trim(),
      Reference: String(source.Reference || "").trim(),
      EmailAddress: "",
      Type: documentType === "credit_note" ? "Sales credit note" : "Sales invoice",
      _documentType: documentType
    });
  };

  for (const row of XLSX.utils.sheet_to_json(workbook.Sheets["Xero Invoices"])) {
    pushRow(row, "invoice", "Invoice Number");
  }

  for (const row of XLSX.utils.sheet_to_json(workbook.Sheets["Xero Credit Notes"])) {
    pushRow(row, "credit_note", "Credit Note Number");
  }

  return rows;
}

async function loadAuthConfig() {
  try {
    const text = await fs.readFile(path.join(root, "auth-config.js"), "utf8");
    return {
      supabaseUrl: text.match(/supabaseUrl:\s*["']([^"']+)["']/)?.[1] || "",
      supabaseAnonKey: text.match(/supabaseAnonKey:\s*["']([^"']+)["']/)?.[1] || "",
      xeroSalesTable: text.match(/xeroSalesTable:\s*["']([^"']+)["']/)?.[1] || ""
    };
  } catch {
    return { supabaseUrl: "", supabaseAnonKey: "", xeroSalesTable: "" };
  }
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return fallback;
}

function normalizeXeroSalesRow(row) {
  const invoiceNumber = String(pick(row, [
    "invoice_number",
    "InvoiceNumber",
    "Invoice Number",
    "credit_note_number",
    "Credit Note Number",
    "number"
  ]) || "").trim();
  if (!invoiceNumber) return null;

  const documentType = String(pick(row, ["document_type", "_documentType", "Type", "type"], "invoice")).toLowerCase();
  const isCreditNote = /credit/.test(documentType);
  const subtotal = number(pick(row, ["subtotal", "Subtotal", "Sub Total", "line_amount", "LineAmount", "Line Amount"]));

  return {
    Entity: String(pick(row, ["entity", "Entity"], "")).trim(),
    ContactName: String(pick(row, ["contact_name", "ContactName", "Contact", "contact"], "")).trim(),
    InvoiceNumber: invoiceNumber,
    InvoiceDate: pick(row, ["invoice_date", "InvoiceDate", "Date", "date"], ""),
    DueDate: pick(row, ["due_date", "DueDate", "Due Date"], ""),
    Currency: String(pick(row, ["currency", "Currency"], "USD")).trim(),
    Subtotal: subtotal,
    Quantity: number(pick(row, ["quantity", "Quantity"], 1)) || 1,
    UnitAmount: number(pick(row, ["unit_amount", "UnitAmount", "Unit Amount"], subtotal)),
    LineAmount: number(pick(row, ["line_amount", "LineAmount", "Line Amount"], subtotal)),
    TaxAmount: number(pick(row, ["tax", "tax_amount", "TaxAmount", "Total Tax", "total_tax"], 0)),
    Total: number(pick(row, ["total", "Total"], subtotal)),
    InvoiceAmountPaid: pick(row, ["amount_paid", "InvoiceAmountPaid", "Amount Paid", "invoice_amount_paid"], ""),
    Status: String(pick(row, ["status", "Status"], "")).trim(),
    Reference: String(pick(row, ["reference", "Reference"], "")).trim(),
    EmailAddress: String(pick(row, ["contact_email", "email", "EmailAddress", "Email Address"], "")).trim(),
    Type: isCreditNote ? "Sales credit note" : "Sales invoice",
    _documentType: isCreditNote ? "credit_note" : "invoice"
  };
}

function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Supabase Xero fetch failed (${response.statusCode}): ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
  });
}

async function loadXeroSalesRowsFromSupabase() {
  const config = await loadAuthConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.xeroSalesTable) {
    return { rows: null, source: "workbook", reason: "Supabase Xero table is not configured" };
  }

  const baseUrl = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(config.xeroSalesTable)}?select=*`;
  const headers = {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`
  };
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const page = await requestJson(baseUrl, {
      ...headers,
      Range: `${offset}-${offset + pageSize - 1}`
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return {
    rows: rows.map(normalizeXeroSalesRow).filter(Boolean),
    source: `supabase:${config.xeroSalesTable}`,
    reason: ""
  };
}

function isGametizePteLtd(entity) {
  return /gametize\s+pte\s+ltd/i.test(String(entity || ""));
}

function isGametizeSdnBhd(entity) {
  return /gametize\s+sdn\s+bhd/i.test(String(entity || ""));
}

function shouldExcludeXeroInvoice(entity, invoiceNumber) {
  const invoice = String(invoiceNumber || "").trim();
  if (!invoice) return false;
  if (isGametizePteLtd(entity) && excludedPteLtdInvoices.has(invoice)) return true;
  if (isGametizeSdnBhd(entity) && excludedSdnBhdInvoices.has(invoice)) return true;
  return false;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function toObjects(csvRows) {
  const headers = csvRows[0];
  return csvRows
    .slice(1)
    .filter((row) => row.length > 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function toCsv(rows, headers) {
  return `${[
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\r\n")}\r\n`;
}

function number(value) {
  let text = String(value ?? "0")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .trim();
  text = text.replace(/^\s*(USD|SGD|MYR|RM|\$)\s*/i, "").replace(/\s*(USD|SGD|MYR|RM)\s*$/i, "").trim();
  text = text.replace(/,/g, "").trim();
  let negate = false;
  if (/^\(.*\)$/.test(text)) {
    negate = true;
    text = text.slice(1, -1).trim();
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return 0;
  return negate ? -Math.abs(parsed) : parsed;
}

/** Native-currency Sub Total from Xero (credit notes are negative for revenue). */
function xeroSubtotalNative(row) {
  let subtotal = number(row.Subtotal ?? row["Sub Total"] ?? row.LineAmount);
  if (row._documentType === "credit_note" && subtotal > 0) {
    subtotal = -subtotal;
  }
  return subtotal;
}

function money(value) {
  return number(value).toFixed(2);
}

const companyNameStopwords = new Set([
  "and",
  "the",
  "sdn",
  "bhd",
  "berhad",
  "pte",
  "ltd",
  "limited",
  "llc",
  "llp",
  "plc",
  "inc",
  "corp",
  "corporation",
  "company",
  "co"
]);

function nameTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !companyNameStopwords.has(token));
}

function normalize(value) {
  return nameTokens(value).join("");
}

function organizationAliases(organization) {
  return String(organization || "")
    .split(/[\/|]+/)
    .map((alias) => alias.trim())
    .filter(Boolean)
    .concat(organization);
}

function parseStripeDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (match) return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]));

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})/);
  if (match) return new Date(Date.UTC(+match[3], +match[1] - 1, +match[2], +match[4], +match[5]));

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseSalesDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const utcDays = Math.floor(value - 25569);
    return new Date(utcDays * 86400 * 1000);
  }

  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Date.UTC(+match[3], +match[2] - 1, +match[1], 0, 0));

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSalesDateLabel(value) {
  const parsed = parseSalesDate(value);
  if (!parsed) return String(value ?? "");
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${parsed.getUTCFullYear()}`;
}

function formatDateTime(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isOrganization(organization, expected) {
  return normalize(organization) === normalize(expected);
}

function shouldZeroStripeTotalBeforeGst(row, organization) {
  const date = parseStripeDate(row["Date (UTC)"]);
  if (!date) return false;
  if (isOrganization(organization, "focusu")) {
    return date >= new Date(Date.UTC(2022, 1, 12)) &&
      date <= new Date(Date.UTC(2024, 5, 11, 23, 59, 59));
  }

  if (isOrganization(organization, "Right Impact")) {
    return date >= new Date(Date.UTC(2024, 1, 7)) &&
      date <= new Date(Date.UTC(2024, 3, 30, 23, 59, 59));
  }

  if (isOrganization(organization, "Finalix")) {
    return date >= new Date(Date.UTC(2023, 11, 31)) &&
      date <= new Date(Date.UTC(2024, 3, 30, 23, 59, 59));
  }

  return false;
}

function shouldExcludeStripeRow(row, organization) {
  const date = parseStripeDate(row["Date (UTC)"]);
  if (!date) return false;

  const email = String(row["Customer Email"] || "").trim().toLowerCase();
  if (isOrganization(organization, "Pico") || email.endsWith("@pico.com")) {
    return date >= new Date(Date.UTC(2021, 7, 2)) &&
      date <= new Date(Date.UTC(2022, 8, 10, 23, 59, 59));
  }

  return false;
}

function stripeInvoiceAdjustments(row) {
  const subtotal = number(row.Subtotal);
  if (row.id !== "in_1Gz8nNDEzGPOQfRsc7fBVMNj") {
    return {
      discount: number(row["Total Discount Amount"]),
      total: number(row.Total),
      discountText: row["Total Discount Amount"],
      totalText: row.Total
    };
  }

  const discount = number(row["Total Discount Amount"]) + 100;
  const total = subtotal - discount;
  return {
    discount,
    total,
    discountText: discount.toFixed(2),
    totalText: total.toFixed(2)
  };
}

const [invoiceText, contactsText] = await Promise.all([
  fs.readFile(path.join(root, "invoices.csv"), "utf8"),
  fs.readFile(path.join(root, "CP emails.csv"), "utf8")
]);

let xeroSource = "workbook";
let xeroSalesRows = [];
try {
  const supabaseXero = await loadXeroSalesRowsFromSupabase();
  if (supabaseXero.rows) {
    xeroSalesRows = supabaseXero.rows;
    xeroSource = supabaseXero.source;
  } else {
    xeroSalesRows = loadXeroSalesRowsFromWorkbook(xeroWorkbookPath);
    xeroSource = `${path.basename(xeroWorkbookPath)} (${supabaseXero.reason})`;
  }
} catch (error) {
  console.warn(error.message);
  xeroSalesRows = loadXeroSalesRowsFromWorkbook(xeroWorkbookPath);
  xeroSource = `${path.basename(xeroWorkbookPath)} (Supabase unavailable)`;
}
const xeroProcessedHeaders = [
  "Entity",
  "ContactName",
  "Organization",
  "InvoiceNumber",
  "Reference",
  "InvoiceDate",
  "DueDate",
  "Currency",
  "Quantity",
  "UnitAmount",
  "Subtotal",
  "Discount",
  "Tax",
  "Total before GST",
  "Total",
  "InvoiceAmountPaid",
  "Status",
  "Type"
];

const fxRatesPath = path.join(root, "fx-rates-usd.json");
let fxRateCache = {};
try {
  fxRateCache = JSON.parse(await fs.readFile(fxRatesPath, "utf8"));
} catch {
  fxRateCache = {};
}
let fxRateCacheChanged = false;

function nearestCachedRateToUsd(code, dateKey) {
  const suffix = `:${code}:USD`;
  const target = new Date(`${dateKey}T00:00:00Z`).getTime();
  let bestRate = null;
  let bestDiff = Infinity;

  for (const [key, rate] of Object.entries(fxRateCache)) {
    if (!key.endsWith(suffix) || !Number.isFinite(rate)) continue;
    const cachedDate = key.slice(0, key.indexOf(":"));
    const diff = Math.abs(new Date(`${cachedDate}T00:00:00Z`).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRate = rate;
    }
  }

  return bestRate;
}

async function conversionRateToUsd(currency, invoiceDate) {
  const code = String(currency || "USD").trim().toUpperCase();
  if (!code || code === "USD") return 1;

  const parsedDate = parseSalesDate(invoiceDate);
  if (!parsedDate) {
    throw new Error(`Cannot parse invoice date "${invoiceDate}" for ${code} conversion.`);
  }

  const dateKey = formatDate(parsedDate);
  const cacheKey = `${dateKey}:${code}:USD`;
  if (Number.isFinite(fxRateCache[cacheKey])) return fxRateCache[cacheKey];

  try {
    const response = await fetch(
      `https://api.frankfurter.app/${dateKey}?from=${encodeURIComponent(code)}&to=USD`
    );
    if (!response.ok) {
      throw new Error(`Could not fetch ${code} to USD rate for ${dateKey}: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rate = Number(payload?.rates?.USD);
    if (!Number.isFinite(rate)) {
      throw new Error(`No USD rate returned for ${code} on ${dateKey}.`);
    }

    fxRateCache[cacheKey] = rate;
    fxRateCacheChanged = true;
    return rate;
  } catch (error) {
    const fallback = nearestCachedRateToUsd(code, dateKey);
    if (Number.isFinite(fallback)) {
      console.warn(
        `Using nearest cached ${code}->USD rate for ${dateKey} after fetch failure: ${error.message}`
      );
      fxRateCache[cacheKey] = fallback;
      fxRateCacheChanged = true;
      return fallback;
    }
    throw error;
  }
}

const contacts = toObjects(parseCsv(contactsText));
const exactEmails = new Map();
const domains = new Map();
const organizations = new Map();
const organizationAliasMap = new Map();
const partnerMetaByOrg = new Map();

function splitContactValues(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addContactKey(key, organization) {
  const cleaned = String(key || "").trim().toLowerCase().replace(/^@/, "");
  if (!cleaned || !organization) return;
  if (cleaned.includes("@")) exactEmails.set(cleaned, organization);
  else domains.set(cleaned, organization);
}

function contactField(contact, ...keys) {
  for (const key of keys) {
    const match = Object.entries(contact).find(([header]) =>
      header.replace(/^\uFEFF/, "").trim() === key
    );
    if (match && String(match[1] ?? "").trim()) {
      return String(match[1]).trim();
    }
  }
  return "";
}

for (const contact of contacts) {
  const organization = contactField(
    contact,
    "CP name",
    "CP Name",
    "Organization",
    "Channel Partner name"
  );
  if (!organization) continue;

  if (!partnerMetaByOrg.has(organization)) {
    partnerMetaByOrg.set(organization, {
      status: contactField(contact, "Status"),
      joinedDate: contactField(contact, "Joined Date"),
      agreementEndDate: contactField(contact, "Agreement End Date")
    });
  } else {
    const meta = partnerMetaByOrg.get(organization);
    if (!meta.status) meta.status = contactField(contact, "Status");
    if (!meta.joinedDate) meta.joinedDate = contactField(contact, "Joined Date");
    if (!meta.agreementEndDate) meta.agreementEndDate = contactField(contact, "Agreement End Date");
  }

  for (const key of splitContactValues(contact["Contact Emails "] || contact["Contact Emails"] || contact.email || contact.Email)) {
    addContactKey(key, organization);
  }
  for (const key of splitContactValues(contact["Email Domain"] || contact.Domain)) {
    addContactKey(key, organization);
  }

  const normalized = normalize(organization);
  if (normalized) organizations.set(normalized, organization);
  for (const alias of organizationAliases(organization)) {
    const key = normalize(alias);
    if (key && !organizationAliasMap.has(key)) {
      organizationAliasMap.set(key, {
        key,
        organization,
        tokens: nameTokens(alias)
      });
    }
  }
}

const organizationMatchers = Array.from(organizationAliasMap.values()).sort((a, b) => b.key.length - a.key.length);

function matchStripeOrganization(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (exactEmails.has(normalizedEmail)) return { organization: exactEmails.get(normalizedEmail), via: "exact" };

  const domain = normalizedEmail.split("@").pop();
  if (domains.has(domain)) return { organization: domains.get(domain), via: "domain" };

  return null;
}

function matchSalesOrganization(contactName) {
  const normalizedContact = normalize(contactName);
  if (!normalizedContact) return null;

  const contactTokens = new Set(nameTokens(contactName));
  for (const matcher of organizationMatchers) {
    if (normalizedContact.includes(matcher.key) || matcher.key.includes(normalizedContact)) {
      return matcher.organization;
    }

    if (matcher.tokens.length >= 2 && matcher.tokens.every((token) => contactTokens.has(token))) {
      return matcher.organization;
    }
  }
  return null;
}

const stripeRows = toObjects(parseCsv(invoiceText));
let positiveSubtotalRows = 0;
let skippedStripeInvoiceIdRows = 0;
let skippedStripeRuleRows = 0;
let exactMatchedRows = 0;
let domainMatchedRows = 0;
const unmatchedStripeRows = [];
const processedRows = [];

for (const row of stripeRows) {
  const subtotal = number(row.Subtotal);
  if (subtotal <= 0) continue;
  positiveSubtotalRows++;

  if (String(row.id || "").startsWith("INV")) {
    skippedStripeInvoiceIdRows++;
    continue;
  }

  const match = matchStripeOrganization(row["Customer Email"]);
  if (!match) {
    if (shouldExcludeStripeRow(row, "")) {
      skippedStripeRuleRows++;
      continue;
    }
    unmatchedStripeRows.push(row);
    continue;
  }

  if (match.via === "exact") exactMatchedRows++;
  else domainMatchedRows++;

  if (shouldExcludeStripeRow(row, match.organization)) {
    skippedStripeRuleRows++;
    continue;
  }

  const adjustments = stripeInvoiceAdjustments(row);
  const tax = number(row.Tax);
  const totalBeforeGst = shouldZeroStripeTotalBeforeGst(row, match.organization) ? 0 : adjustments.total - tax;
  processedRows.push({
    id: row.id,
    "Date (UTC)": row["Date (UTC)"],
    "Ending Balance": row["Ending Balance"],
    "Starting Balance": row["Starting Balance"],
    "Credits Usage": (number(row["Ending Balance"]) - number(row["Starting Balance"])).toFixed(2),
    Subtotal: row.Subtotal,
    "Total Discount Amount": adjustments.discountText,
    "Applied Coupons": row["Applied Coupons"],
    Tax: row.Tax,
    "Total Before GST": totalBeforeGst.toFixed(2),
    Total: adjustments.totalText,
    "Customer Email": row["Customer Email"],
    Organization: match.organization,
    Platform: "Stripe",
    "Amount Paid": row["Amount Paid"],
    Status: row.Status
  });
}

const salesProcessed = [];
const sdnSalesProcessed = [];
const unmatchedSalesRows = [];
const unmatchedSdnSalesRows = [];
let excludedSalesRows = 0;
let excludedSdnSalesRows = 0;
let duplicateSalesRows = 0;
const seenSalesRows = new Set();

async function processXeroSalesLine({ row, index, idPrefix, processedBucket, unmatchedBucket, onExcluded }) {
  const rowSignature = JSON.stringify(row);
  if (seenSalesRows.has(rowSignature)) {
    duplicateSalesRows++;
    return;
  }
  seenSalesRows.add(rowSignature);

  const entity = String(row.Entity || "").trim();
  if (shouldExcludeXeroInvoice(entity, row.InvoiceNumber)) {
    onExcluded();
    return;
  }

  const organization = matchSalesOrganization(row.ContactName);
  if (!organization) {
    unmatchedBucket.push(row);
    return;
  }

  const subtotalNative = xeroSubtotalNative(row);
  const conversionRate = await conversionRateToUsd(row.Currency, row.InvoiceDate);
  const subtotalUsd = subtotalNative * conversionRate;
  const totalBeforeGst = subtotalUsd;
  const tax = number(row.TaxAmount) * conversionRate;
  const totalUsd = number(row.Total) * conversionRate;
  const invoiceDate = parseSalesDate(row.InvoiceDate);
  const normalizedDate = invoiceDate ? formatDateTime(invoiceDate) : formatSalesDateLabel(row.InvoiceDate);

  const outputRow = {
    Entity: entity,
    ContactName: row.ContactName,
    Organization: organization,
    InvoiceNumber: row.InvoiceNumber,
    Reference: row.Reference,
    InvoiceDate: formatSalesDateLabel(row.InvoiceDate),
    DueDate: row.DueDate ? formatSalesDateLabel(row.DueDate) : "",
    Currency: row.Currency,
    Quantity: row.Quantity,
    UnitAmount: number(row.UnitAmount).toFixed(2),
    Subtotal: subtotalUsd.toFixed(2),
    Discount: "0.00",
    Tax: tax.toFixed(2),
    "Total before GST": totalBeforeGst.toFixed(2),
    Total: totalUsd.toFixed(2),
    InvoiceAmountPaid: money(row.InvoiceAmountPaid),
    Status: row.Status,
    Type: row.Type
  };
  processedBucket.push(outputRow);

  processedRows.push({
    id: `${row.InvoiceNumber || idPrefix}-${index + 1}`,
    "Date (UTC)": normalizedDate,
    "Ending Balance": "0.00",
    "Starting Balance": "0.00",
    "Credits Usage": "0.00",
    Subtotal: subtotalUsd.toFixed(2),
    "Total Discount Amount": "0.00",
    "Applied Coupons": "",
    Tax: tax.toFixed(2),
    "Total Before GST": totalBeforeGst.toFixed(2),
    Total: (totalBeforeGst + tax).toFixed(2),
    "Customer Email": row.EmailAddress,
    Organization: organization,
    Platform: "Xero",
    "Amount Paid": money(row.InvoiceAmountPaid),
    Status: row.Status
  });
}

for (let index = 0; index < xeroSalesRows.length; index++) {
  const row = xeroSalesRows[index];
  const entity = String(row.Entity || "").trim();
  const isSdn = isGametizeSdnBhd(entity);

  await processXeroSalesLine({
    row,
    index,
    idPrefix: isSdn ? "SdnSalesInvoice" : "SalesInvoice",
    processedBucket: isSdn ? sdnSalesProcessed : salesProcessed,
    unmatchedBucket: isSdn ? unmatchedSdnSalesRows : unmatchedSalesRows,
    onExcluded: () => {
      if (isSdn) excludedSdnSalesRows++;
      else excludedSalesRows++;
    }
  });
}

const dashboardHeaders = [
  "id",
  "Date (UTC)",
  "Ending Balance",
  "Starting Balance",
  "Credits Usage",
  "Subtotal",
  "Total Discount Amount",
  "Applied Coupons",
  "Tax",
  "Total Before GST",
  "Total",
  "Customer Email",
  "Organization",
  "Platform",
  "Amount Paid",
  "Status"
];

const processedCsv = toCsv(processedRows, dashboardHeaders);
try {
  await fs.writeFile(path.join(root, "invoices_processed.csv"), processedCsv, "utf8");
} catch {
  // Excel or OneDrive can lock this file; always write the corrected copy below.
}
try {
  await fs.writeFile(path.join(root, "invoices_processed_corrected.csv"), processedCsv, "utf8");
} catch {
  await fs.writeFile(path.join(root, "invoices_processed_latest.csv"), processedCsv, "utf8");
}

const salesProcessedCsv = toCsv(salesProcessed, xeroProcessedHeaders);
try {
  await fs.writeFile(path.join(root, "SalesInvoices_processed.csv"), salesProcessedCsv, "utf8");
} catch {
  // Excel or OneDrive can lock this file; always write the corrected copy below.
}
try {
  await fs.writeFile(path.join(root, "SalesInvoices_processed_corrected.csv"), salesProcessedCsv, "utf8");
} catch {
  await fs.writeFile(path.join(root, "SalesInvoices_processed_latest.csv"), salesProcessedCsv, "utf8");
}

await fs.writeFile(
  path.join(root, "unmatched_positive_subtotal.csv"),
  toCsv(
    unmatchedStripeRows.map((row) => ({
      id: row.id,
      "Date (UTC)": row["Date (UTC)"],
      Subtotal: row.Subtotal,
      Total: row.Total,
      "Customer Email": row["Customer Email"],
      Status: row.Status
    })),
    ["id", "Date (UTC)", "Subtotal", "Total", "Customer Email", "Status"]
  ),
  "utf8"
);

const unmatchedSalesCsv = toCsv(
  unmatchedSalesRows.map((row) => ({
    Entity: row.Entity,
    ContactName: row.ContactName,
    InvoiceNumber: row.InvoiceNumber,
    InvoiceDate: formatSalesDateLabel(row.InvoiceDate),
    LineAmount: row.LineAmount,
    Status: row.Status
  })),
  ["Entity", "ContactName", "InvoiceNumber", "InvoiceDate", "LineAmount", "Status"]
);
try {
  await fs.writeFile(path.join(root, "unmatched_sales_invoices.csv"), unmatchedSalesCsv, "utf8");
} catch {
  await fs.writeFile(path.join(root, "unmatched_sales_invoices_latest.csv"), unmatchedSalesCsv, "utf8");
}

const sdnSalesProcessedCsv = toCsv(sdnSalesProcessed, xeroProcessedHeaders);
try {
  await fs.writeFile(path.join(root, "SalesInvoices_Gametize Sdn Bhd_processed.csv"), sdnSalesProcessedCsv, "utf8");
} catch {
  await fs.writeFile(path.join(root, "SalesInvoices_Gametize Sdn Bhd_processed_latest.csv"), sdnSalesProcessedCsv, "utf8");
}
const unmatchedSdnSalesCsv = toCsv(
  unmatchedSdnSalesRows.map((row) => ({
    Entity: row.Entity,
    ContactName: row.ContactName,
    InvoiceNumber: row.InvoiceNumber,
    InvoiceDate: formatSalesDateLabel(row.InvoiceDate),
    LineAmount: row.LineAmount,
    Status: row.Status
  })),
  ["Entity", "ContactName", "InvoiceNumber", "InvoiceDate", "LineAmount", "Status"]
);
try {
  await fs.writeFile(path.join(root, "unmatched_sales_invoices_sdn_bhd.csv"), unmatchedSdnSalesCsv, "utf8");
} catch {
  await fs.writeFile(path.join(root, "unmatched_sales_invoices_sdn_bhd_latest.csv"), unmatchedSdnSalesCsv, "utf8");
}

if (fxRateCacheChanged) {
  await fs.writeFile(fxRatesPath, `${JSON.stringify(fxRateCache, null, 2)}\n`, "utf8");
}

const partnersByOrganization = Object.fromEntries(partnerMetaByOrg);

const payload = {
  generatedAt: new Date().toISOString().slice(0, 19),
  partnersByOrganization,
  source: {
    stripeInvoiceRows: stripeRows.length,
    stripePositiveSubtotalRows: positiveSubtotalRows,
    stripeSkippedInvoiceIdRows: skippedStripeInvoiceIdRows,
    stripeSkippedRuleRows: skippedStripeRuleRows,
    stripeExactMatchedRows: exactMatchedRows,
    stripeDomainMatchedRows: domainMatchedRows,
    stripeUnmatchedPositiveSubtotalRows: unmatchedStripeRows.length,
    xeroSource,
    xeroInvoiceRows: xeroSalesRows.filter((row) => row._documentType === "invoice").length,
    xeroCreditNoteRows: xeroSalesRows.filter((row) => row._documentType === "credit_note").length,
    xeroDuplicateRows: duplicateSalesRows,
    xeroExcludedPteRows: excludedSalesRows,
    xeroExcludedSdnRows: excludedSdnSalesRows,
    xeroMatchedPteRows: salesProcessed.length,
    xeroMatchedSdnRows: sdnSalesProcessed.length,
    xeroUnmatchedPteRows: unmatchedSalesRows.length,
    xeroUnmatchedSdnRows: unmatchedSdnSalesRows.length,
    matchedRows: processedRows.length,
    contactRows: contacts.length
  },
  rows: processedRows
};

await fs.writeFile(path.join(root, "dashboard-data.js"), `window.DASHBOARD_DATA = ${JSON.stringify(payload, null, 2)};`, "utf8");

console.log(JSON.stringify(payload.source, null, 2));
