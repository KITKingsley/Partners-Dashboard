(function () {
  const STORAGE_KEY = "dashboard-credits-user-limit";

  const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2L15.5 4.5a1.4 1.4 0 0 0-2 0L4 14v4Zm13.5-9.5 2 2M7 17h2l9.5-9.5-2-2L7 15v2Z"></path></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9h2v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z"></path></svg>';

  const els = {
    body: document.querySelector("#creditsUserLimitTableBody"),
    addRowButton: document.querySelector("#creditsUserLimitAddRow"),
    status: document.querySelector("#creditsUserLimitStatus")
  };

  const state = {
    rows: [],
    loading: false,
    saving: false,
    editingId: null,
    draft: null,
    isNewRow: false
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toNumber(value) {
    const number = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function createRowId() {
    return crypto.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function emptyRow() {
    return {
      id: createRowId(),
      partnerName: "",
      pic: "",
      project: "",
      licenseEndDate: "",
      creditsAllocated: 0,
      creditsUsed: 0,
      termsAndCondition: ""
    };
  }

  function normalizeRow(raw) {
    return {
      id: String(raw?.id || createRowId()),
      partnerName: String(raw?.partnerName || "").trim(),
      pic: String(raw?.pic || "").trim(),
      project: String(raw?.project || "").trim(),
      licenseEndDate: String(raw?.licenseEndDate || "").trim(),
      creditsAllocated: Math.max(0, toNumber(raw?.creditsAllocated)),
      creditsUsed: Math.max(0, toNumber(raw?.creditsUsed)),
      termsAndCondition: String(raw?.termsAndCondition || "").trim()
    };
  }

  function loadRowsFromLocalStorage() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.map(normalizeRow);
    } catch {
      return [];
    }
  }

  function rowHasContent(row) {
    return Boolean(
      row.partnerName
      || row.pic
      || row.project
      || row.licenseEndDate
      || row.creditsAllocated > 0
      || row.creditsUsed > 0
      || row.termsAndCondition
    );
  }

  function formatLicenseDate(value) {
    if (!value) return "—";
    return window.DashboardDateFormat?.formatDisplayDateValue?.(value) || value;
  }

  function formatCredits(value) {
    return Math.max(0, toNumber(value)).toLocaleString("en-US");
  }

  function displayValue(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function setStatus(message, tone = "") {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.className = `credits-upload-status${tone ? ` is-${tone}` : ""}`;
  }

  function setControlsDisabled(disabled) {
    if (els.addRowButton) els.addRowButton.disabled = disabled;
  }

  function clearEditState() {
    state.editingId = null;
    state.draft = null;
    state.isNewRow = false;
  }

  function renderIconButton(action, rowId, label) {
    const icon = action === "edit" ? PENCIL_ICON : DELETE_ICON;
    const disabled = state.loading || state.saving ? "disabled" : "";
    return `
      <button
        type="button"
        class="partners-icon-btn partners-icon-btn-${action}"
        data-action="${action}"
        data-row-id="${escapeHtml(rowId)}"
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
        ${disabled}
      >${icon}</button>
    `;
  }

  function renderViewCell(value, className = "") {
    const classAttr = className ? ` class="credits-user-limit-view-cell ${className}"` : ' class="credits-user-limit-view-cell"';
    return `<td${classAttr}>${escapeHtml(displayValue(value))}</td>`;
  }

  function renderViewRow(row, index) {
    return `
      <tr data-row-id="${escapeHtml(row.id)}">
        ${renderViewCell(row.partnerName)}
        <td class="credits-user-limit-view-cell credits-user-limit-view-pic">${escapeHtml(displayValue(row.pic))}</td>
        ${renderViewCell(row.project)}
        <td class="credits-user-limit-view-cell">${escapeHtml(formatLicenseDate(row.licenseEndDate))}</td>
        <td class="credits-user-limit-view-cell credits-user-limit-view-number">${escapeHtml(formatCredits(row.creditsAllocated))}</td>
        <td class="credits-user-limit-view-cell credits-user-limit-view-number">${escapeHtml(formatCredits(row.creditsUsed))}</td>
        <td class="credits-user-limit-view-cell credits-user-limit-view-terms">${escapeHtml(displayValue(row.termsAndCondition))}</td>
        <td class="credits-user-limit-row-actions">
          <div class="credits-user-limit-icon-actions">
            ${renderIconButton("edit", row.id, `Edit row ${index + 1}`)}
            ${renderIconButton("delete", row.id, `Delete row ${index + 1}`)}
          </div>
        </td>
      </tr>
    `;
  }

  function fieldDisabledAttr() {
    return state.loading || state.saving ? "disabled" : "";
  }

  function renderEditRow(row, index) {
    return `
      <tr class="is-editing" data-row-id="${escapeHtml(row.id)}">
        <td>
          <input
            type="text"
            data-field="partnerName"
            value="${escapeHtml(row.partnerName)}"
            placeholder="Partner name"
            aria-label="Partner name for row ${index + 1}"
            ${fieldDisabledAttr()}
          >
        </td>
        <td>
          <textarea
            data-field="pic"
            data-expandable="true"
            class="credits-user-limit-expand-field"
            rows="1"
            placeholder="PIC"
            aria-label="PIC for row ${index + 1}"
            ${fieldDisabledAttr()}
          >${escapeHtml(row.pic)}</textarea>
        </td>
        <td>
          <input
            type="text"
            data-field="project"
            value="${escapeHtml(row.project)}"
            placeholder="Project"
            aria-label="Project for row ${index + 1}"
            ${fieldDisabledAttr()}
          >
        </td>
        <td>
          <input
            type="date"
            data-field="licenseEndDate"
            value="${escapeHtml(row.licenseEndDate)}"
            aria-label="License end date for row ${index + 1}"
            ${fieldDisabledAttr()}
          >
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="1"
            data-field="creditsAllocated"
            value="${row.creditsAllocated}"
            aria-label="Credits allocated for row ${index + 1}"
            ${fieldDisabledAttr()}
          >
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="1"
            data-field="creditsUsed"
            value="${row.creditsUsed}"
            aria-label="Credits used for row ${index + 1}"
            ${fieldDisabledAttr()}
          >
        </td>
        <td>
          <textarea
            data-field="termsAndCondition"
            rows="2"
            placeholder="Terms and condition"
            aria-label="Terms and condition for row ${index + 1}"
            ${fieldDisabledAttr()}
          >${escapeHtml(row.termsAndCondition)}</textarea>
        </td>
        <td class="credits-user-limit-row-actions">
          <div class="credits-user-limit-edit-actions">
            <button type="button" class="partners-btn partners-btn-save" data-action="save-row" ${fieldDisabledAttr()}>Save</button>
            <button type="button" class="partners-btn partners-btn-cancel" data-action="cancel-row" ${fieldDisabledAttr()}>Cancel</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderRow(row, index) {
    if (state.editingId === row.id && state.draft) {
      return renderEditRow(state.draft, index);
    }
    return renderViewRow(row, index);
  }

  function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function autoResizeExpandFields(root = els.body) {
    root?.querySelectorAll("[data-expandable='true']").forEach(autoResizeTextarea);
  }

  function renderRows(rows = state.rows) {
    if (!els.body) return;

    if (!rows.length) {
      els.body.innerHTML = `
        <tr>
          <td colspan="8" class="credits-user-limit-empty">No user limit rows yet. Click Add row to create one.</td>
        </tr>
      `;
      setControlsDisabled(state.loading || state.saving);
      return;
    }

    els.body.innerHTML = rows.map((row, index) => renderRow(row, index)).join("");
    setControlsDisabled(state.loading || state.saving);
    autoResizeExpandFields();
  }

  function syncDraftFromInputs() {
    if (!state.draft || !els.body) return;

    const editingRow = els.body.querySelector(`tr.is-editing[data-row-id="${CSS.escape(state.draft.id)}"]`);
    if (!editingRow) return;

    state.draft = normalizeRow({
      id: state.draft.id,
      partnerName: editingRow.querySelector("[data-field='partnerName']")?.value,
      pic: editingRow.querySelector("[data-field='pic']")?.value,
      project: editingRow.querySelector("[data-field='project']")?.value,
      licenseEndDate: editingRow.querySelector("[data-field='licenseEndDate']")?.value,
      creditsAllocated: editingRow.querySelector("[data-field='creditsAllocated']")?.value,
      creditsUsed: editingRow.querySelector("[data-field='creditsUsed']")?.value,
      termsAndCondition: editingRow.querySelector("[data-field='termsAndCondition']")?.value
    });
  }

  function startEdit(row) {
    state.editingId = row.id;
    state.draft = normalizeRow(row);
    state.isNewRow = false;
    renderRows(state.rows);
  }

  function cancelEdit() {
    if (state.isNewRow && state.editingId) {
      state.rows = state.rows.filter((row) => row.id !== state.editingId);
    }
    clearEditState();
    renderRows(state.rows);
    setStatus("");
  }

  async function persistRows(rows, successMessage) {
    if (!window.DashboardAuth?.saveCreditsUserLimitRows) {
      throw new Error("Supabase user limit storage is not configured.");
    }

    state.saving = true;
    setControlsDisabled(true);
    renderRows(state.rows);

    try {
      const payload = await window.DashboardAuth.saveCreditsUserLimitRows(rows);
      state.rows = (payload.rows || []).map(normalizeRow);
      setStatus(successMessage, "success");
    } finally {
      state.saving = false;
      setControlsDisabled(false);
      renderRows(state.rows);
    }
  }

  async function saveEdit() {
    syncDraftFromInputs();
    const draft = normalizeRow(state.draft);
    if (!rowHasContent(draft)) {
      setStatus("Fill in at least one field before saving.", "error");
      return;
    }

    const rows = state.rows.some((row) => row.id === draft.id)
      ? state.rows.map((row) => (row.id === draft.id ? draft : row))
      : [...state.rows, draft];

    try {
      await persistRows(rows.filter(rowHasContent), "Row saved to Supabase.");
      clearEditState();
      renderRows(state.rows);
    } catch (error) {
      console.error("Could not save user limit row:", error);
      setStatus(error.message || "Could not save user limit row.", "error");
    }
  }

  async function deleteRow(rowId) {
    if (state.editingId === rowId) {
      clearEditState();
    }

    const nextRows = state.rows.filter((row) => row.id !== rowId);
    state.rows = nextRows;

    try {
      await persistRows(nextRows.filter(rowHasContent), "Row deleted from Supabase.");
    } catch (error) {
      console.error("Could not delete user limit row:", error);
      setStatus(error.message || "Could not delete user limit row.", "error");
      await hydrateFromSupabase();
    }
  }

  async function hydrateFromSupabase() {
    if (!window.DashboardAuth?.getCreditsUserLimitRows) {
      state.rows = loadRowsFromLocalStorage();
      clearEditState();
      renderRows(state.rows);
      setStatus("Supabase user limit storage is not configured. Using local browser data.", "error");
      return;
    }

    state.loading = true;
    clearEditState();
    setControlsDisabled(true);
    setStatus("Loading user limit rows...");
    renderRows(state.rows);

    try {
      const payload = await window.DashboardAuth.getCreditsUserLimitRows();
      let rows = (payload.rows || []).map(normalizeRow);

      if (!rows.length) {
        const localRows = loadRowsFromLocalStorage().filter(rowHasContent);
        if (localRows.length && window.DashboardAuth?.saveCreditsUserLimitRows) {
          const saved = await window.DashboardAuth.saveCreditsUserLimitRows(localRows);
          rows = (saved.rows || []).map(normalizeRow);
          localStorage.removeItem(STORAGE_KEY);
          setStatus("Moved existing browser rows into Supabase.", "success");
        }
      }

      state.rows = rows;
      renderRows(state.rows);
      if (!els.status?.classList.contains("is-success")) {
        setStatus(rows.length ? `Loaded ${rows.length} row(s) from Supabase.` : "");
      }
    } catch (error) {
      console.error("Could not load user limit rows:", error);
      state.rows = loadRowsFromLocalStorage();
      renderRows(state.rows);
      setStatus(error.message || "Could not load user limit rows from Supabase.", "error");
    } finally {
      state.loading = false;
      setControlsDisabled(false);
      renderRows(state.rows);
    }
  }

  function addRow() {
    if (state.editingId) {
      cancelEdit();
    }

    const row = emptyRow();
    state.rows = [...state.rows, row];
    state.editingId = row.id;
    state.draft = normalizeRow(row);
    state.isNewRow = true;
    renderRows(state.rows);
    setStatus("");
  }

  function bindEvents() {
    els.addRowButton?.addEventListener("click", addRow);

    els.body?.addEventListener("input", (event) => {
      if (!state.draft) return;

      const field = event.target.dataset.field;
      if (!field) return;

      if (field === "creditsAllocated" || field === "creditsUsed") {
        state.draft[field] = Math.max(0, toNumber(event.target.value));
      } else {
        state.draft[field] = event.target.value;
      }

      if (event.target.matches("[data-expandable='true']")) {
        autoResizeTextarea(event.target);
      }
    });

    els.body?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || state.loading || state.saving) return;

      const action = button.dataset.action;
      const rowId = button.dataset.rowId;

      if (action === "edit") {
        const row = state.rows.find((item) => item.id === rowId);
        if (row) startEdit(row);
        return;
      }

      if (action === "delete") {
        if (!rowId) return;
        await deleteRow(rowId);
        return;
      }

      if (action === "save-row") {
        await saveEdit();
        return;
      }

      if (action === "cancel-row") {
        cancelEdit();
      }
    });
  }

  window.CreditsUserLimit = {
    hydrate: hydrateFromSupabase,
    render: () => {
      renderRows(state.rows);
      setStatus("");
    }
  };

  bindEvents();
  hydrateFromSupabase();
})();
