(function () {
  const STORAGE_KEY = "dashboard-partner-edits";
  const DELETED_PARTNERS_KEY = "dashboard-partner-deleted";

  const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2L15.5 4.5a1.4 1.4 0 0 0-2 0L4 14v4Zm13.5-9.5 2 2M7 17h2l9.5-9.5-2-2L7 15v2Z"></path></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9h2v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z"></path></svg>';

  const STATUS_OPTIONS = ["", "Active", "Dormant", "Inactive"];
  const CREDIT_ACCOUNTING_OPTIONS = ["", "Plans Limit", "User Limit", "Custom"];

  const STATUS_SORT_ORDER = {
    Active: 0,
    Dormant: 1,
    Inactive: 2
  };

  const ORG_FIELD_NAMES = [
    "Organization",
    "Organisation",
    "CP name",
    "CP Name",
    "Partner",
    "Partner Name",
    "Company",
    "Company Name",
    "Channel Partner",
    "Channel Partner name",
    "Account Name",
    "Name"
  ];

  const ORGANIZATION_IDENTITY_GROUPS = [
    {
      label: "DO IT/PMK",
      aliases: [
        "DO IT",
        "DO IT/PMK",
        "DOIT",
        "doit",
        "Doit",
        "doit.mx",
        "PMK Psicomarketing",
        "Psicomarketing"
      ]
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

  const COLUMN_PRIORITY = [
    "Credit Accounting method",
    "Status",
    "Joined Date",
    "Agreement End Date",
    "Contact Emails",
    "Coupon Code",
    "Account Manager",
    "Partners POC",
    "Email Domain",
    "Domain",
    "Contact",
    "Contact Name",
    "Website",
    "Company Website",
    "Alias",
    "Aliases",
    "Short Name",
    "Brand",
    "Brand Name"
  ];

  const CREDIT_ACCOUNTING_COLUMN = "Credit Accounting method";
  const CREDIT_ACCOUNTING_HEADER_LABEL = "Credits Accounting method";

  const COLUMN_IDENTITY_GROUPS = [
    ["creditaccountingmethod", ["Credit Accounting method", "Credit Accounting Method"]],
    ["note", ["Notes", "Note"]],
    ["contactemails", ["Contact Emails", "Contact Emails ", "Email"]],
    ["couponcode", ["Coupon Code", "Coupon Codes"]],
    ["accountmanager", ["Account Manager", "Gametize POC", "Gametize PoC"]],
    ["partnerpocs", ["Partners POC", "CM POCs", "CM POC", "CP POCs", "CP POC"]]
  ];

  const EXCLUDED_COLUMNS = new Set([
    "remarks",
    "sourcesheet",
    "specialrequests",
    // Hide legacy app columns that are no longer relevant
    "apptype",
    "cobrandedapp"
  ]);

  const state = {
    partners: [],
    cpRows: [],
    dbIdsByOrganization: {},
    columns: [],
    search: "",
    editingId: null,
    draft: null,
    sortKey: "Status",
    sortDirection: "asc",
    supabaseLoaded: false,
    saving: false
  };

  const els = {
    searchInput: document.querySelector("#partnersSearch"),
    tableHead: document.querySelector("#partnersTableHead"),
    tableBody: document.querySelector("#partnersTableBody"),
    status: document.querySelector("#partnersStatus"),
    addButton: document.querySelector("#addPartnerButton")
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `partner-${Date.now()}`;
  }

  function normalizeColumnKey(key) {
    return String(key || "").replace(/^\uFEFF/, "").trim();
  }

  function compactFieldName(name) {
    return normalizeColumnKey(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function cpField(row, names) {
    const fields = Object.keys(row || {}).reduce((map, key) => {
      map[compactFieldName(key)] = row[key];
      return map;
    }, {});

    for (const name of names) {
      const value = fields[compactFieldName(name)];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  }

  function organizationFromCpRow(row) {
    return cpField(row, ORG_FIELD_NAMES);
  }

  function organizationCompactName(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function canonicalOrganizationName(value) {
    const text = String(value || "").trim();
    if (!text) return "";

    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    const compact = organizationCompactName(text);

    const group = ORGANIZATION_IDENTITY_GROUPS.find((item) => {
      if (organizationCompactName(item.label) === compact) return true;
      if (item.label.toLowerCase().replace(/\s+/g, " ") === normalized) return true;
      return item.aliases.some((alias) => {
        const aliasNormalized = String(alias).trim().toLowerCase().replace(/\s+/g, " ");
        return aliasNormalized === normalized || organizationCompactName(alias) === compact;
      });
    });

    return group ? group.label : text;
  }

  function isOrgColumnKey(key) {
    return ORG_FIELD_NAMES.some((name) => compactFieldName(name) === compactFieldName(key));
  }

  function isExcludedColumn(key) {
    return EXCLUDED_COLUMNS.has(compactFieldName(key));
  }

  function readEdits() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const migrated = {};

      Object.entries(raw).forEach(([organization, value]) => {
        if (!value || typeof value !== "object") return;
        const canonical = canonicalOrganizationName(organization);

        if (
          value.status !== undefined ||
          value.joinedDate !== undefined ||
          value.agreementEndDate !== undefined ||
          value.note !== undefined
        ) {
        migrated[canonical] = collapseDuplicateFields({
          ...(migrated[canonical] || {}),
          ...(value.status !== undefined ? { Status: value.status } : {}),
          ...(value.joinedDate !== undefined ? { "Joined Date": value.joinedDate } : {}),
          ...(value.agreementEndDate !== undefined ? { "Agreement End Date": value.agreementEndDate } : {}),
          ...(value.note !== undefined ? { Note: value.note } : {}),
          ...(value.fields || {}),
          ...Object.fromEntries(
            Object.entries(value).filter(([key]) =>
              !["status", "joinedDate", "agreementEndDate", "note", "fields"].includes(key)
            )
          )
        });
        return;
      }

      migrated[canonical] = collapseDuplicateFields({
        ...(migrated[canonical] || {}),
        ...value
      });
      });

      return migrated;
    } catch {
      return {};
    }
  }

  function writeEdits(edits) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  }

  function readDeletedPartners() {
    try {
      const raw = JSON.parse(localStorage.getItem(DELETED_PARTNERS_KEY) || "[]");
      return new Set(
        Array.isArray(raw) ? raw.map((name) => canonicalOrganizationName(name)).filter(Boolean) : []
      );
    } catch {
      return new Set();
    }
  }

  function writeDeletedPartners(deletedSet) {
    localStorage.setItem(DELETED_PARTNERS_KEY, JSON.stringify([...deletedSet]));
  }

  function sourcePartners() {
    return (window.DASHBOARD_DATA && window.DASHBOARD_DATA.partnersByOrganization) || {};
  }

  function bundledMetaToFields(meta) {
    return {
      Status: meta?.status || "",
      "Joined Date": meta?.joinedDate || "",
      "Agreement End Date": meta?.agreementEndDate || "",
      Note: meta?.note || ""
    };
  }

  function fieldsToBundledMeta(fields) {
    const status = fields.Status || fields.status || "";
    const joinedDate = fields["Joined Date"] || fields.joinedDate || "";
    const agreementEndDate = fields["Agreement End Date"] || fields.agreementEndDate || "";
    const note = fields.Note || fields.Notes || fields.note || "";
    return { status, joinedDate, agreementEndDate, note };
  }

  function columnIdentityKey(key) {
    const compact = compactFieldName(key);
    const group = COLUMN_IDENTITY_GROUPS.find((item) =>
      item[1].some((alias) => compactFieldName(alias) === compact)
    );
    return group ? group[0] : compact;
  }

  function preferColumnLabel(a, b) {
    const candidates = [a, b].map((key) => normalizeColumnKey(key)).filter(Boolean);
    for (const priority of COLUMN_PRIORITY) {
      const match = candidates.find((key) => columnIdentityKey(key) === columnIdentityKey(priority));
      if (match) return match;
    }
    return candidates.sort((left, right) => left.length - right.length)[0];
  }

  function canonicalColumnKey(key) {
    const normalized = normalizeColumnKey(key);
    if (!normalized) return "";

    const mapped = state.rawToCanonical?.get(compactFieldName(normalized));
    if (mapped) return mapped;

    return normalized;
  }

  function buildColumnCanonicalMap(rawKeys) {
    const variantsByIdentity = new Map();

    rawKeys.forEach((key) => {
      const normalized = normalizeColumnKey(key);
      if (!normalized || isOrgColumnKey(normalized) || isExcludedColumn(normalized)) return;
      const identity = columnIdentityKey(normalized);
      if (!variantsByIdentity.has(identity)) variantsByIdentity.set(identity, []);
      const variants = variantsByIdentity.get(identity);
      if (!variants.includes(normalized)) variants.push(normalized);
    });

    const rawToCanonical = new Map();
    const canonicalKeys = [];

    variantsByIdentity.forEach((variants) => {
      const canonical = variants.reduce((best, current) => preferColumnLabel(best, current));
      canonicalKeys.push(canonical);
      variants.forEach((variant) => {
        rawToCanonical.set(compactFieldName(variant), canonical);
      });
    });

    state.rawToCanonical = rawToCanonical;
    return canonicalKeys;
  }

  function shouldCombineFieldValues(columnKey) {
    const identity = columnIdentityKey(columnKey);
    return identity === "contactemails" || identity === "couponcode" || identity === "accountmanager" || identity === "partnerpocs";
  }

  function splitCombinedValues(value, columnKey) {
    const identity = columnIdentityKey(columnKey);
    const segments = String(value || "")
      .split(/[,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (identity === "accountmanager" || identity === "partnerpocs") return segments;

    return segments.flatMap((part) => part.split(/\s+/).map((token) => token.trim()).filter(Boolean));
  }

  function mergeFieldValues(columnKey, existing, incoming) {
    const left = String(existing || "").trim();
    const right = String(incoming || "").trim();
    if (!left) return right;
    if (!right) return left;
    if (!shouldCombineFieldValues(columnKey) || left === right) return left;

    const parts = new Set([...splitCombinedValues(left, columnKey), ...splitCombinedValues(right, columnKey)]);
    return [...parts].join(", ");
  }

  function assignFieldValue(fields, column, value) {
    const text = normalizePartnerFieldValue(column, value);
    if (!text) return;
    fields[column] = mergeFieldValues(column, fields[column], text);
  }

  function collapseDuplicateFields(fields) {
    const out = {};

    Object.entries(fields || {}).forEach(([key, value]) => {
      const canonical = canonicalColumnKey(key);
      if (!canonical) return;
      assignFieldValue(out, canonical, value);
    });

    return out;
  }

  function orderDisplayColumns(canonicalKeys) {
    const remaining = new Set(canonicalKeys);
    const ordered = [];

    COLUMN_PRIORITY.forEach((key) => {
      const canonical = canonicalColumnKey(key);
      if (remaining.has(canonical)) {
        ordered.push(canonical);
        remaining.delete(canonical);
      }
    });

    const trailing = [];
    [...remaining].forEach((key) => {
      if (columnIdentityKey(key) === "note") {
        trailing.push(key);
        remaining.delete(key);
      }
    });

    return ordered
      .concat([...remaining].sort((a, b) => a.localeCompare(b)))
      .concat(trailing);
  }

  function discoverColumns(rows) {
    const keys = new Set();

    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        const normalized = normalizeColumnKey(key);
      if (normalized && !isOrgColumnKey(normalized) && !isExcludedColumn(normalized)) keys.add(normalized);
      });
    });

    Object.values(sourcePartners()).forEach((meta) => {
      Object.keys(bundledMetaToFields(meta)).forEach((key) => keys.add(key));
    });

    const canonicalKeys = buildColumnCanonicalMap(keys);
    const ordered = orderDisplayColumns(canonicalKeys);
    if (!ordered.some(isCreditAccountingColumn)) {
      return [CREDIT_ACCOUNTING_COLUMN, ...ordered];
    }
    return ordered;
  }

  function groupCpRowsByOrganization(rows) {
    const byOrg = new Map();

    rows.forEach((row) => {
      const organization = canonicalOrganizationName(organizationFromCpRow(row));
      if (!organization) return;

      if (!byOrg.has(organization)) {
        byOrg.set(organization, { organization, fields: {} });
      }

      const entry = byOrg.get(organization);
      Object.entries(row).forEach(([key, value]) => {
        const column = canonicalColumnKey(normalizeColumnKey(key));
        if (!column || isOrgColumnKey(column) || isExcludedColumn(column)) return;
        const text = String(value ?? "").trim();
        if (!text) return;
        assignFieldValue(entry.fields, column, text);
      });
    });

    return byOrg;
  }

  function partnerFieldsForEdits(organization) {
    const partner = state.partners.find((item) => item.organization === organization);
    if (partner) return { ...partner.fields };

    const edits = readEdits()[canonicalOrganizationName(organization)] || {};
    const bundled = bundledMetaToFields(sourcePartners()[organization] || {});
    return { ...bundled, ...edits };
  }

  function partnerDbId(organization) {
    const canonical = canonicalOrganizationName(organization);
    return state.dbIdsByOrganization[canonical]
      || state.dbIdsByOrganization[organization]
      || null;
  }

  function rememberPartnerDbId(organization, dbId, previousOrganization = "") {
    if (!organization || !dbId) return;

    state.dbIdsByOrganization[organization] = dbId;
    const canonical = canonicalOrganizationName(organization);
    if (canonical !== organization) {
      state.dbIdsByOrganization[canonical] = dbId;
    }

    const previous = String(previousOrganization || "").trim();
    if (previous && previous !== organization) {
      delete state.dbIdsByOrganization[previous];
      const previousCanonical = canonicalOrganizationName(previous);
      if (previousCanonical !== previous) {
        delete state.dbIdsByOrganization[previousCanonical];
      }
    }
  }

  function partnerToCpRow(partner) {
    return {
      Organization: partner.organization,
      "CP name": partner.organization,
      ...(partner.fields || {})
    };
  }

  function notifyPartnersChanged() {
    syncDashboardPartners();
    window.dispatchEvent(new CustomEvent("dashboard-partners-changed"));
    window.CreditsUsage?.refreshPartnerOptions?.();
  }

  async function persistPartnerToSupabase(partner, options = {}) {
    if (!window.DashboardAuth?.upsertCpContact) {
      throw new Error("Sign in to save partners to Supabase.");
    }

    const result = await window.DashboardAuth.upsertCpContact(partnerToCpRow(partner), {
      id: partner.dbId || partnerDbId(partner.organization),
      previousOrganization: options.previousOrganization || ""
    });

    if (result?.id) {
      partner.dbId = result.id;
      rememberPartnerDbId(partner.organization, result.id, options.previousOrganization);
    }

    return result;
  }

  async function removePartnerFromSupabase(partner) {
    if (!window.DashboardAuth?.deleteCpContact) {
      throw new Error("Sign in to delete partners from Supabase.");
    }

    const dbId = partner.dbId || partnerDbId(partner.organization);
    if (dbId) {
      await window.DashboardAuth.deleteCpContact({ id: dbId });
      return;
    }

    await window.DashboardAuth.deleteCpContact({ organization: partner.organization });
  }

  function syncDashboardPartners() {
    if (!window.DASHBOARD_DATA) return;

    window.DASHBOARD_DATA.partnersByOrganization = Object.fromEntries(
      state.partners.map((partner) => [partner.organization, fieldsToBundledMeta(partner.fields)])
    );
  }

  function mergePartners() {
    state.columns = discoverColumns(state.cpRows);
    const edits = state.supabaseLoaded ? {} : readEdits();
    const grouped = groupCpRowsByOrganization(state.cpRows);

    Object.entries(sourcePartners()).forEach(([organization, meta]) => {
      const canonical = canonicalOrganizationName(organization);
      if (grouped.has(canonical)) {
        grouped.get(canonical).fields = collapseDuplicateFields({
          ...grouped.get(canonical).fields,
          ...bundledMetaToFields(meta)
        });
        return;
      }

      grouped.set(canonical, {
        organization: canonical,
        fields: bundledMetaToFields(meta)
      });
    });

    if (!state.supabaseLoaded) {
      Object.entries(edits).forEach(([organization, fields]) => {
        const canonical = canonicalOrganizationName(organization);
        if (!grouped.has(canonical)) {
          grouped.set(canonical, { organization: canonical, fields: {} });
        }
        grouped.get(canonical).fields = collapseDuplicateFields({
          ...grouped.get(canonical).fields,
          ...fields
        });
      });
    }

    state.partners = [...grouped.values()]
      .filter((entry) => (
        state.supabaseLoaded
          ? true
          : !readDeletedPartners().has(canonicalOrganizationName(entry.organization))
      ))
      .map((entry) => ({
        id: slugify(entry.organization),
        organization: entry.organization,
        dbId: partnerDbId(entry.organization),
        fields: collapseDuplicateFields({
          ...entry.fields,
          ...(state.supabaseLoaded ? {} : (edits[entry.organization] || {}))
        })
      }));

    syncDashboardPartners();
  }

  function statusColumnKey() {
    return state.columns.find((key) => compactFieldName(key) === "status") || "Status";
  }

  function isCreditAccountingColumn(columnKey) {
    return columnIdentityKey(columnKey) === "creditaccountingmethod";
  }

  function creditAccountingColumnKey() {
    return state.columns.find(isCreditAccountingColumn) || CREDIT_ACCOUNTING_COLUMN;
  }

  function dynamicColumns() {
    return state.columns.filter((column) => !isCreditAccountingColumn(column));
  }

  function noteColumnKey() {
    return state.columns.find((key) => /^notes?$/i.test(compactFieldName(key))) || "Note";
  }

  function fieldValue(partner, columnKey) {
    if (columnKey === "organization") return partner.organization;
    return partner.fields?.[columnKey] || "";
  }

  function isStatusColumn(columnKey) {
    return compactFieldName(columnKey) === "status";
  }

  function isNoteColumn(columnKey) {
    return /^notes?$/i.test(compactFieldName(columnKey));
  }

  function isEmailColumn(columnKey) {
    return /email/i.test(normalizeColumnKey(columnKey));
  }

  function isDateColumn(columnKey) {
    return /date/i.test(normalizeColumnKey(columnKey)) && !isScoringColumn(columnKey);
  }

  function isScoringColumn(columnKey) {
    return /scoring/i.test(normalizeColumnKey(columnKey));
  }

  function isInvalidScoringValue(value) {
    const text = String(value || "").trim();
    if (!text) return true;
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return true;
    if (/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(text)) return true;

    const num = Number(text);
    if (Number.isFinite(num) && num > 30000 && num < 70000) return true;

    return false;
  }

  function formatScoringDisplay(value) {
    const text = String(value ?? "").trim();
    if (!text || isInvalidScoringValue(text)) return "—";

    if (/^\d+\s*\/\s*\d+$/.test(text)) {
      return text.replace(/\s+/g, "");
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
      const num = Number(text);
      if (num >= 0 && num <= 10) {
        return Number.isInteger(num) ? `${num}/10` : `${num}/10`;
      }
    }

    return text;
  }

  function normalizePartnerFieldValue(column, value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (isScoringColumn(column) && isInvalidScoringValue(text)) return "";
    return text;
  }

  function formatDateDisplay(value) {
    return window.DashboardDateFormat?.formatDisplayDateValue(value) || String(value || "");
  }

  function columnCellClass(columnKey) {
    if (isCreditAccountingColumn(columnKey)) return "partners-credit-accounting-cell";
    if (isDateColumn(columnKey)) return "partners-date-cell";
    if (isEmailColumn(columnKey)) return "partners-email-cell";
    if (isNoteColumn(columnKey)) return "partners-note-cell";
    return "";
  }

  function renderDateViewCell(partner, column) {
    const rawValue = fieldValue(partner, column) || "";
    const displayValue = rawValue && rawValue !== "—" ? formatDateDisplay(rawValue) : "";

    return `
      <td class="partners-date-cell">
        <textarea
          class="partners-input partners-date-input partners-date-inline"
          data-partner-id="${escapeHtml(partner.id)}"
          data-column="${escapeHtml(column)}"
          rows="2"
          placeholder="—"
          aria-label="${escapeHtml(column)} for ${escapeHtml(partner.organization)}"
        >${escapeHtml(displayValue)}</textarea>
      </td>
    `;
  }

  function renderCreditAccountingViewCell(partner) {
    const column = creditAccountingColumnKey();
    const value = fieldValue(partner, column) || "";

    return `
      <td class="partners-credit-accounting-cell">
        ${renderCreditAccountingSelect(partner.id, column, value, "partners-credit-accounting-inline")}
      </td>
    `;
  }

  function formatEmailDisplay(value) {
    if (!value || value === "—") return "—";
    return escapeHtml(String(value))
      .split(/[,;]\s*/)
      .filter(Boolean)
      .join("<br>");
  }

  function statusSortRank(status) {
    const key = String(status || "").trim();
    return Object.prototype.hasOwnProperty.call(STATUS_SORT_ORDER, key)
      ? STATUS_SORT_ORDER[key]
      : 99;
  }

  function parsePartnerDate(value) {
    const parsed = window.DashboardDateFormat?.parseFlexibleDate(value);
    return parsed ? parsed.getTime() : null;
  }

  function comparePartners(a, b) {
    const direction = state.sortDirection === "desc" ? -1 : 1;
    let diff = 0;
    const sortKey = state.sortKey;

    if (sortKey === "organization") {
      diff = a.organization.localeCompare(b.organization);
    } else if (isStatusColumn(sortKey)) {
      diff = statusSortRank(fieldValue(a, sortKey)) - statusSortRank(fieldValue(b, sortKey));
    } else if (/date/i.test(sortKey)) {
      const aDate = parsePartnerDate(fieldValue(a, sortKey));
      const bDate = parsePartnerDate(fieldValue(b, sortKey));
      if (aDate === null && bDate === null) diff = 0;
      else if (aDate === null) diff = 1;
      else if (bDate === null) diff = -1;
      else diff = aDate - bDate;
    } else {
      diff = String(fieldValue(a, sortKey)).localeCompare(String(fieldValue(b, sortKey)), undefined, {
        sensitivity: "base"
      });
    }

    if (diff !== 0) return diff * direction;
    return a.organization.localeCompare(b.organization);
  }

  function renderSortButton(label, sortKey) {
    const ariaSort =
      state.sortKey === sortKey
        ? state.sortDirection === "asc"
          ? "ascending"
          : "descending"
        : "none";

    return `
      <button type="button" class="partners-sort-btn" data-sort-key="${escapeHtml(sortKey)}" aria-sort="${ariaSort}">
        <span>${escapeHtml(label)}</span>
        <span class="partners-sort-arrow" aria-hidden="true"><span class="sort-up">▲</span><span class="sort-down">▼</span></span>
      </button>
    `;
  }

  function renderTableHead() {
    if (!els.tableHead) return;

    const headers = [
      `<th scope="col">${renderSortButton("Organization", "organization")}</th>`,
      `<th scope="col" class="partners-credit-accounting-cell">${renderSortButton(CREDIT_ACCOUNTING_HEADER_LABEL, creditAccountingColumnKey())}</th>`,
      ...dynamicColumns().map((column) => {
        const cellClass = columnCellClass(column);
        const classAttr = cellClass ? ` class="${cellClass}"` : "";
        return `<th scope="col"${classAttr}>${renderSortButton(column, column)}</th>`;
      }),
      '<th scope="col">Actions</th>'
    ];

    els.tableHead.innerHTML = `<tr>${headers.join("")}</tr>`;
  }

  function toggleSort(sortKey) {
    if (state.sortKey === sortKey) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = sortKey;
      state.sortDirection = isStatusColumn(sortKey) ? "asc" : "asc";
    }
    render();
  }

  function filteredPartners() {
    const query = state.search.trim().toLowerCase();
    const list = query
      ? state.partners.filter((partner) => partnerSearchText(partner).includes(query))
      : state.partners;

    return list.slice().sort(comparePartners);
  }

  function setStatus(message, type = "") {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.classList.remove("is-error", "is-success");
    if (type) els.status.classList.add(type);
  }

  async function hydratePartnersFromSupabase() {
    if (!window.DashboardAuth?.getCpContacts) {
      mergePartners();
      render();
      return;
    }

    setStatus("Loading partners from Supabase…");

    try {
      const payload = await window.DashboardAuth.getCpContacts();
      state.cpRows = payload?.rows || [];
      state.dbIdsByOrganization = payload?.dbIdsByOrganization || {};
      state.supabaseLoaded = true;

      mergePartners();

      if (!state.columns.includes(state.sortKey)
        && state.sortKey !== "organization"
        && state.sortKey !== creditAccountingColumnKey()) {
        state.sortKey = state.columns.includes(statusColumnKey()) ? statusColumnKey() : "organization";
      }

      syncDashboardPartners();
      notifyPartnersChanged();

      const updatedNote = payload?.updated_at
        ? ` Last updated ${window.DashboardDateFormat?.formatUploadTimestampLocal(payload.updated_at) || payload.updated_at}.`
        : "";
      const warningNote = payload?.warning ? ` ${payload.warning}` : "";

      setStatus(
        state.partners.length
          ? `Loaded ${state.partners.length} partner row(s) from Supabase (${state.columns.length} columns).${updatedNote}${warningNote}`
          : "No partner rows found in Supabase.",
        state.partners.length ? "is-success" : ""
      );
      render();
    } catch (error) {
      mergePartners();
      setStatus(error.message || "Could not load partners from Supabase.", "is-error");
      render();
    }
  }

  async function savePartnerInlineField(partnerId, columnKey, value, successMessage = "Saved.") {
    const partner = state.partners.find((item) => item.id === partnerId);
    if (!partner || state.saving) return;

    const text = String(value || "").trim();
    if ((partner.fields[columnKey] || "") === text) return;

    const previousValue = partner.fields[columnKey] || "";
    partner.fields[columnKey] = text;
    syncDashboardPartners();
    setStatus("Saving…");

    state.saving = true;
    try {
      await persistPartnerToSupabase(partner);
      notifyPartnersChanged();
      setStatus(successMessage, "is-success");
    } catch (error) {
      partner.fields[columnKey] = previousValue;
      syncDashboardPartners();
      setStatus(error.message || "Could not save partner.", "is-error");
      render();
    } finally {
      state.saving = false;
    }
  }

  function savePartnerNote(partnerId, noteValue) {
    savePartnerInlineField(partnerId, noteColumnKey(), noteValue, "Note saved.");
  }

  function savePartnerCreditAccounting(partnerId, value) {
    savePartnerInlineField(
      partnerId,
      creditAccountingColumnKey(),
      value,
      "Credit accounting method saved."
    );
  }

  function startEdit(partner) {
    state.editingId = partner.id;
    state.draft = {
      id: partner.id,
      organization: partner.organization,
      fields: { ...partner.fields }
    };
    render();
  }

  function cancelEdit() {
    state.editingId = null;
    state.draft = null;
    render();
  }

  async function savePartner() {
    if (!state.draft || state.saving) return;

    const organization = canonicalOrganizationName(String(state.draft.organization || "").trim());
    if (!organization) {
      setStatus("Organization name is required.", "is-error");
      return;
    }

    const existing = state.partners.find((partner) => partner.id === state.editingId);
    const previousOrganization = existing?.organization || "";
    const isNewPartner = !existing;
    const duplicate = state.partners.find((partner) => (
      partner.organization === organization && partner.id !== state.editingId
    ));

    if (duplicate) {
      setStatus("A partner with that organization name already exists.", "is-error");
      return;
    }

    const savedFields = {};
    state.columns.forEach((column) => {
      savedFields[column] = String(state.draft.fields?.[column] || "").trim();
    });

    const partner = {
      id: slugify(organization),
      organization,
      dbId: existing?.dbId || partnerDbId(previousOrganization || organization) || null,
      fields: collapseDuplicateFields(savedFields)
    };

    setStatus("Saving partner…");
    state.saving = true;

    try {
      await persistPartnerToSupabase(partner, { previousOrganization });

      if (isNewPartner) {
        state.cpRows.push(partnerToCpRow(partner));
      } else {
        state.cpRows = state.cpRows.map((row) => {
          const rowOrg = canonicalOrganizationName(organizationFromCpRow(row));
          if (rowOrg !== canonicalOrganizationName(previousOrganization || organization)) return row;
          return partnerToCpRow(partner);
        });
      }

      state.editingId = null;
      state.draft = null;
      mergePartners();
      notifyPartnersChanged();
      setStatus(isNewPartner ? "Partner added." : "Partner saved.", "is-success");
      render();
    } catch (error) {
      setStatus(error.message || "Could not save partner.", "is-error");
    } finally {
      state.saving = false;
    }
  }

  async function deletePartner(partner) {
    const name = partner.organization;
    if (!window.confirm(`Remove ${name} from Supabase?`)) return;
    if (state.saving) return;

    setStatus("Deleting partner…");
    state.saving = true;

    try {
      await removePartnerFromSupabase(partner);

      const canonical = canonicalOrganizationName(name);
      state.cpRows = state.cpRows.filter((row) => (
        canonicalOrganizationName(organizationFromCpRow(row)) !== canonical
      ));
      delete state.dbIdsByOrganization[name];
      delete state.dbIdsByOrganization[canonical];

      if (state.editingId === partner.id) {
        state.editingId = null;
        state.draft = null;
      }

      mergePartners();
      notifyPartnersChanged();
      setStatus(`${name} removed.`, "is-success");
      render();
    } catch (error) {
      setStatus(error.message || "Could not delete partner.", "is-error");
    } finally {
      state.saving = false;
    }
  }

  function addPartner() {
    const organization = `New Partner ${state.partners.length + 1}`;
    const fields = Object.fromEntries(state.columns.map((column) => [column, ""]));
    if (state.columns.includes(statusColumnKey())) {
      fields[statusColumnKey()] = "Active";
    }

    state.editingId = slugify(organization);
    state.draft = {
      id: state.editingId,
      organization,
      fields
    };
    render();
  }

  function renderPartnerIconButton(action, partnerId, label) {
    const icon = action === "edit" ? PENCIL_ICON : DELETE_ICON;
    return `
      <button
        type="button"
        class="partners-icon-btn partners-icon-btn-${action}"
        data-action="${action}"
        data-id="${escapeHtml(partnerId)}"
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >${icon}</button>
    `;
  }

  function renderStatusOptions(selected) {
    return STATUS_OPTIONS.map((option) => {
      const label = option || "—";
      const isSelected = option === selected ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${isSelected}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function normalizeCreditAccountingValue(value) {
    const normalized = String(value || "").trim();
    if (normalized === "NA") return "";
    if (normalized === "User Limits") return "User Limit";
    return normalized;
  }

  function renderCreditAccountingOptions(selected) {
    const effective = normalizeCreditAccountingValue(selected);
    const options = [...CREDIT_ACCOUNTING_OPTIONS];
    if (effective && !options.includes(effective)) {
      options.push(effective);
    }

    return options.map((option) => {
      const label = option || "—";
      const isSelected = option === effective ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${isSelected}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function renderCreditAccountingSelect(partnerId, column, value, extraClass = "") {
    const classNames = [
      "partners-input",
      "partners-credit-accounting-select",
      extraClass
    ].filter(Boolean).join(" ");
    const partnerAttr = partnerId ? ` data-partner-id="${escapeHtml(partnerId)}"` : "";

    return `
      <select
        class="${classNames}"
        data-column="${escapeHtml(column)}"
        ${partnerAttr}
        aria-label="${escapeHtml(CREDIT_ACCOUNTING_HEADER_LABEL)}"
      >
        ${renderCreditAccountingOptions(value)}
      </select>
    `;
  }

  function renderFieldInput(column, value) {
    if (isStatusColumn(column)) {
      return `
        <select class="partners-input" data-column="${escapeHtml(column)}">
          ${renderStatusOptions(value)}
        </select>
      `;
    }

    if (isNoteColumn(column)) {
      return `<textarea class="partners-input partners-note-input" data-column="${escapeHtml(column)}" rows="2">${escapeHtml(value)}</textarea>`;
    }

    if (isCreditAccountingColumn(column)) {
      return renderCreditAccountingSelect("", column, value);
    }

    if (isDateColumn(column)) {
      return `<textarea class="partners-input partners-date-input" data-column="${escapeHtml(column)}" rows="2">${escapeHtml(value)}</textarea>`;
    }

    if (isScoringColumn(column)) {
      const displayValue = formatScoringDisplay(value);
      const editValue = displayValue === "—" ? "" : displayValue;
      return `<input class="partners-input partners-scoring-input" data-column="${escapeHtml(column)}" inputmode="decimal" value="${escapeHtml(editValue)}">`;
    }

    if (isEmailColumn(column)) {
      return `<textarea class="partners-input partners-email-input" data-column="${escapeHtml(column)}" rows="2">${escapeHtml(value)}</textarea>`;
    }

    return `<input class="partners-input" data-column="${escapeHtml(column)}" value="${escapeHtml(value)}">`;
  }

  function renderViewCell(partner, column) {
    const value = fieldValue(partner, column) || "—";

    if (isStatusColumn(column)) {
      return `<td><span class="partners-status-badge ${statusClass(value)}">${escapeHtml(value === "—" ? "—" : value)}</span></td>`;
    }

    if (isNoteColumn(column)) {
      return `
        <td class="partners-note-cell">
          <textarea
            class="partners-input partners-note-input partners-note-inline"
            data-partner-id="${escapeHtml(partner.id)}"
            rows="2"
            placeholder="Add a note..."
            aria-label="Note for ${escapeHtml(partner.organization)}"
          >${escapeHtml(value === "—" ? "" : value)}</textarea>
        </td>
      `;
    }

    if (isEmailColumn(column)) {
      return `<td class="partners-email-cell">${formatEmailDisplay(value === "—" ? "" : value)}</td>`;
    }

    if (isDateColumn(column)) {
      return renderDateViewCell(partner, column);
    }

    if (isScoringColumn(column)) {
      const displayValue = formatScoringDisplay(value === "—" ? "" : value);
      return `<td class="partners-scoring-cell">${escapeHtml(displayValue)}</td>`;
    }

    const displayValue = value;
    const cellClass = columnCellClass(column);
    const classAttr = cellClass ? ` class="${cellClass}"` : "";
    return `<td${classAttr}>${escapeHtml(displayValue)}</td>`;
  }

  function renderRow(partner) {
    const isEditing = state.editingId === partner.id && state.draft;
    const row = isEditing ? state.draft : partner;

    if (isEditing) {
      return `
        <tr class="is-editing">
          <td><input class="partners-input" data-field="organization" value="${escapeHtml(row.organization)}"></td>
          <td class="partners-credit-accounting-cell">${renderFieldInput(creditAccountingColumnKey(), row.fields?.[creditAccountingColumnKey()] || "")}</td>
          ${dynamicColumns().map((column) => {
            const cellClass = columnCellClass(column);
            const classAttr = cellClass ? ` class="${cellClass}"` : "";
            return `<td${classAttr}>${renderFieldInput(column, row.fields?.[column] || "")}</td>`;
          }).join("")}
          <td class="partners-actions">
            <button type="button" class="partners-btn partners-btn-save" data-action="save">Save</button>
            <button type="button" class="partners-btn partners-btn-cancel" data-action="cancel">Cancel</button>
          </td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${escapeHtml(partner.organization)}</td>
        ${renderCreditAccountingViewCell(partner)}
        ${dynamicColumns().map((column) => renderViewCell(partner, column)).join("")}
        <td class="partners-actions">
          ${renderPartnerIconButton("edit", partner.id, `Edit ${partner.organization}`)}
          ${renderPartnerIconButton("delete", partner.id, `Delete ${partner.organization}`)}
        </td>
      </tr>
    `;
  }

  function statusClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "active") return "is-active";
    if (normalized === "inactive") return "is-inactive";
    if (normalized === "dormant") return "is-dormant";
    return "";
  }

  function tableColumnCount() {
    return dynamicColumns().length + 3;
  }

  function render() {
    if (!els.tableBody) return;

    renderTableHead();

    const rows = filteredPartners();
    const draftOnly =
      state.draft &&
      !rows.some((partner) => partner.id === state.editingId);

    const html = rows.map(renderRow).join("");
    const draftRow = draftOnly ? renderRow(state.draft) : "";

    if (!html && !draftRow) {
      els.tableBody.innerHTML = `<tr><td colspan="${tableColumnCount()}" class="empty">No partners found.</td></tr>`;
      return;
    }

    els.tableBody.innerHTML = draftRow + html;
  }

  function bindTableEvents() {
    els.tableHead?.addEventListener("click", (event) => {
      const button = event.target.closest(".partners-sort-btn");
      if (!button) return;
      toggleSort(button.dataset.sortKey);
    });

    els.tableBody?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "save") {
        syncDraftFromInputs();
        void savePartner();
        return;
      }

      if (action === "cancel") {
        cancelEdit();
        return;
      }

      if (action === "edit") {
        const partner = state.partners.find((item) => item.id === button.dataset.id);
        if (partner) startEdit(partner);
        return;
      }

      if (action === "delete") {
        const partner = state.partners.find((item) => item.id === button.dataset.id);
        if (partner) void deletePartner(partner);
      }
    });

    els.tableBody?.addEventListener("blur", (event) => {
      const noteTextarea = event.target.closest(".partners-note-inline");
      if (noteTextarea) {
        void savePartnerNote(noteTextarea.dataset.partnerId, noteTextarea.value);
        return;
      }

      const dateTextarea = event.target.closest(".partners-date-inline");
      if (dateTextarea) {
        void savePartnerInlineField(
          dateTextarea.dataset.partnerId,
          dateTextarea.dataset.column,
          dateTextarea.value,
          "Date saved."
        );
      }
    }, true);

    els.tableBody?.addEventListener("keydown", (event) => {
      const textarea = event.target.closest(".partners-note-inline, .partners-date-inline");
      if (!textarea) return;
      if (event.key === "Escape") {
        const partner = state.partners.find((item) => item.id === textarea.dataset.partnerId);
        const column = textarea.dataset.column || noteColumnKey();
        const resetValue = partner
          ? (isDateColumn(column) && fieldValue(partner, column) !== "—"
            ? formatDateDisplay(fieldValue(partner, column))
            : fieldValue(partner, column))
          : "";
        textarea.value = resetValue === "—" ? "" : resetValue;
        textarea.blur();
      }
    });

    els.tableBody?.addEventListener("input", (event) => {
      if (!state.draft) return;
      const column = event.target.dataset.column;
      if (column) {
        state.draft.fields[column] = event.target.value;
        return;
      }
      if (event.target.dataset.field === "organization") {
        state.draft.organization = event.target.value;
      }
    });

    els.tableBody?.addEventListener("change", (event) => {
      const creditSelect = event.target.closest(".partners-credit-accounting-inline");
      if (creditSelect && !creditSelect.closest(".is-editing")) {
        void savePartnerCreditAccounting(creditSelect.dataset.partnerId, creditSelect.value);
        return;
      }

      if (!state.draft) return;
      const column = event.target.dataset.column;
      if (column) state.draft.fields[column] = event.target.value;
    });
  }

  function syncDraftFromInputs() {
    if (!state.draft || !els.tableBody) return;

    els.tableBody.querySelectorAll(".is-editing [data-field]").forEach((input) => {
      if (input.dataset.field === "organization") {
        state.draft.organization = input.value;
      }
    });

    els.tableBody.querySelectorAll(".is-editing [data-column]").forEach((input) => {
      state.draft.fields[input.dataset.column] = input.value;
    });
  }

  function bindEvents() {
    els.searchInput?.addEventListener("input", () => {
      state.search = els.searchInput.value;
      render();
    });

    els.addButton?.addEventListener("click", addPartner);
    bindTableEvents();
  }

  function partnerSearchText(partner) {
    return [partner.organization, ...Object.values(partner.fields || {})]
      .join(" ")
      .toLowerCase();
  }

  function getPartnerNames() {
    mergePartners();
    return state.partners.map((partner) => partner.organization);
  }

  window.PartnersView = {
    getPartnerNames,
    render() {
      hydratePartnersFromSupabase();
    },
    applySearch(query) {
      state.search = String(query || "");
      if (els.searchInput) els.searchInput.value = state.search;
      render();
    },
    searchIndex(query) {
      const q = String(query || "").trim().toLowerCase();
      if (!q) return [];

      mergePartners();

      return state.partners
        .filter((partner) => partnerSearchText(partner).includes(q))
        .slice(0, 6)
        .map((partner) => ({
          type: "partner",
          title: partner.organization,
          subtitle: [
            fieldValue(partner, statusColumnKey()),
            fieldValue(partner, noteColumnKey()),
            formatDateDisplay(fieldValue(partner, "Joined Date"))
          ].filter(Boolean).join(" · "),
          organization: partner.organization,
          partnerId: partner.id
        }));
    },
    openResult(item) {
      if (!item) return;
      state.search = item.organization || "";
      if (els.searchInput) els.searchInput.value = state.search;
      render();
      const row = els.tableBody?.querySelector(`button[data-id="${item.partnerId}"]`)?.closest("tr");
      row?.scrollIntoView({ block: "nearest" });
    }
  };

  bindEvents();
  mergePartners();
  render();
  hydratePartnersFromSupabase();
}());
