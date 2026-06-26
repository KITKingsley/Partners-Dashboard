(function () {
  const input = document.querySelector("#globalSearch");

  let debounceTimer = null;

  function applyToAllTabs(query) {
    window.DashboardApp?.applySearch?.(query);
    window.CreditsUsage?.applySearch?.(query);
    window.PartnersView?.applySearch?.(query);
  }

  function runSearch(query) {
    applyToAllTabs(query);
  }

  function bindEvents() {
    if (!input) return;

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runSearch(input.value), 180);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        runSearch("");
      }
    });
  }

  window.GlobalSearch = { runSearch };

  bindEvents();
}());
