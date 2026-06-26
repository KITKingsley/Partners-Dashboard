(function () {
  const emptyData = () => ({
    totalAllocated: 0,
    remainingBalance: 0,
    transactions: [],
    partnerBalanceRows: [],
    partnerHealth: [],
    projectReportRows: [],
    adminLogReportRows: []
  });

  const state = {
    search: "",
    month: "all",
    partner: "all",
    page: 1,
    pageSize: 6,
    filtersReady: false,
    loading: false,
    projectLoading: false,
    loadError: "",
    projectReportError: "",
    projectUploadCount: 0,
    adminLogUploadCount: 0,
    uploadHistory: [],
    healthMonthGroups: [],
    showAllHealthMonths: false,
    healthMonthStatusesReady: false,
    partnerDetailLoaded: false,
    data: emptyData()
  };

  let healthMonthStatusCache = null;
  const partnerScopeCache = new Map();
  let partnerScopeLoadPromise = null;
  let allPartnersLogRows = null;

  const els = {
    totalAllocated: document.querySelector("#creditsTotalAllocated"),
    remainingBalance: document.querySelector("#creditsRemainingBalance"),
    balanceBar: document.querySelector("#creditsBalanceBar"),
    searchInput: document.querySelector("#creditsSearch"),
    monthFilter: document.querySelector("#creditsMonthFilter"),
    partnerFilter: document.querySelector("#creditsPartnerFilter"),
    historyTableBody: document.querySelector("#creditsHistoryRows"),
    lastGametizeAdjustment: document.querySelector("#creditsLastGametizeAdjustment"),
    paginationSummary: document.querySelector("#creditsPaginationSummary"),
    paginationControls: document.querySelector("#creditsPaginationControls"),
    healthList: document.querySelector("#creditsHealthList"),
    healthHeadingTotals: document.querySelector("#creditsHealthHeadingTotals"),
    partnerOverviewBody: document.querySelector("#creditsPartnerOverviewRows"),
    partnerOverviewFoot: document.querySelector("#creditsPartnerOverviewFoot"),
    partnerOverviewPanel: document.querySelector(".credits-overview-panel"),
    creditLogsInput: document.querySelector("#creditLogsFileInput"),
    uploadCreditLogsButton: document.querySelector("#uploadCreditLogsButton"),
    uploadReportButton: document.querySelector("#uploadCreditsReportButton"),
    uploadStatus: document.querySelector("#creditsUploadStatus"),
    uploadHistory: document.querySelector("#creditsUploadHistory"),
    uploadModal: document.querySelector("#creditUploadModal"),
    uploadPartnerSelect: document.querySelector("#creditUploadPartnerSelect"),
    uploadCancelButton: document.querySelector("#creditUploadCancelButton"),
    uploadContinueButton: document.querySelector("#creditUploadContinueButton"),
    reportUploadModal: document.querySelector("#creditReportUploadModal"),
    reportUploadPartnerSelect: document.querySelector("#creditReportUploadPartnerSelect"),
    reportTypeSelect: document.querySelector("#creditReportTypeSelect"),
    reportUploadMonthField: document.querySelector("#creditReportMonthField"),
    reportUploadMonthOptionsWrap: document.querySelector("#creditReportMonthOptionsWrap"),
    reportUploadMonthSelectAll: document.querySelector("#creditReportMonthSelectAll"),
    reportUploadMonthOptions: document.querySelector("#creditReportUploadMonthOptions"),
    reportUploadCancelButton: document.querySelector("#creditReportUploadCancelButton"),
    reportUploadContinueButton: document.querySelector("#creditReportUploadContinueButton"),
    reportFileInput: document.querySelector("#creditReportFileInput")
  };

  let selectedUploadPartner = "";
  let selectedReportUpload = null;
  let creditsHydrated = false;
  let creditsHydratePromise = null;

  const numberFmt = new Intl.NumberFormat("en-US");
  const creditMoneyFmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

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

  function pick(row, names, fallback = "") {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
        return row[name];
      }
    }
    return fallback;
  }

  function parseDate(value) {
    return window.DashboardDateFormat?.parseFlexibleDate(value) ?? null;
  }

  function formatShortDate(value) {
    const date = parseProjectDate(value) || parseDate(value);
    if (!date) return "—";
    return window.DashboardDateFormat?.formatDisplayDate(date) || "—";
  }

  function formatMonthLabel(value) {
    const date = parseDate(value);
    return date ? monthFmt.format(date) : "—";
  }

  function formatAmount(amount) {
    const value = toNumber(amount);
    if (!value) return "—";
    const prefix = value < 0 ? "-" : "";
    return `${prefix}US$${creditMoneyFmt.format(Math.abs(value))}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeLogRow(row) {
    const transactionDate = pick(row, ["transaction_date", "transactionDate", "date", "Date"]);
    const description = String(pick(row, ["description", "Description"], "")).trim();
    const amount = toNumber(pick(row, ["amount", "Amount"], 0));
    const actions = String(pick(row, ["actions", "action_label", "actionLabel", "Actions"], "")).trim();
    const cpPartner = String(pick(row, ["cp_partner", "cpPartner", "partner", "Partner"], "Unknown")).trim();

    return {
      date: formatShortDate(transactionDate),
      dateSort: parseDate(transactionDate)?.getTime() || 0,
      month: formatMonthLabel(transactionDate),
      description: description || "—",
      amount,
      amountDisplay: formatAmount(amount),
      actions: actions || "—",
      cpPartner,
      partner: cpPartner
    };
  }

  function healthTone(remainingPct) {
    if (remainingPct <= 15) return "critical";
    if (remainingPct <= 35) return "warning";
    return "healthy";
  }

  function projectRowData(row) {
    return row?.row_data || row?.rowData || row || {};
  }

  const PROJECT_FIELD_ALIASES = {
    evaluationMonth: [
      "Evaluation Month",
      "Month",
      "Active Evaluation Month",
      "Evaluation Period",
      "Report Month",
      "Eval Month"
    ],
    title: ["Title", "Project Title", "Project", "project", "Project Name"],
    creationDate: [
      "Project Creation",
      "Project Creation Date",
      "Creation Date",
      "Created Date",
      "Project Created",
      "Create Date",
      "Date Created"
    ],
    firstCompletionDate: ["First Completion Date", "First Completion", "First Completed Date"],
    lastCompletionDate: [
      "Last Completion Date",
      "Last Completion",
      "Latest Completion Date",
      "Last Completed",
      "Last Completed Date"
    ],
    players: ["Players", "players", "Player Count", "Total Players"],
    projectId: ["Project ID", "Project Id", "project_id", "ProjectID", "ID"],
    email: [
      "Contact Email",
      "Owner Email",
      "Project Owner Email",
      "Project Contact Email",
      "Email Address",
      "Email"
    ]
  };

  const PROJECT_OUTPUT_COLUMNS = [
    "CP Name",
    "Evaluation Month",
    "Title",
    "Project Creation Date",
    "First Completion Date",
    "Players",
    "Removed Players",
    "Players Including Removed",
    "To Debit",
    "Waived",
    "Final Debited (US$)",
    "First Completion from Previous Months but Still Less Than 30 Days"
  ];

  const WAIVED_STORAGE_KEY = "dashboard-credit-health-waived";
  const HEALTH_MONTH_STATUS_KEY = "dashboard-credit-health-month-status";
  const HEALTH_DEBIT_MONTH_LIMIT = 24;
  const REPORT_UPLOAD_EARLIEST_MONTH = Date.UTC(2025, 0, 1);
  const MONTHLY_DEBIT_SHEET_PATTERN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i;
  const PARTNER_EVALUATION_START_MONTHS = {
    "right impact": "Apr 2025"
  };

  const ADMIN_LOG_FIELD_ALIASES = {
    timestamp: ["Timestamp", "Date", "Time", "Date Time", "Datetime", "Logged At", "Created At", "Log Date"],
    description: ["Description", "Action", "Details", "Log", "Event", "Activity", "Admin Action"],
    projectId: ["Project ID", "Project Id", "project_id", "ProjectID", "ID"],
    removedCount: ["No. of Players removed", "Players removed", "Removed Players Count", "Deleted Players"]
  };

  function normalizeFieldKey(key) {
    return String(key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  const PARTNER_IDENTITY_GROUPS = [
    {
      label: "DO IT/PMK",
      aliases: [
        "doit",
        "do it",
        "do it/pmk",
        "doit.mx",
        "Doit",
        "DOIT",
        "DO IT",
        "DO IT/PMK",
        "PMK Psicomarketing",
        "Psicomarketing"
      ]
    },
    {
      label: "Finalix",
      aliases: ["finalix", "Finalix"]
    },
    {
      label: "InPsyful Learning & Solutions/Talent Intelligence",
      aliases: [
        "InPsyful Learning & Solutions/ Talent Intelligence",
        "InPsyful Learning & Solutions/Talent Intelligence",
        "InPsyful Learning & Solutions",
        "Inpsyful Learning and Solutions",
        "Talent Intelligence"
      ]
    }
  ];

  function normalizePartnerName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function partnerIdentityGroup(value) {
    const normalized = normalizePartnerName(value);
    if (!normalized) return "";

    const group = PARTNER_IDENTITY_GROUPS.find((item) =>
      normalizePartnerName(item.label) === normalized
      || item.aliases.some((alias) => normalizePartnerName(alias) === normalized)
    );

    return group ? normalizePartnerName(group.label) : normalized;
  }

  function partnerDisplayLabel(value) {
    const normalized = normalizePartnerName(value);
    if (!normalized) return "";

    const group = PARTNER_IDENTITY_GROUPS.find((item) =>
      normalizePartnerName(item.label) === normalized
      || item.aliases.some((alias) => normalizePartnerName(alias) === normalized)
    );

    return group ? group.label : String(value || "").trim();
  }

  function partnersMatch(left, right) {
    return partnerIdentityGroup(left) === partnerIdentityGroup(right);
  }

  function partnerScopeCacheKey(partner) {
    const key = partnerIdentityGroup(partner) || normalizePartnerName(partner);
    return key || String(partner || "").trim();
  }

  function getPartnerDbKeys(partner) {
    const normalized = normalizePartnerName(partner);
    if (!normalized) return [];

    const group = PARTNER_IDENTITY_GROUPS.find((item) =>
      normalizePartnerName(item.label) === normalized
      || item.aliases.some((alias) => normalizePartnerName(alias) === normalized)
    );

    if (group) {
      return [...new Set([group.label, ...group.aliases].map((value) => String(value || "").trim()).filter(Boolean))];
    }

    return [String(partner || "").trim()].filter(Boolean);
  }

  function clearPartnerScopedData() {
    const balanceRows = state.data.partnerBalanceRows || [];
    state.data = buildCreditsData(allPartnersLogRows || [], balanceRows, [], []);
    state.projectUploadCount = 0;
    state.adminLogUploadCount = 0;
    state.projectReportError = "";
    state.partnerDetailLoaded = false;
  }

  function invalidatePartnerScopeCache(partner) {
    if (partner) {
      partnerScopeCache.delete(partnerScopeCacheKey(partner));
      return;
    }
    partnerScopeCache.clear();
  }

  async function loadPartnerScopedData(partner, options = {}) {
    const partnerLabel = partnerDisplayLabel(partner) || String(partner || "").trim();
    if (!partnerLabel) return;

    const cacheKey = partnerScopeCacheKey(partnerLabel);
    if (!options.force && partnerScopeCache.has(cacheKey)) {
      const cached = partnerScopeCache.get(cacheKey);
      state.data = buildCreditsData(
        cached.logRows,
        state.data.partnerBalanceRows || [],
        cached.projectRows,
        cached.adminLogRows
      );
      state.projectUploadCount = cached.projectUploadCount;
      state.adminLogUploadCount = cached.adminLogUploadCount;
      state.projectReportError = cached.projectReportError || "";
      state.partnerDetailLoaded = true;
      render();
      return;
    }

    if (partnerScopeLoadPromise && !options.force) {
      return partnerScopeLoadPromise;
    }

    partnerScopeLoadPromise = loadPartnerScopedDataInternal(partnerLabel, cacheKey, options);
    try {
      await partnerScopeLoadPromise;
    } finally {
      partnerScopeLoadPromise = null;
    }
  }

  async function loadPartnerScopedDataInternal(partnerLabel, cacheKey, options = {}) {
    const partnerKeys = getPartnerDbKeys(partnerLabel);
    state.projectLoading = true;
    state.projectReportError = "";
    state.projectUploadCount = 0;
    state.adminLogUploadCount = 0;
    render();

    let logRows = [];
    let projectRows = [];
    let adminLogRows = [];
    let projectReportError = "";

    try {
      const requests = [];

      if (window.DashboardAuth?.getCreditUsageLogs) {
        requests.push(
          window.DashboardAuth.getCreditUsageLogs({ partnerKeys })
            .then((payload) => { logRows = payload.rows || []; })
            .catch((error) => { throw error; })
        );
      }

      if (window.DashboardAuth.getLatestProjectReportRows) {
        requests.push(
          window.DashboardAuth.getLatestProjectReportRows({ partnerKeys })
            .then((projectPayload) => {
              projectRows = projectPayload.rows || [];
              state.projectUploadCount = projectPayload.uploads?.length || 0;
              if (state.projectUploadCount && !projectRows.length) {
                projectReportError = "Project report uploads were found but no Excel rows could be loaded. Re-upload the Project report.";
              }
            })
            .catch((projectError) => {
              projectReportError = projectError.message || "Could not load project statistics rows.";
              console.warn("Could not load project statistics rows:", projectError);
            })
        );
      } else {
        projectReportError = "Project report loading is unavailable. Hard-refresh the page (Ctrl+Shift+R).";
      }

      if (window.DashboardAuth.getLatestAdminLogReportRows) {
        requests.push(
          window.DashboardAuth.getLatestAdminLogReportRows({ partnerKeys })
            .then((adminPayload) => {
              adminLogRows = adminPayload.rows || [];
              state.adminLogUploadCount = adminPayload.uploads?.length || 0;
            })
            .catch((adminLogError) => {
              console.warn("Could not load admin log rows:", adminLogError);
            })
        );
      }

      await Promise.all(requests);

      state.projectReportError = projectReportError;
      state.data = buildCreditsData(
        logRows,
        state.data.partnerBalanceRows || [],
        projectRows,
        adminLogRows
      );
      state.partnerDetailLoaded = true;

      partnerScopeCache.set(cacheKey, {
        logRows,
        projectRows,
        adminLogRows,
        projectUploadCount: state.projectUploadCount,
        adminLogUploadCount: state.adminLogUploadCount,
        projectReportError
      });
    } catch (error) {
      state.projectReportError = error.message || "Could not load partner credit usage data.";
      console.warn("Could not load partner credit usage data:", error);
    } finally {
      state.projectLoading = false;
      render();
    }
  }

  async function applyPartnerFilter(partner) {
    state.partner = partner;
    state.showAllHealthMonths = false;
    state.page = 1;
    if (els.partnerFilter) els.partnerFilter.value = partner;

    if (partner === "all") {
      clearPartnerScopedData();
      if (!allPartnersLogRows?.length && window.DashboardAuth?.getCreditUsageLogs) {
        await loadPartnerOverviewData();
      }
      render();
      return;
    }

    await loadPartnerScopedData(partner);
  }

  function partnerEvaluationStartMonth(cpName) {
    const groupKey = partnerIdentityGroup(cpName);
    return PARTNER_EVALUATION_START_MONTHS[groupKey] || null;
  }

  function applyPartnerEvaluationStartFilter(months, cpName) {
    const startMonth = partnerEvaluationStartMonth(cpName);
    if (!startMonth) return months;

    return months.filter((monthValue) => {
      const label = evaluationMonthRange(monthValue)?.label || monthValue;
      return compareEvaluationMonthLabels(label, startMonth) >= 0;
    });
  }

  function projectField(record, field) {
    const aliases = (PROJECT_FIELD_ALIASES[field] || []).map(normalizeFieldKey);
    const entries = Object.entries(record || {});

    for (const [key, value] of entries) {
      if (value === null || value === undefined || String(value).trim() === "") continue;
      if (aliases.includes(normalizeFieldKey(key))) return value;
    }

    if (field === "creationDate") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if (normalized.includes("creation") && normalized.includes("date") && String(value).trim()) {
          return value;
        }
      }
    }

    if (field === "lastCompletionDate") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if (normalized.includes("last") && normalized.includes("completion") && String(value).trim()) {
          return value;
        }
      }
    }

    if (field === "firstCompletionDate") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if (normalized.includes("first") && normalized.includes("completion") && String(value).trim()) {
          return value;
        }
      }
    }

    if (field === "evaluationMonth") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if ((normalized.includes("evaluation") || normalized.includes("report")) && normalized.includes("month")) {
          return value;
        }
      }
    }

    if (field === "email") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if (!normalized.includes("email")) continue;
        const text = String(value).trim();
        if (text.includes("@")) return text;
      }
    }

    return "";
  }

  function projectCreationMillis(record) {
    const direct = projectDateMillis(projectField(record, "creationDate"));
    if (direct !== null) return direct;

    for (const [key, value] of Object.entries(record || {})) {
      const normalized = normalizeFieldKey(key);
      if (!(normalized.includes("creation") || normalized === "created" || normalized === "createdon")) continue;
      const ms = projectDateMillis(value);
      if (ms !== null) return ms;
    }

    return null;
  }

  function projectLastCompletionMillis(record) {
    const direct = projectDateMillis(projectField(record, "lastCompletionDate"));
    if (direct !== null) return direct;

    for (const [key, value] of Object.entries(record || {})) {
      const normalized = normalizeFieldKey(key);
      if (!(normalized.includes("last") && normalized.includes("completion"))) continue;
      const ms = projectDateMillis(value);
      if (ms !== null) return ms;
    }

    return null;
  }

  function parseProjectDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }

    const text = String(value ?? "").trim();
    if (!text) return null;

    const serial = Number(text);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000 && !text.includes("/") && !text.includes("-")) {
      const utcDays = Math.floor(serial - 25569);
      const parsedSerial = new Date(utcDays * 86400 * 1000);
      if (!Number.isNaN(parsedSerial.getTime())) {
        return new Date(Date.UTC(
          parsedSerial.getUTCFullYear(),
          parsedSerial.getUTCMonth(),
          parsedSerial.getUTCDate()
        ));
      }
    }

    const parsed = parseDate(text);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  function projectDateMillis(value) {
    const parsed = parseProjectDate(value);
    return parsed ? parsed.getTime() : null;
  }

  function addEvaluationMonthCandidate(months, value, options = {}) {
    const parsed = parseEvaluationMonth(value, options);
    if (!parsed) return;
    months.add(monthFmt.format(parsed));
  }

  function isEvaluationMonthFieldKey(key) {
    const normalized = normalizeFieldKey(key);
    return normalized === "month"
      || normalized === "evalmonth"
      || ((normalized.includes("evaluation") || normalized.includes("report")) && normalized.includes("month"));
  }

  function scanEvaluationMonthsFromReport(partnerRows) {
    const months = new Set();

    partnerRows
      .filter((row) => row.row_index <= 20)
      .forEach((row) => {
        Object.entries(projectRowData(row)).forEach(([key, value]) => {
          if (!isEvaluationMonthFieldKey(key)) return;
          const text = String(value || "").trim();
          if (!text) return;
          addEvaluationMonthCandidate(months, text, { allowDateFallback: true });
        });
      });

    return [...months];
  }

  function isExcludedProjectTitle(title) {
    const text = String(title || "").toLowerCase();
    return text.includes("demo")
      || text.includes("internal")
      || text.includes("[gametize test]");
  }

  function isMonthlyDebitSheetName(value) {
    return MONTHLY_DEBIT_SHEET_PATTERN.test(String(value || "").trim());
  }

  function collectMonthlyDebitSheetMonthLabels(partnerRows) {
    const months = new Set();

    partnerRows.forEach((row) => {
      const sheetName = String(row.sheet_name || "").trim();
      if (isMonthlyDebitSheetName(sheetName)) {
        addEvaluationMonthCandidate(months, sheetName);
      }
    });

    return [...months].sort(compareEvaluationMonthLabels);
  }

  function normalizeEvaluationMonthLabel(monthValue) {
    return evaluationMonthRange(monthValue)?.label || formatEvaluationMonthLabel(monthValue);
  }

  function expandEvaluationMonthSpan(months) {
    const labels = [...new Set(
      months.map((month) => normalizeEvaluationMonthLabel(month)).filter(Boolean)
    )].sort(compareEvaluationMonthLabels);

    if (!labels.length) return labels;

    const firstRange = evaluationMonthRange(labels[0]);
    const lastRange = evaluationMonthRange(labels[labels.length - 1]);
    if (!firstRange || !lastRange) return labels;

    const filled = new Set(labels);
    const cursor = new Date(firstRange.start);
    const end = new Date(lastRange.start);

    while (cursor.getTime() <= end.getTime()) {
      filled.add(monthFmt.format(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return [...filled].sort(compareEvaluationMonthLabels);
  }

  function capPartnerEvaluationMonths(months, partnerRows, cpName, monthFilter = "all") {
    let result = applyPartnerEvaluationStartFilter(months, cpName);

    const latestActivityMonth = latestProjectActivityMonthLabel(partnerRows);
    if (latestActivityMonth) {
      result = result.filter((monthValue) => (
        compareEvaluationMonthLabels(monthValue, latestActivityMonth) <= 0
      ));
    }

    if (monthFilter !== "all") {
      result = result.filter((monthValue) => normalizeEvaluationMonthLabel(monthValue) === monthFilter);
    }

    if (result.length > HEALTH_DEBIT_MONTH_LIMIT) {
      result = result.slice(-HEALTH_DEBIT_MONTH_LIMIT);
    }

    return result;
  }

  function fieldHintMatches(normalized, hint) {
    if (!normalized || !hint) return false;
    if (normalized === hint) return true;
    if (normalized.includes(hint)) return true;
    // Avoid matching short field names like "players" against longer hints.
    if (hint.includes(normalized) && normalized.length >= 8) return true;
    return false;
  }

  function recordFieldByHints(record, hints) {
    const wanted = hints.map((hint) => normalizeFieldKey(hint));
    for (const [key, value] of Object.entries(record || {})) {
      if (value === null || value === undefined || String(value).trim() === "") continue;
      const normalized = normalizeFieldKey(key);
      if (wanted.some((hint) => fieldHintMatches(normalized, hint))) {
        return value;
      }
    }
    return "";
  }

  function recordNumericByHints(record, hints) {
    const value = recordFieldByHints(record, hints);
    if (value === "" || value === null || value === undefined) return null;
    return toNumber(value);
  }

  function isDemoInternalRecord(record) {
    const demoValue = String(recordFieldByHints(record, ["demointernal", "demo", "internal"]) || "").toLowerCase();
    if (demoValue === "yes") return true;
    const title = String(projectField(record, "title") || recordFieldByHints(record, ["title"])).trim();
    return isExcludedProjectTitle(title);
  }

  function isGametizeProjectEmail(email) {
    return String(email || "").toLowerCase().includes("@gametize");
  }

  function projectContactEmail(record) {
    return projectField(record, "email");
  }

  function parseEvaluationMonth(value, options = {}) {
    const allowDateFallback = options.allowDateFallback === true;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
    }

    const text = String(value ?? "").trim();
    if (!text || /^sheet\d*$/i.test(text)) return null;

    const namedMonth = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (namedMonth) {
      const parsed = new Date(`${namedMonth[2]} ${namedMonth[1]} 1 00:00:00 UTC`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const yearMonth = text.match(/^(\d{4})-(\d{2})$/);
    if (yearMonth) {
      return new Date(Date.UTC(Number(yearMonth[1]), Number(yearMonth[2]) - 1, 1));
    }

    const slashMonth = text.match(/^(\d{1,2})\/(\d{4})$/);
    if (slashMonth) {
      return new Date(Date.UTC(Number(slashMonth[2]), Number(slashMonth[1]) - 1, 1));
    }

    if (!allowDateFallback) return null;

    const parsed = parseProjectDate(value) || parseDate(text);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  }

  function formatEvaluationMonthLabel(value) {
    const parsed = parseEvaluationMonth(value, { allowDateFallback: true });
    return parsed ? monthFmt.format(parsed) : String(value || "").trim();
  }

  function evaluationMonthRange(value) {
    const parsed = parseEvaluationMonth(value, { allowDateFallback: true });
    if (!parsed) return null;

    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth();

    return {
      label: monthFmt.format(parsed),
      start: Date.UTC(year, month, 1),
      end: Date.UTC(year, month + 1, 0, 23, 59, 59, 999)
    };
  }

  function evaluationMonthsMatch(left, right) {
    const leftRange = evaluationMonthRange(left);
    const rightRange = evaluationMonthRange(right);
    if (leftRange && rightRange) return leftRange.start === rightRange.start;
    return formatEvaluationMonthLabel(left) === formatEvaluationMonthLabel(right);
  }

  function compareEvaluationMonthLabels(left, right) {
    const leftRange = evaluationMonthRange(left);
    const rightRange = evaluationMonthRange(right);
    return (leftRange?.start || 0) - (rightRange?.start || 0);
  }

  function inferEvaluationMonthFromDates(dataRows) {
    let latest = null;

    dataRows.forEach((row) => {
      const record = projectRowData(row);
      [
        projectField(record, "lastCompletionDate"),
        projectField(record, "firstCompletionDate"),
        projectField(record, "creationDate")
      ].forEach((value) => {
        const date = parseProjectDate(value);
        if (date && (!latest || date.getTime() > latest.getTime())) {
          latest = date;
        }
      });
    });

    return latest ? monthFmt.format(latest) : "";
  }

  function projectActivityStartMs(record) {
    return projectCreationMillis(record)
      ?? projectDateMillis(projectField(record, "firstCompletionDate"));
  }

  function projectHasActivityDates(record) {
    return projectActivityStartMs(record) !== null
      || projectLastCompletionMillis(record) !== null;
  }

  function partnerTransactionMonths(transactions, cpName) {
    return [...new Set(
      (transactions || [])
        .filter((row) => partnersMatch(row.cpPartner, cpName) && row.month)
        .map((row) => row.month)
    )].sort(compareEvaluationMonthLabels);
  }

  function expandEvaluationMonthRangeFromProjects(dataRows) {
    let earliest = null;
    let latest = null;

    getPartnerProjectDataRows(dataRows).forEach((row) => {
      const record = projectRowData(row);
      [
        projectActivityStartMs(record),
        projectLastCompletionMillis(record),
        projectDateMillis(projectField(record, "firstCompletionDate"))
      ].forEach((ms) => {
        if (ms === null) return;
        if (earliest === null || ms < earliest) earliest = ms;
        if (latest === null || ms > latest) latest = ms;
      });
    });

    if (earliest === null && latest === null) return [];

    const start = new Date(earliest ?? latest);
    const end = new Date(latest ?? earliest);
    const months = new Set();
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

    while (cursor.getTime() <= endMonth.getTime()) {
      months.add(monthFmt.format(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return [...months].sort(compareEvaluationMonthLabels);
  }

  function findProjectHeaderRowIndex(partnerRows) {
    const sortedRows = [...partnerRows].sort((a, b) => a.row_index - b.row_index);

    for (const row of sortedRows.slice(0, 12)) {
      const data = projectRowData(row);
      const values = Object.values(data).map((value) => String(value || "").trim().toLowerCase());
      const keys = Object.keys(data).map((key) => normalizeFieldKey(key));

      if (values.includes("title") && values.some((value) => value.includes("creation"))) {
        return row.row_index;
      }
      if (keys.includes("title") && keys.some((key) => key.includes("creation") && key.includes("date"))) {
        return row.row_index;
      }
    }

    return 1;
  }

  function rowValuesInOrder(record) {
    return Object.values(record || {});
  }

  function projectRowsLookWellFormed(partnerRows) {
    return getPartnerProjectDataRows(partnerRows, { skipRepair: true }).some((row) => {
      const record = projectRowData(row);
      const title = String(projectField(record, "title")).trim();
      return title && title !== "Title" && !parseEvaluationMonth(title);
    });
  }

  function repairPartnerProjectRows(partnerRows) {
    const sorted = [...partnerRows].sort((a, b) => a.row_index - b.row_index);
    if (projectRowsLookWellFormed(sorted)) return sorted;

    let headerRowIndex = -1;
    let headerNames = [];

    for (const row of sorted.slice(0, 20)) {
      const values = rowValuesInOrder(projectRowData(row)).map((value) => String(value || "").trim());
      const normalized = values.map((value) => value.toLowerCase());

      if (normalized.includes("title") && normalized.some((value) => value.includes("creation"))) {
        headerRowIndex = row.row_index;
        headerNames = values;
        break;
      }
    }

    if (headerRowIndex === -1 || !headerNames.length) return sorted;

    return sorted.map((row) => {
      if (row.row_index <= headerRowIndex) return row;

      const values = rowValuesInOrder(projectRowData(row));
      const record = {};
      headerNames.forEach((name, index) => {
        const key = String(name || "").trim();
        if (!key) return;
        record[key] = values[index] ?? "";
      });

      return { ...row, row_data: record };
    });
  }

  function getPartnerProjectDataRows(partnerRows, options = {}) {
    const rows = options.skipRepair ? partnerRows : repairPartnerProjectRows(partnerRows);
    const headerRowIndex = findProjectHeaderRowIndex(rows);
    return rows.filter((row) => row.row_index > headerRowIndex);
  }

  function buildPartnerHealthDiagnostics(projectRows, partnerFilter = "all", monthFilter = "all") {
    const byPartner = projectRowsByPartner(projectRows, "all");
    const partners = partnerFilter === "all"
      ? [...byPartner.keys()]
      : [...byPartner.keys()].filter((cp) => partnersMatch(cp, partnerFilter));

    if (!partners.length) {
      const uploadedPartners = [...new Set(projectRows.map((row) => String(row.cp || "").trim()).filter(Boolean))];
      return uploadedPartners.length
        ? `No uploaded project rows match partner filter "${partnerFilter}". Uploaded for: ${uploadedPartners.join(", ")}.`
        : "No project report rows were loaded from Supabase.";
    }

    const notes = [];

    partners.forEach((cp) => {
      const rows = byPartner.get(cp) || [];
      const dataRows = getPartnerProjectDataRows(rows);
      const months = collectEvaluationMonthsFromPartnerRows(rows);
      let included = 0;

      months.forEach((monthValue) => {
        included += filteredProjectRecordsForMonth(rows, monthValue, monthFilter).length;
      });

      notes.push(
        `${cp}: ${rows.length} stored row(s), ${dataRows.length} data row(s), ${months.length} evaluation month(s), ${included} included after filters`
      );

      if (!included && dataRows.length) {
        const blockerNote = summarizePartnerHealthFilterBlockers(rows, monthFilter);
        if (blockerNote) notes.push(blockerNote);
      }
    });

    return notes.join(" · ");
  }

  function summarizePartnerHealthFilterBlockers(partnerRows, monthFilter = "all") {
    const dataRows = getPartnerProjectDataRows(partnerRows);
    const months = collectEvaluationMonthsFromPartnerRows(partnerRows);
    if (!dataRows.length || !months.length) return "";

    const targetMonth = monthFilter !== "all"
      ? months.find((monthValue) => evaluationMonthRange(monthValue)?.label === monthFilter)
      : months[months.length - 1];
    const monthRange = evaluationMonthRange(targetMonth);
    if (!monthRange) return "";

    const blockers = {
      noTitle: 0,
      demoInternal: 0,
      gametize: 0,
      missingCreation: 0,
      createdAfterMonth: 0,
      lastCompletionBeforeMonth: 0,
      monthMismatch: 0
    };

    dataRows.forEach((row) => {
      const record = projectRowData(row);
      const title = String(projectField(record, "title")).trim();
      if (!title || title === "Title") {
        blockers.noTitle += 1;
        return;
      }
      if (isExcludedProjectTitle(title)) {
        blockers.demoInternal += 1;
        return;
      }
      if (isGametizeProjectEmail(projectContactEmail(record))) {
        blockers.gametize += 1;
        return;
      }
      if (!rowBelongsToEvaluationMonth(row, record, targetMonth)) {
        blockers.monthMismatch += 1;
        return;
      }

      const creationMs = projectCreationMillis(record);
      if (creationMs === null) {
        blockers.missingCreation += 1;
        return;
      }
      if (creationMs > monthRange.end) {
        blockers.createdAfterMonth += 1;
        return;
      }

      const lastCompletionMs = projectLastCompletionMillis(record);
      if (lastCompletionMs !== null && lastCompletionMs < monthRange.start) {
        blockers.lastCompletionBeforeMonth += 1;
      }
    });

    const parts = [];
    if (blockers.noTitle) parts.push(`${blockers.noTitle} missing title`);
    if (blockers.demoInternal) parts.push(`${blockers.demoInternal} demo/internal`);
    if (blockers.gametize) parts.push(`${blockers.gametize} @gametize email`);
    if (blockers.monthMismatch) parts.push(`${blockers.monthMismatch} evaluation-month mismatch`);
    if (blockers.missingCreation) parts.push(`${blockers.missingCreation} missing creation date`);
    if (blockers.createdAfterMonth) parts.push(`${blockers.createdAfterMonth} created after ${monthRange.label}`);
    if (blockers.lastCompletionBeforeMonth) {
      parts.push(`${blockers.lastCompletionBeforeMonth} last completion before ${monthRange.label}`);
    }

    return parts.length
      ? `Excluded for ${monthRange.label}: ${parts.join(", ")}.`
      : "";
  }

  function rowBelongsToEvaluationMonth(row, record, evaluationMonthValue) {
    const fromColumn = projectField(record, "evaluationMonth");
    if (fromColumn && parseEvaluationMonth(fromColumn, { allowDateFallback: true })) {
      return evaluationMonthsMatch(fromColumn, evaluationMonthValue);
    }

    const sheetName = String(row.sheet_name || "").trim();
    if (sheetName && parseEvaluationMonth(sheetName)) {
      return evaluationMonthsMatch(sheetName, evaluationMonthValue);
    }

    return true;
  }

  function collectEvaluationMonthsFromPartnerRows(partnerRows, options = {}) {
    const months = new Set();
    const dataRows = getPartnerProjectDataRows(partnerRows);
    const transactionMonths = options.transactionMonths || [];
    const includeActivityRange = options.includeActivityRange === true;
    const activityRangeLimit = options.activityRangeLimit || HEALTH_DEBIT_MONTH_LIMIT;

    dataRows.forEach((row) => {
      const record = projectRowData(row);
      const fromColumn = projectField(record, "evaluationMonth");
      if (fromColumn) addEvaluationMonthCandidate(months, fromColumn, { allowDateFallback: true });

      const sheetName = String(row.sheet_name || "").trim();
      if (isMonthlyDebitSheetName(sheetName)) {
        addEvaluationMonthCandidate(months, sheetName);
      } else if (parseEvaluationMonth(sheetName)) {
        addEvaluationMonthCandidate(months, sheetName);
      }
    });

    scanEvaluationMonthsFromReport(partnerRows).forEach((month) => months.add(month));

    if (includeActivityRange) {
      const rangeMonths = expandEvaluationMonthRangeFromProjects(partnerRows);
      const cappedRange = rangeMonths.length > activityRangeLimit
        ? rangeMonths.slice(-activityRangeLimit)
        : rangeMonths;
      cappedRange.forEach((month) => months.add(month));
    }

    transactionMonths.forEach((month) => addEvaluationMonthCandidate(months, month));

    if (!months.size) {
      const fallback = inferEvaluationMonthFromDates(dataRows);
      if (fallback) months.add(fallback);
    }

    return [...months].sort(compareEvaluationMonthLabels);
  }

  function latestProjectActivityMonthLabel(partnerRows) {
    let latest = "";

    getPartnerProjectDataRows(partnerRows).forEach((row) => {
      const record = projectRowData(row);
      const activityMs = projectLastCompletionMillis(record) ?? projectCreationMillis(record);
      if (activityMs === null) return;

      const label = monthFmt.format(new Date(activityMs));
      if (!latest || compareEvaluationMonthLabels(label, latest) > 0) {
        latest = label;
      }
    });

    return latest;
  }

  function relevantEvaluationMonthsForDebit(partnerRows, transactions, cpName, monthFilter = "all") {
    if (monthFilter !== "all") {
      const range = evaluationMonthRange(monthFilter);
      if (!range) return [];
      return applyPartnerEvaluationStartFilter([range.label], cpName);
    }

    const transactionMonths = partnerTransactionMonths(transactions, cpName).slice(-HEALTH_DEBIT_MONTH_LIMIT);
    let months = collectEvaluationMonthsFromPartnerRows(partnerRows, {
      transactionMonths,
      includeActivityRange: false,
      activityRangeLimit: HEALTH_DEBIT_MONTH_LIMIT
    });

    const latestActivityMonth = latestProjectActivityMonthLabel(partnerRows);
    if (latestActivityMonth) {
      months = months.filter((monthValue) => (
        compareEvaluationMonthLabels(monthValue, latestActivityMonth) <= 0
      ));
    }

    months = applyPartnerEvaluationStartFilter(months, cpName);

    if (months.length <= HEALTH_DEBIT_MONTH_LIMIT) return months;
    return months.slice(-HEALTH_DEBIT_MONTH_LIMIT);
  }

  function collectAllEvaluationMonthLabels(projectRows, transactions = []) {
    const months = new Set();
    projectRowsByPartner(projectRows).forEach((rows, cp) => {
      const transactionMonths = partnerTransactionMonths(transactions, cp);
      collectEvaluationMonthsFromPartnerRows(rows, { transactionMonths })
        .forEach((month) => months.add(month));
    });
    return [...months].sort(compareEvaluationMonthLabels);
  }

  function evaluationMonthIncludeOptions(evaluationMonths) {
    return {};
  }

  function isProjectActiveDuringMonth(record, monthRange) {
    const lastCompletionMs = projectLastCompletionMillis(record);
    if (lastCompletionMs === null) return false;
    if (lastCompletionMs < monthRange.start) return false;

    const creationMs = projectCreationMillis(record);
    if (creationMs !== null && creationMs > monthRange.end) return false;

    return true;
  }

  function projectMatchesEvaluationMonth(record, monthRange) {
    if (!isProjectActiveDuringMonth(record, monthRange)) return false;

    const firstCompletionMs = projectDateMillis(projectField(record, "firstCompletionDate"));
    if (firstCompletionMs === null) return true;

    return firstCompletionMs <= monthRange.end;
  }

  function shouldIncludeProjectForMonth(record, monthRange, options = {}) {
    const title = String(projectField(record, "title")).trim();
    if (!title || title === "Title") return false;
    if (isExcludedProjectTitle(title)) return false;
    if (isGametizeProjectEmail(projectContactEmail(record))) return false;

    return projectMatchesEvaluationMonth(record, monthRange);
  }

  function adminLogRowData(row) {
    return row?.row_data || row?.rowData || row || {};
  }

  function adminLogField(record, field) {
    const aliases = (ADMIN_LOG_FIELD_ALIASES[field] || []).map(normalizeFieldKey);
    const entries = Object.entries(record || {});

    for (const [key, value] of entries) {
      if (value === null || value === undefined || String(value).trim() === "") continue;
      if (aliases.includes(normalizeFieldKey(key))) return value;
    }

    if (field === "timestamp") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if ((normalized.includes("date") || normalized.includes("time")) && String(value).trim()) {
          return value;
        }
      }
    }

    if (field === "description") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if ((normalized.includes("description") || normalized.includes("action") || normalized.includes("detail"))
          && String(value).trim()) {
          return value;
        }
      }
    }

    if (field === "projectId") {
      for (const [key, value] of entries) {
        const normalized = normalizeFieldKey(key);
        if (normalized.includes("project") && normalized.includes("id") && String(value).trim()) {
          return value;
        }
      }
    }

    return "";
  }

  function findAdminLogHeaderRowIndex(partnerRows) {
    const sortedRows = [...partnerRows].sort((a, b) => a.row_index - b.row_index);

    for (const row of sortedRows.slice(0, 12)) {
      const data = adminLogRowData(row);
      const values = Object.values(data).map((value) => String(value || "").trim().toLowerCase());
      const keys = Object.keys(data).map((key) => normalizeFieldKey(key));

      if (values.some((value) => value.includes("timestamp") || value === "date" || value === "time")) {
        if (values.some((value) => value.includes("description") || value.includes("action"))) {
          return row.row_index;
        }
      }
      if (keys.some((key) => key.includes("timestamp") || key === "date")
        && keys.some((key) => key.includes("description") || key.includes("action"))) {
        return row.row_index;
      }
    }

    return 1;
  }

  function getAdminLogDataRows(partnerRows) {
    const headerRowIndex = findAdminLogHeaderRowIndex(partnerRows);
    return partnerRows.filter((row) => row.row_index > headerRowIndex);
  }

  function isRemovedPlayerProjectAction(text) {
    const lower = String(text || "").toLowerCase();
    return lower.includes("removed") && /\bplayers?\b/.test(lower) && lower.includes("project");
  }

  function normalizeProjectIdKey(value) {
    const digits = String(value || "").match(/\d{3,8}/);
    return digits ? digits[0] : String(value || "").trim();
  }

  function extractProjectIdFromText(text) {
    const labeled = String(text || "").match(/project\s*(?:id)?\s*[:#]?\s*(\d+)/i);
    if (labeled) return labeled[1];

    const inProject = String(text || "").match(/\bproject\s+(\d{3,8})\b/i);
    if (inProject) return inProject[1];

    return "";
  }

  function adminLogTimestampMs(record) {
    const value = adminLogField(record, "timestamp");
    return projectDateMillis(value) ?? (parseDate(value)?.getTime() || null);
  }

  function adminLogDescriptionText(record) {
    const primary = String(adminLogField(record, "description")).trim();
    if (primary) return primary;

    return Object.values(record || {})
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function removedPlayersFromAdminAction(record) {
    const explicit = adminLogField(record, "removedCount");
    if (explicit !== "" && explicit !== null && explicit !== undefined) {
      return Math.max(0, toNumber(explicit));
    }

    const description = adminLogDescriptionText(record);
    if (!isRemovedPlayerProjectAction(description)) return 0;

    const multi = String(description).match(/removed multiple players.*?id\(s\):\s*([\d,\s]+)/i);
    if (multi) {
      return multi[1].split(",").map((part) => part.trim()).filter(Boolean).length;
    }

    if (/removed a player/i.test(description)) return 1;
    return 1;
  }

  function buildRemovedPlayerCountMap(adminLogRows, cpPartner, monthRange) {
    const counts = new Map();
    const partnerLogs = (adminLogRows || []).filter((row) => partnersMatch(row.cp, cpPartner));

    getAdminLogDataRows(partnerLogs).forEach((row) => {
      const record = adminLogRowData(row);
      const timestampMs = adminLogTimestampMs(record);
      if (timestampMs === null || timestampMs < monthRange.start || timestampMs > monthRange.end) return;

      const description = adminLogDescriptionText(record);
      if (!isRemovedPlayerProjectAction(description)) return;

      const removedCount = removedPlayersFromAdminAction(record);
      if (!removedCount) return;

      let projectId = normalizeProjectIdKey(adminLogField(record, "projectId"));
      if (!projectId) projectId = normalizeProjectIdKey(extractProjectIdFromText(description));
      const key = projectId || description.trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + removedCount);
    });

    return counts;
  }

  function getRemovedPlayersForProject(countMap, record) {
    if (!countMap?.size) return 0;

    const projectId = normalizeProjectIdKey(projectField(record, "projectId"));
    if (projectId && countMap.has(projectId)) return countMap.get(projectId);

    const titleKey = String(projectField(record, "title")).trim().toLowerCase();
    if (titleKey && countMap.has(titleKey)) return countMap.get(titleKey);

    let total = 0;
    countMap.forEach((count, key) => {
      if (projectId && key.includes(projectId)) total += count;
    });
    return total;
  }

  function calculateToDebit(playersIncludingRemoved) {
    if (window.PlatformSettings?.calculateToDebit) {
      return window.PlatformSettings.calculateToDebit(playersIncludingRemoved);
    }

    const count = toNumber(playersIncludingRemoved);
    if (count <= 100) return 100;
    if (count <= 200) return 200;
    if (count <= 500) return 500;
    return 1000;
  }

  function firstCompletionWithin30DaysExcludes(record, monthRange) {
    const firstCompletionMs = projectDateMillis(projectField(record, "firstCompletionDate"));
    const lastCompletionMs = projectLastCompletionMillis(record);
    if (firstCompletionMs === null || lastCompletionMs === null) return false;

    return firstCompletionMs < monthRange.start
      && lastCompletionMs >= monthRange.start
      && (lastCompletionMs - firstCompletionMs) < (30 * 86400000);
  }

  function firstCompletionWithin30DaysLabel(record, monthRange) {
    return firstCompletionWithin30DaysExcludes(record, monthRange) ? "Yes" : "No";
  }

  function waiverStorageKey(cpName, monthLabel, record) {
    const projectId = String(projectField(record, "projectId")).trim();
    const title = String(projectField(record, "title")).trim();
    return [
      partnerIdentityGroup(cpName),
      monthLabel,
      projectId || title
    ].join("|");
  }

  function readWaivedValues() {
    try {
      return JSON.parse(localStorage.getItem(WAIVED_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function getWaivedAmount(key) {
    return toNumber(readWaivedValues()[key] || 0);
  }

  function setWaivedAmount(key, value) {
    const store = readWaivedValues();
    const amount = Math.max(0, toNumber(value));
    if (!amount) {
      delete store[key];
    } else {
      store[key] = amount;
    }
    localStorage.setItem(WAIVED_STORAGE_KEY, JSON.stringify(store));
  }

  function filteredProjectRecordsForMonth(
    partnerRows,
    evaluationMonthValue,
    monthFilter = "all",
    includeOptions = {}
  ) {
    const monthRange = evaluationMonthRange(evaluationMonthValue);
    if (!monthRange) return [];
    if (monthFilter !== "all" && monthRange.label !== monthFilter) return [];

    return getPartnerProjectDataRows(partnerRows).filter((row) => {
      const record = projectRowData(row);
      if (!rowBelongsToEvaluationMonth(row, record, evaluationMonthValue)) return false;
      return shouldIncludeProjectForMonth(record, monthRange, includeOptions);
    });
  }

  function latestEvaluationMonthForPartnerRows(partnerRows) {
    const months = collectEvaluationMonthsFromPartnerRows(partnerRows);
    return months.length ? months[months.length - 1] : "";
  }

  function buildFilteredProjectOutputRow(cpName, monthRange, record, removedPlayerCounts, options = {}) {
    const players = toNumber(projectField(record, "players"));
    const sheetDeleted = recordNumericByHints(record, ["deletedplayers", "playersremoved"]);
    const adminLogRemovedPlayers = getRemovedPlayersForProject(removedPlayerCounts, record);
    const removedPlayers = sheetDeleted !== null
      ? sheetDeleted
      : adminLogRemovedPlayers;
    const sheetPlayersIncl = recordNumericByHints(record, [
      "playersincldeleted",
      "playersincludingremoved",
      "totalplayersinclremoved"
    ]);
    const playersIncludingRemoved = sheetPlayersIncl !== null
      ? sheetPlayersIncl
      : players + removedPlayers;
    const sheetToDebit = recordNumericByHints(record, ["todebit", "debitedusd", "debited"]);
    const toDebit = sheetToDebit !== null && sheetToDebit > 0
      ? sheetToDebit
      : calculateToDebit(playersIncludingRemoved);
    const waiverKey = waiverStorageKey(cpName, monthRange.label, record);
    const sheetWaived = recordNumericByHints(record, ["waived"]);
    const storedWaived = getWaivedAmount(waiverKey);
    const waived = storedWaived > 0 ? storedWaived : (sheetWaived ?? 0);
    const finalDebited = Math.max(0, toDebit - waived);

    return {
      waiverKey,
      toDebit,
      waived,
      finalDebited,
      cpName,
      monthLabel: monthRange.label,
      projectId: String(projectField(record, "projectId")).trim(),
      title: String(projectField(record, "title")).trim(),
      players,
      removedPlayers,
      adminLogRemovedPlayers,
      playersIncludingRemoved,
      creationDate: formatShortDate(parseProjectDate(projectField(record, "creationDate"))),
      firstCompletionDate: formatShortDate(parseProjectDate(projectField(record, "firstCompletionDate"))),
      lastCompletionDate: formatShortDate(parseProjectDate(projectField(record, "lastCompletionDate"))),
      cells: [
        cpName,
        monthRange.label,
        String(projectField(record, "title")).trim(),
        formatShortDate(parseProjectDate(projectField(record, "creationDate"))),
        formatShortDate(parseProjectDate(projectField(record, "firstCompletionDate"))),
        formatCredits(players),
        formatCredits(removedPlayers),
        formatCredits(playersIncludingRemoved),
        formatCreditMoney(toDebit),
        String(waived || ""),
        formatCreditMoney(finalDebited),
        firstCompletionWithin30DaysLabel(record, monthRange)
      ]
    };
  }

  function healthMonthStatusPartnerKey(partnerFilter = "all") {
    return partnerFilter === "all" ? "all" : String(partnerFilter || "").trim();
  }

  function healthMonthStatusStorageKey(partnerKey, monthLabel) {
    return `${partnerKey}|${String(monthLabel || "").trim()}`;
  }

  function readHealthMonthStatusStore() {
    if (healthMonthStatusCache) return { ...healthMonthStatusCache };

    try {
      healthMonthStatusCache = JSON.parse(localStorage.getItem(HEALTH_MONTH_STATUS_KEY) || "{}");
    } catch {
      healthMonthStatusCache = {};
    }

    return { ...healthMonthStatusCache };
  }

  function writeHealthMonthStatusStore(store) {
    healthMonthStatusCache = { ...store };
    try {
      localStorage.setItem(HEALTH_MONTH_STATUS_KEY, JSON.stringify(healthMonthStatusCache));
    } catch {
      // Ignore storage quota errors.
    }
  }

  async function hydrateHealthMonthStatuses() {
    if (!window.DashboardAuth?.getCreditHealthMonthStatuses) {
      state.healthMonthStatusesReady = true;
      return;
    }

    try {
      const remote = await window.DashboardAuth.getCreditHealthMonthStatuses();
      if (remote && Object.keys(remote).length) {
        writeHealthMonthStatusStore({
          ...readHealthMonthStatusStore(),
          ...remote
        });
      }
    } catch (error) {
      console.warn("Could not load month status from Supabase:", error);
    } finally {
      state.healthMonthStatusesReady = true;
    }
  }

  function getHealthMonthStatus(partnerFilter, monthLabel) {
    const partnerKey = healthMonthStatusPartnerKey(partnerFilter);
    const status = readHealthMonthStatusStore()[healthMonthStatusStorageKey(partnerKey, monthLabel)];
    return status === "debited" ? "debited" : "pending";
  }

  function setHealthMonthStatus(partnerFilter, monthLabel, status) {
    const partnerKey = healthMonthStatusPartnerKey(partnerFilter);
    const store = readHealthMonthStatusStore();
    store[healthMonthStatusStorageKey(partnerKey, monthLabel)] = status === "debited" ? "debited" : "pending";
    writeHealthMonthStatusStore(store);

    if (window.DashboardAuth?.saveCreditHealthMonthStatus) {
      window.DashboardAuth.saveCreditHealthMonthStatus(partnerKey, monthLabel, status).catch((error) => {
        console.warn("Could not save month status to Supabase:", error);
      });
    }
  }

  function renderHealthMonthStatusControl(group, partnerFilter) {
    const partnerKey = healthMonthStatusPartnerKey(partnerFilter);
    const status = getHealthMonthStatus(partnerFilter, group.monthLabel);
    const statusClass = status === "debited" ? "is-debited" : "is-pending";

    return `
      <span class="credits-health-month-status-wrap" data-stop-toggle="true">
        <label class="credits-health-month-status">
          <span class="credits-health-month-status-label">Status</span>
          <select
            class="credits-health-month-status-select ${statusClass}"
            data-month="${escapeHtml(group.monthLabel)}"
            data-partner-key="${escapeHtml(partnerKey)}"
            aria-label="Debit status for ${escapeHtml(group.monthLabel)}"
          >
            <option value="pending"${status === "pending" ? " selected" : ""}>Pending</option>
            <option value="debited"${status === "debited" ? " selected" : ""}>Debited</option>
          </select>
        </label>
      </span>
    `;
  }

  function dateInEvaluationMonth(dateMs, monthRange) {
    if (dateMs === null || !monthRange) return false;
    return dateMs >= monthRange.start && dateMs <= monthRange.end;
  }

  function formatSubscriptionDuration(firstCompletionDate, lastCompletionDate, evaluationMonthLabel) {
    const monthRange = evaluationMonthRange(evaluationMonthLabel);
    const firstMs = projectDateMillis(firstCompletionDate);
    const lastMs = projectDateMillis(lastCompletionDate);

    if (!monthRange) {
      if (firstMs !== null && lastMs !== null) {
        return `${formatShortDate(new Date(firstMs))} – ${formatShortDate(new Date(lastMs))}`;
      }
      if (firstMs !== null) return formatShortDate(new Date(firstMs));
      if (lastMs !== null) return formatShortDate(new Date(lastMs));
      return "—";
    }

    if (firstMs === null && lastMs === null) return "—";

    let startMs = firstMs ?? monthRange.start;
    let endMs = lastMs ?? monthRange.end;

    if (firstMs !== null && !dateInEvaluationMonth(firstMs, monthRange)) {
      startMs = monthRange.start;
    }

    if (lastMs !== null && !dateInEvaluationMonth(lastMs, monthRange)) {
      endMs = monthRange.end;
    }

    if (endMs < startMs) {
      endMs = monthRange.end;
      if (startMs > endMs) startMs = monthRange.start;
    }

    return `${formatShortDate(new Date(startMs))} – ${formatShortDate(new Date(endMs))}`;
  }

  function monthNameFromLabel(monthLabel) {
    return String(monthLabel || "").trim().split(/\s+/)[0] || monthLabel;
  }

  function groupHealthRowsByMonth(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      const monthLabel = row.monthLabel || row.cells[1];
      if (!groups.has(monthLabel)) {
        groups.set(monthLabel, {
          monthLabel,
          rows: [],
          totalDebit: 0,
          partners: new Set()
        });
      }

      const group = groups.get(monthLabel);
      group.rows.push(row);
      group.totalDebit += toNumber(row.finalDebited);
      if (row.cpName || row.cells[0]) group.partners.add(row.cpName || row.cells[0]);
    });

    return [...groups.values()].sort((left, right) => (
      compareEvaluationMonthLabels(right.monthLabel, left.monthLabel)
    ));
  }

  function fillEmptyHealthMonthGroups(monthGroups, monthLabels, partnerHint = "") {
    const byLabel = new Map(monthGroups.map((group) => [group.monthLabel, group]));

    return monthLabels
      .map((monthValue) => {
        const monthLabel = normalizeEvaluationMonthLabel(monthValue);
        if (byLabel.has(monthLabel)) return byLabel.get(monthLabel);

        return {
          monthLabel,
          rows: [],
          totalDebit: 0,
          partners: partnerHint ? new Set([partnerHint]) : new Set()
        };
      })
      .sort((left, right) => compareEvaluationMonthLabels(right.monthLabel, left.monthLabel));
  }

  function healthMonthSubtitle(group, partnerFilter) {
    const countLabel = `${group.rows.length} Project${group.rows.length === 1 ? "" : "s"}`;
    if (partnerFilter !== "all") {
      return `${countLabel} · ${partnerFilter}`;
    }
    if (group.partners.size === 1) {
      return `${countLabel} · ${[...group.partners][0]}`;
    }
    if (!group.partners.size) {
      return countLabel;
    }
    return `${countLabel} · ${group.partners.size} Partners`;
  }

  function computeHealthDebitTotals(groups, partnerFilter = "all") {
    let totalPending = 0;
    let totalDebited = 0;

    (groups || []).forEach((group) => {
      const amount = toNumber(group.totalDebit);
      if (getHealthMonthStatus(partnerFilter, group.monthLabel) === "debited") {
        totalDebited += amount;
      } else {
        totalPending += amount;
      }
    });

    return {
      totalPending,
      totalDebited,
      totalDebit: totalPending + totalDebited
    };
  }

  function updateHealthHeadingTotals(partnerFilter = state.partner) {
    if (!els.healthHeadingTotals) return;

    const groups = state.healthMonthGroups || [];
    if (!groups.length) {
      els.healthHeadingTotals.hidden = true;
      els.healthHeadingTotals.innerHTML = "";
      return;
    }

    const totals = computeHealthDebitTotals(groups, partnerFilter);
    els.healthHeadingTotals.hidden = false;
    els.healthHeadingTotals.innerHTML = `
      <div class="credits-health-heading-total">
        <span class="credits-health-heading-total-label">Total Pending</span>
        <strong class="credits-health-heading-total-value is-pending">${escapeHtml(formatCreditMoney(totals.totalPending))}</strong>
      </div>
      <div class="credits-health-heading-total">
        <span class="credits-health-heading-total-label">Total Debit</span>
        <strong class="credits-health-heading-total-value">${escapeHtml(formatCreditMoney(totals.totalDebit))}</strong>
      </div>
    `;
  }

  function clearHealthHeadingTotals() {
    if (!els.healthHeadingTotals) return;
    els.healthHeadingTotals.hidden = true;
    els.healthHeadingTotals.innerHTML = "";
  }

  function buildPartnerHealth(balanceRows) {
    return balanceRows
      .map((row) => {
        const name = String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim();
        const allocated = toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0));
        const remaining = toNumber(pick(row, ["credits_remaining", "creditsRemaining", "remaining"], 0));
        if (!name) return null;

        const remainingPct = allocated > 0
          ? Math.max(0, Math.min(100, Math.round((remaining / allocated) * 100)))
          : 0;

        return {
          name,
          partner: name,
          remainingPct,
          tone: healthTone(remainingPct)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.remainingPct - b.remainingPct);
  }

  function isBalanceSnapshotRow(row) {
    return /account balance as of/i.test(String(row?.description || ""));
  }

  function balanceRowForPartner(balanceRows, partner) {
    return (balanceRows || []).find((row) => {
      const name = String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim();
      return name && partnersMatch(name, partner);
    });
  }

  function latestBalanceSnapshotFromLogs(transactions) {
    return transactions
      .filter(isBalanceSnapshotRow)
      .sort((a, b) => b.dateSort - a.dateSort)[0] || null;
  }

  function partnerRemainingBalance(transactions, balanceRows, partner) {
    const partnerTx = transactions
      .filter((row) => partnersMatch(row.cpPartner, partner))
      .sort((a, b) => b.dateSort - a.dateSort);
    const snapshots = partnerTx.filter(isBalanceSnapshotRow);
    const activity = partnerTx.filter((row) => !isBalanceSnapshotRow(row));

    if (snapshots.length) {
      const latestSnapshot = snapshots.sort((a, b) => b.dateSort - a.dateSort)[0];
      const deltaAfterSnapshot = activity
        .filter((row) => row.dateSort > latestSnapshot.dateSort)
        .reduce((sum, row) => sum + row.amount, 0);
      return latestSnapshot.amount + deltaAfterSnapshot;
    }

    const ledgerNet = activity.reduce((sum, row) => sum + row.amount, 0);
    if (ledgerNet !== 0) return ledgerNet;

    const balanceRow = balanceRowForPartner(balanceRows, partner);
    if (balanceRow) {
      return toNumber(pick(balanceRow, ["credits_remaining", "creditsRemaining", "remaining"], 0));
    }

    return ledgerNet;
  }

  function partnerCreditFromLogs(transactions, partner, balanceRows = []) {
    const partnerTx = transactions.filter((row) => partnersMatch(row.cpPartner, partner));
    const allocated = partnerTx
      .filter((row) => row.amount > 0 && !isBalanceSnapshotRow(row))
      .reduce((sum, row) => sum + row.amount, 0);

    return {
      allocated,
      remaining: partnerRemainingBalance(transactions, balanceRows, partner)
    };
  }

  function aggregateProjectStats(rows, evaluationMonth = "", monthFilter = "all") {
    const stats = {
      projectCount: 0,
      totalPlayers: 0,
      activePlayers: 0,
      publishedCount: 0,
      totalCompletions: 0
    };

    const monthValue = evaluationMonth || latestEvaluationMonthForPartnerRows(rows);
    if (!monthValue) return stats;

    filteredProjectRecordsForMonth(rows, monthValue, monthFilter).forEach((row) => {
      const data = projectRowData(row);
      stats.projectCount += 1;
      stats.totalPlayers += toNumber(pick(data, ["Players", "players"], 0));
      stats.activePlayers += toNumber(pick(data, ["Players with Completions", "players_with_completions"], 0));
      stats.totalCompletions += toNumber(pick(data, ["Completions", "completions"], 0));
      if (String(pick(data, ["Published", "published"], "")).toLowerCase() === "yes") {
        stats.publishedCount += 1;
      }
    });

    return stats;
  }

  function buildProjectHealthEntry(name, partner, detail, remainingPct) {
    return {
      name,
      partner,
      detail,
      remainingPct,
      tone: healthTone(remainingPct)
    };
  }

  function buildPartnerHealthFromProjectReports(projectRows, transactions, partnerFilter = "all", monthFilter = "all", balanceRows = []) {
    const byPartner = projectRowsByPartner(projectRows, partnerFilter);

    const entries = [];

    byPartner.forEach((rows, cp) => {
      if (partnerFilter !== "all") {
        collectEvaluationMonthsFromPartnerRows(rows).forEach((monthValue) => {
          const monthRange = evaluationMonthRange(monthValue);
          if (!monthRange) return;
          if (monthFilter !== "all" && monthRange.label !== monthFilter) return;

          filteredProjectRecordsForMonth(rows, monthValue, monthFilter).forEach((row) => {
            const data = projectRowData(row);
            const title = String(projectField(data, "title")).trim();
            const players = toNumber(projectField(data, "players"));
            const activePlayers = toNumber(pick(data, ["Players with Completions", "players_with_completions"], 0));
            const completions = toNumber(pick(data, ["Completions", "completions"], 0));
            const published = String(pick(data, ["Published", "published"], "")).toLowerCase() === "yes";
            const projectId = String(pick(data, ["Project ID", "project_id"], "")).trim();

            let remainingPct;
            if (players > 0) {
              remainingPct = Math.max(0, Math.min(100, Math.round(((players - activePlayers) / players) * 100)));
            } else if (published) {
              remainingPct = completions > 0 ? 25 : 60;
            } else {
              remainingPct = 100;
            }

            const detailParts = [];
            if (projectId) detailParts.push(`ID ${projectId}`);
            detailParts.push(`${formatCredits(players)} players`);
            detailParts.push(`${formatCredits(completions)} completions`);

            entries.push(buildProjectHealthEntry(
              title,
              cp,
              detailParts.join(" · "),
              remainingPct
            ));
          });
        });
        return;
      }

      const stats = aggregateProjectStats(rows, "", monthFilter);
      const credit = partnerCreditFromLogs(transactions, cp, balanceRows);

      let remainingPct;
      let detail;

      if (credit.allocated > 0) {
        remainingPct = Math.max(0, Math.min(100, Math.round((credit.remaining / credit.allocated) * 100)));
        detail = `${formatCreditMoney(credit.remaining)} of ${formatCreditMoney(credit.allocated)} credits · ${stats.projectCount} projects`;
      } else if (stats.totalPlayers > 0) {
        remainingPct = Math.max(0, Math.min(100, Math.round(
          ((stats.totalPlayers - stats.activePlayers) / stats.totalPlayers) * 100
        )));
        detail = `${stats.projectCount} projects · ${formatCredits(stats.totalPlayers)} players · ${formatCredits(stats.totalCompletions)} completions`;
      } else {
        remainingPct = stats.publishedCount > 0 ? 50 : 100;
        detail = `${stats.projectCount} projects · ${stats.publishedCount} published`;
      }

      entries.push(buildProjectHealthEntry(cp, cp, detail, remainingPct));
    });

    return entries.sort((a, b) => a.remainingPct - b.remainingPct);
  }

  function buildCreditsData(logRows, balanceRows, projectRows = [], adminLogRows = []) {
    const transactions = logRows
      .map(normalizeLogRow)
      .sort((a, b) => b.dateSort - a.dateSort);

    const balanceHealth = buildPartnerHealth(balanceRows);
    const partnerHealth = projectRows.length
      ? buildPartnerHealthFromProjectReports(projectRows, transactions, "all", "all", balanceRows)
      : balanceHealth;

    const positiveAdjustments = transactions
      .filter((row) => row.amount > 0 && !isBalanceSnapshotRow(row))
      .reduce((sum, row) => sum + row.amount, 0);

    const partnerNames = [...new Set(
      transactions.map((row) => partnerDisplayLabel(row.cpPartner)).filter(Boolean)
    )];
    const remainingBalance = partnerNames.length
      ? partnerNames.reduce(
        (sum, partner) => sum + partnerRemainingBalance(transactions, balanceRows, partner),
        0
      )
      : balanceRows.reduce(
        (sum, row) => sum + toNumber(pick(row, ["credits_remaining", "creditsRemaining", "remaining"], 0)),
        0
      );

    const totalAllocated = positiveAdjustments || balanceRows.reduce(
      (sum, row) => sum + toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0)),
      0
    );

    return {
      totalAllocated,
      remainingBalance,
      transactions,
      partnerBalanceRows: balanceRows,
      partnerHealth: partnerHealth.slice(0, 8),
      projectReportRows: projectRows,
      adminLogReportRows: adminLogRows
    };
  }

  function filteredPartnerHealth(data) {
    let health = data.partnerHealth || [];
    if (state.partner !== "all") {
      health = health.filter((entry) =>
        partnersMatch(entry.partner, state.partner) || partnersMatch(entry.name, state.partner)
      );
    }

    const query = creditsSearchQuery();
    if (query) {
      health = health.filter((entry) => partnerHealthEntryMatchesCreditsSearch(entry, query));
    }

    return health;
  }

  function getData() {
    return state.data;
  }

  function creditsSearchQuery() {
    return state.search.trim().toLowerCase();
  }

  function textMatchesCreditsSearch(value, query = creditsSearchQuery()) {
    if (!query) return true;
    return String(value || "").toLowerCase().includes(query);
  }

  function transactionMatchesCreditsSearch(row, query = creditsSearchQuery()) {
    if (!query) return true;

    return [
      row.month,
      row.date,
      row.description,
      row.cpPartner,
      partnerDisplayLabel(row.cpPartner),
      row.actions,
      row.amountDisplay
    ].some((value) => textMatchesCreditsSearch(value, query));
  }

  function partnerOverviewMatchesCreditsSearch(row, query = creditsSearchQuery()) {
    if (!query) return true;
    return textMatchesCreditsSearch(row.partner, query);
  }

  function projectHealthRowMatchesCreditsSearch(row, query = creditsSearchQuery()) {
    if (!query) return true;

    return [
      row.projectId,
      row.title,
      row.cpName,
      row.monthLabel,
      row.waiverKey,
      ...(row.cells || [])
    ].some((value) => textMatchesCreditsSearch(value, query));
  }

  function partnerHealthEntryMatchesCreditsSearch(entry, query = creditsSearchQuery()) {
    if (!query) return true;

    return [
      entry.name,
      entry.partner,
      entry.detail
    ].some((value) => textMatchesCreditsSearch(value, query));
  }

  function formatCredits(value) {
    return numberFmt.format(Math.round(toNumber(value)));
  }

  function formatCreditMoney(value) {
    return `US$${creditMoneyFmt.format(toNumber(value))}`;
  }

  function uniqueMonths(data) {
    const months = new Set(data.transactions.map((row) => row.month));
    collectAllEvaluationMonthLabels(data.projectReportRows || [], data.transactions || [])
      .forEach((month) => months.add(month));

    let monthList = [...months]
      .filter(Boolean)
      .sort(compareEvaluationMonthLabels);

    if (state.partner !== "all") {
      monthList = applyPartnerEvaluationStartFilter(monthList, state.partner);
    }

    return monthList;
  }

  function uniquePartners(data) {
    const partners = new Set();
    data.transactions.forEach((row) => {
      if (row.cpPartner) partners.add(partnerDisplayLabel(row.cpPartner));
    });
    (data.projectReportRows || []).forEach((row) => {
      if (row.cp) partners.add(partnerDisplayLabel(row.cp));
    });
    Object.keys(window.DASHBOARD_DATA?.partnersByOrganization || {}).forEach((name) => {
      if (name) partners.add(name);
    });
    if (window.PartnersView?.getPartnerNames) {
      window.PartnersView.getPartnerNames().forEach((name) => partners.add(name));
    }
    return [...partners].filter(Boolean).sort();
  }

  function allPartnerNames(data) {
    const partners = new Set(uniquePartners(data));
    (data.partnerBalanceRows || []).forEach((row) => {
      const name = String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim();
      if (name) partners.add(partnerDisplayLabel(name));
    });
    return [...partners].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function partnerAllocatedAmount(transactions, partner, monthFilter = "all") {
    return transactions
      .filter((row) => partnersMatch(row.cpPartner, partner))
      .filter((row) => monthFilter === "all" || row.month === monthFilter)
      .filter((row) => row.amount > 0 && !isBalanceSnapshotRow(row))
      .reduce((sum, row) => sum + row.amount, 0);
  }

  function partnerHasCreditOverviewData(data, partner) {
    if ((data.transactions || []).some((row) => partnersMatch(row.cpPartner, partner))) return true;
    if ((data.projectReportRows || []).some((row) => partnersMatch(row.cp, partner))) return true;
    if ((data.adminLogReportRows || []).some((row) => partnersMatch(row.cp, partner))) return true;
    if ((data.partnerBalanceRows || []).some((row) => {
      const name = String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim();
      return name && partnersMatch(name, partner);
    })) return true;
    if ((state.uploadHistory || []).some((entry) => entry.cp && partnersMatch(entry.cp, partner))) return true;
    return false;
  }

  function shouldShowPartnerOverviewRow(data, row) {
    if (row.allocated > 0) return true;
    if (Math.abs(row.remaining) > 0.001) return true;
    return partnerHasCreditOverviewData(data, row.partner);
  }

  function partnerOverviewMetrics(transactions, balanceRows, partner) {
    const balanceRow = balanceRowForPartner(balanceRows, partner);
    const hasPartnerLogs = (transactions || []).some((row) => partnersMatch(row.cpPartner, partner));

    if (balanceRow && !hasPartnerLogs) {
      const allocated = toNumber(pick(balanceRow, ["credits_allocated", "creditsAllocated", "allocated"], 0));
      const remaining = toNumber(pick(balanceRow, ["credits_remaining", "creditsRemaining", "remaining"], 0));
      const remainingPct = allocated > 0
        ? Math.max(0, Math.min(100, Math.round((remaining / allocated) * 100)))
        : null;
      return { allocated, remaining, remainingPct };
    }

    const credit = partnerCreditFromLogs(transactions, partner, balanceRows);
    let allocated = credit.allocated;
    let remaining = credit.remaining;

    if (balanceRow) {
      const balanceAllocated = toNumber(pick(balanceRow, ["credits_allocated", "creditsAllocated", "allocated"], 0));
      const balanceRemaining = toNumber(pick(balanceRow, ["credits_remaining", "creditsRemaining", "remaining"], 0));
      if (allocated <= 0 && balanceAllocated > 0) allocated = balanceAllocated;
      if (!hasPartnerLogs || (remaining === 0 && balanceRemaining !== 0)) remaining = balanceRemaining;
    }

    const remainingPct = allocated > 0
      ? Math.max(0, Math.min(100, Math.round((remaining / allocated) * 100)))
      : null;

    return { allocated, remaining, remainingPct };
  }

  function balanceRowOverviewMetrics(row) {
    const partner = partnerDisplayLabel(String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim());
    if (!partner) return null;

    const allocated = toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0));
    const remaining = toNumber(pick(row, ["credits_remaining", "creditsRemaining", "remaining"], 0));
    const remainingPct = allocated > 0
      ? Math.max(0, Math.min(100, Math.round((remaining / allocated) * 100)))
      : null;

    return { partner, allocated, remaining, remainingPct };
  }

  function balanceRowsNeedLogAggregation(balanceRows) {
    if (!balanceRows.length) return true;
    return balanceRows.some((row) =>
      toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0)) <= 0
    );
  }

  function buildPartnerBalanceRowsFromLogs(logRows, existingBalanceRows = []) {
    const transactions = (logRows || []).map(normalizeLogRow);
    const byKey = new Map();

    (existingBalanceRows || []).forEach((row) => {
      const partner = String(pick(row, ["partner", "Partner", "cp_partner", "cpPartner"], "")).trim();
      if (!partner) return;
      byKey.set(partnerIdentityGroup(partner), { ...row, partner });
    });

    const partnersFromLogs = [...new Set(
      transactions.map((row) => partnerDisplayLabel(row.cpPartner)).filter(Boolean)
    )];

    partnersFromLogs.forEach((partner) => {
      const key = partnerIdentityGroup(partner);
      const credit = partnerCreditFromLogs(transactions, partner, existingBalanceRows);
      const existing = byKey.get(key);
      const balanceAllocated = existing
        ? toNumber(pick(existing, ["credits_allocated", "creditsAllocated", "allocated"], 0))
        : 0;
      const balanceRemaining = existing
        ? toNumber(pick(existing, ["credits_remaining", "creditsRemaining", "remaining"], 0))
        : 0;

      byKey.set(key, {
        partner: partnerDisplayLabel(partner),
        credits_allocated: balanceAllocated > 0 ? balanceAllocated : credit.allocated,
        credits_remaining: balanceRemaining !== 0 ? balanceRemaining : credit.remaining
      });
    });

    return [...byKey.values()];
  }

  function buildPartnerOverviewRows(data) {
    const balanceRows = data.partnerBalanceRows || [];
    const transactions = data.transactions || [];
    const byPartnerKey = new Map();

    balanceRows.forEach((row) => {
      const entry = balanceRowOverviewMetrics(row);
      if (!entry) return;
      byPartnerKey.set(partnerIdentityGroup(entry.partner), entry);
    });

    allPartnerNames(data).forEach((partner) => {
      const key = partnerIdentityGroup(partner);
      const hasPartnerLogs = transactions.some((row) => partnersMatch(row.cpPartner, partner));
      if (byPartnerKey.has(key) && !hasPartnerLogs) return;

      const row = {
        partner,
        ...partnerOverviewMetrics(transactions, balanceRows, partner)
      };
      if (!byPartnerKey.has(key) && !shouldShowPartnerOverviewRow(data, row)) return;
      byPartnerKey.set(key, row);
    });

    const query = creditsSearchQuery();
    return [...byPartnerKey.values()]
      .filter((row) => partnerOverviewMatchesCreditsSearch(row, query))
      .sort((a, b) => a.partner.localeCompare(b.partner));
  }

  function overviewRemainingTone(remainingPct) {
    if (remainingPct === null) return "";
    if (remainingPct <= 20) return "is-critical";
    if (remainingPct <= 40) return "is-warning";
    return "";
  }

  function renderPartnerOverview(data) {
    if (!els.partnerOverviewBody) return;

    if (state.loading) {
      els.partnerOverviewBody.innerHTML = '<tr><td colspan="4" class="empty">Loading partner balances…</td></tr>';
      if (els.partnerOverviewFoot) els.partnerOverviewFoot.innerHTML = "";
      return;
    }

    const rows = buildPartnerOverviewRows(data);
    if (!rows.length) {
      const message = (data.partnerBalanceRows || []).length
        ? "No partners match your search."
        : "No partner credit balances found yet.";
      els.partnerOverviewBody.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(message)}</td></tr>`;
      if (els.partnerOverviewFoot) els.partnerOverviewFoot.innerHTML = "";
      return;
    }

    const totals = rows.reduce(
      (acc, row) => ({
        allocated: acc.allocated + row.allocated,
        remaining: acc.remaining + row.remaining
      }),
      { allocated: 0, remaining: 0 }
    );

    els.partnerOverviewBody.innerHTML = rows.map((row) => {
      const isActive = state.partner !== "all" && partnersMatch(row.partner, state.partner);
      const pctClass = overviewRemainingTone(row.remainingPct);
      const pctLabel = row.remainingPct !== null ? `${row.remainingPct}%` : "—";

      return `
        <tr class="credits-overview-row${isActive ? " is-active" : ""}">
          <td>
            <button type="button" class="credits-overview-partner-btn" data-partner="${escapeHtml(row.partner)}">${escapeHtml(row.partner)}</button>
          </td>
          <td>${escapeHtml(formatCreditMoney(row.allocated))}</td>
          <td class="credits-overview-balance">${escapeHtml(formatCreditMoney(row.remaining))}</td>
          <td class="${pctClass}">${escapeHtml(pctLabel)}</td>
        </tr>
      `;
    }).join("");

    if (els.partnerOverviewFoot) {
      els.partnerOverviewFoot.innerHTML = `
        <tr class="credits-overview-total-row">
          <th scope="row">Total</th>
          <td>${escapeHtml(formatCreditMoney(totals.allocated))}</td>
          <td>${escapeHtml(formatCreditMoney(totals.remaining))}</td>
          <td>—</td>
        </tr>
      `;
    }
  }

  function populateFilters() {
    if (!els.monthFilter || !els.partnerFilter) return;

    const data = getData();
    const months = uniqueMonths(data);

    els.monthFilter.innerHTML = '<option value="all">All months</option>';
    months.forEach((month) => {
      const option = document.createElement("option");
      option.value = month;
      option.textContent = month;
      els.monthFilter.appendChild(option);
    });

    els.partnerFilter.innerHTML = '<option value="all">All Partners</option>';
    const partners = uniquePartners(data);
    partners.forEach((partner) => {
      const option = document.createElement("option");
      option.value = partner;
      option.textContent = partner;
      els.partnerFilter.appendChild(option);
    });

    if (!state.filtersReady) {
      state.month = "all";
      state.partner = "all";
      state.filtersReady = true;
    } else if (state.partner !== "all") {
      const currentKey = partnerIdentityGroup(state.partner);
      const matched = partners.find((partner) => partnerIdentityGroup(partner) === currentKey);
      state.partner = matched || (partners.includes(state.partner) ? state.partner : "all");
    }

    if (state.partner !== "all" && state.month !== "all") {
      const allowedMonths = applyPartnerEvaluationStartFilter([state.month], state.partner);
      if (!allowedMonths.length) state.month = "all";
    }

    els.monthFilter.value = state.month;
    els.partnerFilter.value = state.partner;
  }

  function transactionsMatchingFilters(data, includeSearch = false) {
    return data.transactions.filter((row) => {
      if (state.month !== "all" && row.month !== state.month) return false;
      if (state.partner !== "all" && !partnersMatch(row.cpPartner, state.partner)) return false;
      if (includeSearch && !transactionMatchesCreditsSearch(row)) return false;
      return true;
    });
  }

  function filteredTransactions(data) {
    return transactionsMatchingFilters(data, true);
  }

  function computeSummaryMetrics(data) {
    const scoped = data.transactions.filter((row) => {
      if (state.partner !== "all" && !partnersMatch(row.cpPartner, state.partner)) return false;
      return true;
    });

    const filtered = scoped.filter((row) => {
      if (state.month !== "all" && row.month !== state.month) return false;
      return true;
    });

    const totalAllocated = filtered
      .filter((row) => row.amount > 0 && !isBalanceSnapshotRow(row))
      .reduce((sum, row) => sum + row.amount, 0);

    const balanceRows = data.partnerBalanceRows || [];
    let remainingBalance = 0;

    if (state.partner !== "all") {
      remainingBalance = partnerRemainingBalance(data.transactions, balanceRows, state.partner);
    } else if (state.month !== "all") {
      const monthSnapshots = scoped
        .filter((row) => row.month === state.month && isBalanceSnapshotRow(row))
        .sort((a, b) => b.dateSort - a.dateSort);
      const latestByPartner = new Map();
      monthSnapshots.forEach((row) => {
        if (!latestByPartner.has(row.cpPartner)) {
          latestByPartner.set(row.cpPartner, row.amount);
        }
      });

      if (latestByPartner.size) {
        remainingBalance = [...latestByPartner.values()].reduce((sum, amount) => sum + amount, 0);
      } else {
        const partnersInScope = [...new Set(scoped.map((row) => row.cpPartner).filter(Boolean))];
        remainingBalance = partnersInScope.reduce(
          (sum, partner) => sum + partnerRemainingBalance(data.transactions, balanceRows, partner),
          0
        );
      }
    } else if (balanceRows.length) {
      remainingBalance = balanceRows.reduce(
        (sum, row) => sum + toNumber(pick(row, ["credits_remaining", "creditsRemaining", "remaining"], 0)),
        0
      );
    } else {
      const partnerNames = [...new Set(
        data.transactions.map((row) => partnerDisplayLabel(row.cpPartner)).filter(Boolean)
      )];
      remainingBalance = partnerNames.reduce(
        (sum, partner) => sum + partnerRemainingBalance(data.transactions, balanceRows, partner),
        0
      );
    }

    if (state.partner === "all" && state.month === "all" && !totalAllocated && balanceRows.length) {
      totalAllocated = balanceRows.reduce(
        (sum, row) => sum + toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0)),
        0
      );
    }

    return { totalAllocated, remainingBalance };
  }

  function renderSummary(data) {
    if (!els.totalAllocated) return;

    const metrics = computeSummaryMetrics(data);
    const usedPct = metrics.totalAllocated
      ? Math.max(0, Math.min(100, (metrics.remainingBalance / metrics.totalAllocated) * 100))
      : 0;

    els.totalAllocated.textContent = formatCreditMoney(metrics.totalAllocated);
    els.remainingBalance.textContent = formatCreditMoney(metrics.remainingBalance);
    if (els.balanceBar) {
      els.balanceBar.style.width = `${usedPct.toFixed(1)}%`;
    }
  }

  function formatProjectCell(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) {
      return window.DashboardDateFormat?.formatDisplayDate(value) || value.toLocaleDateString();
    }

    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        return window.DashboardDateFormat?.formatDisplayDate(date) || text;
      }
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text)) {
      return window.DashboardDateFormat?.formatDisplayDateValue(text) || text;
    }

    return text;
  }

  function projectRowsByPartner(projectRows, partnerFilter = "all") {
    const byPartner = new Map();

    projectRows.forEach((row) => {
      const cp = String(row.cp || "").trim();
      if (!cp) return;
      if (partnerFilter !== "all" && !partnersMatch(cp, partnerFilter)) return;
      if (!byPartner.has(cp)) byPartner.set(cp, []);
      byPartner.get(cp).push(row);
    });

    return byPartner;
  }

  function partnerRowsHaveMonthlyDebitSheets(partnerRows) {
    return partnerRows.some((row) => isMonthlyDebitSheetName(row.sheet_name));
  }

  function partnerRowsHaveActivityDates(partnerRows) {
    return getPartnerProjectDataRows(partnerRows).some((row) => {
      const record = projectRowData(row);
      return projectLastCompletionMillis(record) !== null || projectCreationMillis(record) !== null;
    });
  }

  function getMonthlyDebitSheetDataRows(partnerRows, sheetName) {
    const sheetRows = partnerRows.filter((row) => (
      String(row.sheet_name || "").trim().toLowerCase() === String(sheetName || "").trim().toLowerCase()
    ));
    if (!sheetRows.length) return [];

    const sorted = [...sheetRows].sort((a, b) => a.row_index - b.row_index);
    let headerRowIndex = 1;

    for (const row of sorted.slice(0, 8)) {
      const data = projectRowData(row);
      const values = Object.values(data).map((value) => String(value || "").trim().toLowerCase());
      if (values.some((value) => value.includes("project id"))
        && values.some((value) => value.includes("title") || value.includes("players") || value.includes("debit"))) {
        headerRowIndex = row.row_index;
        break;
      }
    }

    return sorted.filter((row) => row.row_index > headerRowIndex);
  }

  function buildMonthlyDebitSheetsTable(partnerRows, cpName, monthFilter = "all", adminLogRows = [], transactions = []) {
    if (!partnerRowsHaveMonthlyDebitSheets(partnerRows)) return null;

    const evaluationMonths = capPartnerEvaluationMonths(
      expandEvaluationMonthSpan(collectMonthlyDebitSheetMonthLabels(partnerRows)),
      partnerRows,
      cpName,
      monthFilter
    );
    if (!evaluationMonths.length) return null;

    const outputRows = [];

    evaluationMonths.forEach((monthValue) => {
      const monthRange = evaluationMonthRange(monthValue);
      if (!monthRange) return;
      if (monthFilter !== "all" && monthRange.label !== monthFilter) return;

      const removedPlayerCounts = buildRemovedPlayerCountMap(adminLogRows, cpName, monthRange);

      getMonthlyDebitSheetDataRows(partnerRows, monthRange.label).forEach((row) => {
        const record = projectRowData(row);
        const projectId = String(projectField(record, "projectId") || recordFieldByHints(record, ["projectid"])).trim();
        const title = String(projectField(record, "title") || recordFieldByHints(record, ["title"])).trim();
        if (!projectId || !title || title === "Title") return;
        if (isDemoInternalRecord(record)) return;
        if (isGametizeProjectEmail(projectContactEmail(record))) return;
        if (!shouldIncludeProjectForMonth(record, monthRange)) return;

        outputRows.push(
          buildFilteredProjectOutputRow(cpName, monthRange, record, removedPlayerCounts)
        );
      });
    });

    if (!outputRows.length) return null;

    return {
      columns: PROJECT_OUTPUT_COLUMNS,
      rows: outputRows,
      source: "monthly-sheets",
      evaluationMonths: evaluationMonths.map((month) => normalizeEvaluationMonthLabel(month))
    };
  }

  function buildProjectStatisticsTable(partnerRows, cpName, monthFilter = "all", adminLogRows = [], transactions = []) {
    const evaluationMonths = capPartnerEvaluationMonths(
      expandEvaluationMonthSpan(relevantEvaluationMonthsForDebit(partnerRows, transactions, cpName, monthFilter)),
      partnerRows,
      cpName,
      monthFilter
    );
    if (!evaluationMonths.length) return null;

    const includeOptions = evaluationMonthIncludeOptions(evaluationMonths);
    const outputRows = [];

    evaluationMonths.forEach((monthValue) => {
      const monthRange = evaluationMonthRange(monthValue);
      if (!monthRange) return;
      if (monthFilter !== "all" && monthRange.label !== monthFilter) return;

      const removedPlayerCounts = buildRemovedPlayerCountMap(adminLogRows, cpName, monthRange);

      filteredProjectRecordsForMonth(partnerRows, monthValue, monthFilter, includeOptions).forEach((row) => {
        outputRows.push(
          buildFilteredProjectOutputRow(cpName, monthRange, projectRowData(row), removedPlayerCounts)
        );
      });
    });

    if (!outputRows.length) return null;

    return {
      columns: PROJECT_OUTPUT_COLUMNS,
      rows: outputRows,
      evaluationMonths: evaluationMonths.map((month) => normalizeEvaluationMonthLabel(month))
    };
  }

  function buildProjectPreviewTable(partnerRows, cpName, monthFilter = "all", adminLogRows = [], transactions = []) {
    const dataRows = getPartnerProjectDataRows(partnerRows);
    if (!dataRows.length) return null;

    const evaluationMonths = relevantEvaluationMonthsForDebit(partnerRows, transactions, cpName, monthFilter);
    if (!evaluationMonths.length) return null;

    const includeOptions = {
      ...evaluationMonthIncludeOptions(evaluationMonths),
      relaxed: true
    };
    const outputRows = [];

    evaluationMonths.forEach((monthValue) => {
      const monthRange = evaluationMonthRange(monthValue);
      if (!monthRange) return;
      if (monthFilter !== "all" && monthRange.label !== monthFilter) return;

      const removedPlayerCounts = buildRemovedPlayerCountMap(adminLogRows, cpName, monthRange);

      dataRows.forEach((row) => {
        const record = projectRowData(row);
        if (!rowBelongsToEvaluationMonth(row, record, monthValue)) return;
        if (!shouldIncludeProjectForMonth(record, monthRange, includeOptions)) return;
        outputRows.push(
          buildFilteredProjectOutputRow(cpName, monthRange, record, removedPlayerCounts)
        );
      });
    });

    if (!outputRows.length) return null;

    const monthCount = new Set(outputRows.map((row) => row.cells[1])).size;

    return {
      columns: PROJECT_OUTPUT_COLUMNS,
      rows: outputRows,
      preview: true,
      previewNote: `Showing ${outputRows.length} project row(s) across ${monthCount} evaluation month(s). Projects without dates are listed under ${includeOptions.undatedAnchorMonth || "the latest month"} only. Add creation/completion dates or an Evaluation Month column for stricter debit filtering.`
    };
  }

  function buildCombinedFilteredProjectTable(
    projectRows,
    partnerFilter = "all",
    monthFilter = "all",
    adminLogRows = [],
    transactions = []
  ) {
    const byPartner = projectRowsByPartner(projectRows, partnerFilter);
    const outputRows = [];
    const evaluationMonths = new Set();
    let previewNote = "";

    byPartner.forEach((rows, cp) => {
      const table = buildMonthlyDebitSheetsTable(rows, cp, monthFilter, adminLogRows, transactions)
        || buildProjectStatisticsTable(rows, cp, monthFilter, adminLogRows, transactions);
      if (!table) return;
      if (table.preview && table.previewNote) previewNote = table.previewNote;
      (table.evaluationMonths || []).forEach((month) => evaluationMonths.add(month));
      outputRows.push(...table.rows);
    });

    if (!outputRows.length && !evaluationMonths.size) return null;

    outputRows.sort((left, right) => {
      const monthDiff = compareEvaluationMonthLabels(left.cells[1], right.cells[1]);
      if (monthDiff) return monthDiff;
      const cpDiff = String(left.cells[0]).localeCompare(String(right.cells[0]));
      if (cpDiff) return cpDiff;
      return String(left.cells[2]).localeCompare(String(right.cells[2]));
    });

    return {
      columns: PROJECT_OUTPUT_COLUMNS,
      rows: outputRows,
      previewNote,
      evaluationMonths: [...evaluationMonths].sort(compareEvaluationMonthLabels)
    };
  }

  function renderHealthAccordionRow(row, partnerFilter) {
    const projectId = row.projectId || "—";
    const title = row.title || row.cells[2] || "—";
    const cpName = row.cpName || row.cells[0] || "";
    const players = formatCredits(row.players ?? row.cells[5] ?? 0);
    const removedPlayers = formatCredits(row.adminLogRemovedPlayers ?? row.removedPlayers ?? row.cells[6] ?? 0);
    const playersIncludingRemoved = formatCredits(
      row.playersIncludingRemoved ?? (toNumber(row.players ?? row.cells[5]) + toNumber(row.adminLogRemovedPlayers ?? row.removedPlayers ?? row.cells[6]))
    );
    const toDebit = formatCreditMoney(row.toDebit);
    const firstCompletion = row.firstCompletionDate || row.cells[4] || "—";
    const lastCompletion = row.lastCompletionDate || "—";
    const duration = formatSubscriptionDuration(
      firstCompletion,
      lastCompletion,
      row.monthLabel || row.cells[1]
    );
    const debited = formatCreditMoney(row.finalDebited);
    const subtitle = partnerFilter === "all" && cpName ? cpName : "";

    return `
      <tr data-waiver-key="${escapeHtml(row.waiverKey)}">
        <td class="credits-health-project-id">${escapeHtml(projectId)}</td>
        <td class="credits-health-project-title">
          <strong>${escapeHtml(title)}</strong>
          ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}
        </td>
        <td class="credits-health-project-date">${escapeHtml(firstCompletion)}</td>
        <td class="credits-health-project-date">${escapeHtml(lastCompletion)}</td>
        <td class="credits-health-project-players">${escapeHtml(players)}</td>
        <td class="credits-health-project-removed">${escapeHtml(removedPlayers)}</td>
        <td class="credits-health-project-total-players">${escapeHtml(playersIncludingRemoved)}</td>
        <td class="credits-health-project-duration">${escapeHtml(duration)}</td>
        <td class="credits-health-project-to-debit">${escapeHtml(toDebit)}</td>
        <td class="credits-health-project-waived">
          <input
            type="number"
            min="0"
            step="1"
            class="credits-health-waived-input"
            data-waiver-key="${escapeHtml(row.waiverKey)}"
            data-to-debit="${row.toDebit}"
            value="${escapeHtml(String(row.waived || ""))}"
            aria-label="Waived amount for ${escapeHtml(title)}"
          >
        </td>
        <td class="credits-health-project-debited">
          <span class="credits-health-debit-badge" data-final-cell="${escapeHtml(row.waiverKey)}">${escapeHtml(debited)}</span>
        </td>
      </tr>
    `;
  }

  function renderHealthMonthTableBody(group, partnerFilter) {
    const monthName = monthNameFromLabel(group.monthLabel);

    return `
      <div class="credits-health-month-table-wrap">
        <table class="credits-health-month-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Title</th>
              <th>First Completion Date</th>
              <th>Last Completion Date</th>
              <th>Players</th>
              <th>Removed Players</th>
              <th>Total Players Incl. Removed</th>
              <th>Subscription Duration</th>
              <th>To Debit</th>
              <th>Waived</th>
              <th>Debited</th>
            </tr>
          </thead>
          <tbody>
            ${group.rows.map((row) => renderHealthAccordionRow(row, partnerFilter)).join("")}
          </tbody>
        </table>
      </div>
      <div class="credits-health-month-footer">
        <span>Total projects in ${escapeHtml(monthName)}: ${group.rows.length}</span>
      </div>
    `;
  }

  function hydrateHealthMonthPanel(panel, partnerFilter = state.partner) {
    const body = panel?.querySelector(".credits-health-month-body");
    if (!body || body.dataset.loaded === "true") return;

    const monthLabel = panel.dataset.month || "";
    const group = state.healthMonthGroups.find((item) => item.monthLabel === monthLabel);
    if (!group) return;

    body.innerHTML = renderHealthMonthTableBody(group, partnerFilter);
    body.dataset.loaded = "true";
  }

  function renderHealthMonthPanel(group, partnerFilter, options = {}) {
    const expanded = options.expanded === true;

    return `
      <section class="credits-health-month-panel${expanded ? " is-expanded" : ""}" data-month="${escapeHtml(group.monthLabel)}">
        <button
          type="button"
          class="credits-health-month-toggle"
          aria-expanded="${expanded ? "true" : "false"}"
        >
          <span class="credits-health-month-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="5" width="18" height="16" rx="2"></rect>
              <path d="M8 3v4M16 3v4M3 10h18"></path>
            </svg>
          </span>
          <span class="credits-health-month-copy">
            <strong>${escapeHtml(group.monthLabel)}</strong>
            <span>${escapeHtml(healthMonthSubtitle(group, partnerFilter))}</span>
          </span>
          ${renderHealthMonthStatusControl(group, partnerFilter)}
          <span class="credits-health-month-total">
            <span class="credits-health-month-total-label">Total Monthly Debit</span>
            <strong class="credits-health-month-total-value">${formatCreditMoney(group.totalDebit)}</strong>
          </span>
          <span class="credits-health-month-chevron" aria-hidden="true"></span>
        </button>
        <div class="credits-health-month-body"${expanded ? ' data-loaded="true"' : ""}>
          ${expanded ? renderHealthMonthTableBody(group, partnerFilter) : ""}
        </div>
      </section>
    `;
  }

  function renderHealthTableCell(column, cell, row) {
    if (column === "Waived") {
      return `
        <td class="credits-health-waived-cell">
          <input
            type="number"
            min="0"
            step="1"
            class="credits-health-waived-input"
            data-waiver-key="${escapeHtml(row.waiverKey)}"
            data-to-debit="${row.toDebit}"
            value="${escapeHtml(String(row.waived || ""))}"
            aria-label="Waived amount"
          >
        </td>
      `;
    }

    if (column === "Final Debited (US$)") {
      return `<td class="credits-health-final-cell" data-final-cell="${escapeHtml(row.waiverKey)}">${escapeHtml(cell)}</td>`;
    }

    if (column === "To Debit") {
      return `<td class="credits-health-debit-cell">${escapeHtml(cell)}</td>`;
    }

    return `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`;
  }

  function renderFilteredProjectTableHtml(table, partnerFilter = "all") {
    const previewNote = table.previewNote
      ? `<p class="credits-project-stats-meta credits-project-stats-preview">${escapeHtml(table.previewNote)}</p>`
      : "";
    const query = creditsSearchQuery();
    const filteredRows = query
      ? table.rows.filter((row) => projectHealthRowMatchesCreditsSearch(row, query))
      : table.rows;

    if (!filteredRows.length) {
      return query
        ? '<p class="empty">No projects match your search.</p>'
        : "";
    }

    const monthGroups = groupHealthRowsByMonth(filteredRows);
    const expectedMonths = table.evaluationMonths?.length
      ? table.evaluationMonths
      : monthGroups.map((group) => group.monthLabel);
    const partnerHint = partnerFilter !== "all"
      ? partnerFilter
      : (filteredRows[0]?.cpName || filteredRows[0]?.cells?.[0] || "");
    state.healthMonthGroups = fillEmptyHealthMonthGroups(monthGroups, expectedMonths, partnerHint);

    const visibleLimit = state.showAllHealthMonths
      ? state.healthMonthGroups.length
      : Math.min(state.healthMonthGroups.length, HEALTH_DEBIT_MONTH_LIMIT);
    const visibleGroups = state.healthMonthGroups.slice(0, visibleLimit);
    const hiddenCount = Math.max(0, state.healthMonthGroups.length - visibleGroups.length);
    const defaultExpandedMonth = state.month !== "all"
      ? state.month
      : visibleGroups[0]?.monthLabel || "";

    return `
      <div class="credits-project-stats-block credits-health-accordion-block">
        ${previewNote}
        <div class="credits-health-accordion">
          ${visibleGroups.map((group) => renderHealthMonthPanel(group, partnerFilter, {
            expanded: group.monthLabel === defaultExpandedMonth
          })).join("")}
        </div>
        ${hiddenCount ? `
          <button type="button" class="credits-health-show-all-months" data-action="show-all-health-months">
            Show ${hiddenCount} older month${hiddenCount === 1 ? "" : "s"}
          </button>
        ` : ""}
      </div>
    `;
  }

  function syncHealthMonthGroupTotal(monthLabel, amount) {
    const group = (state.healthMonthGroups || []).find((item) => item.monthLabel === monthLabel);
    if (group) group.totalDebit = toNumber(amount);
  }

  function renderProjectStatisticsTables(
    projectRows,
    partnerFilter = "all",
    monthFilter = "all",
    adminLogRows = [],
    transactions = []
  ) {
    const table = buildCombinedFilteredProjectTable(
      projectRows,
      partnerFilter,
      monthFilter,
      adminLogRows,
      transactions
    );
    return table ? renderFilteredProjectTableHtml(table, partnerFilter) : "";
  }

  function updateFinalDebitedCell(waiverKey, toDebit, waivedValue) {
    const finalCell = els.healthList?.querySelector(`[data-final-cell="${CSS.escape(waiverKey)}"]`);
    if (!finalCell) return;
    const finalDebited = Math.max(0, toNumber(toDebit) - toNumber(waivedValue));
    finalCell.textContent = formatCreditMoney(finalDebited);

    const panel = finalCell.closest(".credits-health-month-panel");
    if (!panel) return;

    let monthTotal = 0;
    panel.querySelectorAll(".credits-health-waived-input").forEach((input) => {
      const rowToDebit = toNumber(input.dataset.toDebit || 0);
      const rowWaived = toNumber(input.value || 0);
      monthTotal += Math.max(0, rowToDebit - rowWaived);
    });

    const totalEl = panel.querySelector(".credits-health-month-total-value");
    if (totalEl) totalEl.textContent = formatCreditMoney(monthTotal);
    syncHealthMonthGroupTotal(panel.dataset.month || "", monthTotal);
    updateHealthHeadingTotals(state.partner);
  }

  function renderHealthSummary(healthRows) {
    return healthRows.map((partner) => {
      const toneClass = partner.tone === "critical"
        ? "is-critical"
        : partner.tone === "warning"
          ? "is-warning"
          : "";

      return `
        <div class="credits-health-row">
          <div class="credits-health-row-head">
            <strong>${escapeHtml(partner.name)}</strong>
            <span class="${toneClass}">${partner.remainingPct}% Left</span>
          </div>
          ${partner.detail ? `<p class="credits-health-detail">${escapeHtml(partner.detail)}</p>` : ""}
          <div class="track">
            <div class="fill ${toneClass}" style="width:${partner.remainingPct}%"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderHealth(data) {
    if (!els.healthList) return;

    if (state.projectLoading) {
      els.healthList.innerHTML = '<p class="empty">Loading project statistics from Supabase…</p>';
      clearHealthHeadingTotals();
      return;
    }

    if (data.projectReportRows?.length) {
      const projectTablesHtml = renderProjectStatisticsTables(
        data.projectReportRows,
        state.partner,
        state.month,
        data.adminLogReportRows || [],
        data.transactions || []
      );

      if (!projectTablesHtml) {
        const monthHint = state.month !== "all"
          ? ` for ${state.month}`
          : state.partner !== "all"
            ? ` for ${state.partner}`
            : "";
        const filterHint = state.month !== "all" || state.partner !== "all"
          ? " Try setting Month and Partner filters to “All”."
          : "";
        const diagnostics = buildPartnerHealthDiagnostics(
          data.projectReportRows,
          state.partner,
          state.month
        );
        els.healthList.innerHTML = `
          <p class="empty">No projects match the Partner Credit Health filters${escapeHtml(monthHint)}.${escapeHtml(filterHint)}</p>
          <p class="credits-project-stats-meta">${escapeHtml(diagnostics)}</p>
        `;
        clearHealthHeadingTotals();
        return;
      }

      els.healthList.innerHTML = projectTablesHtml;
      updateHealthHeadingTotals(state.partner);
      return;
    }

    clearHealthHeadingTotals();

    const healthRows = filteredPartnerHealth(data);

    if (!healthRows.length) {
      let message = "No project statistics uploaded yet. Upload a Project report to see partner credit health.";
      if (state.partner === "all" && !state.partnerDetailLoaded) {
        message = "Select a partner to load project statistics and detailed partner credit health.";
      } else if (state.projectReportError) {
        message = state.projectReportError;
      } else if (state.projectUploadCount > 0) {
        message = `Found ${state.projectUploadCount} project report upload(s) in Supabase but no row data was loaded. Try re-uploading the Project report for this partner.`;
      } else if (data.partnerHealth.length) {
        message = "No partner health matches your filters.";
      }
      els.healthList.innerHTML = `<p class="empty">${escapeHtml(message)}</p>`;
      return;
    }

    els.healthList.innerHTML = renderHealthSummary(healthRows);
  }

  function renderPagination(totalRows) {
    const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;

    const start = totalRows ? (state.page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.page * state.pageSize, totalRows);

    if (els.paginationSummary) {
      els.paginationSummary.textContent = `Showing ${start} to ${end} of ${numberFmt.format(totalRows)} transactions`;
    }

    if (!els.paginationControls) return;

    const maxButtons = 5;
    const startPage = Math.max(1, Math.min(state.page - 2, totalPages - maxButtons + 1));
    const endPage = Math.min(totalPages, startPage + maxButtons - 1);
    const buttons = [];

    for (let page = startPage; page <= endPage; page += 1) {
      buttons.push(
        `<button type="button" class="credits-page-btn${page === state.page ? " is-active" : ""}" data-page="${page}">${page}</button>`
      );
    }

    els.paginationControls.innerHTML = `
      <button type="button" class="credits-page-btn" data-page="prev" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>
      ${buttons.join("")}
      <button type="button" class="credits-page-btn" data-page="next" ${state.page === totalPages ? "disabled" : ""} aria-label="Next page">›</button>
    `;
  }

  function isGametizeCreditAdjustment(description) {
    return /credit adjustment by gametize/i.test(String(description || ""));
  }

  function findLastGametizeAdjustment(data) {
    return transactionsMatchingFilters(data, false)
      .filter((row) => isGametizeCreditAdjustment(row.description))
      .sort((left, right) => right.dateSort - left.dateSort)[0] || null;
  }

  function renderLastGametizeAdjustment(data) {
    if (!els.lastGametizeAdjustment) return;

    const row = findLastGametizeAdjustment(data);
    if (!row) {
      els.lastGametizeAdjustment.textContent = "";
      els.lastGametizeAdjustment.hidden = true;
      return;
    }

    els.lastGametizeAdjustment.hidden = false;
    els.lastGametizeAdjustment.textContent = `Last Adjustment by Gametize: ${row.date} · ${row.description} · ${row.amountDisplay}`;
  }

  function renderHistory(data) {
    if (!els.historyTableBody) return;

    renderLastGametizeAdjustment(data);

    if (state.loading) {
      els.historyTableBody.innerHTML = '<tr><td colspan="4" class="empty">Loading credit history…</td></tr>';
      renderPagination(0);
      return;
    }

    const rows = filteredTransactions(data);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);

    if (!pageRows.length) {
      const message = state.loadError
        ? state.loadError
        : creditsSearchQuery()
          ? "No transactions match your search."
          : data.transactions.length
            ? "No history matches your filters."
            : "No credit transaction history yet. Upload credit logs to populate this table.";
      els.historyTableBody.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(message)}</td></tr>`;
      renderPagination(0);
      return;
    }

    els.historyTableBody.innerHTML = pageRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.description)}</td>
        <td class="${row.amount < 0 ? "credits-debit" : ""}">${escapeHtml(row.amountDisplay)}</td>
        <td>${escapeHtml(row.cpPartner)}</td>
      </tr>
    `).join("");

    renderPagination(rows.length);
  }

  function formatUploadHistoryDate(iso) {
    return window.DashboardDateFormat?.formatUploadTimestampLocal(iso) || "—";
  }

  function uploadReportTypeLabel(reportType) {
    switch (String(reportType || "").trim()) {
      case "project":
        return "Project report";
      case "admin_logs":
        return "Admin logs";
      case "credit_logs":
        return "Credit logs";
      default:
        return reportType || "—";
    }
  }

  function renderUploadHistory() {
    if (!els.uploadHistory) return;

    const partnerFilter = state.partner === "all" ? "" : state.partner;
    const rows = (state.uploadHistory || []).filter((entry) => {
      if (!partnerFilter) return true;
      return entry.cp === partnerFilter;
    });

    if (!rows.length) {
      els.uploadHistory.innerHTML = `<p class="credits-upload-history-empty">No uploaded files yet${
        partnerFilter ? ` for ${escapeHtml(partnerFilter)}` : ""
      }.</p>`;
      return;
    }

    els.uploadHistory.innerHTML = `
      <div class="table-wrap credits-upload-history-table-wrap">
        <table class="credits-table credits-upload-history-table">
          <thead>
            <tr>
              <th>CP</th>
              <th>Report type</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (entry) => `
              <tr>
                <td>${escapeHtml(entry.cp || "—")}</td>
                <td>${escapeHtml(uploadReportTypeLabel(entry.reportType))}</td>
                <td>${escapeHtml(formatUploadHistoryDate(entry.uploadedAt))}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderStatusMessage(data) {
    if (!els.uploadStatus) return;

    if (state.loading) {
      els.uploadStatus.textContent = "Loading credit usage from Supabase…";
      return;
    }

    if (state.projectLoading) {
      const base = data.transactions.length
        ? `Loaded ${data.transactions.length} credit log row(s). `
        : "";
      els.uploadStatus.textContent = `${base}Loading project statistics…`;
      return;
    }

    if (state.loadError) {
      els.uploadStatus.textContent = state.loadError;
      return;
    }

    if (!data.transactions.length && !data.partnerHealth.length && !data.projectReportRows?.length) {
      if (state.partner === "all" && !state.partnerDetailLoaded && (state.uploadHistory.length || data.partnerBalanceRows?.length)) {
        els.uploadStatus.textContent = "Partner overview loaded. Select a partner to load project statistics.";
        return;
      }
      els.uploadStatus.textContent = "Credit Usage reads from Supabase credit logs only — not Stripe or Xero.";
      return;
    }

    const parts = [];
    if (data.transactions.length) parts.push(`${data.transactions.length} credit log row(s)`);
    if (data.projectReportRows?.length) parts.push(`${data.projectReportRows.length} project stat row(s)`);
    else if (state.projectUploadCount) parts.push(`${state.projectUploadCount} project upload(s) with 0 row(s)`);
    if (data.adminLogReportRows?.length) parts.push(`${data.adminLogReportRows.length} admin log row(s)`);
    else if (state.adminLogUploadCount) parts.push(`${state.adminLogUploadCount} admin log upload(s) with 0 row(s)`);
    if (state.partner === "all" && !state.partnerDetailLoaded) {
      const base = parts.length ? `Loaded ${parts.join(" and ")}. ` : "";
      els.uploadStatus.textContent = `${base}Select a partner to load project statistics.`;
      return;
    }
    if (state.projectReportError && !data.projectReportRows?.length) {
      const base = parts.length ? `Loaded ${parts.join(" and ")}. ` : "";
      els.uploadStatus.textContent = `${base}${state.projectReportError}`;
      return;
    }
    els.uploadStatus.textContent = parts.length
      ? `Loaded ${parts.join(" and ")}.`
      : "Credit Usage reads from Supabase credit logs only — not Stripe or Xero.";
  }

  function render() {
    const data = getData();
    populateFilters();
    renderSummary(data);
    renderPartnerOverview(data);
    renderHistory(data);
    renderHealth(data);
    renderStatusMessage(data);
    renderUploadHistory();
  }

  function applyCreditsSearch() {
    state.page = 1;
    const data = getData();
    renderPartnerOverview(data);
    renderHistory(data);
    renderHealth(data);
  }

  async function loadPartnerOverviewData() {
    if (!window.DashboardAuth?.getPartnerCreditBalances) {
      return 0;
    }

    let balanceRows = [];
    try {
      const balancesPayload = await window.DashboardAuth.getPartnerCreditBalances();
      balanceRows = balancesPayload.rows || [];
    } catch (balanceError) {
      console.warn("Could not load partner credit balances:", balanceError);
    }

    let logRows = allPartnersLogRows;
    const shouldFetchAllLogs = window.DashboardAuth?.getCreditUsageLogs
      && (balanceRowsNeedLogAggregation(balanceRows) || !logRows);

    if (shouldFetchAllLogs) {
      try {
        const logsPayload = await window.DashboardAuth.getCreditUsageLogs();
        logRows = logsPayload.rows || [];
        allPartnersLogRows = logRows;
        if (balanceRowsNeedLogAggregation(balanceRows)) {
          balanceRows = buildPartnerBalanceRowsFromLogs(logRows, balanceRows);
        }
      } catch (logSummaryError) {
        console.warn("Could not load credit usage logs for overview:", logSummaryError);
      }
    }

    state.data = buildCreditsData(
      logRows || [],
      balanceRows,
      state.data.projectReportRows || [],
      state.data.adminLogReportRows || []
    );

    if (window.DashboardAuth.getCreditUploadSummary) {
      try {
        state.uploadHistory = await window.DashboardAuth.getCreditUploadSummary();
      } catch (uploadHistoryError) {
        console.warn("Could not load upload history:", uploadHistoryError);
      }
    }

    return balanceRows.length;
  }

  async function hydrateFromSupabase(options = {}) {
    if (options.force) {
      creditsHydrated = false;
      creditsHydratePromise = null;
      invalidatePartnerScopeCache(options.partner);
    }

    if (creditsHydrated && !options.force) {
      render();
      if (
        !(getData().partnerBalanceRows || []).length
        || (state.partner === "all" && !allPartnersLogRows?.length)
      ) {
        await loadPartnerOverviewData();
        render();
      }
      if (state.partner !== "all" && !state.partnerDetailLoaded) {
        await loadPartnerScopedData(state.partner);
      }
      return creditsHydratePromise;
    }

    if (creditsHydratePromise && !options.force) {
      return creditsHydratePromise;
    }

    creditsHydratePromise = hydrateFromSupabaseInternal(options);
    return creditsHydratePromise;
  }

  async function hydrateFromSupabaseInternal(options = {}) {
    if (!window.DashboardAuth?.getCreditUsageLogs) {
      state.loadError = "Supabase credit usage is not configured.";
      render();
      return;
    }

    state.loading = true;
    state.projectLoading = false;
    state.loadError = "";
    state.projectReportError = "";
    state.projectUploadCount = 0;
    state.adminLogUploadCount = 0;
    state.uploadHistory = [];
    state.healthMonthStatusesReady = false;
    state.partnerDetailLoaded = false;
    if (options.force) {
      allPartnersLogRows = null;
    }
    render();

    const statusPromise = hydrateHealthMonthStatuses();

    try {
      state.data = buildCreditsData([], [], [], []);
      state.uploadHistory = [];
      await loadPartnerOverviewData();
    } catch (error) {
      state.data = emptyData();
      state.loadError = error.message || "Could not load credit usage from Supabase.";
      state.loading = false;
      render();
      return;
    }

    state.loading = false;
    render();

    const partner = options.partner || (state.partner !== "all" ? state.partner : null);
    if (partner) {
      await loadPartnerScopedData(partner, { force: options.force });
    }

    await statusPromise;
    creditsHydrated = true;
    render();
  }

  function bindEvents() {
    els.searchInput?.addEventListener("input", () => {
      state.search = els.searchInput.value;
      applyCreditsSearch();
    });

    els.searchInput?.addEventListener("search", () => {
      state.search = els.searchInput.value;
      applyCreditsSearch();
    });

    els.monthFilter?.addEventListener("change", () => {
      state.month = els.monthFilter.value;
      state.showAllHealthMonths = false;
      state.page = 1;
      const data = getData();
      renderSummary(data);
      renderHistory(data);
      renderHealth(data);
      renderUploadHistory();
    });

    els.partnerOverviewPanel?.addEventListener("click", (event) => {
      const button = event.target.closest(".credits-overview-partner-btn");
      if (!button) return;

      const partner = button.dataset.partner || "";
      if (!partner) return;

      applyPartnerFilter(partner);
    });

    els.partnerFilter?.addEventListener("change", () => {
      applyPartnerFilter(els.partnerFilter.value);
    });

    els.healthList?.addEventListener("click", (event) => {
      const showAllButton = event.target.closest("[data-action='show-all-health-months']");
      if (showAllButton) {
        state.showAllHealthMonths = true;
        renderHealth(getData());
        return;
      }

      const toggle = event.target.closest(".credits-health-month-toggle");
      if (!toggle) return;
      if (event.target.closest(".credits-health-month-status-select, [data-stop-toggle]")) return;

      const panel = toggle.closest(".credits-health-month-panel");
      if (!panel) return;

      const willExpand = !panel.classList.contains("is-expanded");
      els.healthList.querySelectorAll(".credits-health-month-panel").forEach((item) => {
        const expanded = item === panel && willExpand;
        item.classList.toggle("is-expanded", expanded);
        item.querySelector(".credits-health-month-toggle")?.setAttribute("aria-expanded", expanded ? "true" : "false");
      });

      if (willExpand) hydrateHealthMonthPanel(panel, state.partner);
    });

    els.healthList?.addEventListener("input", (event) => {
      const input = event.target.closest(".credits-health-waived-input");
      if (!input) return;

      const waiverKey = input.dataset.waiverKey || "";
      const toDebit = input.dataset.toDebit || "0";
      setWaivedAmount(waiverKey, input.value);
      updateFinalDebitedCell(waiverKey, toDebit, input.value);
    });

    els.healthList?.addEventListener("change", (event) => {
      const statusSelect = event.target.closest(".credits-health-month-status-select");
      if (statusSelect) {
        const monthLabel = statusSelect.dataset.month || "";
        const partnerKey = statusSelect.dataset.partnerKey || "all";
        const partnerFilter = partnerKey === "all" ? "all" : partnerKey;
        setHealthMonthStatus(partnerFilter, monthLabel, statusSelect.value);
        statusSelect.classList.toggle("is-debited", statusSelect.value === "debited");
        statusSelect.classList.toggle("is-pending", statusSelect.value === "pending");
        updateHealthHeadingTotals(partnerFilter);
        return;
      }

      const input = event.target.closest(".credits-health-waived-input");
      if (!input) return;

      const waiverKey = input.dataset.waiverKey || "";
      const toDebit = input.dataset.toDebit || "0";
      const waived = getWaivedAmount(waiverKey);
      input.value = waived ? String(waived) : "";
      updateFinalDebitedCell(waiverKey, toDebit, waived);
    });

    els.paginationControls?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button) return;

      const totalRows = filteredTransactions(getData()).length;
      const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
      const action = button.dataset.page;

      if (action === "prev") state.page = Math.max(1, state.page - 1);
      else if (action === "next") state.page = Math.min(totalPages, state.page + 1);
      else state.page = Number(action);

      renderHistory(getData());
    });

    els.uploadReportButton?.addEventListener("click", openReportUploadModal);
    els.reportUploadCancelButton?.addEventListener("click", closeReportUploadModal);
    els.reportUploadModal?.querySelector("[data-action='close-report']")?.addEventListener("click", closeReportUploadModal);
    els.reportUploadContinueButton?.addEventListener("click", continueReportUpload);
    els.reportTypeSelect?.addEventListener("change", updateReportUploadMonthField);
    els.reportUploadMonthOptionsWrap?.addEventListener("change", (event) => {
      const input = event.target;
      if (input.type !== "checkbox") return;

      if (input.dataset.selectAll === "true") {
        els.reportUploadMonthOptions?.querySelectorAll("input[data-month='true']").forEach((monthInput) => {
          monthInput.checked = input.checked;
        });
        return;
      }

      if (input.dataset.month === "true") {
        updateReportUploadSelectAllState();
      }
    });

    els.uploadCreditLogsButton?.addEventListener("click", openUploadModal);
    els.uploadCancelButton?.addEventListener("click", closeUploadModal);
    els.uploadModal?.querySelector("[data-action='close-credit-logs']")?.addEventListener("click", closeUploadModal);
    els.uploadContinueButton?.addEventListener("click", continueUploadWithPartner);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (els.reportUploadModal && !els.reportUploadModal.hidden) closeReportUploadModal();
      else if (els.uploadModal && !els.uploadModal.hidden) closeUploadModal();
    });

    els.reportFileInput?.addEventListener("change", async () => {
      const file = els.reportFileInput.files?.[0];
      els.reportFileInput.value = "";
      if (!file || !els.uploadStatus) return;

      const upload = selectedReportUpload;
      selectedReportUpload = null;
      if (!upload?.partner || !upload?.reportType) {
        els.uploadStatus.textContent = "Select a partner and report type before uploading.";
        return;
      }

      if (!window.DashboardAuth?.uploadCreditReport) {
        els.uploadStatus.textContent = "Report storage is not configured.";
        return;
      }

      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        els.uploadStatus.textContent = "Upload Report only accepts Excel files (.xlsx or .xls).";
        return;
      }

      state.loading = true;
      render();

      try {
        const stored = await window.DashboardAuth.uploadCreditReport(
          file,
          upload.partner,
          upload.reportType,
          {
            mergeMonthOnly: upload.mergeMonthOnly,
            targetMonths: upload.targetMonths,
            targetMonth: upload.targetMonths?.[0] || ""
          }
        );
        const storedName = stored.storagePath?.split("/").pop() || file.name;
        const updatedMonths = stored.targetMonths?.length
          ? stored.targetMonths
          : (stored.targetMonth ? [stored.targetMonth] : []);
        const monthNote = updatedMonths.length
          ? ` Updated ${updatedMonths.join(", ")} only. Other evaluation months unchanged.`
          : "";
        els.uploadStatus.textContent = `Stored "${storedName}" for ${upload.partner} with ${stored.insertedRows || 0} Excel row(s) in Supabase.${monthNote}`;

        await hydrateFromSupabase({ force: true, partner: upload.partner });
      } catch (error) {
        console.error("Report upload failed:", error);
        state.loadError = "";
        els.uploadStatus.textContent = error.message || "Report upload failed.";
        state.loading = false;
        render();
      }
    });

    els.creditLogsInput?.addEventListener("change", async () => {
      const file = els.creditLogsInput.files?.[0];
      els.creditLogsInput.value = "";
      if (!file || !els.uploadStatus) return;

      const cpPartner = selectedUploadPartner;
      selectedUploadPartner = "";

      if (!cpPartner) {
        els.uploadStatus.textContent = "Select a partner before uploading credit logs.";
        return;
      }

      if (!window.DashboardAuth?.uploadCreditLogs) {
        els.uploadStatus.textContent = "Credit log upload is not configured.";
        return;
      }

      state.loading = true;
      render();

      try {
        const result = await window.DashboardAuth.uploadCreditLogs(file, cpPartner);
        els.uploadStatus.textContent = `Stored ${result.insertedRows || 0} credit log row(s) from ${file.name} for ${cpPartner}.`;
        await hydrateFromSupabase({ force: true, partner: cpPartner });
      } catch (error) {
        state.loadError = "";
        els.uploadStatus.textContent = error.message || "Credit log upload failed.";
        state.loading = false;
        render();
      }
    });

    window.addEventListener("platform-settings-changed", () => {
      renderHealth(getData());
    });
  }

  let cpPartnerNamesCache = null;
  let cpPartnerNamesPromise = null;

  function organizationFromCpRow(row) {
    const fields = [
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
    ];

    for (const field of fields) {
      const value = row?.[field];
      if (value && String(value).trim()) return String(value).trim();
    }

    return "";
  }

  function collectPartnerNames(names) {
    const partners = window.DASHBOARD_DATA?.partnersByOrganization || {};
    Object.keys(partners).forEach((name) => names.add(name));

    if (window.PartnersView?.getPartnerNames) {
      window.PartnersView.getPartnerNames().forEach((name) => names.add(name));
    }

    getData().transactions.forEach((row) => {
      if (row.cpPartner) names.add(row.cpPartner);
    });
  }

  function getPartnerOptions() {
    const names = new Set();
    collectPartnerNames(names);

    if (cpPartnerNamesCache) {
      cpPartnerNamesCache.forEach((name) => names.add(name));
    }

    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function refreshPartnerOptions() {
    cpPartnerNamesCache = null;
    cpPartnerNamesPromise = null;
    populateFilters();
  }

  async function loadPartnerOptions() {
    if (cpPartnerNamesCache) return cpPartnerNamesCache;

    if (!cpPartnerNamesPromise) {
      cpPartnerNamesPromise = (async () => {
        const names = new Set();
        collectPartnerNames(names);

        if (window.DashboardAuth?.getCpContacts) {
          try {
            const payload = await window.DashboardAuth.getCpContacts();
            (payload?.rows || []).forEach((row) => {
              const organization = organizationFromCpRow(row);
              if (organization) names.add(organization);
            });
          } catch (error) {
            console.warn("Could not load CP contacts for partner options:", error);
          }
        }

        cpPartnerNamesCache = [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
        return cpPartnerNamesCache;
      })();
    }

    return cpPartnerNamesPromise;
  }

  async function populatePartnerSelect(selectEl) {
    if (!selectEl) return;

    const partners = await loadPartnerOptions();
    const currentFilter = els.partnerFilter?.value;
    const preferred = currentFilter && currentFilter !== "all" ? currentFilter : "";

    selectEl.innerHTML = [
      '<option value="">Select a partner</option>',
      ...partners.map((partner) => `<option value="${escapeHtml(partner)}">${escapeHtml(partner)}</option>`)
    ].join("");

    if (preferred && partners.includes(preferred)) {
      selectEl.value = preferred;
    }
  }

  async function populateUploadPartnerSelect() {
    await populatePartnerSelect(els.uploadPartnerSelect);
  }

  async function populateReportUploadPartnerSelect() {
    await populatePartnerSelect(els.reportUploadPartnerSelect);
  }

  async function openUploadModal() {
    if (!els.uploadModal) return;
    await populateUploadPartnerSelect();
    els.uploadModal.hidden = false;
    els.uploadPartnerSelect?.focus();
  }

  function closeUploadModal() {
    if (!els.uploadModal) return;
    els.uploadModal.hidden = true;
  }

  function continueUploadWithPartner() {
    const partner = els.uploadPartnerSelect?.value || "";
    if (!partner) {
      if (els.uploadStatus) {
        els.uploadStatus.textContent = "Select a partner before uploading credit logs.";
      }
      els.uploadPartnerSelect?.focus();
      return;
    }

    selectedUploadPartner = partner;
    closeUploadModal();
    els.creditLogsInput?.click();
  }

  function populateReportUploadMonthOptions() {
    if (!els.reportUploadMonthOptions) return;

    const options = [];
    const cursor = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const earliest = new Date(REPORT_UPLOAD_EARLIEST_MONTH);

    while (cursor >= earliest) {
      const label = monthFmt.format(cursor);
      const id = `creditReportMonth-${label.replace(/\s+/g, "-")}`;
      options.push(`
        <label class="credits-modal-month-option" for="${escapeHtml(id)}">
          <input id="${escapeHtml(id)}" type="checkbox" value="${escapeHtml(label)}" data-month="true">
          <span>${escapeHtml(label)}</span>
        </label>
      `);
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }

    els.reportUploadMonthOptions.innerHTML = options.join("");
  }

  function getSelectedReportUploadMonths() {
    return [...(els.reportUploadMonthOptions?.querySelectorAll("input[data-month='true']:checked") || [])]
      .map((input) => input.value)
      .filter(Boolean);
  }

  function updateReportUploadSelectAllState() {
    const monthInputs = [...(els.reportUploadMonthOptions?.querySelectorAll("input[data-month='true']") || [])];
    const selectAll = els.reportUploadMonthSelectAll;
    if (!selectAll || !monthInputs.length) return;

    const checkedCount = monthInputs.filter((input) => input.checked).length;
    selectAll.checked = checkedCount === monthInputs.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < monthInputs.length;
  }

  function clearSelectedReportUploadMonth() {
    if (els.reportUploadMonthSelectAll) {
      els.reportUploadMonthSelectAll.checked = false;
      els.reportUploadMonthSelectAll.indeterminate = false;
    }

    els.reportUploadMonthOptions
      ?.querySelectorAll("input[data-month='true']")
      .forEach((input) => {
        input.checked = false;
      });
  }

  function setReportUploadMonthOptionsEnabled(enabled) {
    if (els.reportUploadMonthOptionsWrap) {
      els.reportUploadMonthOptionsWrap.disabled = !enabled;
    }

    if (!enabled) {
      clearSelectedReportUploadMonth();
    }
  }

  function updateReportUploadMonthField() {
    const isProject = els.reportTypeSelect?.value === "project";

    if (els.reportUploadMonthField) {
      els.reportUploadMonthField.hidden = !isProject;
    }

    if (!isProject) {
      setReportUploadMonthOptionsEnabled(false);
    } else {
      setReportUploadMonthOptionsEnabled(true);
    }
  }

  async function openReportUploadModal() {
    if (!els.reportUploadModal) return;
    await populateReportUploadPartnerSelect();
    populateReportUploadMonthOptions();
    if (els.reportTypeSelect) els.reportTypeSelect.value = "";
    clearSelectedReportUploadMonth();
    setReportUploadMonthOptionsEnabled(false);
    updateReportUploadMonthField();
    els.reportUploadModal.hidden = false;
    els.reportUploadPartnerSelect?.focus();
  }

  function closeReportUploadModal() {
    if (!els.reportUploadModal) return;
    els.reportUploadModal.hidden = true;
  }

  function continueReportUpload() {
    const partner = els.reportUploadPartnerSelect?.value || "";
    const reportType = els.reportTypeSelect?.value || "";

    if (!partner) {
      if (els.uploadStatus) {
        els.uploadStatus.textContent = "Select a partner before uploading a report.";
      }
      els.reportUploadPartnerSelect?.focus();
      return;
    }

    if (!reportType) {
      if (els.uploadStatus) {
        els.uploadStatus.textContent = "Select whether this is a Project or Admin Logs report.";
      }
      els.reportTypeSelect?.focus();
      return;
    }

    if (reportType === "project") {
      const targetMonths = getSelectedReportUploadMonths();
      if (!targetMonths.length) {
        if (els.uploadStatus) {
          els.uploadStatus.textContent = "Select at least one evaluation month to update. Other months will stay unchanged.";
        }
        els.reportUploadMonthOptions?.querySelector("input[data-month='true']")?.focus();
        return;
      }

      selectedReportUpload = {
        partner,
        reportType,
        mergeMonthOnly: true,
        targetMonths
      };
    } else {
      selectedReportUpload = {
        partner,
        reportType,
        mergeMonthOnly: false,
        targetMonth: ""
      };
    }

    closeReportUploadModal();
    els.reportFileInput?.click();
  }

  function partnerSearchText(row) {
    return [row.date, row.description, row.cpPartner, row.actions].join(" ").toLowerCase();
  }

  window.CreditsUsage = {
    render,
    populateFilters,
    refreshPartnerOptions,
    hydrate: hydrateFromSupabase,
    applySearch(query) {
      state.search = String(query || "");
      if (els.searchInput) els.searchInput.value = state.search;
      applyCreditsSearch();
    },
    searchIndex(query) {
      const q = String(query || "").trim().toLowerCase();
      if (!q) return [];

      return getData().transactions
        .filter((row) => partnerSearchText(row).includes(q))
        .slice(0, 6)
        .map((row) => ({
          type: "credit-log",
          title: row.description,
          subtitle: `${row.cpPartner} · ${row.date}`,
          partner: row.cpPartner
        }));
    },
    openResult(item) {
      if (!item) return;
      state.search = "";
      if (els.searchInput) els.searchInput.value = "";
      if (item.partner) {
        applyPartnerFilter(partnerDisplayLabel(item.partner));
        return;
      }
      state.page = 1;
      render();
    }
  };

  async function initCreditsUsagePage() {
    const client = window.DashboardAuth?.getClient?.();
    if (client) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const { data } = await client.auth.getSession();
        if (data.session) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    hydrateFromSupabase();
  }

  bindEvents();
  window.addEventListener("dashboard-partners-changed", refreshPartnerOptions);
  initCreditsUsagePage();
}());
