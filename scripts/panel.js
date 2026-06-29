/* ============================================================
   panel.js — Side panel.
   Shows a philosopher card (with expandable ideas, works, and
   connections) or a relation essay. Connections expand INLINE:
   tapping one reveals the relation's content right inside the
   card, with a button to jump to the other philosopher's card.
   ============================================================ */

const Panel = (() => {
  const el = document.getElementById("panel");
  const content = document.getElementById("panel-content");
  const closeBtn = document.getElementById("panel-close");
  const backdrop = document.getElementById("panel-backdrop");

  // Human-readable label for each relation type.
  const TYPE_LABEL = {
    continuacion: "Continuation",
    critica: "Critique",
    reinterpretacion: "Reinterpretation",
    radicalizacion: "Radicalization",
    inversion: "Inversion",
    diagnostico: "Diagnosis",
  };

  // Human-readable label for each school (also used by search.js).
  const SCHOOL_LABEL = {
    "presocratic": "Pre-Socratics",
    "classical": "Classical Greek",
    "hellenistic": "Hellenistic",
    "late-antique": "Late Antiquity",
    "medieval": "Medieval",
    "renaissance": "Renaissance / Early Modern",
    "rationalism": "Rationalism",
    "empiricism": "Empiricism",
    "enlightenment": "Enlightenment",
    "german-idealism": "German Idealism",
    "19c-continental": "19th-c. Continental",
    "utilitarianism": "Utilitarianism",
    "pragmatism": "Pragmatism",
    "phenomenology-existentialism": "Phenomenology / Existentialism",
    "analytic": "Analytic",
    "critical-theory": "Critical Theory",
    "hermeneutics": "Hermeneutics",
    "poststructuralism": "Structuralism / Post-structuralism",
    "political": "Political philosophy (20c)",
    "feminist": "Feminist philosophy",
    "philosophy-of-science": "Philosophy of science",
  };

  // Graph data + navigation callbacks, injected once via setData().
  let DATA = { philosophers: [], relations: [], byId: {} };
  let onPhilosopherTap = null;      // (id) => void  — open that philosopher's card
  let onConnectionExpand = null;    // (relation) => void — e.g. highlight the edge
  let onConnectionCollapse = null;  // (philosopherId) => void — restore focus
  let loadEssay = null;             // (path) => Promise<string>
  let currentP = null;              // the philosopher currently shown

  function setData(philosophers, relations, byId, callbacks) {
    DATA = { philosophers, relations, byId };
    callbacks = callbacks || {};
    onPhilosopherTap = callbacks.onPhilosopherTap || null;
    onConnectionExpand = callbacks.onConnectionExpand || null;
    onConnectionCollapse = callbacks.onConnectionCollapse || null;
    loadEssay = callbacks.loadEssay || null;
  }

  let onCloseCallback = null;

  function showBackdrop() {
    if (window.innerWidth > 820) return;
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("is-shown"));
  }
  function hideBackdrop() {
    backdrop.classList.remove("is-shown");
    setTimeout(() => { backdrop.hidden = true; }, 220);
  }

  function open() {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    el.scrollTop = 0;
    showBackdrop();
  }
  function close() {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    hideBackdrop();
    if (onCloseCallback) onCloseCallback();
  }

  closeBtn.addEventListener("click", close);
  if (backdrop) backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // Escape user text when assembling HTML manually.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Wikipedia search link for a term (always resolves — no guessed slugs).
  function searchLink(term) {
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(term)}`;
  }
  // Strip a trailing "(1781)" style year from a work title for cleaner search.
  function stripYear(s) { return s.replace(/\s*\(\d{3,4}[^)]*\)\s*$/, "").trim(); }

  // One expandable accordion item (used for ideas and works).
  function accItem(title, detail, searchTerm, linkLabel) {
    const body = `${detail ? `<p>${esc(detail)}</p>` : ""}<a class="acc-link" href="${searchLink(searchTerm)}" target="_blank" rel="noopener">${linkLabel} ↗</a>`;
    return `
      <div class="acc-item">
        <button class="acc-head" type="button" aria-expanded="false">
          <span class="acc-title">${esc(title)}</span>
          <span class="acc-chevron">›</span>
        </button>
        <div class="acc-body" hidden>${body}</div>
      </div>`;
  }

  // One connection row (collapsed). Body is filled lazily on first expand.
  function connItem(rel, otherId) {
    const other = DATA.byId[otherId];
    const otherName = other ? other.name : otherId;
    const typeLabel = TYPE_LABEL[rel.type] || rel.type;
    return `
      <div class="acc-item">
        <button class="acc-head conn-row" type="button" aria-expanded="false"
                data-rel="${esc(rel.id)}" data-other="${esc(otherId)}">
          <span class="conn-dot" style="background:var(--rel-${rel.type})"></span>
          <span class="conn-name">${esc(otherName)}</span>
          <span class="conn-type">${esc(typeLabel)}</span>
          <span class="acc-chevron">›</span>
        </button>
        <div class="acc-body conn-body" hidden></div>
      </div>`;
  }

  // Fill a connection body the first time it is opened.
  function fillConnBody(body, rel, otherId) {
    const sourceName = DATA.byId[rel.source] ? DATA.byId[rel.source].name : rel.source;
    const targetName = DATA.byId[rel.target] ? DATA.byId[rel.target].name : rel.target;
    const other = DATA.byId[otherId];
    const quotes = (rel.quotes || []).map((c) => `
      <div class="cite"><span class="cite__text">«${esc(c.text)}»</span><span class="cite__src">${esc(c.source)}</span></div>
    `).join("");

    body.innerHTML = `
      <div class="conn-bridge">${esc(sourceName)} <span class="arrow">→</span> ${esc(targetName)}${rel.bridge ? ` · ${esc(rel.bridge)}` : ""}</div>
      ${rel.summary ? `<p class="conn-summary">${esc(rel.summary)}</p>` : ""}
      <div class="conn-essay"></div>
      ${quotes ? `<div class="conn-quotes">${quotes}</div>` : ""}
      <button class="conn-goto" type="button" data-id="${esc(otherId)}">Open ${esc(other ? other.name : otherId)}'s card →</button>
    `;
    // Load the full essay inline, if this relation has one.
    if (rel.essay && loadEssay) {
      loadEssay(rel.essay).then((md) => {
        if (md && window.marked) body.querySelector(".conn-essay").innerHTML = window.marked.parse(md);
      });
    }
  }

  // --- Philosopher view ----------------------------------------------------
  function showPhilosopher(p) {
    currentP = p;
    const schoolLabel = SCHOOL_LABEL[p.school] || p.school || "";
    const schoolColor = p.school ? `var(--school-${p.school})` : "var(--ink-soft)";
    const ideaDetails = p.idea_details || {};
    const workDetails = p.work_details || {};

    // Ideas & works as expandable accordions.
    const ideas = (p.central_ideas || []).map((i) => {
      const title = i && i.title ? i.title : i;
      const detail = (i && i.detail) || ideaDetails[title] || "";
      return accItem(title, detail, title, "Look it up");
    }).join("");
    const works = (p.key_works || []).map((w) => {
      const title = w && w.title ? w.title : w;
      const detail = (w && w.detail) || workDetails[title] || "";
      return accItem(title, detail, stripYear(title), "Find this work");
    }).join("");

    // Connections — derived from relations. Arrows point later → earlier.
    const looksBack = DATA.relations.filter((r) => r.source === p.id);
    const takenUp = DATA.relations.filter((r) => r.target === p.id);
    const looksBackHtml = looksBack.map((r) => connItem(r, r.target)).join("");
    const takenUpHtml = takenUp.map((r) => connItem(r, r.source)).join("");

    const quoteHtml = p.signature_quote ? `
      <blockquote class="ph-quote">
        «${esc(p.signature_quote.text)}»
        ${p.signature_quote.source ? `<cite>— ${esc(p.signature_quote.source)}</cite>` : ""}
      </blockquote>` : "";

    const links = (p.links || []).slice();
    links.push({ label: "Wikipedia", url: searchLink(p.name) });
    const linksHtml = links.map((l) =>
      `<a class="ph-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`
    ).join("");

    content.innerHTML = `
      <span class="ph-school" style="background:${schoolColor}">${esc(schoolLabel)}</span>
      <h2 class="ph-name">${esc(p.name)}</h2>
      <div class="ph-dates">${esc(p.dates || "")}</div>
      <div class="ph-meta"><strong>Tradition:</strong> ${esc(p.tradition || "—")}</div>
      <div class="ph-meta"><strong>Region:</strong> ${esc(p.region || "—")}</div>
      <p class="ph-desc">${esc(p.short_description || "")}</p>
      ${quoteHtml}
      ${ideas ? `<div class="ph-section-title">Central ideas <span class="conn-hint">tap to expand</span></div><div class="acc-list">${ideas}</div>` : ""}
      ${works ? `<div class="ph-section-title">Key works</div><div class="acc-list">${works}</div>` : ""}
      ${looksBackHtml ? `<div class="ph-section-title">Looks back to <span class="conn-count">${looksBack.length}</span></div><div class="ph-connections">${looksBackHtml}</div>` : ""}
      ${takenUpHtml ? `<div class="ph-section-title">Taken up by <span class="conn-count">${takenUp.length}</span></div><div class="ph-connections">${takenUpHtml}</div>` : ""}
      <div class="ph-links">${linksHtml}</div>
    `;
    open();
  }

  // --- Relation / essay view (used by graph edge taps) --------------------
  function showRelation(rel, sourceName, targetName, markdown) {
    const color = `var(--rel-${rel.type})`;
    const label = TYPE_LABEL[rel.type] || rel.type;
    const quotes = (rel.quotes || []).map((c) => `
      <div class="cite"><span class="cite__text">«${esc(c.text)}»</span><span class="cite__src">${esc(c.source)}</span></div>
    `).join("");
    const bodyHtml = markdown && window.marked ? window.marked.parse(markdown) : "";

    content.innerHTML = `
      <span class="essay-kicker" style="background:${color}">${esc(label)}</span>
      <h2 class="essay-title">${esc(rel.title)}</h2>
      <div class="essay-bridge">
        ${esc(sourceName)} <span class="arrow">→</span> ${esc(targetName)}
        &nbsp;·&nbsp; ${esc(rel.bridge || "")}
      </div>
      ${rel.summary ? `<p class="essay-summary">${esc(rel.summary)}</p>` : ""}
      ${bodyHtml ? `<div class="essay-body">${bodyHtml}</div>` : ""}
      ${quotes ? `<div class="essay-cites"><div class="ph-section-title">Quotations</div>${quotes}</div>` : ""}
    `;
    open();
  }

  // --- Delegated interactions inside the panel ----------------------------
  content.addEventListener("click", (e) => {
    // "Open X's card" button inside an expanded connection.
    const goto = e.target.closest(".conn-goto");
    if (goto) { if (onPhilosopherTap) onPhilosopherTap(goto.dataset.id); return; }

    const head = e.target.closest(".acc-head");
    if (!head) return;
    const body = head.nextElementSibling;
    const wasOpen = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!wasOpen));
    body.hidden = wasOpen;

    // Connection rows: lazy-fill on first open; tie to the graph edge.
    if (head.classList.contains("conn-row")) {
      const rel = DATA.relations.find((r) => r.id === head.dataset.rel);
      if (!wasOpen) {
        if (rel && !body.dataset.filled) { fillConnBody(body, rel, head.dataset.other); body.dataset.filled = "1"; }
        if (rel && onConnectionExpand) onConnectionExpand(rel);
      } else {
        if (currentP && onConnectionCollapse) onConnectionCollapse(currentP.id);
      }
    }
  });

  // Swipe-down on the grip dismisses the bottom sheet (mobile).
  const grip = el.querySelector(".panel__grip");
  if (grip) {
    let startY = null;
    grip.addEventListener("touchstart", (e) => { startY = e.touches[0].clientY; }, { passive: true });
    grip.addEventListener("touchmove", (e) => {
      if (startY == null) return;
      if (e.touches[0].clientY - startY > 60) { close(); startY = null; }
    }, { passive: true });
    grip.addEventListener("touchend", () => { startY = null; });
  }

  function onClose(cb) { onCloseCallback = cb; }

  return { showPhilosopher, showRelation, close, onClose, setData, SCHOOL_LABEL, TYPE_LABEL };
})();
