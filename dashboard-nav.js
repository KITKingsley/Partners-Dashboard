(function () {
  const views = {
    dashboard: document.querySelector("#dashboardView"),
    credits: document.querySelector("#creditsView"),
    partners: document.querySelector("#partnersView")
  };

  const navButtons = [...document.querySelectorAll("[data-dashboard-view]")];
  const sidebarUserName = document.querySelector("#sidebarUserName");
  const sidebarUserRole = document.querySelector("#sidebarUserRole");
  const sidebarUserInitials = document.querySelector("#sidebarUserInitials");

  function setActiveView(viewName) {
    Object.entries(views).forEach(([name, section]) => {
      if (!section) return;
      section.hidden = name !== viewName;
    });

    navButtons.forEach((button) => {
      const isActive = button.dataset.dashboardView === viewName;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    if (viewName === "credits" && window.CreditsUsage) {
      window.CreditsUsage.hydrate?.() || window.CreditsUsage.render();
    }

    if (viewName === "partners" && window.PartnersView) {
      window.PartnersView.render();
    }

    const hash = viewName === "dashboard" ? "" : `#${viewName}`;
    if (window.location.hash !== hash) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${hash}`);
    }
  }

  function initialsFromEmail(email) {
    const local = String(email || "").split("@")[0] || "User";
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
    }
    return local.slice(0, 2).toUpperCase();
  }

  function displayNameFromEmail(email) {
    const local = String(email || "").split("@")[0] || "Dashboard User";
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  async function hydrateSidebarUser() {
    const client = window.DashboardAuth?.getClient?.();
    if (!client || !sidebarUserName) return;

    const { data } = await client.auth.getUser();
    const email = data.user?.email || "";
    if (!email) return;

    sidebarUserName.textContent = displayNameFromEmail(email);
    sidebarUserRole.textContent = email.endsWith("@gametize.com") ? "Gametize Admin" : "Partner User";
    if (sidebarUserInitials) {
      sidebarUserInitials.textContent = initialsFromEmail(email);
    }
  }

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.dashboardView);
    });
  });

  const hashView = window.location.hash.replace("#", "");
  const initialView = views[hashView] ? hashView : "dashboard";
  setActiveView(initialView);
  hydrateSidebarUser();

  window.DashboardNav = { setActiveView };
}());
