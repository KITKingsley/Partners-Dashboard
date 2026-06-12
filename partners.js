(function () {
  const STORAGE_KEY = "dashboard-partner-edits";

  const STATUS_OPTIONS = ["", "Active", "Inactive", "Dormant"];

  const state = {
    partners: [],
    search: "",
    editingId: null,
    draft: null
  };

  const els = {
    searchInput: document.querySelector("#partnersSearch"),
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

  function readEdits() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeEdits(edits) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  }

  function sourcePartners() {
    return (window.DASHBOARD_DATA && window.DASHBOARD_DATA.partnersByOrganization) || {};
  }

  function mergePartners() {
    const edits = readEdits();
    const merged = { ...sourcePartners(), ...edits };

    state.partners = Object.entries(merged)
      .map(([organization, meta]) => ({
        id: slugify(organization),
        organization,
        status: meta?.status || "",
        joinedDate: meta?.joinedDate || "",
        agreementEndDate: meta?.agreementEndDate || ""
      }))
      .sort((a, b) => a.organization.localeCompare(b.organization));

    if (window.DASHBOARD_DATA) {
      window.DASHBOARD_DATA.partnersByOrganization = Object.fromEntries(
        state.partners.map((partner) => [
          partner.organization,
          {
            status: partner.status,
            joinedDate: partner.joinedDate,
            agreementEndDate: partner.agreementEndDate
          }
        ])
      );
    }
  }

  function filteredPartners() {
    const query = state.search.trim().toLowerCase();
    if (!query) return state.partners;

    return state.partners.filter((partner) =>
      [partner.organization, partner.status, partner.joinedDate, partner.agreementEndDate]
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }

  function setStatus(message, type = "") {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.classList.remove("is-error", "is-success");
    if (type) els.status.classList.add(type);
  }

  function startEdit(partner) {
    state.editingId = partner.id;
    state.draft = { ...partner };
    render();
  }

  function cancelEdit() {
    state.editingId = null;
    state.draft = null;
    render();
  }

  function savePartner() {
    if (!state.draft) return;

    const organization = String(state.draft.organization || "").trim();
    if (!organization) {
      setStatus("Organization name is required.", "is-error");
      return;
    }

    const edits = readEdits();
    const existing = state.partners.find((partner) => partner.id === state.editingId);
    if (existing && existing.organization !== organization) {
      delete edits[existing.organization];
    }

    edits[organization] = {
      status: String(state.draft.status || "").trim(),
      joinedDate: String(state.draft.joinedDate || "").trim(),
      agreementEndDate: String(state.draft.agreementEndDate || "").trim()
    };

    writeEdits(edits);
    state.editingId = null;
    state.draft = null;
    mergePartners();
    setStatus("Partner saved.", "is-success");
    render();
  }

  function addPartner() {
    const organization = `New Partner ${state.partners.length + 1}`;
    state.editingId = slugify(organization);
    state.draft = {
      id: state.editingId,
      organization,
      status: "Active",
      joinedDate: "",
      agreementEndDate: ""
    };
    render();
  }

  function renderStatusOptions(selected) {
    return STATUS_OPTIONS.map((option) => {
      const label = option || "—";
      const isSelected = option === selected ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${isSelected}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function renderRow(partner) {
    const isEditing = state.editingId === partner.id && state.draft;
    const row = isEditing ? state.draft : partner;

    if (isEditing) {
      return `
        <tr class="is-editing">
          <td><input class="partners-input" data-field="organization" value="${escapeHtml(row.organization)}"></td>
          <td>
            <select class="partners-input" data-field="status">
              ${renderStatusOptions(row.status)}
            </select>
          </td>
          <td><input class="partners-input" data-field="joinedDate" value="${escapeHtml(row.joinedDate)}"></td>
          <td><input class="partners-input" data-field="agreementEndDate" value="${escapeHtml(row.agreementEndDate)}"></td>
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
        <td><span class="partners-status-badge ${statusClass(partner.status)}">${escapeHtml(partner.status || "—")}</span></td>
        <td>${escapeHtml(partner.joinedDate || "—")}</td>
        <td>${escapeHtml(partner.agreementEndDate || "—")}</td>
        <td class="partners-actions">
          <button type="button" class="partners-btn" data-action="edit" data-id="${escapeHtml(partner.id)}">Edit</button>
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

  function render() {
    if (!els.tableBody) return;

    const rows = filteredPartners();
    const draftOnly =
      state.draft &&
      !rows.some((partner) => partner.id === state.editingId);

    const html = rows.map(renderRow).join("");
    const draftRow = draftOnly ? renderRow(state.draft) : "";

    if (!html && !draftRow) {
      els.tableBody.innerHTML = '<tr><td colspan="5" class="empty">No partners found.</td></tr>';
      return;
    }

    els.tableBody.innerHTML = draftRow + html;
  }

  function bindTableEvents() {
    els.tableBody?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "save") {
        syncDraftFromInputs();
        savePartner();
        return;
      }

      if (action === "cancel") {
        cancelEdit();
        return;
      }

      if (action === "edit") {
        const partner = state.partners.find((item) => item.id === button.dataset.id);
        if (partner) startEdit(partner);
      }
    });

    els.tableBody?.addEventListener("input", (event) => {
      if (!state.draft) return;
      const field = event.target.dataset.field;
      if (!field) return;
      state.draft[field] = event.target.value;
    });

    els.tableBody?.addEventListener("change", (event) => {
      if (!state.draft) return;
      const field = event.target.dataset.field;
      if (!field) return;
      state.draft[field] = event.target.value;
    });
  }

  function syncDraftFromInputs() {
    if (!state.draft || !els.tableBody) return;
    els.tableBody.querySelectorAll(".is-editing [data-field]").forEach((input) => {
      state.draft[input.dataset.field] = input.value;
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
    return [partner.organization, partner.status, partner.joinedDate, partner.agreementEndDate]
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
      mergePartners();
      render();
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
          subtitle: [partner.status, partner.joinedDate].filter(Boolean).join(" · "),
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
}());
