(function () {
  const STORAGE_KEY = "dashboard-platform-settings";

  const DEFAULT_SETTINGS = {
    debitTiers: [
      { maxPlayers: 100, amount: 100 },
      { maxPlayers: 200, amount: 200 },
      { maxPlayers: 500, amount: 500 }
    ],
    defaultAmount: 1000
  };

  const els = {
    form: document.querySelector("#platformSettingsForm"),
    tiersBody: document.querySelector("#platformDebitTiersBody"),
    defaultAmount: document.querySelector("#platformDefaultDebitAmount"),
    preview: document.querySelector("#platformDebitPreview"),
    previewPlayers: document.querySelector("#platformDebitPreviewPlayers"),
    status: document.querySelector("#platformSettingsStatus"),
    addTierButton: document.querySelector("#platformAddDebitTier"),
    resetButton: document.querySelector("#platformResetDebitSettings"),
    saveButton: document.querySelector("#platformSaveDebitSettings")
  };

  function toNumber(value) {
    const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function cloneSettings(settings) {
    return {
      debitTiers: settings.debitTiers.map((tier) => ({ ...tier })),
      defaultAmount: settings.defaultAmount
    };
  }

  function normalizeSettings(raw) {
    const tiers = Array.isArray(raw?.debitTiers)
      ? raw.debitTiers
        .map((tier) => ({
          maxPlayers: Math.max(0, toNumber(tier?.maxPlayers)),
          amount: Math.max(0, toNumber(tier?.amount))
        }))
        .filter((tier) => tier.maxPlayers > 0 && tier.amount >= 0)
        .sort((left, right) => left.maxPlayers - right.maxPlayers)
      : [];

    const seen = new Set();
    const uniqueTiers = tiers.filter((tier) => {
      if (seen.has(tier.maxPlayers)) return false;
      seen.add(tier.maxPlayers);
      return true;
    });

    return {
      debitTiers: uniqueTiers.length ? uniqueTiers : cloneSettings(DEFAULT_SETTINGS).debitTiers,
      defaultAmount: Math.max(0, toNumber(raw?.defaultAmount ?? DEFAULT_SETTINGS.defaultAmount))
    };
  }

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!stored) return cloneSettings(DEFAULT_SETTINGS);
      return normalizeSettings(stored);
    } catch {
      return cloneSettings(DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("platform-settings-changed", { detail: normalized }));
    return normalized;
  }

  function calculateToDebitFromSettings(playersIncludingRemoved, settings) {
    const count = Math.max(0, toNumber(playersIncludingRemoved));
    const tiers = settings.debitTiers;

    for (const tier of tiers) {
      if (count <= tier.maxPlayers) return tier.amount;
    }

    return settings.defaultAmount;
  }

  function calculateToDebit(playersIncludingRemoved) {
    return calculateToDebitFromSettings(playersIncludingRemoved, loadSettings());
  }

  function formatMoney(amount) {
    const value = toNumber(amount);
    return `US$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function setStatus(message, tone = "") {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.className = `platform-settings-status${tone ? ` is-${tone}` : ""}`;
  }

  function readFormSettings() {
    const tiers = [...(els.tiersBody?.querySelectorAll("tr") || [])].map((row) => ({
      maxPlayers: toNumber(row.querySelector("[data-tier-max]")?.value),
      amount: toNumber(row.querySelector("[data-tier-amount]")?.value)
    }));

    return normalizeSettings({
      debitTiers: tiers,
      defaultAmount: els.defaultAmount?.value
    });
  }

  function updatePreview() {
    if (!els.preview || !els.previewPlayers) return;
    const players = toNumber(els.previewPlayers.value);
    const settings = readFormSettings();
    els.preview.textContent = formatMoney(calculateToDebitFromSettings(players, settings));
  }

  function renderTierRows(settings) {
    if (!els.tiersBody) return;

    els.tiersBody.innerHTML = settings.debitTiers.map((tier, index) => `
      <tr>
        <td>
          <input
            type="number"
            min="1"
            step="1"
            data-tier-max
            value="${tier.maxPlayers}"
            aria-label="Max players for tier ${index + 1}"
          >
        </td>
        <td>
          <input
            type="number"
            min="0"
            step="1"
            data-tier-amount
            value="${tier.amount}"
            aria-label="Debit amount for tier ${index + 1}"
          >
        </td>
        <td class="platform-settings-tier-actions">
          <button type="button" class="platform-settings-remove-tier" data-action="remove-tier" aria-label="Remove tier ${index + 1}">Remove</button>
        </td>
      </tr>
    `).join("");
  }

  function renderForm(settings = loadSettings()) {
    renderTierRows(settings);
    if (els.defaultAmount) els.defaultAmount.value = String(settings.defaultAmount);
    updatePreview();
  }

  function bindEvents() {
    els.form?.addEventListener("input", (event) => {
      if (event.target.matches("[data-tier-max], [data-tier-amount], #platformDefaultDebitAmount, #platformDebitPreviewPlayers")) {
        updatePreview();
      }
    });

    els.addTierButton?.addEventListener("click", () => {
      const settings = readFormSettings();
      const highest = settings.debitTiers[settings.debitTiers.length - 1];
      settings.debitTiers.push({
        maxPlayers: (highest?.maxPlayers || 0) + 100,
        amount: highest?.amount || 100
      });
      renderTierRows(normalizeSettings(settings));
      updatePreview();
    });

    els.tiersBody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='remove-tier']");
      if (!button) return;

      const rows = [...els.tiersBody.querySelectorAll("tr")];
      if (rows.length <= 1) {
        setStatus("At least one debit tier is required.", "error");
        return;
      }

      button.closest("tr")?.remove();
      updatePreview();
      setStatus("");
    });

    els.resetButton?.addEventListener("click", () => {
      renderForm(cloneSettings(DEFAULT_SETTINGS));
      setStatus("Restored default debit tiers. Save to apply.", "info");
    });

    els.saveButton?.addEventListener("click", () => {
      const settings = readFormSettings();
      saveSettings(settings);
      renderForm(settings);
      setStatus("Debit settings saved. Partner Credit Health totals will use these tiers.", "success");
    });

    els.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      els.saveButton?.click();
    });
  }

  window.PlatformSettings = {
    loadSettings,
    saveSettings,
    calculateToDebit,
    getDefaultSettings: () => cloneSettings(DEFAULT_SETTINGS),
    render: () => renderForm(loadSettings())
  };

  bindEvents();
  renderForm();
}());
