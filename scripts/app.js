/* ============================================================
   app.js — Orchestrator.
   Loads data (base JSON + the user's localStorage additions),
   initializes the graph, drawer, panel, lane labels, century
   axis, and the add-philosopher flow.
   ============================================================ */

(async function main() {
  // --- Theme persistence -------------------------------------------------
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    Graph.refreshTheme();
    renderLaneLabels();
    scheduleSync();
  });

  // --- Data load (base JSON + user additions) ---------------------------
  let philosophers, relations, trails;
  try {
    [philosophers, relations, trails] = await Promise.all([
      fetch("data/philosophers.json").then((r) => r.json()),
      fetch("data/relations.json").then((r) => r.json()),
      fetch("data/trails.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
  } catch (err) { showError(); return; }

  // Merge in the user's saved additions so they survive reloads.
  const additions = Store.loadAdditions();
  const baseIds = new Set(philosophers.map((p) => p.id));
  additions.philosophers.forEach((p) => { if (!baseIds.has(p.id)) philosophers.push(p); });
  const baseRelIds = new Set(relations.map((r) => r.id));
  additions.relations.forEach((r) => { if (!baseRelIds.has(r.id)) relations.push(r); });

  const byId = Object.fromEntries(philosophers.map((p) => [p.id, p]));

  // --- Open a relation in the panel (shared by edge tap + connection tap)
  const essayCache = {};
  async function loadEssay(path) {
    if (essayCache[path]) return essayCache[path];
    try {
      const txt = await fetch(path).then((r) => (r.ok ? r.text() : Promise.reject()));
      essayCache[path] = txt;
      return txt;
    } catch { return ""; }
  }
  async function openRelation(r, trailCtx) {
    const sourceName = byId[r.source] ? byId[r.source].name : r.source;
    const targetName = byId[r.target] ? byId[r.target].name : r.target;
    Panel.showRelation(r, sourceName, targetName, "", trailCtx);
    if (r.essay) {
      const md = await loadEssay(r.essay);
      if (md) Panel.showRelation(r, sourceName, targetName, md, trailCtx);
    }
  }

  // --- Initialize graph -------------------------------------------------
  Graph.init("cy", philosophers, relations, {
    onNode: (p) => Panel.showPhilosopher(p),
    onEdge: (r) => openRelation(r),
    // Mid-trail, a background tap keeps the path lit instead of clearing it.
    onBackground: () => { Panel.close(); if (Trails.isActive()) Trails.rehighlight(); },
    onViewportChange: () => scheduleSync(),
  });
  Panel.onClose(() => Graph.clearHighlight());

  // Give the panel the data + navigation callbacks for the connections list.
  Panel.setData(philosophers, relations, byId, {
    // Jump to another philosopher's card (from a connection's "Open … card" button).
    onPhilosopherTap: (id) => { Graph.focusNode(id); if (byId[id]) Panel.showPhilosopher(byId[id]); },
    // When a connection expands inline, light up that edge in the graph.
    onConnectionExpand: (r) => { Graph.clearHighlight(); Graph.highlightEdge(r.id); },
    // When it collapses, restore the focus on the philosopher.
    onConnectionCollapse: (id) => { Graph.clearHighlight(); Graph.highlightNode(id); },
    // Lets the panel render a relation's full essay inline.
    loadEssay,
  });

  // --- Guided trails ------------------------------------------------------
  const byRelId = Object.fromEntries(relations.map((r) => [r.id, r]));
  Trails.init(trails, { byRelId, byId, openRelation });

  // --- Lane labels (desktop) --------------------------------------------
  const lanesEl = document.getElementById("lanes");
  function renderLaneLabels() {
    const labels = Panel.SCHOOL_LABEL || {};
    const lanes = Graph.getLaneCenters();
    const order = Graph.getSchoolOrder();
    lanesEl.innerHTML = "";
    order.forEach((s) => {
      if (!(s in lanes)) return;
      const el = document.createElement("div");
      el.className = "lane-label";
      el.dataset.modelY = String(lanes[s]);
      el.innerHTML = `<span class="lane-label__dot" style="background:var(--school-${s})"></span><span>${labels[s] || s}</span>`;
      lanesEl.appendChild(el);
    });
  }
  function syncLaneLabels() {
    const cy = Graph.getCy();
    if (!cy) return;
    const zoom = cy.zoom();
    const panY = cy.pan().y;
    const vpHeight = window.innerHeight;
    lanesEl.querySelectorAll(".lane-label").forEach((el) => {
      const modelY = parseFloat(el.dataset.modelY);
      const y = panY + modelY * zoom - 13;
      el.style.transform = `translateY(${y}px)`;
      const visible = y > -30 && y < vpHeight - 20;
      el.style.opacity = visible ? "1" : "0";
    });
  }

  // --- Century axis ------------------------------------------------------
  const axisEl = document.getElementById("time-axis");
  function fmtYear(y) {
    if (y < 0) return Math.abs(y) + " BCE";
    if (y === 0) return "1 CE";
    return String(y);
  }
  function syncTimeAxis() {
    const cy = Graph.getCy();
    if (!cy) return;
    const zoom = cy.zoom();
    const panX = cy.pan().x;
    const pxPerYear = (Graph.yearToX(1) - Graph.yearToX(0)) * zoom; // = X_SCALE * zoom
    // Pick a century step so labels stay ~110px apart minimum.
    const candidates = [100, 200, 500, 1000, 2000];
    let step = candidates[candidates.length - 1];
    for (const s of candidates) { if (s * pxPerYear >= 110) { step = s; break; } }
    const bounds = Graph.getTimeBounds();
    const start = Math.floor(bounds.min / step) * step;
    const end = Math.ceil(bounds.max / step) * step;
    const width = axisEl.clientWidth;
    let html = "";
    for (let y = start; y <= end; y += step) {
      const x = panX + Graph.yearToX(y) * zoom;
      if (x < -60 || x > width + 60) continue;
      html += `<div class="time-tick" style="transform:translateX(${x}px)"><div class="time-tick__label">${fmtYear(y)}</div></div>`;
    }
    axisEl.innerHTML = html;
  }

  // Coalesce both syncs into a single rAF so frequent pan/zoom/render
  // events don't thrash the DOM.
  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; syncLaneLabels(); syncTimeAxis(); });
  }
  renderLaneLabels();
  scheduleSync();
  window.addEventListener("resize", scheduleSync);

  // --- Drawer ------------------------------------------------------------
  Search.init(philosophers, relations, Graph);
  const drawer = document.getElementById("drawer");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  function openDrawer() {
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    drawerBackdrop.hidden = false;
    requestAnimationFrame(() => drawerBackdrop.classList.add("is-shown"));
  }
  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawerBackdrop.classList.remove("is-shown");
    setTimeout(() => { drawerBackdrop.hidden = true; }, 220);
  }
  document.getElementById("drawer-toggle").addEventListener("click", () => {
    if (drawer.classList.contains("is-open")) closeDrawer(); else openDrawer();
  });
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  drawer.addEventListener("click", (e) => {
    const item = e.target.closest(".school-item");
    if (item && !e.target.classList.contains("school-item__filter") && window.innerWidth <= 820) {
      closeDrawer();
    }
  });
  // Mobile search button: open the drawer and focus its search field.
  document.getElementById("search-mobile-btn").addEventListener("click", () => {
    openDrawer();
    setTimeout(() => { const s = document.getElementById("search-mobile"); if (s) s.focus(); }, 280);
  });

  // --- Zoom controls -----------------------------------------------------
  document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.35));
  document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.35));
  document.getElementById("zoom-fit").addEventListener("click", () => {
    const cy = Graph.getCy();
    cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 300 });
  });
  function zoomBy(factor) {
    const cy = Graph.getCy();
    const target = Math.min(Math.max(cy.zoom() * factor, cy.minZoom()), cy.maxZoom());
    cy.animate({ zoom: target, pan: cy.pan() }, { duration: 180 });
  }

  // --- Add-philosopher flow ---------------------------------------------
  const addSheet = document.getElementById("add-sheet");
  const addBackdrop = document.getElementById("add-backdrop");
  const addForm = document.getElementById("add-form");
  const addName = document.getElementById("add-name");
  const addStatus = document.getElementById("add-status");
  const addPreview = document.getElementById("add-preview");
  let pending = null;   // { philosopher, relations } awaiting confirmation

  function openAddSheet() {
    addSheet.classList.add("is-open");
    addSheet.setAttribute("aria-hidden", "false");
    addBackdrop.hidden = false;
    requestAnimationFrame(() => addBackdrop.classList.add("is-shown"));
    resetAddForm();
    setTimeout(() => addName.focus(), 250);
  }
  function closeAddSheet() {
    addSheet.classList.remove("is-open");
    addSheet.setAttribute("aria-hidden", "true");
    addBackdrop.classList.remove("is-shown");
    setTimeout(() => { addBackdrop.hidden = true; }, 220);
  }
  function resetAddForm() {
    pending = null;
    addName.value = "";
    addStatus.hidden = true;
    addPreview.hidden = true;
    addPreview.innerHTML = "";
  }
  document.getElementById("add-fab").addEventListener("click", openAddSheet);
  document.getElementById("add-close").addEventListener("click", closeAddSheet);
  addBackdrop.addEventListener("click", closeAddSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && addSheet.classList.contains("is-open")) closeAddSheet(); });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = addName.value.trim();
    if (!name) return;

    // Duplicate? Focus the existing node instead of generating.
    const existingId = Generator.slugify(name);
    if (byId[existingId]) {
      addStatus.hidden = false;
      addStatus.textContent = `${byId[existingId].name} is already on the map — taking you there.`;
      setTimeout(() => { closeAddSheet(); Graph.focusNode(existingId); Panel.showPhilosopher(byId[existingId]); }, 800);
      return;
    }

    addPreview.hidden = true;
    addStatus.hidden = false;
    addStatus.textContent = "Generating…";
    try {
      pending = await Generator.generate(name, { philosophers });
    } catch {
      addStatus.textContent = "Generation failed. Try again.";
      return;
    }
    addStatus.hidden = true;
    renderPreview(pending);
  });

  function renderPreview({ philosopher, relations: rels }) {
    const schoolLabel = (Panel.SCHOOL_LABEL || {})[philosopher.school] || philosopher.school;
    const connsHtml = rels.map((r, i) => {
      const other = byId[r.target] || byId[r.source];
      const otherName = other ? other.name : (r.target || r.source);
      const typeLabel = (Panel.TYPE_LABEL || {})[r.type] || r.type;
      return `
        <label class="add-conn">
          <input type="checkbox" data-i="${i}" checked />
          <span class="conn-dot" style="background:var(--rel-${r.type})"></span>
          <span>${esc(otherName)}</span>
          <span class="add-conn__type">${esc(typeLabel)}</span>
        </label>`;
    }).join("");

    addPreview.hidden = false;
    addPreview.innerHTML = `
      <div class="add-preview__name">${esc(philosopher.name)}</div>
      <div class="add-preview__meta">${esc(schoolLabel)} · ${esc(philosopher.dates || "")}</div>
      <div class="add-preview__desc">${esc(philosopher.short_description || "")}</div>
      ${connsHtml ? `<div class="ph-section-title">Proposed connections</div>${connsHtml}` : ""}
      <div class="add-actions">
        <button id="add-confirm" class="primary-btn" type="button">Add to map</button>
        <button id="add-cancel" class="ghost-btn" type="button">Cancel</button>
      </div>
    `;
    document.getElementById("add-cancel").addEventListener("click", resetAddForm);
    document.getElementById("add-confirm").addEventListener("click", confirmAdd);
  }

  function confirmAdd() {
    if (!pending) return;
    const checks = addPreview.querySelectorAll('input[type="checkbox"]');
    const chosen = [];
    checks.forEach((c) => { if (c.checked) chosen.push(pending.relations[Number(c.dataset.i)]); });

    const node = pending.philosopher;
    const added = Graph.addPhilosopher(node, chosen);
    if (!added) { resetAddForm(); return; }

    // Keep in-memory data + index in sync (same array refs Panel/Graph hold).
    philosophers.push(node);
    chosen.forEach((r) => relations.push(r));
    byId[node.id] = node;

    // Persist + let the drawer's export button update its count.
    Store.addPhilosopher({ philosopher: node, relations: chosen });
    document.dispatchEvent(new CustomEvent("philograph:added"));

    closeAddSheet();
    Panel.showPhilosopher(node);
    scheduleSync();
  }

  // --- Welcome overlay (first visit) ------------------------------------
  const welcome = document.getElementById("welcome");
  if (!localStorage.getItem("welcomeSeen")) welcome.hidden = false;
  document.getElementById("welcome-dismiss").addEventListener("click", () => {
    welcome.hidden = true;
    localStorage.setItem("welcomeSeen", "1");
  });

  function showError() {
    const box = document.getElementById("error");
    box.hidden = false;
    box.innerHTML = `
      Could not load the data.<br /><br />
      If you opened the file directly (<code>file://</code>), the browser
      blocks fetching local JSON and Markdown.<br />
      Start a local server from the project folder:<br /><br />
      <code>python3 -m http.server 8000</code><br /><br />
      then open <code>http://localhost:8000</code>.
    `;
  }
})();
