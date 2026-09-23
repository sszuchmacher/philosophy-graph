/* ============================================================
   app.js — Orchestrator.
   Loads data (base JSON + the user's localStorage additions),
   initializes the graph, drawer, panel, lane labels, century
   axis, and the add-philosopher flow.
   ============================================================ */

(async function main() {
  // --- Theme persistence -------------------------------------------------
  // A returning visitor's explicit choice always wins. A first-time visitor
  // gets their OS preference instead of a hardcoded light default, so a
  // system-dark user doesn't get a light flash they then have to fix by hand.
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const savedTheme = localStorage.getItem("theme") || (prefersDark ? "dark" : "light");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  // Keep the browser-chrome color (mobile status bar / address bar) matching
  // the applied theme, so a dark app isn't framed by a light bar.
  function syncThemeColorMeta(theme) {
    if (themeColorMeta) themeColorMeta.setAttribute("content", theme === "dark" ? "#1a1816" : "#f5f2ea");
  }
  document.documentElement.setAttribute("data-theme", savedTheme);
  syncThemeColorMeta(savedTheme);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    syncThemeColorMeta(next);
    Graph.refreshTheme();
    renderLaneLabels();
    scheduleSync();
  });

  // --- Data load (base JSON + user additions) ----------------------------
  // The graph area stays blank until this resolves. On a fast connection
  // that's sub-100ms and invisible; on a slow one it can be long enough to
  // look broken. Delay showing the indicator so a fast load never flashes
  // it, but a slow one gets feedback instead of a dead screen.
  const graphLoading = document.getElementById("graph-loading");
  const loadingTimer = setTimeout(() => {
    graphLoading.hidden = false;
    graphLoading.setAttribute("aria-hidden", "false");
  }, 250);
  function hideLoading() {
    clearTimeout(loadingTimer);
    graphLoading.hidden = true;
    graphLoading.setAttribute("aria-hidden", "true");
  }

  let philosophers, relations, trails;
  try {
    [philosophers, relations, trails] = await Promise.all([
      fetch("data/philosophers.json").then((r) => r.json()),
      fetch("data/relations.json").then((r) => r.json()),
      fetch("data/trails.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
  } catch (err) { hideLoading(); showError(); return; }
  hideLoading();

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

  // Long-form idea/work entries live in content/details/<id>.json, loaded
  // lazily when a card with long_docs opens. Cached per philosopher.
  const detailsCache = {};
  async function loadDetails(pid) {
    if (pid in detailsCache) return detailsCache[pid];
    try {
      const data = await fetch(`content/details/${pid}.json`).then((r) => (r.ok ? r.json() : Promise.reject()));
      detailsCache[pid] = data;
      return data;
    } catch { detailsCache[pid] = null; return null; }
  }
  async function openRelation(r, trailCtx) {
    const sourceName = byId[r.source] ? byId[r.source].name : r.source;
    const targetName = byId[r.target] ? byId[r.target].name : r.target;
    // Inside a trail, trails.js owns the URL (#/t/<trail>/<step>); otherwise
    // this relation gets its own shareable link.
    if (!trailCtx) Router.navigate("r/" + r.id);
    Panel.showRelation(r, sourceName, targetName, "", trailCtx);
    if (r.essay) {
      const md = await loadEssay(r.essay);
      if (md) Panel.showRelation(r, sourceName, targetName, md, trailCtx);
    }
  }

  // --- Initialize graph -------------------------------------------------
  Graph.init("cy", philosophers, relations, {
    onNode: (p) => { Panel.showPhilosopher(p); Router.navigate("p/" + p.id); },
    onEdge: (r) => openRelation(r),
    onBackground: () => Panel.close(),
    onViewportChange: () => scheduleSync(),
  });
  // Single choke point for every way the panel can close (X, Escape,
  // swipe-down, backdrop tap): clear the highlight, and either keep the
  // trail's URL (if one is active) or drop back to the home route.
  Panel.onClose(() => {
    Graph.clearHighlight();
    if (Trails.isActive()) Trails.rehighlight();
    else Router.clear();
  });

  // Give the panel the data + navigation callbacks for the connections list.
  Panel.setData(philosophers, relations, byId, {
    // The trails index lives on Panel so the philosopher card can cross-link
    // to every trail this thinker appears in.
    trails,
    // Jump to another philosopher's card (from a connection's "Open … card" button).
    onPhilosopherTap: (id) => {
      Graph.focusNode(id);
      if (byId[id]) { Panel.showPhilosopher(byId[id]); Router.navigate("p/" + id); }
    },
    // When a connection expands inline, light up that edge in the graph.
    onConnectionExpand: (r) => { Graph.clearHighlight(); Graph.highlightEdge(r.id); },
    // When it collapses, restore the focus on the philosopher.
    onConnectionCollapse: (id) => { Graph.clearHighlight(); Graph.highlightNode(id); },
    // Lets the panel render a relation's full essay inline.
    loadEssay,
    // Lets the panel upgrade short idea/work previews to full entries.
    loadDetails,
  });

  // --- Guided trails ------------------------------------------------------
  const byRelId = Object.fromEntries(relations.map((r) => [r.id, r]));
  Trails.init(trails, { byRelId, byId, openRelation });

  // --- Deep links (shareable URLs for philosophers, relations, trail stops)
  Router.init({
    onPhilosopher: (id) => {
      const p = byId[id];
      if (!p) return false;
      Graph.focusNode(id);
      Panel.showPhilosopher(p);
      return true;
    },
    onRelation: (id) => {
      const rel = byRelId[id];
      if (!rel) return false;
      Graph.clearHighlight();
      Graph.highlightEdge(id);
      Graph.focusEdge(id);
      openRelation(rel);
      return true;
    },
    onTrailStep: (trailId, step) => Trails.goTo(trailId, step - 1),
  });
  const openedFromLink = Router.start();

  // --- Row labels -----------------------------------------------------------
  // Rows are lineages: several schools share a row at different times (see
  // computeRows in graph.js). Each row's label names the school in view, the
  // one nearest the centre of the screen, and when none of the row's schools
  // is on screen it points toward the nearest ("← Medieval"). Desktop
  // shows them in the sticky column; phones get small pills at the top of
  // each row's band, over the graph's left edge.
  const lanesEl = document.getElementById("lanes");
  const graphEl = document.getElementById("cy");
  function renderLaneLabels() {
    lanesEl.innerHTML = "";
    Graph.getRows().forEach((row, i) => {
      const el = document.createElement("div");
      el.className = "lane-label";
      el.dataset.row = String(i);
      el.innerHTML = `<span class="lane-label__dot"></span><span class="lane-label__name"></span>`;
      lanesEl.appendChild(el);
    });
  }
  function syncLaneLabels() {
    const cy = Graph.getCy();
    if (!cy) return;
    const labels = Panel.SCHOOL_LABEL || {};
    const rows = Graph.getRows();
    const laneH = Graph.getLaneHeight();
    const zoom = cy.zoom();
    const pan = cy.pan();
    const mobile = window.innerWidth <= 820;
    // Visible time range, in model x.
    const vx1 = -pan.x / zoom;
    const vx2 = (cy.width() - pan.x) / zoom;
    const vc = (vx1 + vx2) / 2;

    // The alternating row bands behind the graph follow the rows.
    graphEl.style.setProperty("--row-h", `${laneH * zoom}px`);
    graphEl.style.setProperty("--row-offset", `${pan.y - (laneH / 2) * zoom}px`);

    if (lanesEl.children.length !== rows.length) renderLaneLabels();
    const vpHeight = lanesEl.clientHeight || window.innerHeight;
    lanesEl.querySelectorAll(".lane-label").forEach((el) => {
      const row = rows[Number(el.dataset.row)];
      if (!row || !row.schools.length) { el.style.visibility = "hidden"; return; }
      const dist = (e) => (vc < e.x1 ? e.x1 - vc : vc > e.x2 ? vc - e.x2 : 0);
      const pick = row.schools.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      const onScreen = pick.x2 >= vx1 && pick.x1 <= vx2;
      const ahead = pick.x1 > vc;
      const key = pick.school + (onScreen ? "" : ahead ? ">" : "<");
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        const name = labels[pick.school] || pick.school;
        el.querySelector(".lane-label__dot").style.background = `var(--school-${pick.school})`;
        el.querySelector(".lane-label__name").textContent =
          onScreen ? name : ahead ? `${name} \u2192` : `\u2190 ${name}`;
        el.classList.toggle("is-away", !onScreen);
      }
      // Desktop: centred on the row. Phone: at the top of the row's band, so
      // the pill sits above the row's dots rather than on them.
      const rowY = pan.y + row.y * zoom;
      const y = mobile ? rowY - (laneH / 2) * zoom + 6 : rowY - 13;
      el.style.transform = `translateY(${y}px)`;
      el.style.visibility = y > -30 && y < vpHeight - 20 ? "" : "hidden";
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
    // The time scale is piecewise (modern centuries are wider than ancient
    // ones), so no single step suits the whole axis. Place ticks by rank —
    // millennia, then 500s, 200s, centuries, half- and quarter-centuries —
    // each only where it stays MIN_GAP clear of ticks already placed. Wide
    // modern centuries fill in with 1850/1925-style ticks; sparse eras thin
    // out to rounder numbers.
    const MIN_GAP = 110;
    const bounds = Graph.getTimeBounds();
    const start = Math.floor(bounds.min / 100) * 100;
    // No ticks in the future (living thinkers are placed near 2000).
    const end = Math.min(Math.ceil(bounds.max / 100) * 100,
      Math.floor(new Date().getFullYear() / 100) * 100);
    const width = axisEl.clientWidth;
    const placed = [];
    for (const step of [1000, 500, 200, 100, 50, 25]) {
      for (let y = Math.ceil(start / step) * step; y <= end; y += step) {
        const x = panX + Graph.yearToX(y) * zoom;
        if (x < -60 || x > width + 60) continue;
        if (placed.some((t) => t.y === y || Math.abs(t.x - x) < MIN_GAP)) continue;
        placed.push({ y, x });
      }
    }
    axisEl.innerHTML = placed.map((t) =>
      `<div class="time-tick" style="transform:translateX(${t.x}px)"><div class="time-tick__label">${fmtYear(t.y)}</div></div>`
    ).join("");
  }

  // --- Era jump buttons ------------------------------------------------------
  // Tap an era to glide there: a horizontal pan at the current zoom, so the
  // rows and labels stay put. It lands on the era's thinkers (their
  // connection-weighted centre), not on the era's midpoint. The button for
  // the era at the centre of the screen stays lit, so the bar doubles as a
  // "you are here".
  const ERAS = [
    { label: "Ancient", from: -Infinity, to: 400 },
    { label: "Medieval", from: 400, to: 1450 },
    { label: "Early modern", from: 1450, to: 1780 },
    { label: "1800s", from: 1780, to: 1900 },
    { label: "1900s", from: 1900, to: Infinity },
  ];
  const eraBar = document.getElementById("era-bar");
  eraBar.innerHTML = ERAS.map((e, i) =>
    `<button class="era-chip" type="button" data-era="${i}">${e.label}</button>`).join("");
  const eraX = (year) => (Number.isFinite(year) ? Graph.yearToX(year) : year);
  function eraTargetX(era) {
    const x1 = eraX(era.from), x2 = eraX(era.to);
    let sum = 0, weight = 0;
    Graph.getCy().nodes().forEach((n) => {
      const x = n.position("x");
      if (x < x1 || x >= x2) return;
      const w = 1 + n.degree(false);
      sum += x * w;
      weight += w;
    });
    return weight ? sum / weight : (x1 + x2) / 2;
  }
  eraBar.addEventListener("click", (e) => {
    const chip = e.target.closest(".era-chip");
    if (!chip) return;
    const cy = Graph.getCy();
    const x = eraTargetX(ERAS[Number(chip.dataset.era)]);
    cy.stop();
    cy.animate({ pan: { x: cy.width() / 2 - x * cy.zoom(), y: cy.pan().y } },
      { duration: 450, easing: "ease-in-out" });
  });
  function syncEraChips() {
    const cy = Graph.getCy();
    if (!cy) return;
    const cx = (cy.width() / 2 - cy.pan().x) / cy.zoom();
    const current = ERAS.findIndex((e) => cx >= eraX(e.from) && cx < eraX(e.to));
    eraBar.querySelectorAll(".era-chip").forEach((chip, i) => {
      const on = i === current;
      if (chip.classList.contains("is-current") === on) return;
      chip.classList.toggle("is-current", on);
      if (on) {
        chip.setAttribute("aria-current", "true");
        // On phones the bar scrolls; keep the lit era in view.
        eraBar.scrollLeft = chip.offsetLeft - (eraBar.clientWidth - chip.offsetWidth) / 2;
      } else {
        chip.removeAttribute("aria-current");
      }
    });
  }

  // Coalesce both syncs into a single rAF so frequent pan/zoom/render
  // events don't thrash the DOM.
  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => { syncQueued = false; syncLaneLabels(); syncTimeAxis(); syncEraChips(); });
  }
  renderLaneLabels();
  scheduleSync();
  window.addEventListener("resize", scheduleSync);

  // --- Drawer ------------------------------------------------------------
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
    if (typeof Search !== "undefined") Search.hideSuggestions();
  }
  // Picking a search suggestion focuses the node, then closes the drawer so the
  // highlighted node is revealed on the graph (the card is not opened).
  Search.init(philosophers, relations, Graph, { onSelect: () => closeDrawer() });
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
  // Escape closes the drawer — matches the add-sheet and trails-sheet, which
  // already dismiss on Escape; the drawer was the one overlay missing this.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer(); });

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
  const addGenerateBtn = document.getElementById("add-generate");
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
    addName.disabled = false;
    addGenerateBtn.disabled = false;
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

    // Lock the form for the whole async round-trip below — without this, a
    // fast double-tap (or holding Enter) fires a second concurrent
    // Generator.generate() call, and whichever resolves last silently wins.
    addName.disabled = true;
    addGenerateBtn.disabled = true;

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
      addName.disabled = false;
      addGenerateBtn.disabled = false;
      return;
    }
    addStatus.hidden = true;
    addName.disabled = false;
    addGenerateBtn.disabled = false;
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
    Router.navigate("p/" + node.id);
    scheduleSync();
  }

  // --- Welcome overlay (first visit) -------------------------------------
  // Skip it if the page loaded straight into a shared link — a "how to
  // read this map" interruption is the wrong welcome for someone arriving
  // at a specific philosopher, essay, or trail stop.
  const welcome = document.getElementById("welcome");
  if (!localStorage.getItem("welcomeSeen") && !openedFromLink) welcome.hidden = false;
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
