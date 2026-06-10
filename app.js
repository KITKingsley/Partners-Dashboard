(function () {
  const rawRows = (window.DASHBOARD_DATA && window.DASHBOARD_DATA.rows) || [];
  const partnersByOrganization =
    (window.DASHBOARD_DATA && window.DASHBOARD_DATA.partnersByOrganization) || {};
  const bundledRows = rawRows.map(normalizeDashboardRow).filter(Boolean);
  let rows = bundledRows.slice();
  let cpContactsPromise = null;
  let cpContactsLoaded = false;
  let fxRatesPromise = null;
  let fxRateCache = {};
  const fxRatePending = new Map();
  let xeroSkippedCurrencyRows = 0;

  const excludedPteLtdInvoices = new Set([
    "INV23/0492",
    "INV23/0464",
    "CN-0465",
    "INV23/0461",
    "INV22/0384",
    "INV21/0286",
    "INV23/0502",
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
      canonical: "Finalix",
      aliases: [
        "finalix",
        "Finalix"
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

  function normalizeDashboardRow(row) {
    const date = parseStripeDate(row["Date (UTC)"]);
    if (!date) return null;

    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return applyCurrentRevenueOverrides({
      id: row.id,
      date,
      dateLabel: row["Date (UTC)"],
      day: date.getUTCDate(),
      month,
      year: String(date.getUTCFullYear()),
      endingBalance: toNumber(row["Ending Balance"]),
      startingBalance: toNumber(row["Starting Balance"]),
      creditsUsage: toNumber(row["Credits Usage"]),
      subtotal: toNumber(row.Subtotal),
      discount: toNumber(row["Total Discount Amount"]),
      tax: toNumber(row.Tax),
      totalBeforeGst: toNumber(row["Total Before GST"]),
      total: toNumber(row.Total),
      email: row["Customer Email"],
      organization: row.Organization,
      originalOrganization: row.Organization,
      platform: row.Platform || "Stripe",
      cpMatched: row.Platform !== "Xero",
      amountPaid: toNumber(row["Amount Paid"]),
      status: row.Status
    });
  }

  const state = {
    month: "all",
    year: "all",
    organization: "all",
    platform: "all"
  };

  const els = {
    monthFilter: document.querySelector("#monthFilter"),
    yearFilter: document.querySelector("#yearFilter"),
    organizationFilter: document.querySelector("#organizationFilter"),
    platformFilter: document.querySelector("#platformFilter"),
    resetFilters: document.querySelector("#resetFilters"),
    uploadPanel: document.querySelector("#uploadPanel"),
    xeroFileInput: document.querySelector("#xeroFileInput"),
    stripeFileInput: document.querySelector("#stripeFileInput"),
    uploadXeroButton: document.querySelector("#uploadXeroButton"),
    uploadStripeButton: document.querySelector("#uploadStripeButton"),
    uploadStatus: document.querySelector("#uploadStatus"),
    totalRevenue: document.querySelector("#totalRevenue"),
    momGrowth: document.querySelector("#momGrowth"),
    momGrowthContext: document.querySelector("#momGrowthContext"),
    yoyGrowth: document.querySelector("#yoyGrowth"),
    yoyGrowthContext: document.querySelector("#yoyGrowthContext"),
    averageAmount: document.querySelector("#averageAmount"),
    transactionCount: document.querySelector("#transactionCount"),
    organizationCount: document.querySelector("#organizationCount"),
    dataLoadStatus: document.querySelector("#dataLoadStatus"),
    dataLoadStatusText: document.querySelector("#dataLoadStatusText"),
    cpMetaStrip: document.querySelector("#cpMetaStrip"),
    cpMetaJoined: document.querySelector("#cpMetaJoined"),
    cpMetaAgreementEnd: document.querySelector("#cpMetaAgreementEnd"),
    cpMetaStatus: document.querySelector("#cpMetaStatus"),
    momDelta: document.querySelector("#momDelta"),
    yoyDelta: document.querySelector("#yoyDelta"),
    monthlyChart: document.querySelector("#monthlyChart"),
    yearlyChart: document.querySelector("#yearlyChart"),
    platformChart: document.querySelector("#platformChart"),
    topPartnerName: document.querySelector("#topPartnerName"),
    topPartnerRevenue: document.querySelector("#topPartnerRevenue"),
    topPartnerContribution: document.querySelector("#topPartnerContribution"),
    projectedRevenue: document.querySelector("#projectedRevenue"),
    projectedRevenueContext: document.querySelector("#projectedRevenueContext"),
    organizationBars: document.querySelector("#organizationBars"),
    transactionRows: document.querySelector("#transactionRows")
  };

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });

  function toNumber(value) {
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
    const number = Number.parseFloat(text);
    if (!Number.isFinite(number)) return 0;
    return negate ? -Math.abs(number) : number;
  }

  function parseStripeDate(value) {
    const text = String(value || "").trim();
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (isoMatch) {
      const [, year, month, day, hour, minute] = isoMatch.map(Number);
      return new Date(Date.UTC(year, month - 1, day, hour, minute));
    }

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})/);
    if (slashMatch) {
      const [, month, day, year, hour, minute] = slashMatch.map(Number);
      return new Date(Date.UTC(year, month - 1, day, hour, minute));
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  async function loadFxRateCache() {
    if (!fxRatesPromise) {
      fxRatesPromise = fetch("fx-rates-usd.json")
        .then((response) => (response.ok ? response.json() : {}))
        .catch(() => ({}))
        .then((payload) => {
          fxRateCache = payload || {};
          return fxRateCache;
        });
    }
    return fxRatesPromise;
  }

  function nearestCachedRateToUsd(code, dateKey) {
    const target = new Date(`${dateKey}T00:00:00Z`).getTime();
    let bestRate = null;
    let bestDiff = Infinity;

    for (const [key, rate] of Object.entries(fxRateCache)) {
      if (!key.endsWith(`:${code}:USD`) || !Number.isFinite(rate)) continue;
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

    const date = invoiceDate instanceof Date ? invoiceDate : parseStripeDate(invoiceDate);
    if (!date) return 1;

    await loadFxRateCache();
    const dateKey = formatDateKey(date);
    const cacheKey = `${dateKey}:${code}:USD`;
    if (Number.isFinite(fxRateCache[cacheKey])) return fxRateCache[cacheKey];
    if (fxRatePending.has(cacheKey)) return fxRatePending.get(cacheKey);

    const ratePromise = (async () => {
      try {
        const response = await fetch(`https://api.frankfurter.app/${dateKey}?from=${encodeURIComponent(code)}&to=USD`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const rate = Number(payload?.rates?.USD);
        if (Number.isFinite(rate)) {
          fxRateCache[cacheKey] = rate;
          return rate;
        }
      } catch (error) {
        console.warn(`Could not fetch ${code}->USD rate for ${dateKey}:`, error);
      }

      const cachedRate = nearestCachedRateToUsd(code, dateKey);
      if (Number.isFinite(cachedRate)) return cachedRate;

      try {
        const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(code)}&to=USD`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const rate = Number(payload?.rates?.USD);
        if (Number.isFinite(rate)) {
          fxRateCache[cacheKey] = rate;
          return rate;
        }
      } catch (error) {
        console.warn(`Could not fetch latest ${code}->USD rate:`, error);
      }

      return null;
    })().finally(() => {
      fxRatePending.delete(cacheKey);
    });

    fxRatePending.set(cacheKey, ratePromise);
    return ratePromise;
  }

  function restoreBundledRowsIfEmpty() {
    if (rows.length || !bundledRows.length) return false;
    rows = bundledRows.slice();
    return true;
  }

  function formatDateTime(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }

  function applyCurrentRevenueOverrides(row) {
    const organization = normalizedLookupKey(row.organization);
    const focusuStart = new Date("2022-02-12T00:00:00Z");
    if (row.platform === "Stripe" && organization.includes("focusu") && row.date >= focusuStart) {
      return {
        ...row,
        totalBeforeGst: 0
      };
    }
    return row;
  }

  function canonicalOrganization(value) {
    const compactValue = compactLookupKey(value);
    if (!compactValue) return value;

    const rule = organizationCanonicalRules.find((item) =>
      item.aliases.some((alias) => {
        const compactAlias = compactLookupKey(alias);
        return compactValue.includes(compactAlias) || compactAlias.includes(compactValue);
      })
    );

    return rule ? rule.canonical : value;
  }

  function forcedOrganizationForRow(row) {
    const sourceOrganization = row.originalOrganization || row.organization || "";
    const sourceCompact = compactLookupKey(sourceOrganization);
    const emailDomain = domainFromEmail(row.email);

    if (sourceCompact.includes("finalix") || emailDomain === "finalix.com") {
      return "Finalix";
    }

    if (sourceCompact.includes("pmkpsicomarketing") || sourceCompact.includes("psicomarketing")) {
      return "doit";
    }

    return "";
  }

  function sum(list, key) {
    return list.reduce((total, row) => total + row[key], 0);
  }

  function groupBy(list, key, valueKey) {
    return list.reduce((map, row) => {
      const group = row[key];
      map.set(group, (map.get(group) || 0) + row[valueKey]);
      return map;
    }, new Map());
  }

  function sortedEntries(map) {
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function filteredRows() {
    if (!rows.length && bundledRows.length) {
      rows = bundledRows.slice();
    }

    return rows.filter((row) => {
      const monthMatch = state.month === "all" || row.month === state.month;
      const yearMatch = state.month !== "all" || state.year === "all" || row.year === state.year;
      const orgMatch = state.organization === "all" || row.organization === state.organization;
      const platformMatch = state.platform === "all" || row.platform === state.platform;
      return monthMatch && yearMatch && orgMatch && platformMatch;
    });
  }

  function populateFilters() {
    const months = Array.from(new Set(rows.map((row) => row.month))).sort();
    const years = Array.from(new Set(rows.map((row) => row.year))).sort();
    const organizations = Array.from(new Set(rows.map((row) => row.organization))).sort();
    const platforms = Array.from(new Set(rows.map((row) => row.platform))).sort();

    if (state.month !== "all" && !months.includes(state.month)) state.month = "all";
    if (state.year !== "all" && !years.includes(state.year)) state.year = "all";
    if (state.organization !== "all" && !organizations.includes(state.organization)) state.organization = "all";
    if (state.platform !== "all" && !platforms.includes(state.platform)) state.platform = "all";

    els.monthFilter.innerHTML = [
      '<option value="all">All months</option>',
      ...months.map((month) => `<option value="${month}">${formatMonth(month)}</option>`)
    ].join("");

    els.yearFilter.innerHTML = [
      '<option value="all">All years</option>',
      ...years.map((year) => `<option value="${year}">${year}</option>`)
    ].join("");

    els.organizationFilter.innerHTML = [
      '<option value="all">All organizations</option>',
      ...organizations.map((org) => `<option value="${escapeHtml(org)}">${escapeHtml(org)}</option>`)
    ].join("");

    els.platformFilter.innerHTML = [
      '<option value="all">All platforms</option>',
      ...platforms.map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`)
    ].join("");

    els.monthFilter.value = state.month;
    els.yearFilter.value = state.year;
    els.organizationFilter.value = state.organization;
    els.platformFilter.value = state.platform;
  }

  function formatMonth(month) {
    const [year, monthIndex] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, monthIndex - 1, 1)));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function pick(row, keys, fallback = "") {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    }
    return fallback;
  }

  function textFromValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") {
      return String(
        value.name ||
        value.Name ||
        value.contact_name ||
        value.ContactName ||
        value.email ||
        value.EmailAddress ||
        ""
      ).trim();
    }
    return String(value).trim();
  }

  function normalizedLookupKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function compactLookupKey(value) {
    return normalizedLookupKey(value).replace(/[^a-z0-9]/g, "");
  }

  function domainFromEmail(value) {
    const email = normalizedLookupKey(value);
    if (!email.includes("@")) return "";
    return email.split("@").pop().replace(/^www\./, "");
  }

  function cpField(row, names) {
    const lowerMap = Object.keys(row || {}).reduce((map, key) => {
      map[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = row[key];
      return map;
    }, {});

    for (const name of names) {
      const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const value = lowerMap[compact];
      if (value !== undefined && value !== null && value !== "") return textFromValue(value);
    }

    return "";
  }

  function organizationFromCpRow(row) {
    return cpField(row, [
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
  }

  function buildCpLookup(cpRows) {
    const emailMap = new Map();
    const domainMap = new Map();
    const nameMap = new Map();
    const nameEntries = [];

    cpRows.forEach((row) => {
      const organization = organizationFromCpRow(row);
      if (!organization) return;

      const email = cpField(row, [
        "Email",
        "email",
        "Email Address",
        "Contact Email",
        "Customer Email",
        "Member Email"
      ]);
      const domain = cpField(row, [
        "Domain",
        "Email Domain",
        "Website",
        "Company Website"
      ]) || domainFromEmail(email);
      const contactName = cpField(row, [
        "Contact",
        "Contact Name",
        "Member",
        "Member Name",
        "Name"
      ]);
      const aliases = [
        cpField(row, ["Alias", "Aliases", "Short Name", "Brand", "Brand Name"]),
        cpField(row, ["Xero Contact", "Xero Contact Name", "Customer", "Customer Name"]),
        cpField(row, ["Stripe Customer", "Stripe Customer Name"])
      ].filter(Boolean);

      if (email) emailMap.set(normalizedLookupKey(email), organization);
      if (domain) domainMap.set(normalizedLookupKey(domain).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0], organization);
      [contactName, organization, ...aliases].forEach((name) => {
        const exactKey = normalizedLookupKey(name);
        const compactKey = compactLookupKey(name);
        if (!exactKey || compactKey.length < 3) return;
        nameMap.set(exactKey, organization);
        nameEntries.push({ key: exactKey, compactKey, organization });
      });
    });

    return { emailMap, domainMap, nameMap, nameEntries };
  }

  function fuzzyCpOrganization(value, lookup) {
    const key = normalizedLookupKey(value);
    const compactKey = compactLookupKey(value);
    if (!key || compactKey.length < 3) return "";
    if (lookup.nameMap.has(key)) return lookup.nameMap.get(key);

    const match = lookup.nameEntries.find((entry) => {
      if (entry.compactKey.length < 3) return false;
      return compactKey.includes(entry.compactKey) || entry.compactKey.includes(compactKey);
    });

    return match ? match.organization : "";
  }

  function applyCpLookup(cpRows) {
    if (!Array.isArray(cpRows) || !cpRows.length) {
      return { matchedRows: 0, removedXeroRows: 0 };
    }

    const lookup = buildCpLookup(cpRows);
    let matchedRows = 0;
    let removedXeroRows = 0;

    rows = rows.map((row) => {
      const emailKey = normalizedLookupKey(row.email);
      const domainKey = domainFromEmail(row.email);
      const sourceOrganization = row.originalOrganization || row.organization;
      const forcedOrganization = forcedOrganizationForRow(row);
      const matchedOrganization =
        forcedOrganization ||
        lookup.emailMap.get(emailKey) ||
        lookup.domainMap.get(domainKey) ||
        fuzzyCpOrganization(sourceOrganization, lookup);
      const cpMatched = Boolean(matchedOrganization) || (row.platform !== "Xero" && row.cpMatched);
      if (cpMatched) matchedRows += 1;

      return {
        ...row,
        organization: canonicalOrganization(matchedOrganization || row.organization),
        cpMatched
      };
    }).map((row) => {
      return applyCurrentRevenueOverrides(row);
    }).filter((row) => {
      if (row.platform !== "Xero" || row.cpMatched) return true;
      removedXeroRows += 1;
      return false;
    });

    return { matchedRows, removedXeroRows };
  }

  function isExcludedXeroInvoice(entity, invoiceNumber) {
    const normalizedEntity = normalizedLookupKey(entity);
    const invoice = String(invoiceNumber || "").trim();
    if (normalizedEntity === "gametize pte ltd" && excludedPteLtdInvoices.has(invoice)) return true;
    if (normalizedEntity === "gametize sdn bhd" && excludedSdnBhdInvoices.has(invoice)) return true;
    return false;
  }

  async function normalizeSupabaseXeroRow(row, index) {
    const documentType = String(pick(row, ["document_type", "_documentType", "Type", "type"], "invoice")).toLowerCase();
    const isCreditNote = /credit/.test(documentType);
    const entity = textFromValue(pick(row, ["entity", "Entity"]));
    const status = textFromValue(pick(row, ["status", "Status"]));
    if (["voided", "deleted"].includes(status.toLowerCase())) return null;

    const invoiceNumber = textFromValue(pick(row, [
      "invoice_number",
      "InvoiceNumber",
      "Invoice Number",
      "credit_note_number",
      "CreditNoteNumber",
      "Credit Note Number"
    ]));
    if (isExcludedXeroInvoice(entity, invoiceNumber)) return null;

    const dateValue = pick(row, [
      "invoice_date",
      "credit_note_date",
      "InvoiceDate",
      "CreditNoteDate",
      "Date",
      "date",
      "created_at"
    ]);
    const date = parseStripeDate(dateValue);
    if (!date) return null;

    const organization = textFromValue(pick(row, [
      "organization",
      "Organization",
      "org",
      "Org",
      "cp_name",
      "CP name",
      "contact_name",
      "ContactName",
      "contact",
      "Contact"
    ]));
    if (!organization) return null;

    const sign = isCreditNote ? -1 : 1;
    const currency = textFromValue(pick(row, ["currency", "Currency"], "USD")) || "USD";
    const conversionRate = await conversionRateToUsd(currency, date);
    if (!Number.isFinite(conversionRate)) {
      xeroSkippedCurrencyRows += 1;
      return null;
    }
    const subtotalNative = sign * Math.abs(toNumber(pick(row, [
      "subtotal",
      "Subtotal",
      "sub_total",
      "SubTotal",
      "Sub Total",
      "subtotal_amount",
      "line_amount",
      "LineAmount",
      "Line Amount"
    ])));
    const subtotal = subtotalNative * conversionRate;
    const tax = sign * Math.abs(toNumber(pick(row, ["tax", "Tax", "tax_amount", "TaxAmount", "total_tax", "Total Tax"]))) * conversionRate;
    const totalBeforeGst = subtotal;
    const total = sign * Math.abs(toNumber(pick(row, ["total", "Total"], subtotalNative))) * conversionRate;

    return normalizeDashboardRow({
      id: invoiceNumber || pick(row, [
        "id",
      ], `xero-supabase-${index + 1}`),
      "Date (UTC)": formatDateTime(date),
      "Ending Balance": "0.00",
      "Starting Balance": "0.00",
      "Credits Usage": "0.00",
      Subtotal: subtotal.toFixed(2),
      "Total Discount Amount": toNumber(pick(row, ["discount", "Discount", "total_discount_amount"], 0)).toFixed(2),
      "Applied Coupons": "",
      Tax: tax.toFixed(2),
      "Total Before GST": totalBeforeGst.toFixed(2),
      Total: total.toFixed(2),
      "Customer Email": textFromValue(pick(row, ["contact_email", "email", "EmailAddress", "Email Address"], "")),
      Organization: canonicalOrganization(organization),
      Platform: "Xero",
      "Amount Paid": pick(row, ["amount_paid", "Amount Paid", "invoice_amount_paid", "InvoiceAmountPaid"], ""),
      Status: status || (isCreditNote ? "Credit note" : "")
    });
  }

  async function hydrateXeroRowsFromSupabase() {
    if (!window.DashboardAuth?.getDashboardXeroRows && !window.DashboardAuth?.getXeroInvoices) return;

    if (els.uploadStatus) {
      setUploadStatus("Loading cached Xero dashboard rows from Supabase...");
    }

    try {
      const payload = await window.DashboardAuth.getDashboardXeroRows();
      const cachedRows = payload.rows || [];
      const xeroRows = cachedRows.map((row) => normalizeDashboardRow({
        id: row.invoice_number || row.source_id || row.id,
        "Date (UTC)": row.invoice_date,
        "Ending Balance": "0.00",
        "Starting Balance": "0.00",
        "Credits Usage": "0.00",
        Subtotal: row.subtotal,
        "Total Discount Amount": "0.00",
        Tax: row.tax,
        "Total Before GST": row.total_before_gst,
        Total: row.total,
        "Customer Email": "",
        Organization: row.organization,
        Platform: "Xero",
        "Amount Paid": "",
        Status: row.status
      })).filter(Boolean);

      if (!xeroRows.length && window.DashboardAuth?.getXeroInvoices) {
        await hydrateRawXeroRowsFromSupabase();
        return;
      }

      rows = rows.filter((row) => row.platform !== "Xero").concat(xeroRows);
      restoreBundledRowsIfEmpty();
      populateFilters();
      render();

      if (els.uploadStatus) {
        setUploadStatus(`Loaded ${xeroRows.length} cached Xero dashboard rows from Supabase.`, "is-success");
      }
    } catch (error) {
      console.warn("Could not load cached Xero rows from Supabase:", error);
      rows = rows.filter((row) => row.platform !== "Xero");
      restoreBundledRowsIfEmpty();
      populateFilters();
      render();
      if (els.uploadStatus && !els.uploadPanel?.hidden) {
        setUploadStatus(error.message || "Could not load cached Xero rows from Supabase.", "is-error");
      }
    }
  }

  async function hydrateRawXeroRowsFromSupabase() {
    const payload = await window.DashboardAuth.getXeroInvoices();
    const supabaseRows = payload.rows || [];
    xeroSkippedCurrencyRows = 0;
    const xeroRows = (await Promise.all(
      supabaseRows.map((row, index) => normalizeSupabaseXeroRow(row, index))
    )).filter(Boolean);

    let matchResult = { matchedRows: 0, removedXeroRows: 0 };
    if (supabaseRows.length && xeroRows.length) {
      const cpPayload = await loadCpContactsPayload();
      const cpRows = cpPayload.rows || [];

      if (!cpRows.length) {
        throw new Error("Could not filter Xero rows because CP contacts returned no rows.");
      }

      rows = rows.filter((row) => row.platform !== "Xero").concat(xeroRows);
      matchResult = applyCpLookup(cpRows);
    }

    restoreBundledRowsIfEmpty();
    populateFilters();
    render();

    if (els.uploadStatus) {
      const currencyWarning = xeroSkippedCurrencyRows
        ? ` Skipped ${xeroSkippedCurrencyRows} non-USD rows without an available FX rate.`
        : "";
      setUploadStatus(
        `Loaded ${xeroRows.length} raw Xero rows because cached dashboard rows are empty. Removed ${matchResult.removedXeroRows} non-CP Xero rows.${currencyWarning}`,
        "is-success"
      );
    }
  }

  async function loadCpContactsPayload() {
    if (!window.DashboardAuth?.getCpContacts) return { rows: [] };
    cpContactsPromise = cpContactsPromise || window.DashboardAuth.getCpContacts();
    const payload = await cpContactsPromise;
    cpContactsLoaded = true;
    return payload || { rows: [] };
  }

  async function hydrateCpContactsFromSupabase() {
    if (!window.DashboardAuth?.getCpContacts) return;

    try {
      const payload = await loadCpContactsPayload();
      const cpRows = payload.rows || [];
      if (!cpRows.length) return;

      const matchResult = applyCpLookup(cpRows);
      populateFilters();
      render();

      if (els.uploadStatus) {
        setUploadStatus(
          `Matched organizations using ${cpRows.length} CP contact rows. Removed ${matchResult.removedXeroRows} non-CP Xero rows.`,
          "is-success"
        );
      }
    } catch (error) {
      console.warn("Could not load CP contacts from Supabase:", error);
      populateFilters();
      render();
      if (els.uploadStatus && !els.uploadPanel?.hidden) {
        setUploadStatus(error.message || "Could not load CP contacts from Supabase.", "is-error");
      }
    }
  }

  function partnerMetaForOrganization(orgName) {
    if (!orgName || orgName === "all") return null;
    const direct = partnersByOrganization[orgName];
    if (direct) return direct;
    const lower = orgName.toLowerCase();
    for (const key of Object.keys(partnersByOrganization)) {
      if (key.toLowerCase() === lower) return partnersByOrganization[key];
    }
    const compactOrg = compactLookupKey(orgName);
    for (const key of Object.keys(partnersByOrganization)) {
      const compactKey = compactLookupKey(key);
      if (compactOrg.length >= 4 && compactKey.length >= 4 && (compactKey.includes(compactOrg) || compactOrg.includes(compactKey))) {
        return partnersByOrganization[key];
      }
    }

    const rule = organizationCanonicalRules.find((item) => item.canonical === orgName);
    if (rule) {
      for (const alias of rule.aliases) {
        const aliasCompact = compactLookupKey(alias);
        for (const key of Object.keys(partnersByOrganization)) {
        const keyCompact = compactLookupKey(key);
          if (aliasCompact.length >= 4 && keyCompact.length >= 4 && (keyCompact.includes(aliasCompact) || aliasCompact.includes(keyCompact))) {
            return partnersByOrganization[key];
          }
        }
      }
    }

    return null;
  }

  function deltaLabel(entries, formatter) {
    if (entries.length < 2) return "No comparison";
    const previous = entries[entries.length - 2][1];
    const current = entries[entries.length - 1][1];
    const diff = current - previous;
    const percent = previous === 0 ? null : (diff / previous) * 100;
    const sign = diff >= 0 ? "+" : "";
    const pct = percent === null ? "" : ` (${sign}${percent.toFixed(1)}%)`;
    return `${sign}${formatter(diff)}${pct}`;
  }

  function periodDeltaLabel(entries, formatter, labelFormatter = (value) => value) {
    if (entries.length < 2) return "No comparison";
    const previousPeriod = entries[entries.length - 2][0];
    const currentPeriod = entries[entries.length - 1][0];
    return `${labelFormatter(currentPeriod)} vs ${labelFormatter(previousPeriod)}: ${deltaLabel(entries, formatter)}`;
  }

  function comparisonLegend(entries, labelFormatter) {
    return entries.map(([period, value]) => ({
      color: "#2563eb",
      label: `${labelFormatter(period)} revenue`,
      value
    }));
  }

  function deltaValue(entries) {
    if (entries.length < 2) return 0;
    return entries[entries.length - 1][1] - entries[entries.length - 2][1];
  }

  function deltaPercent(entries) {
    if (entries.length < 2) return null;
    const previous = entries[entries.length - 2][1];
    if (previous === 0) return null;
    return ((entries[entries.length - 1][1] - previous) / previous) * 100;
  }

  function setDeltaState(element, entries, hasPrevious) {
    element.classList.remove("delta-negative", "delta-positive");
    if (!hasPrevious || entries.length < 2) return;
    element.classList.add(deltaValue(entries) < 0 ? "delta-negative" : "delta-positive");
  }

  function setKpiTrend(element, value) {
    element.classList.remove("delta-negative", "delta-positive");
    if (value === null) return;
    element.classList.add(value < 0 ? "delta-negative" : "delta-positive");
  }

  function previousMonth(month) {
    const [year, monthIndex] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthIndex - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function comparisonRows() {
    return rows.filter((row) => {
      const orgMatch = state.organization === "all" || row.organization === state.organization;
      const platformMatch = state.platform === "all" || row.platform === state.platform;
      return orgMatch && platformMatch;
    });
  }

  function latestMonth(list) {
    const months = Array.from(new Set(list.map((row) => row.month))).sort();
    return months[months.length - 1] || null;
  }

  function selectedMonth() {
    if (state.month !== "all") return state.month;
    return latestMonth(comparisonRows());
  }

  function selectedYear() {
    if (state.year !== "all") return state.year;
    return null;
  }

  function periodTotal(list, key, value, amountKey) {
    return sum(list.filter((row) => row[key] === value), amountKey);
  }

  function monthlyComparison() {
    const list = comparisonRows();
    const currentMonth = selectedMonth();
    if (!currentMonth) return { entries: [], hasPrevious: false };

    const priorMonth = previousMonth(currentMonth);
    const hasPrevious = list.some((row) => row.month === priorMonth);
    const priorTotal = periodTotal(list, "month", priorMonth, "totalBeforeGst");
    const currentTotal = periodTotal(list, "month", currentMonth, "totalBeforeGst");
    return {
      deltaEntries: [
        [priorMonth, priorTotal],
        [currentMonth, currentTotal]
      ],
      categories: [formatMonth(priorMonth), formatMonth(currentMonth)],
      series: [
        {
          name: `${formatMonth(currentMonth)} revenue`,
          color: "#2563eb",
          values: [priorTotal, currentTotal]
        }
      ],
      hasPrevious
    };
  }

  function yearlyComparison() {
    const list = comparisonRows();
    const currentYear = selectedYear();
    if (!currentYear) {
      const entries = sortedEntries(groupBy(list, "year", "totalBeforeGst"));
      return {
        deltaEntries: entries.slice(-2),
        categories: entries.map(([year]) => year),
        series: [
          {
            name: "Revenue by year",
            color: "#2563eb",
            values: entries.map(([, value]) => value)
          }
        ],
        hasPrevious: entries.length >= 2
      };
    }

    const priorYear = String(Number(currentYear) - 1);
    const hasPrevious = list.some((row) => row.year === priorYear);
    const priorTotal = periodTotal(list, "year", priorYear, "totalBeforeGst");
    const currentTotal = periodTotal(list, "year", currentYear, "totalBeforeGst");
    return {
      deltaEntries: [
        [priorYear, priorTotal],
        [currentYear, currentTotal]
      ],
      categories: [priorYear, currentYear],
      series: [
        {
          name: `${currentYear} revenue`,
          color: "#2563eb",
          values: [priorTotal, currentTotal]
        }
      ],
      hasPrevious
    };
  }

  function drawComparisonLineChart(canvas, categories, series, options) {
    const activePointIndex = options.activePointIndex ?? null;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight || Number(canvas.getAttribute("height"));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const pad = { top: 40, right: 156, bottom: 58, left: 86 };
    const chartWidth = Math.max(1, width - pad.left - pad.right);
    const chartHeight = Math.max(1, height - pad.top - pad.bottom);
    const allValues = series.flatMap((line) => line.values);
    const maxValue = Math.max(1, ...allValues);
    const minValue = Math.min(0, ...allValues);
    const range = Math.max(1, maxValue - minValue);
    const xForIndex = (index) => categories.length === 1
        ? pad.left + chartWidth / 2
        : pad.left + (chartWidth / (categories.length - 1)) * index;
    const yForValue = (value) => pad.top + chartHeight - ((value - minValue) / range) * chartHeight;

    context.strokeStyle = "#d8ddd5";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left, pad.top);
    context.lineTo(pad.left, pad.top + chartHeight);
    context.lineTo(pad.left + chartWidth, pad.top + chartHeight);
    context.stroke();

    const ticks = [0, maxValue / 2, maxValue];
    ticks.forEach((tick) => {
      const y = yForValue(tick);
      context.strokeStyle = tick === 0 ? "#d8ddd5" : "rgba(216, 221, 213, 0.55)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(pad.left + chartWidth, y);
      context.stroke();
      context.fillStyle = "#627069";
      context.font = "700 10px system-ui";
      context.textAlign = "right";
      context.fillText(money.format(tick), pad.left - 12, y + 4);
    });

    if (!categories.length || !series.length) {
      context.fillStyle = "#627069";
      context.font = "600 14px system-ui";
      context.fillText("No matched transactions", pad.left, pad.top + 34);
      comparisonChartState.set(canvas, { categories, series, options: { ...options, activePointIndex: undefined }, hitPoints: [] });
      return;
    }

    const legendItems = options.legendItems ? [...options.legendItems] : [];
    const hitPoints = [];

    series.forEach((line) => {
      const points = line.values.map((value, index) => ({
        value,
        index,
        category: categories[index],
        x: xForIndex(index),
        y: yForValue(value)
      }));

      hitPoints.push(...points);

      context.strokeStyle = line.color;
      context.lineWidth = 3;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.stroke();

      points.forEach((point) => {
        const isActive = activePointIndex === point.index;
        const radius = isActive ? 6 : 4.5;

        context.fillStyle = "#ffffff";
        context.strokeStyle = line.color;
        context.lineWidth = isActive ? 3 : 2.5;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();

        if (isActive) {
          context.fillStyle = line.color;
          context.globalAlpha = 0.16;
          context.beginPath();
          context.arc(point.x, point.y, 12, 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = 1;
        }
      });

      if (!options.legendItems) {
        const lastActiveIndex = Math.max(0, line.values.map((value, index) => value !== 0 ? index : -1).filter((index) => index >= 0).pop() ?? line.values.length - 1);
        legendItems.push({
          color: line.color,
          label: line.name,
          value: line.values[lastActiveIndex]
        });
      }
    });

    const legendX = pad.left + chartWidth + 18;
    const legendY = pad.top + 10;
    context.fillStyle = "rgba(255, 255, 255, 0.94)";
    context.fillRect(legendX - 10, legendY - 16, pad.right - 18, legendItems.length * 34 + 18);
    legendItems.forEach((item, index) => {
      const y = legendY + index * 34;
      context.fillStyle = item.color;
      context.beginPath();
      context.arc(legendX, y, 4, 0, Math.PI * 2);
      context.fill();
      context.font = "800 10px system-ui";
      context.textAlign = "left";
      context.fillText(item.label, legendX + 10, y - 4);
      context.font = "800 10px system-ui";
      context.fillText(`Total: ${money.format(item.value)}`, legendX + 10, y + 12);
    });

    categories.forEach((label, index) => {
      if (!options.showLabel(index, categories.length)) return;
      context.fillStyle = "#1c2520";
      context.font = "800 10px system-ui";
      context.textAlign = "center";
      context.fillText(label, xForIndex(index), pad.top + chartHeight + 24);
    });

    if (options.xAxisLabel) {
      context.fillStyle = "#627069";
      context.font = "700 9px system-ui";
      context.textAlign = "center";
      context.fillText(options.xAxisLabel, pad.left + chartWidth / 2, pad.top + chartHeight + 46);
    }

    if (options.yAxisLabel) {
      context.save();
      context.fillStyle = "#627069";
      context.font = "700 10px system-ui";
      context.textAlign = "center";
      context.translate(18, pad.top + chartHeight / 2);
      context.rotate(-Math.PI / 2);
      context.fillText(options.yAxisLabel, 0, 0);
      context.restore();
    }

    const { activePointIndex: _activePointIndex, ...storedOptions } = options;
    comparisonChartState.set(canvas, { categories, series, options: storedOptions, hitPoints });
  }

  const comparisonChartState = new WeakMap();

  function findComparisonPoint(canvas, clientX, clientY) {
    const state = comparisonChartState.get(canvas);
    if (!state?.hitPoints?.length) return null;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    for (const point of state.hitPoints) {
      if (Math.hypot(x - point.x, y - point.y) <= 12) return point.index;
    }

    return null;
  }

  function positionComparisonTooltip(canvas, activePointIndex) {
    const wrap = canvas.closest(".chart-canvas-wrap");
    const tooltip = wrap?.querySelector(".chart-tooltip");
    if (!wrap || !tooltip) return;

    if (activePointIndex === null || activePointIndex === undefined) {
      tooltip.hidden = true;
      return;
    }

    const state = comparisonChartState.get(canvas);
    const point = state?.hitPoints?.find((entry) => entry.index === activePointIndex);
    if (!point) {
      tooltip.hidden = true;
      return;
    }

    tooltip.textContent = money.format(point.value);
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.style.transform = "translate(-50%, -100%)";

    const margin = 10;
    const wrapWidth = wrap.clientWidth;
    const wrapHeight = wrap.clientHeight;
    let left = point.x;
    let top = point.y - margin;
    let transform = "translate(-50%, -100%)";

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;

    const tipWidth = tooltip.offsetWidth;
    const tipHeight = tooltip.offsetHeight;

    if (top - tipHeight < 4) {
      top = point.y + margin + 12;
      transform = "translate(-50%, 0)";
    }

    const halfWidth = tipWidth / 2;
    if (left - halfWidth < 4) {
      left = halfWidth + 4;
    } else if (left + halfWidth > wrapWidth - 4) {
      left = wrapWidth - halfWidth - 4;
    }

    if (top + tipHeight > wrapHeight - 4 && transform === "translate(-50%, 0)") {
      top = Math.max(4, wrapHeight - tipHeight - 4);
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.transform = transform;
  }

  function redrawComparisonLineChart(canvas) {
    const state = comparisonChartState.get(canvas);
    if (!state) return;

    const interaction = canvas._comparisonInteraction || { hoverIndex: null, pinnedIndex: null };
    const activePointIndex = interaction.pinnedIndex ?? interaction.hoverIndex;
    drawComparisonLineChart(canvas, state.categories, state.series, {
      ...state.options,
      activePointIndex
    });
    positionComparisonTooltip(canvas, activePointIndex);
  }

  function bindComparisonLineChart(canvas) {
    if (canvas._comparisonBound) return;
    canvas._comparisonBound = true;
    canvas._comparisonInteraction = { hoverIndex: null, pinnedIndex: null };

    canvas.addEventListener("mousemove", (event) => {
      const index = findComparisonPoint(canvas, event.clientX, event.clientY);
      const interaction = canvas._comparisonInteraction;

      if (interaction.pinnedIndex !== null) {
        canvas.style.cursor = index !== null ? "pointer" : "default";
        return;
      }

      if (interaction.hoverIndex !== index) {
        interaction.hoverIndex = index;
        redrawComparisonLineChart(canvas);
      }

      canvas.style.cursor = index !== null ? "pointer" : "default";
    });

    canvas.addEventListener("mouseleave", () => {
      const interaction = canvas._comparisonInteraction;
      if (interaction.pinnedIndex !== null) return;

      if (interaction.hoverIndex !== null) {
        interaction.hoverIndex = null;
        redrawComparisonLineChart(canvas);
      }

      canvas.style.cursor = "default";
    });

    canvas.addEventListener("click", (event) => {
      const index = findComparisonPoint(canvas, event.clientX, event.clientY);
      const interaction = canvas._comparisonInteraction;

      interaction.pinnedIndex = interaction.pinnedIndex === index ? null : index;
      if (interaction.pinnedIndex !== null) {
        interaction.hoverIndex = null;
      }

      redrawComparisonLineChart(canvas);
    });
  }

  function drawPlatformChart(canvas, list) {
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight || Number(canvas.getAttribute("height"));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const entries = Array.from(groupBy(list, "platform", "totalBeforeGst").entries())
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((acc, [, value]) => acc + value, 0);
    if (!entries.length || total <= 0) {
      context.fillStyle = "#627069";
      context.font = "600 14px system-ui";
      context.fillText("No platform revenue for these filters", 28, 52);
      return;
    }

    const topEntries = entries.slice(0, 5);
    const max = Math.max(...topEntries.map(([, value]) => value));
    const pad = { top: 34, right: 132, bottom: 32, left: 112 };
    const rowGap = 15;
    const rowHeight = Math.min(28, (height - pad.top - pad.bottom - rowGap * (topEntries.length - 1)) / topEntries.length);
    const chartWidth = Math.max(120, width - pad.left - pad.right);

    context.strokeStyle = "#dce4f1";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left, height - pad.bottom);
    context.lineTo(pad.left + chartWidth, height - pad.bottom);
    context.stroke();

    topEntries.forEach(([platform, value], index) => {
      const y = pad.top + index * (rowHeight + rowGap);
      const barWidth = Math.max(4, (value / max) * chartWidth);
      const percent = total ? (value / total) * 100 : 0;

      context.fillStyle = "#071638";
      context.font = "800 11px system-ui";
      context.textAlign = "right";
      context.fillText(platform, pad.left - 16, y + rowHeight * 0.72);

      context.fillStyle = "#1d4ed8";
      context.fillRect(pad.left, y, barWidth, rowHeight);

      context.fillStyle = "#334466";
      context.font = "700 10px system-ui";
      context.textAlign = "left";
      context.fillText(`${money.format(value)} (${percent.toFixed(1)}%)`, pad.left + barWidth + 10, y + rowHeight * 0.7);
    });
  }

  function renderOrganizationBars(list) {
    const entries = Array.from(groupBy(list, "organization", "totalBeforeGst").entries())
      .sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map((entry) => entry[1]));
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);

    if (!entries.length) {
      els.organizationBars.innerHTML = '<div class="empty">No organizations match the current filters.</div>';
      return;
    }

    els.organizationBars.innerHTML = entries.map(([organization, value]) => {
      const width = Math.max(3, (value / max) * 100);
      const contribution = total ? (value / total) * 100 : 0;
      return `
        <div class="org-row">
          <header>
            <span>${escapeHtml(organization)}</span>
            <span class="org-metrics">
              <span>${money.format(value)}</span>
              <span>${contribution.toFixed(1)}% contribution</span>
            </span>
          </header>
          <div class="track"><div class="fill" style="width: ${width}%"></div></div>
        </div>
      `;
    }).join("");
  }

  function renderTable(list) {
    if (!list.length) {
      els.transactionRows.innerHTML = '<tr><td colspan="7" class="empty">No matched transactions for these filters.</td></tr>';
      return;
    }

    els.transactionRows.innerHTML = list
      .slice()
      .sort((a, b) => b.date - a.date)
      .map((row) => `
        <tr>
          <td>${escapeHtml(row.dateLabel)}</td>
          <td>${escapeHtml(row.platform)}</td>
          <td>${escapeHtml(row.organization)}</td>
          <td>${money.format(row.subtotal)}</td>
          <td>${money.format(row.discount)}</td>
          <td>${money.format(row.tax)}</td>
          <td>${money.format(row.totalBeforeGst)}</td>
        </tr>
      `).join("");
  }

  function renderTopPartner(list) {
    const entries = Array.from(groupBy(list, "organization", "totalBeforeGst").entries())
      .sort((a, b) => b[1] - a[1]);
    const [name, value] = entries[0] || ["—", 0];
    const total = sum(list, "totalBeforeGst");
    els.topPartnerName.textContent = name;
    els.topPartnerRevenue.textContent = money.format(value);
    els.topPartnerContribution.textContent = total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
  }

  function renderProjection(list) {
    const currentMonth = selectedMonth();
    const monthRows = currentMonth ? comparisonRows().filter((row) => row.month === currentMonth) : list;
    const total = sum(monthRows, "totalBeforeGst");
    const days = new Set(monthRows.map((row) => row.day)).size || 1;
    const projected = (total / days) * 30;
    els.projectedRevenue.textContent = money.format(projected);
    els.projectedRevenueContext.textContent = currentMonth
      ? `${money.format(total)} / ${days} active day${days === 1 ? "" : "s"} x 30 days`
      : "Based on current filters";
  }

  function renderCpMeta() {
    const strip = els.cpMetaStrip;
    if (!strip) return;
    const dash = "—";
    if (state.organization === "all") {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    const meta = partnerMetaForOrganization(state.organization);
    els.cpMetaJoined.textContent = (meta && meta.joinedDate) || dash;
    els.cpMetaAgreementEnd.textContent = (meta && meta.agreementEndDate) || dash;
    els.cpMetaStatus.textContent = (meta && meta.status) || dash;
  }

  function render() {
    restoreBundledRowsIfEmpty();
    const list = filteredRows();
    const organizations = new Set(list.map((row) => row.organization));

    els.totalRevenue.textContent = money.format(sum(list, "totalBeforeGst"));
    els.averageAmount.textContent = money.format(list.length ? sum(list, "totalBeforeGst") / list.length : 0);
    els.transactionCount.textContent = String(list.length);
    els.organizationCount.textContent = String(organizations.size);

    const monthly = monthlyComparison();
    const yearly = yearlyComparison();
    const momPct = deltaPercent(monthly.deltaEntries);
    const yoyPct = deltaPercent(yearly.deltaEntries);
    els.momGrowth.textContent = momPct === null ? "—" : `${momPct.toFixed(1)}%`;
    els.yoyGrowth.textContent = yoyPct === null ? "—" : `${yoyPct.toFixed(1)}%`;
    els.momGrowthContext.textContent = monthly.hasPrevious ? "vs previous month" : "No prior month";
    els.yoyGrowthContext.textContent = yearly.hasPrevious ? "vs previous year" : "No prior year";
    setKpiTrend(els.momGrowth, momPct);
    setKpiTrend(els.yoyGrowth, yoyPct);

    els.momDelta.textContent = monthly.hasPrevious
      ? periodDeltaLabel(monthly.deltaEntries, (value) => money.format(value), formatMonth)
      : "No prior month data";
    setDeltaState(els.momDelta, monthly.deltaEntries, monthly.hasPrevious);
    els.yoyDelta.textContent = yearly.hasPrevious
      ? periodDeltaLabel(yearly.deltaEntries, (value) => money.format(value))
      : "No prior year data";
    setDeltaState(els.yoyDelta, yearly.deltaEntries, yearly.hasPrevious);

    els.monthlyChart._comparisonInteraction = { hoverIndex: null, pinnedIndex: null };
    drawComparisonLineChart(els.monthlyChart, monthly.categories || [], monthly.series || [], {
      showLabel: () => true,
      xAxisLabel: "Month",
      yAxisLabel: "Sales",
      legendItems: comparisonLegend(monthly.deltaEntries || [], formatMonth)
    });
    bindComparisonLineChart(els.monthlyChart);
    positionComparisonTooltip(els.monthlyChart, null);

    els.yearlyChart._comparisonInteraction = { hoverIndex: null, pinnedIndex: null };
    drawComparisonLineChart(els.yearlyChart, yearly.categories || [], yearly.series || [], {
      showLabel: () => true,
      xAxisLabel: "Year",
      yAxisLabel: "Sales",
      legendItems: comparisonLegend(yearly.deltaEntries || [], (year) => year)
    });
    bindComparisonLineChart(els.yearlyChart);
    positionComparisonTooltip(els.yearlyChart, null);
    drawPlatformChart(els.platformChart, list);
    renderTopPartner(list);
    renderOrganizationBars(list);
    renderTable(list);
    renderCpMeta();
  }

  els.monthFilter.addEventListener("change", (event) => {
    state.month = event.target.value;
    render();
  });

  els.yearFilter.addEventListener("change", (event) => {
    state.year = event.target.value;
    render();
  });

  els.organizationFilter.addEventListener("change", (event) => {
    state.organization = event.target.value;
    render();
  });

  els.platformFilter.addEventListener("change", (event) => {
    state.platform = event.target.value;
    render();
  });

  els.resetFilters.addEventListener("click", () => {
    state.month = "all";
    state.year = "all";
    state.organization = "all";
    state.platform = "all";
    els.monthFilter.value = "all";
    els.yearFilter.value = "all";
    els.organizationFilter.value = "all";
    els.platformFilter.value = "all";
    render();
  });

  function setUploadStatus(message, type) {
    if (els.uploadPanel?.hidden || !els.uploadPanel?.classList.contains("can-upload")) return;
    els.uploadStatus.textContent = message;
    els.uploadStatus.classList.remove("is-error", "is-success");
    if (type) els.uploadStatus.classList.add(type);
  }

  function setDataLoadStatus(message, type = "") {
    if (!els.dataLoadStatus || !els.dataLoadStatusText) return;
    els.dataLoadStatus.hidden = !message;
    els.dataLoadStatusText.textContent = message || "";
    els.dataLoadStatus.classList.remove("is-error", "is-success");
    if (type) els.dataLoadStatus.classList.add(type);
  }

  function setUploadBusy(isBusy) {
    if (els.uploadXeroButton) els.uploadXeroButton.disabled = isBusy;
    if (els.uploadStripeButton) els.uploadStripeButton.disabled = isBusy;
  }

  async function configureUploadAccess() {
    if (!els.uploadPanel) return false;
    els.uploadPanel.hidden = true;
    els.uploadPanel.classList.remove("can-upload");

    try {
      const client = window.DashboardAuth?.getClient?.();
      if (!client) return false;
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return false;
      const email = String(data.user.email || "").trim().toLowerCase();
      const domain = email.includes("@") ? email.split("@").pop() : "";
      const canUpload = domain === "gametize.com";
      els.uploadPanel.hidden = !canUpload;
      els.uploadPanel.classList.toggle("can-upload", canUpload);
      return canUpload;
    } catch {
      els.uploadPanel.hidden = true;
      els.uploadPanel.classList.remove("can-upload");
      return false;
    }
  }

  async function uploadDataFile(file, endpoint) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name
      },
      body: file
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error || `Upload failed (${response.status})`);
    }

    return payload;
  }

  async function handleDataUpload({ file, endpoint, invalidMessage }) {
    setUploadBusy(true);
    setUploadStatus(`Uploading ${file.name}…`);

    try {
      const result = await uploadDataFile(file, endpoint);
      setUploadStatus("Data updated. Reloading dashboard…", "is-success");
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
      if (result?.matchedRows != null) {
        console.info("Dashboard rebuild:", result);
      }
    } catch (error) {
      setUploadStatus(error.message || "Upload failed.", "is-error");
      setUploadBusy(false);
    }
  }

  async function handleStripeSupabaseUpload(file) {
    if (!window.DashboardAuth?.uploadStripeInvoices) {
      await handleDataUpload({ file, endpoint: "/api/upload-stripe" });
      return;
    }

    setUploadBusy(true);
    setUploadStatus(`Uploading ${file.name} to Supabase...`);

    try {
      const cpPayload = await loadCpContactsPayload();
      const result = await window.DashboardAuth.uploadStripeInvoices(file, cpPayload.rows || []);
      setUploadStatus(
        `Stored ${result.insertedRows || 0} Stripe rows in Supabase from ${file.name}. Removed ${result.removedRows || 0} rows.`,
        "is-success"
      );
    } catch (error) {
      setUploadStatus(error.message || "Stripe upload to Supabase failed.", "is-error");
    } finally {
      setUploadBusy(false);
    }
  }

  if (els.uploadXeroButton && els.xeroFileInput) {
    els.uploadXeroButton.addEventListener("click", () => {
      els.xeroFileInput.click();
    });
  }

  els.uploadStripeButton.addEventListener("click", () => {
    els.stripeFileInput.click();
  });

  if (els.xeroFileInput) {
    els.xeroFileInput.addEventListener("change", async () => {
      const file = els.xeroFileInput.files?.[0];
      els.xeroFileInput.value = "";
      if (!file) return;

      if (!/\.xlsx$/i.test(file.name)) {
        setUploadStatus("Please choose an .xlsx file.", "is-error");
        return;
      }

      await handleDataUpload({ file, endpoint: "/api/upload-xero" });
    });
  }

  els.stripeFileInput.addEventListener("change", async () => {
    const file = els.stripeFileInput.files?.[0];
    els.stripeFileInput.value = "";
    if (!file) return;

    if (!/\.csv$/i.test(file.name)) {
      setUploadStatus("Please choose a .csv file.", "is-error");
      return;
    }

    await handleStripeSupabaseUpload(file);
  });

  window.addEventListener("resize", render);

  configureUploadAccess();
  populateFilters();
  render();
  hydrateCpContactsFromSupabase();
  hydrateXeroRowsFromSupabase();
}());
