/* ============================================================
   search.js — Builds the drawer content: search input (on mobile),
   relation-type filters, and the school index. Each school row
   has two actions: clicking the name pans the graph to that
   school's lane; the eye icon toggles its visibility.
   ============================================================ */

const Search = (() => {
  const TYPES = [
    { id: "continuacion", label: "Continuation" },
    { id: "critica", label: "Critique" },
    { id: "reinterpretacion", label: "Reinterpretation" },
    { id: "radicalizacion", label: "Radicalization" },
    { id: "inversion", label: "Inversion" },
    { id: "diagnostico", label: "Diagnosis" },
  ];

  // Accent-insensitive normalization for search.
  function norm(s) {
    return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  }

  function buildDrawer(philosophers, relations, graph) {
    const root = document.getElementById("drawer-content");
    root.innerHTML = "";

    // --- Search (mobile only — desktop uses the topbar input). ----------
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "search";
    searchInput.placeholder = "Search philosopher…";
    searchInput.id = "search-mobile";
    root.appendChild(searchInput);

    // --- Relation types ------------------------------------------------
    const presentTypes = new Set(relations.map((r) => r.type));
    const typeSection = document.createElement("div");
    typeSection.className = "drawer__section";
    typeSection.innerHTML = `<div class="drawer__section-title">Relation type</div>`;
    TYPES.filter((t) => presentTypes.has(t.id)).forEach((t) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-swatch" style="background:var(--rel-${t.id})"></span><span>${t.label}</span>`;
      item.addEventListener("click", () => {
        const off = item.classList.toggle("is-off");
        graph.setTypeVisible(t.id, !off);
      });
      typeSection.appendChild(item);
    });
    root.appendChild(typeSection);

    // --- Schools (also the navigation index) ---------------------------
    const labels = Panel.SCHOOL_LABEL || {};
    const schoolOrder = graph.getSchoolOrder();
    const presentSchools = new Set(philosophers.map((p) => p.school));
    const schoolSection = document.createElement("div");
    schoolSection.className = "drawer__section";
    schoolSection.innerHTML = `<div class="drawer__section-title">Schools — tap to jump</div>`;
    schoolOrder.filter((s) => presentSchools.has(s)).forEach((s) => {
      const item = document.createElement("div");
      item.className = "school-item";
      item.innerHTML = `
        <span class="school-swatch" style="background:var(--school-${s})"></span>
        <span class="school-item__name">${labels[s] || s}</span>
        <span class="school-item__filter" title="Show / hide" aria-label="Show / hide">◉</span>
      `;
      // Click on name (or the row): jump to that lane.
      item.addEventListener("click", (e) => {
        if (e.target.classList.contains("school-item__filter")) return;
        graph.focusSchool(s);
      });
      // Click on filter eye: toggle visibility.
      item.querySelector(".school-item__filter").addEventListener("click", (e) => {
        e.stopPropagation();
        const eye = e.target;
        const off = eye.classList.toggle("is-off");
        item.classList.toggle("is-off", off);
        graph.setSchoolVisible(s, !off);
      });
      schoolSection.appendChild(item);
    });
    root.appendChild(schoolSection);

    // --- Your additions: export ----------------------------------------
    const exportSection = document.createElement("div");
    exportSection.className = "drawer__section";
    exportSection.innerHTML = `<div class="drawer__section-title">Your additions</div>`;
    const exportBtn = document.createElement("button");
    exportBtn.className = "export-btn";
    exportBtn.id = "export-btn";
    function refreshExportLabel() {
      const n = (typeof Store !== "undefined") ? Store.count() : 0;
      exportBtn.innerHTML = `Export added philosophers <span class="export-btn__count">(${n})</span>`;
      exportBtn.disabled = n === 0;
      exportBtn.style.opacity = n === 0 ? "0.5" : "1";
    }
    refreshExportLabel();
    exportBtn.addEventListener("click", () => { if (typeof Store !== "undefined") Store.exportJSON(); });
    document.addEventListener("philograph:added", refreshExportLabel);
    exportSection.appendChild(exportBtn);
    root.appendChild(exportSection);

    // Tiny helper text.
    const help = document.createElement("div");
    help.className = "drawer-help";
    help.textContent = "Time flows left to right. Each row is a school of thought. Tap any philosopher to see who they argued with.";
    root.appendChild(help);

    return searchInput;
  }

  function wireSearchInputs(inputs, philosophers, graph) {
    function run(value) {
      const q = norm((value || "").trim());
      if (!q) { graph.clearHighlight(); return; }
      const match = philosophers.find((p) => norm(p.name).includes(q));
      if (match) graph.focusNode(match.id);
    }
    inputs.forEach((input) => {
      if (!input) return;
      input.addEventListener("input", () => run(input.value));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(input.value); });
    });
  }

  function init(philosophers, relations, graph) {
    const mobileSearch = buildDrawer(philosophers, relations, graph);
    const topSearch = document.getElementById("search");
    wireSearchInputs([topSearch, mobileSearch], philosophers, graph);
  }

  return { init };
})();
