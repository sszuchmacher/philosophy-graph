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

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Set by wireSearchInputs; lets app.js dismiss the dropdown (e.g. on drawer close).
  let hideSuggestions = () => {};

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

  // Type-ahead autocomplete. A single fixed dropdown (shared across the topbar
  // and drawer inputs, only one of which is ever focused) lists matches. Picking
  // one focuses that node on the graph and closes the drawer, so the highlighted
  // node is revealed — it does NOT open the card (the user taps the node for that).
  function wireSearchInputs(inputs, philosophers, graph, opts) {
    opts = opts || {};
    const labels = (typeof Panel !== "undefined" && Panel.SCHOOL_LABEL) || {};

    const list = document.createElement("ul");
    list.className = "ac-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    document.body.appendChild(list);

    let matches = [];
    let active = -1;
    let current = null;   // the input currently driving the dropdown

    function meta(p) {
      const parts = [];
      if (p.dates) parts.push(esc(p.dates));
      if (p.school && labels[p.school]) parts.push(esc(labels[p.school]));
      return parts.join(" · ");
    }

    function position() {
      if (!current) return;
      const r = current.getBoundingClientRect();
      list.style.top = `${Math.round(r.bottom + 4)}px`;
      list.style.left = `${Math.round(r.left)}px`;
      list.style.width = `${Math.round(r.width)}px`;
    }

    function hide() { list.hidden = true; list.innerHTML = ""; matches = []; active = -1; }
    hideSuggestions = hide;

    function render() {
      if (!matches.length) { hide(); return; }
      list.innerHTML = matches.map((p, i) => `
        <li class="ac-item${i === active ? " is-active" : ""}" role="option" data-i="${i}">
          <span class="ac-name">${esc(p.name)}</span>
          <span class="ac-meta">${meta(p)}</span>
        </li>`).join("");
      list.hidden = false;
      position();
    }

    function query(value) {
      const q = norm((value || "").trim());
      if (!q) return [];
      const starts = [], incl = [];
      philosophers.forEach((p) => {
        const n = norm(p.name);
        if (n.startsWith(q)) starts.push(p);
        else if (n.includes(q)) incl.push(p);
      });
      return starts.concat(incl).slice(0, 8);
    }

    function update() {
      if (!current) return;
      active = -1;
      matches = query(current.value);
      render();
    }

    function choose(p) {
      if (!p) return;
      if (current) { current.value = p.name; current.blur(); }
      hide();
      graph.focusNode(p.id);          // pan + highlight on the graph; no card
      if (opts.onSelect) opts.onSelect(p);   // e.g. close the drawer to reveal it
    }

    // mousedown (fired on tap via compat events too) keeps the input focused
    // so the list isn't torn down before the click resolves; click commits.
    list.addEventListener("mousedown", (e) => { e.preventDefault(); });
    list.addEventListener("click", (e) => {
      const li = e.target.closest(".ac-item");
      if (!li) return;
      choose(matches[Number(li.dataset.i)]);
    });

    inputs.filter(Boolean).forEach((input) => {
      input.setAttribute("autocomplete", "off");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("spellcheck", "false");
      input.addEventListener("focus", () => { current = input; if (input.value.trim()) update(); });
      input.addEventListener("input", () => { current = input; update(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (!matches.length) update();
          active = Math.min(active + 1, matches.length - 1);
          render();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          active = Math.max(active - 1, 0);
          render();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const pool = matches.length ? matches : query(input.value);
          if (pool.length) choose(active >= 0 ? matches[active] : pool[0]);
        } else if (e.key === "Escape") {
          hide();
        }
      });
    });

    // Dismiss on outside interaction; keep the dropdown pinned to its input.
    document.addEventListener("mousedown", (e) => {
      if (e.target === current || list.contains(e.target)) return;
      hide();
    });
    window.addEventListener("resize", () => { if (!list.hidden) position(); });
    window.addEventListener("scroll", () => { if (!list.hidden) position(); }, true);
  }

  function init(philosophers, relations, graph, opts) {
    const mobileSearch = buildDrawer(philosophers, relations, graph);
    const topSearch = document.getElementById("search");
    wireSearchInputs([topSearch, mobileSearch], philosophers, graph, opts);
  }

  return { init, hideSuggestions: () => hideSuggestions() };
})();
