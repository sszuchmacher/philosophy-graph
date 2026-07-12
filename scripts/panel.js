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
  const shareBtn = document.getElementById("panel-share");
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
  let loadDetails = null;           // (philosopherId) => Promise<{ideas,works}|null>
  let currentP = null;              // the philosopher currently shown

  function setData(philosophers, relations, byId, callbacks) {
    DATA = { philosophers, relations, byId };
    callbacks = callbacks || {};
    onPhilosopherTap = callbacks.onPhilosopherTap || null;
    onConnectionExpand = callbacks.onConnectionExpand || null;
    onConnectionCollapse = callbacks.onConnectionCollapse || null;
    loadEssay = callbacks.loadEssay || null;
    loadDetails = callbacks.loadDetails || null;
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

  // `shareable` is false only for the trail-completion screen (showCustom),
  // where there's no single philosopher/relation URL worth copying.
  function open(shareable) {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    el.scrollTop = 0;
    if (shareBtn) shareBtn.hidden = shareable === false;
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

  // Share the current view's URL: native share sheet on mobile (Messages,
  // WhatsApp, etc.), clipboard copy elsewhere. The URL is already correct
  // by the time this fires — Router keeps the hash in sync as the panel
  // opens for a philosopher, relation, or trail stop.
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = location.href;
      if (navigator.share) {
        try { await navigator.share({ title: document.title, url }); } catch { /* user cancelled */ }
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(url); if (window.Toast) Toast.show("Link copied"); return; }
        catch { /* fall through to prompt */ }
      }
      window.prompt("Copy this link:", url);
    });
  }

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

  // One expandable accordion item (used for ideas and works). Renders the
  // short inline detail immediately; if a long-form entry loads later,
  // upgradeAccBodies() replaces the .acc-detail region with full markdown.
  // `kind`/`title` become data attributes so the upgrade can find this row.
  function accItem(title, detail, searchTerm, linkLabel, kind) {
    const body = `<div class="acc-detail">${detail ? `<p>${esc(detail)}</p>` : ""}</div>` +
      `<a class="acc-link" href="${searchLink(searchTerm)}" target="_blank" rel="noopener">${linkLabel} ↗</a>`;
    return `
      <div class="acc-item" data-kind="${esc(kind)}" data-key="${esc(title)}">
        <button class="acc-head" type="button" aria-expanded="false">
          <span class="acc-title">${esc(title)}</span>
          <span class="acc-chevron">›</span>
        </button>
        <div class="acc-body" hidden>${body}</div>
      </div>`;
  }

  // Replace short previews with full markdown once long-form details load.
  // `details` = { ideas: {title: md}, works: {title: md} }.
  function upgradeAccBodies(details) {
    if (!details) return;
    [["idea", details.ideas], ["work", details.works]].forEach(([kind, map]) => {
      if (!map) return;
      Object.entries(map).forEach(([title, md]) => {
        if (!md) return;
        const item = content.querySelector(`.acc-item[data-kind="${cssEsc(kind)}"][data-key="${cssEsc(title)}"]`);
        if (!item) return;
        const region = item.querySelector(".acc-detail");
        if (!region) return;
        region.innerHTML = window.marked ? window.marked.parse(md) : `<p>${esc(md)}</p>`;
        item.classList.add("acc-item--long");
      });
    });
  }

  // Escape a string for use inside a CSS attribute selector.
  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\\]]/g, "\\$&");
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
      return accItem(title, detail, title, "Look it up", "idea");
    }).join("");
    const works = (p.key_works || []).map((w) => {
      const title = w && w.title ? w.title : w;
      const detail = (w && w.detail) || workDetails[title] || "";
      return accItem(title, detail, stripYear(title), "Find this work", "work");
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

    // Upgrade short idea/work previews to full ~220-word entries, if this
    // philosopher has long-form details. Instant preview shows meanwhile;
    // only patch if the card hasn't changed by the time the file loads.
    if (p.long_docs && loadDetails) {
      loadDetails(p.id).then((details) => {
        if (details && currentP === p) upgradeAccBodies(details);
      });
    }
  }

  // --- Relation / essay view (used by graph edge taps and trails) ---------
  // `trail` (optional): { title, step, total, note, isLast, nextLabel }
  // renders the trail context above the essay and prev/next nav below it.
  function showRelation(rel, sourceName, targetName, markdown, trail) {
    const color = `var(--rel-${rel.type})`;
    const label = TYPE_LABEL[rel.type] || rel.type;
    const quotes = (rel.quotes || []).map((c) => `
      <div class="cite"><span class="cite__text">«${esc(c.text)}»</span><span class="cite__src">${esc(c.source)}</span></div>
    `).join("");
    const bodyHtml = markdown && window.marked ? window.marked.parse(markdown) : "";

    const trailTop = trail ? `
      <div class="trail-ctx">
        <div class="trail-ctx__kicker">${esc(trail.title)} · stop ${trail.step} of ${trail.total}</div>
        ${trail.intro ? `<p class="trail-ctx__intro">${esc(trail.intro)}</p>` : ""}
        ${trail.note ? `<p class="trail-ctx__note">${esc(trail.note)}</p>` : ""}
      </div>` : "";
    const trailNav = trail ? `
      <div class="trail-nav">
        ${trail.step > 1
          ? `<button class="ghost-btn trail-prev" type="button">← Back</button>`
          : `<span></span>`}
        ${trail.isLast
          ? `<button class="primary-btn trail-finish" type="button">Finish trail ✓</button>`
          : `<button class="primary-btn trail-next" type="button">Next: ${esc(trail.nextLabel || "continue")} →</button>`}
      </div>` : "";

    content.innerHTML = `
      ${trailTop}
      <span class="essay-kicker" style="background:${color}">${esc(label)}</span>
      <h2 class="essay-title">${esc(rel.title)}</h2>
      <div class="essay-bridge">
        ${esc(sourceName)} <span class="arrow">→</span> ${esc(targetName)}
        &nbsp;·&nbsp; ${esc(rel.bridge || "")}
      </div>
      ${rel.summary ? `<p class="essay-summary">${esc(rel.summary)}</p>` : ""}
      ${bodyHtml ? `<div class="essay-body">${bodyHtml}</div>` : ""}
      ${quotes ? `<div class="essay-cites"><div class="ph-section-title">Quotations</div>${quotes}</div>` : ""}
      ${trailNav}
    `;
    open();
  }

  // Arbitrary HTML view (used by the trail completion screen).
  function showCustom(html) {
    content.innerHTML = html;
    open(false);
  }

  // --- Delegated interactions inside the panel ----------------------------
  content.addEventListener("click", (e) => {
    // Trail navigation buttons → broadcast; trails.js listens.
    const trailBtn = e.target.closest(".trail-prev, .trail-next, .trail-finish, .trail-browse, .trail-exit");
    if (trailBtn) {
      const action = ["trail-prev", "trail-next", "trail-finish", "trail-browse", "trail-exit"]
        .find((c) => trailBtn.classList.contains(c));
      document.dispatchEvent(new CustomEvent("philograph:trail", { detail: { action } }));
      return;
    }

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

  return { showPhilosopher, showRelation, showCustom, close, onClose, setData, SCHOOL_LABEL, TYPE_LABEL };
})();
