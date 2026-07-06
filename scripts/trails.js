/* ============================================================
   trails.js — Guided trails through the graph.
   A trail is a curated, ordered sequence of relations that
   follows one theme (e.g. "The Death of God") chronologically.
   Walking a trail: the whole path lights up on the graph, the
   viewport pans stop-to-stop, and each stop opens the relation
   essay framed by a trail-specific note. Progress persists in
   localStorage so trails can be resumed and completed.
   ============================================================ */

const Trails = (() => {
  const KEY = "philographTrailProgress";

  let TRAILS = [];
  let deps = null;        // { byRelId, byId, openRelation }
  let active = null;      // { trail, step } while walking

  // DOM (resolved in init)
  let sheet, backdrop, listEl, bar, barTitle, barProg;

  // --- Progress persistence ----------------------------------------------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }
  function setProgress(trailId, patch) {
    const p = loadProgress();
    p[trailId] = { ...(p[trailId] || {}), ...patch };
    saveProgress(p);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // --- Trails sheet (the list) --------------------------------------------
  function renderList() {
    const prog = loadProgress();
    listEl.innerHTML = TRAILS.map((t) => {
      const st = prog[t.id] || {};
      const mins = Math.round(t.steps.length * 2.5);
      let stateHtml;
      if (st.done) {
        stateHtml = `<span class="trail-card__state is-done">✓ Completed — walk it again</span>`;
      } else if (st.step > 0) {
        stateHtml = `<span class="trail-card__state is-going">Continue · stop ${st.step + 1} of ${t.steps.length}</span>`;
      } else {
        stateHtml = `<span class="trail-card__state">Start →</span>`;
      }
      return `
        <button class="trail-card" type="button" data-trail="${esc(t.id)}">
          <span class="trail-card__title">${esc(t.title)}</span>
          <span class="trail-card__tagline">${esc(t.tagline)}</span>
          <span class="trail-card__meta">${t.steps.length} stops · ≈ ${mins} min ${stateHtml}</span>
        </button>`;
    }).join("");
  }

  function openSheet() {
    renderList();
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("is-shown"));
  }
  function closeSheet() {
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    backdrop.classList.remove("is-shown");
    setTimeout(() => { backdrop.hidden = true; }, 220);
  }

  // --- Walking a trail -----------------------------------------------------
  function edgeIdsOf(trail) { return trail.steps.map((s) => s.rel); }

  function start(trailId) {
    const trail = TRAILS.find((t) => t.id === trailId);
    if (!trail) return;
    const st = loadProgress()[trailId] || {};
    // Resume where they left off; restart if completed.
    const step = st.done ? 0 : Math.min(st.step || 0, trail.steps.length - 1);
    active = { trail, step };
    closeSheet();
    bar.hidden = false;
    showStep(step);
  }

  function showStep(i) {
    if (!active) return;
    const { trail } = active;
    if (i < 0 || i >= trail.steps.length) return;
    active.step = i;
    setProgress(trail.id, { step: i });

    const stepDef = trail.steps[i];
    const rel = deps.byRelId[stepDef.rel];
    if (!rel) return;

    // Graph: light the whole path, pop the current hop, pan to it.
    Graph.showTrail(edgeIdsOf(trail), rel.id);
    Graph.focusEdge(rel.id);

    // Panel: essay + trail framing.
    const next = trail.steps[i + 1];
    const nextRel = next ? deps.byRelId[next.rel] : null;
    const nextName = nextRel && deps.byId[nextRel.source] ? deps.byId[nextRel.source].name : "";
    deps.openRelation(rel, {
      title: trail.title,
      step: i + 1,
      total: trail.steps.length,
      intro: i === 0 ? trail.intro : "",
      note: stepDef.note || "",
      isLast: i === trail.steps.length - 1,
      nextLabel: nextName,
    });

    // Bar
    barTitle.textContent = trail.title;
    barProg.textContent = `${i + 1}/${trail.steps.length}`;
  }

  function next() {
    if (!active) return;
    if (active.step < active.trail.steps.length - 1) showStep(active.step + 1);
  }
  function prev() {
    if (!active) return;
    if (active.step > 0) showStep(active.step - 1);
  }

  function finish() {
    if (!active) return;
    const { trail } = active;
    setProgress(trail.id, { step: 0, done: true });
    const centuries = "twenty-five centuries of argument"; // playful constant; stats below are real
    Panel.showCustom(`
      <div class="trail-done">
        <div class="trail-done__badge">✓</div>
        <h2 class="trail-done__title">Trail complete</h2>
        <p class="trail-done__text">You walked <strong>${esc(trail.title)}</strong> — ${trail.steps.length} stops, one idea evolving across the centuries.</p>
        <div class="trail-nav">
          <button class="ghost-btn trail-exit" type="button">Back to the map</button>
          <button class="primary-btn trail-browse" type="button">More trails →</button>
        </div>
      </div>
    `);
  }

  function exit() {
    active = null;
    bar.hidden = true;
    Graph.clearHighlight();
    Panel.close();
  }

  // Re-apply the trail path highlight (e.g. after a background tap cleared it).
  function rehighlight() {
    if (!active) return;
    const rel = deps.byRelId[active.trail.steps[active.step].rel];
    Graph.showTrail(edgeIdsOf(active.trail), rel ? rel.id : null);
  }

  function isActive() { return !!active; }

  // --- Init ----------------------------------------------------------------
  function init(trails, dependencies) {
    TRAILS = trails || [];
    deps = dependencies;

    sheet = document.getElementById("trails-sheet");
    backdrop = document.getElementById("trails-backdrop");
    listEl = document.getElementById("trails-list");
    bar = document.getElementById("trail-bar");
    barTitle = bar.querySelector(".trail-bar__title");
    barProg = bar.querySelector(".trail-bar__prog");

    document.getElementById("trails-btn").addEventListener("click", openSheet);
    document.getElementById("trails-close").addEventListener("click", closeSheet);
    backdrop.addEventListener("click", closeSheet);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sheet.classList.contains("is-open")) closeSheet();
    });

    // Welcome overlay shortcut (optional element).
    const welcomeBtn = document.getElementById("welcome-trails");
    if (welcomeBtn) welcomeBtn.addEventListener("click", () => {
      const welcome = document.getElementById("welcome");
      if (welcome) { welcome.hidden = true; localStorage.setItem("welcomeSeen", "1"); }
      openSheet();
    });

    // Pick a trail from the list.
    listEl.addEventListener("click", (e) => {
      const card = e.target.closest(".trail-card");
      if (card) start(card.dataset.trail);
    });

    // Trail bar controls.
    bar.querySelector(".trail-bar__exit").addEventListener("click", exit);
    bar.querySelector(".trail-bar__prev").addEventListener("click", prev);
    bar.querySelector(".trail-bar__next").addEventListener("click", next);
    // Tapping the bar's title re-opens the current stop (e.g. after closing the panel).
    bar.querySelector(".trail-bar__info").addEventListener("click", () => {
      if (active) showStep(active.step);
    });

    // Buttons rendered inside the panel (next/prev/finish/browse/exit).
    document.addEventListener("philograph:trail", (e) => {
      const a = e.detail.action;
      if (a === "trail-next") next();
      else if (a === "trail-prev") prev();
      else if (a === "trail-finish") finish();
      else if (a === "trail-browse") { exit(); openSheet(); }
      else if (a === "trail-exit") exit();
    });
  }

  return { init, openSheet, isActive, rehighlight };
})();
