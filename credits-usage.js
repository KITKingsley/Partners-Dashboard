(function () {
  const emptyData = () => ({
    totalAllocated: 0,
    remainingBalance: 0,
    allocatedChangePct: 0,
    transactions: [],
    partnerHealth: [],
    projectReportRows: []
  });

  const state = {
    search: "",
    month: "all",
    partner: "all",
    page: 1,
    pageSize: 6,
    filtersReady: false,
    loading: false,
    loadError: "",
    data: emptyData()
  };

  const els = {
    totalAllocated: document.querySelector("#creditsTotalAllocated"),
    remainingBalance: document.querySelector("#creditsRemainingBalance"),
    allocatedChange: document.querySelector("#creditsAllocatedChange"),
    balanceBar: document.querySelector("#creditsBalanceBar"),
    searchInput: document.querySelector("#creditsSearch"),
    monthFilter: document.querySelector("#creditsMonthFilter"),
    partnerFilter: document.querySelector("#creditsPartnerFilter"),
    historyTableBody: document.querySelector("#creditsHistoryRows"),
    paginationSummary: document.querySelector("#creditsPaginationSummary"),
    paginationControls: document.querySelector("#creditsPaginationControls"),
    healthList: document.querySelector("#creditsHealthList"),
    creditLogsInput: document.querySelector("#creditLogsFileInput"),
    uploadCreditLogsButton: document.querySelector("#uploadCreditLogsButton"),
    uploadReportButton: document.querySelector("#uploadCreditsReportButton"),
    uploadStatus: document.querySelector("#creditsUploadStatus"),
    uploadModal: document.querySelector("#creditUploadModal"),
    uploadPartnerSelect: document.querySelector("#creditUploadPartnerSelect"),
    uploadCancelButton: document.querySelector("#creditUploadCancelButton"),
    uploadContinueButton: document.querySelector("#creditUploadContinueButton"),
    reportUploadModal: document.querySelector("#creditReportUploadModal"),
    reportUploadPartnerSelect: document.querySelector("#creditReportUploadPartnerSelect"),
    reportTypeSelect: document.querySelector("#creditReportTypeSelect"),
    reportUploadCancelButton: document.querySelector("#creditReportUploadCancelButton"),
    reportUploadContinueButton: document.querySelector("#creditReportUploadContinueButton"),
    reportFileInput: document.querySelector("#creditReportFileInput")
  };

  let selectedUploadPartner = "";
  let selectedReportUpload = null;

  const numberFmt = new Intl.NumberFormat("en-US");
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
    const text = String(value || "").trim();
    if (!text) return null;
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`);
    }
    const dmyMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dmyMatch) {
      const parsed = new Date(`${dmyMatch[3]} ${dmyMatch[2]} ${dmyMatch[1]} 00:00:00 UTC`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatShortDate(value) {
    const date = parseDate(value);
    if (!date) return "—";
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
  }

  function formatMonthLabel(value) {
    const date = parseDate(value);
    return date ? monthFmt.format(date) : "—";
  }

  function formatAmount(amount) {
    const value = toNumber(amount);
    if (!value) return "—";
    const prefix = value < 0 ? "-" : "";
    return `${prefix}$${numberFmt.format(Math.abs(value))}`;
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

  function partnerCreditFromLogs(transactions, partner) {
    const partnerTx = transactions.filter((row) => row.cpPartner === partner);
    const balance = partnerTx
      .filter((row) => /account balance as of/i.test(row.description))
      .sort((a, b) => b.dateSort - a.dateSort)[0];
    const allocated = partnerTx
      .filter((row) => row.amount > 0)
      .reduce((sum, row) => sum + row.amount, 0);

    return {
      allocated,
      remaining: balance ? balance.amount : 0
    };
  }

  function aggregateProjectStats(rows) {
    const stats = {
      projectCount: 0,
      totalPlayers: 0,
      activePlayers: 0,
      publishedCount: 0,
      totalCompletions: 0
    };

    rows.forEach((row) => {
      const data = projectRowData(row);
      const title = String(pick(data, ["Title", "Project", "project"], "")).trim();
      if (!title || title === "Title") return;

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

  function buildPartnerHealthFromProjectReports(projectRows, transactions, partnerFilter = "all") {
    const byPartner = new Map();

    projectRows.forEach((row) => {
      const cp = String(row.cp || "").trim();
      if (!cp) return;
      if (!byPartner.has(cp)) byPartner.set(cp, []);
      byPartner.get(cp).push(row);
    });

    const entries = [];

    byPartner.forEach((rows, cp) => {
      if (partnerFilter !== "all" && cp !== partnerFilter) return;

      if (partnerFilter !== "all") {
        rows.forEach((row) => {
          const data = projectRowData(row);
          const title = String(pick(data, ["Title", "Project", "project"], "")).trim();
          if (!title || title === "Title") return;

          const players = toNumber(pick(data, ["Players", "players"], 0));
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
        return;
      }

      const stats = aggregateProjectStats(rows);
      const credit = partnerCreditFromLogs(transactions, cp);

      let remainingPct;
      let detail;

      if (credit.allocated > 0) {
        remainingPct = Math.max(0, Math.min(100, Math.round((credit.remaining / credit.allocated) * 100)));
        detail = `${formatCredits(credit.remaining)} of ${formatCredits(credit.allocated)} credits · ${stats.projectCount} projects`;
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

  function buildCreditsData(logRows, balanceRows, projectRows = []) {
    const transactions = logRows
      .map(normalizeLogRow)
      .sort((a, b) => b.dateSort - a.dateSort);

    const balanceHealth = buildPartnerHealth(balanceRows);
    const projectHealth = buildPartnerHealthFromProjectReports(projectRows, transactions);
    const partnerHealth = projectHealth.length ? projectHealth : balanceHealth;

    const positiveAdjustments = transactions
      .filter((row) => row.amount > 0)
      .reduce((sum, row) => sum + row.amount, 0);

    const balanceSnapshot = transactions
      .filter((row) => /account balance as of/i.test(row.description))
      .sort((a, b) => b.dateSort - a.dateSort)[0];

    const remainingBalance = balanceSnapshot
      ? balanceSnapshot.amount
      : balanceRows.reduce(
        (sum, row) => sum + toNumber(pick(row, ["credits_remaining", "creditsRemaining", "remaining"], 0)),
        0
      );

    const totalAllocated = positiveAdjustments || balanceRows.reduce(
      (sum, row) => sum + toNumber(pick(row, ["credits_allocated", "creditsAllocated", "allocated"], 0)),
      0
    );

    const monthTotals = new Map();
    const monthOrder = [];
    transactions.forEach((row) => {
      if (row.amount <= 0) return;
      if (!monthTotals.has(row.month)) monthOrder.push(row.month);
      monthTotals.set(row.month, (monthTotals.get(row.month) || 0) + row.amount);
    });
    const currentMonthTotal = monthOrder.length ? monthTotals.get(monthOrder[0]) || 0 : 0;
    const previousMonthTotal = monthOrder.length > 1 ? monthTotals.get(monthOrder[1]) || 0 : 0;
    const allocatedChangePct = previousMonthTotal
      ? Math.round(((currentMonthTotal - previousMonthTotal) / previousMonthTotal) * 100)
      : 0;

    return {
      totalAllocated,
      remainingBalance,
      allocatedChangePct,
      transactions,
      partnerHealth: partnerHealth.slice(0, 8),
      projectReportRows: projectRows
    };
  }

  function filteredPartnerHealth(data) {
    if (data.projectReportRows?.length) {
      return buildPartnerHealthFromProjectReports(
        data.projectReportRows,
        data.transactions,
        state.partner
      ).slice(0, 8);
    }

    let health = data.partnerHealth || [];
    if (state.partner !== "all") {
      health = health.filter((entry) => entry.partner === state.partner || entry.name === state.partner);
    }
    return health;
  }

  function getData() {
    return state.data;
  }

  function formatCredits(value) {
    return numberFmt.format(Math.round(value));
  }

  function uniqueMonths(data) {
    return [...new Set(data.transactions.map((row) => row.month))];
  }

  function uniquePartners(data) {
    const partners = new Set(data.transactions.map((row) => row.cpPartner));
    (data.projectReportRows || []).forEach((row) => {
      if (row.cp) partners.add(row.cp);
    });
    return [...partners].filter(Boolean).sort();
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
    uniquePartners(data).forEach((partner) => {
      const option = document.createElement("option");
      option.value = partner;
      option.textContent = partner;
      els.partnerFilter.appendChild(option);
    });

    if (!state.filtersReady) {
      state.month = "all";
      state.partner = "all";
      state.filtersReady = true;
    }

    els.monthFilter.value = state.month;
    els.partnerFilter.value = state.partner;
  }

  function filteredTransactions(data) {
    const query = state.search.trim().toLowerCase();

    return data.transactions.filter((row) => {
      if (state.month !== "all" && row.month !== state.month) return false;
      if (state.partner !== "all" && row.cpPartner !== state.partner) return false;
      if (!query) return true;

      return [
        row.month,
        row.description,
        row.cpPartner,
        row.actions
      ].some((value) => String(value).toLowerCase().includes(query));
    });
  }

  function renderSummary(data) {
    if (!els.totalAllocated) return;

    const usedPct = data.totalAllocated
      ? Math.max(0, Math.min(100, (data.remainingBalance / data.totalAllocated) * 100))
      : 0;

    els.totalAllocated.textContent = formatCredits(data.totalAllocated);
    els.remainingBalance.textContent = formatCredits(data.remainingBalance);
    const changePrefix = data.allocatedChangePct > 0 ? "+" : "";
    els.allocatedChange.textContent = `${changePrefix}${data.allocatedChangePct}% from last month`;
    if (els.balanceBar) {
      els.balanceBar.style.width = `${usedPct.toFixed(1)}%`;
    }
  }

  function renderHealth(data) {
    if (!els.healthList) return;

    const healthRows = filteredPartnerHealth(data);

    if (!healthRows.length) {
      const message = data.projectReportRows?.length || data.partnerHealth.length
        ? "No partner health matches your filters."
        : "No project statistics uploaded yet. Upload a Project report to see partner credit health.";
      els.healthList.innerHTML = `<p class="empty">${escapeHtml(message)}</p>`;
      return;
    }

    els.healthList.innerHTML = healthRows.map((partner) => {
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

  function renderHistory(data) {
    if (!els.historyTableBody) return;

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

  function renderStatusMessage(data) {
    if (!els.uploadStatus) return;

    if (state.loading) {
      els.uploadStatus.textContent = "Loading credit usage from Supabase…";
      return;
    }

    if (state.loadError) {
      els.uploadStatus.textContent = state.loadError;
      return;
    }

    if (!data.transactions.length && !data.partnerHealth.length && !data.projectReportRows?.length) {
      els.uploadStatus.textContent = "Credit Usage reads from Supabase credit logs only — not Stripe or Xero.";
      return;
    }

    const parts = [];
    if (data.transactions.length) parts.push(`${data.transactions.length} credit log row(s)`);
    if (data.projectReportRows?.length) parts.push(`${data.projectReportRows.length} project stat row(s)`);
    els.uploadStatus.textContent = parts.length
      ? `Loaded ${parts.join(" and ")}.`
      : "Credit Usage reads from Supabase credit logs only — not Stripe or Xero.";
  }

  function render() {
    const data = getData();
    populateFilters();
    renderSummary(data);
    renderHistory(data);
    renderHealth(data);
    renderStatusMessage(data);
  }

  async function hydrateFromSupabase() {
    if (!window.DashboardAuth?.getCreditUsageLogs) {
      state.loadError = "Supabase credit usage is not configured.";
      render();
      return;
    }

    state.loading = true;
    state.loadError = "";
    render();

    try {
      const logsPayload = await window.DashboardAuth.getCreditUsageLogs();
      let balanceRows = [];
      let projectRows = [];

      try {
        const balancesPayload = await window.DashboardAuth.getPartnerCreditBalances();
        balanceRows = balancesPayload.rows || [];
      } catch (balanceError) {
        console.warn("Could not load partner credit balances:", balanceError);
      }

      if (window.DashboardAuth.getLatestProjectReportRows) {
        try {
          const projectPayload = await window.DashboardAuth.getLatestProjectReportRows();
          projectRows = projectPayload.rows || [];
        } catch (projectError) {
          console.warn("Could not load project statistics rows:", projectError);
        }
      }

      state.data = buildCreditsData(logsPayload.rows || [], balanceRows, projectRows);
    } catch (error) {
      state.data = emptyData();
      state.loadError = error.message || "Could not load credit usage logs from Supabase.";
    } finally {
      state.loading = false;
      render();
    }
  }

  function bindEvents() {
    els.searchInput?.addEventListener("input", () => {
      state.search = els.searchInput.value;
      state.page = 1;
      const data = getData();
      renderHistory(data);
    });

    els.monthFilter?.addEventListener("change", () => {
      state.month = els.monthFilter.value;
      state.page = 1;
      renderHistory(getData());
    });

    els.partnerFilter?.addEventListener("change", () => {
      state.partner = els.partnerFilter.value;
      state.page = 1;
      const data = getData();
      renderHistory(data);
      renderHealth(data);
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
          upload.reportType
        );
        const storedName = stored.storagePath?.split("/").pop() || file.name;
        els.uploadStatus.textContent = `Stored "${storedName}" for ${upload.partner} with ${stored.insertedRows || 0} Excel row(s) in Supabase.`;
        if (upload.reportType === "project") {
          await hydrateFromSupabase();
        } else {
          state.loading = false;
          render();
        }
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
        await hydrateFromSupabase();
      } catch (error) {
        state.loadError = "";
        els.uploadStatus.textContent = error.message || "Credit log upload failed.";
        state.loading = false;
        render();
      }
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

  async function openReportUploadModal() {
    if (!els.reportUploadModal) return;
    await populateReportUploadPartnerSelect();
    if (els.reportTypeSelect) els.reportTypeSelect.value = "";
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

    selectedReportUpload = { partner, reportType };
    closeReportUploadModal();
    els.reportFileInput?.click();
  }

  function partnerSearchText(row) {
    return [row.date, row.description, row.cpPartner, row.actions].join(" ").toLowerCase();
  }

  window.CreditsUsage = {
    render,
    populateFilters,
    hydrate: hydrateFromSupabase,
    applySearch(query) {
      state.search = String(query || "");
      if (els.searchInput) els.searchInput.value = state.search;
      state.page = 1;
      renderHistory(getData());
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
      state.search = item.partner || "";
      if (els.searchInput) els.searchInput.value = state.search;
      if (item.partner) {
        state.partner = item.partner;
        if (els.partnerFilter) els.partnerFilter.value = item.partner;
      }
      state.page = 1;
      render();
    }
  };

  bindEvents();
  hydrateFromSupabase();
}());
