(function () {
  const els = {
    input: document.querySelector("#globalSearch"),
    results: document.querySelector("#globalSearchResults")
  };

  let debounceTimer = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tabLabel(tab) {
    if (tab === "dashboard") return "Dashboard";
    if (tab === "credits") return "Credit Usage (Plans Limit)";
    if (tab === "credits-user-limit") return "Credit Usage (User Limit)";
    if (tab === "partners") return "Partners";
    if (tab === "platform-settings") return "Platform Settings";
    return tab;
  }

  function collectResults(query) {
    const items = [];
    const q = query.trim().toLowerCase();
    if (!q) return items;

    if (window.DashboardApp?.searchIndex) {
      items.push(...window.DashboardApp.searchIndex(q).map((item) => ({ ...item, tab: "dashboard" })));
    }

    if (window.CreditsUsage?.searchIndex) {
      items.push(...window.CreditsUsage.searchIndex(q).map((item) => ({ ...item, tab: "credits" })));
    }

    if (window.PartnersView?.searchIndex) {
      items.push(...window.PartnersView.searchIndex(q).map((item) => ({ ...item, tab: "partners" })));
    }

    return items.slice(0, 12);
  }

  function applyToAllTabs(query) {
    window.DashboardApp?.applySearch?.(query);
    window.CreditsUsage?.applySearch?.(query);
    window.PartnersView?.applySearch?.(query);
  }

  function renderResults(query, items) {
    if (!els.results) return;

    if (!query.trim()) {
      els.results.hidden = true;
      els.results.innerHTML = "";
      return;
    }

    if (!items.length) {
      els.results.hidden = false;
      els.results.innerHTML = '<p class="global-search-empty">No matches across dashboard, credits, or partners.</p>';
      return;
    }

    els.results.hidden = false;
    els.results.innerHTML = items.map((item, index) => `
      <button type="button" class="global-search-result" data-index="${index}">
        <span class="global-search-result-tab">${escapeHtml(tabLabel(item.tab))}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.subtitle || "")}</small>
      </button>
    `).join("");

    els.results._items = items;
  }

  function openResult(item) {
    if (!item) return;
    window.DashboardNav?.setActiveView?.(item.tab);

    if (item.tab === "dashboard") {
      window.DashboardApp?.openResult?.(item);
    } else if (item.tab === "credits") {
      window.CreditsUsage?.openResult?.(item);
    } else if (item.tab === "partners") {
      window.PartnersView?.openResult?.(item);
    }

    if (els.results) els.results.hidden = true;
  }

  function runSearch(query) {
    const items = collectResults(query);
    applyToAllTabs(query);
    renderResults(query, items);
  }

  function bindEvents() {
    if (!els.input) return;

    els.input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(els.input.value), 180);
    });

    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        els.input.value = "";
        runSearch("");
        els.results.hidden = true;
        return;
      }

      if (event.key === "Enter" && els.results?._items?.length) {
        openResult(els.results._items[0]);
      }
    });

    els.results?.addEventListener("click", (event) => {
      const button = event.target.closest(".global-search-result");
      if (!button || !els.results._items) return;
      openResult(els.results._items[Number(button.dataset.index)]);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".global-search-wrap")) {
        if (els.results) els.results.hidden = true;
      }
    });
  }

  window.GlobalSearch = { runSearch };

  bindEvents();
}());
