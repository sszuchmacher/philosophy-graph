/* ============================================================
   graph.js — Chronological + school-lane layout.
   Time runs left-to-right (X = year), schools stack as
   horizontal lanes (Y). Deterministic positions; no force-
   directed pileup. Labels keep a readable size and are placed
   by importance where they fit (see relabel). Edges are nearly invisible by default
   and snap to full opacity when their endpoints are selected.
   ============================================================ */

const Graph = (() => {
  let cy = null;
  let handlers = {};
  let laneCenters = {};        // school -> Y in model coords
  let minYear = 0;             // earliest year across all nodes (for X origin)

  // Schools ordered roughly chronologically by first member's birth.
  // This is also the row order of the lanes (top → bottom).
  const SCHOOL_ORDER = [
    "presocratic", "classical", "hellenistic", "late-antique", "medieval",
    "renaissance", "rationalism", "empiricism", "enlightenment", "german-idealism",
    "19c-continental", "utilitarianism", "pragmatism", "phenomenology-existentialism",
    "analytic", "critical-theory", "hermeneutics", "poststructuralism",
    "political", "feminist", "philosophy-of-science",
  ];

  const LANE_HEIGHT = 220;     // vertical spacing between lanes
  const NODE_SIZE = 22;        // dot diameter (model px)

  // Piecewise-linear time scale. History is very unevenly populated: about
  // 0.6 thinkers per century between 0 and 1000 CE, about 46 in the 1900s.
  // A uniform px-per-year scale left antiquity as a vast empty plain and
  // crammed the modern era. Each era gets its own rate; within an era time is
  // still linear, so ordering and relative spacing stay honest.
  // RATES[0] applies before TIME_BREAKS[0], RATES[i] between breaks i-1 and i,
  // and the last rate after the final break.
  const TIME_BREAKS = [-200, 0, 1000, 1500, 1700, 1800, 1900];
  const TIME_RATES = [5, 3, 1, 2.5, 7, 11, 14, 20];   // px per year
  const JITTER = [0, -40, 40, -80, 80, -20, 20]; // sub-row offsets (used only for user-added nodes)

  // Collision-avoidance: keep node centres at least NODE_SEP apart. Same-school
  // contemporaries first stack into vertical slots (V_OFFSETS), and only if a
  // lane's slots are exhausted at a given time do we nudge x rightward.
  // NODE_SEP is sized so a node's wrapped label (~78px wide, ~2 lines tall)
  // clears the next node's body; label stagger (above/below) does the rest.
  const NODE_SEP = 56;         // min centre-to-centre gap (px, model space)
  const V_OFFSETS = [0, -44, 44, -88, 88];   // vertical slots, bounded inside LANE_HEIGHT

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function relColor(type) { return cssVar(`--rel-${type}`) || cssVar("--ink-soft"); }
  function schoolColor(school) { return cssVar(`--school-${school}`) || cssVar("--ink-soft"); }

  // Parse a year out of a "dates" field like "c. 624–546 BCE", "1724–1804", "b. 1929".
  function parseYear(dates) {
    if (!dates) return 1900;
    const bce = /BCE|B\.?C\.?/i.test(dates);
    const nums = (dates.match(/\d{2,4}/g) || []).map(Number);
    if (nums.length === 0) return 1900;
    let v;
    if (/^\s*b\.\s/i.test(dates)) v = nums[0] + 50;      // still living: assume mid-career
    else if (nums.length >= 2) v = (nums[0] + nums[1]) / 2;
    else v = nums[0];
    return bce ? -v : v;
  }

  // Integral of the rate from the first break to `year` (negative before it).
  function timeX(year) {
    let prev = TIME_BREAKS[0];
    if (year <= prev) return (year - prev) * TIME_RATES[0];
    let x = 0;
    for (let i = 1; i <= TIME_BREAKS.length; i++) {
      const next = i < TIME_BREAKS.length ? TIME_BREAKS[i] : Infinity;
      if (year <= next) return x + (year - prev) * TIME_RATES[i];
      x += (next - prev) * TIME_RATES[i];
      prev = next;
    }
    return x;
  }

  // X coordinate for a given year (depends on minYear, set during layout).
  function yearToX(year) { return timeX(year) - timeX(minYear); }

  // Position for a single philosopher. `laneIndex` spreads philosophers
  // within the same school lane so contemporaries don't overlap.
  function positionFor(p, laneIndex) {
    const laneY = laneCenters[p.school] ?? (SCHOOL_ORDER.length * LANE_HEIGHT);
    const idx = laneIndex == null ? 0 : laneIndex;
    return { x: yearToX(parseYear(p.dates)), y: laneY + JITTER[idx % JITTER.length] };
  }

  function computePositions(philosophers) {
    // Bucket by school
    const buckets = {};
    philosophers.forEach((p) => {
      (buckets[p.school] = buckets[p.school] || []).push({ p, year: parseYear(p.dates) });
    });

    const allYears = philosophers.map((p) => parseYear(p.dates));
    minYear = Math.min(...allYears);

    // Compute lane centers in the order specified above.
    laneCenters = {};
    SCHOOL_ORDER.forEach((s, i) => { laneCenters[s] = i * LANE_HEIGHT; });

    const positions = {};
    Object.entries(buckets).forEach(([school, arr]) => {
      arr.sort((a, b) => a.year - b.year);
      const laneY = laneCenters[school] ?? (SCHOOL_ORDER.length * LANE_HEIGHT);
      const placed = [];   // {x, y} already positioned in this lane

      arr.forEach((item) => {
        let x = yearToX(item.year);
        let y = laneY;
        // Greedily find a slot that clears every previously-placed node in the
        // lane. Prefer staying on the true year (x) and stacking vertically;
        // only shift x right when all vertical slots at this x are taken.
        for (let guard = 0; guard < 60; guard++) {
          const slot = V_OFFSETS.find((off) =>
            !placed.some((q) => Math.abs(q.x - x) < NODE_SEP && Math.abs(q.y - (laneY + off)) < NODE_SEP)
          );
          if (slot !== undefined) { y = laneY + slot; break; }
          x += NODE_SEP;   // this time-column is full — move to the next one
        }
        positions[item.p.id] = { x, y };
        placed.push({ x, y });
      });
    });
    return positions;
  }

  function buildElements(philosophers, relations, positions) {
    const nodes = philosophers.map((p) => ({
      data: { id: p.id, label: p.name, school: p.school, ref: p },
      position: positions[p.id],
    }));
    const edges = relations.map((r) => ({
      data: { id: r.id, source: r.source, target: r.target, type: r.type, ref: r },
    }));
    return [...nodes, ...edges];
  }

  function styles() {
    return [
      {
        selector: "node",
        style: {
          "background-color": (n) => schoolColor(n.data("school")),
          label: "data(label)",
          color: cssVar("--ink"),
          "font-family": "Inter, sans-serif",
          "font-size": 10,
          "font-weight": 500,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 4,
          "text-wrap": "wrap",
          "text-max-width": 78,
          "text-outline-color": cssVar("--bg"),
          "text-outline-width": 2,
          "text-opacity": 0,           // hidden by default; toggled by .shown class
          width: NODE_SIZE,
          height: NODE_SIZE,
          "border-width": 0,
          "transition-property": "opacity, border-width, text-opacity",
          "transition-duration": "0.18s",
        },
      },
      // Labels chosen by relabel() for the current zoom.
      { selector: "node.shown", style: { "text-opacity": 1 } },
      // Nodes stacked above their lane's centre line carry their label on top,
      // so stacked contemporaries' labels never collide with the node below.
      { selector: "node.label-above", style: { "text-valign": "top", "text-margin-y": -4 } },
      // Neighbors of the focal node: always labeled, undimmed, normal size.
      { selector: "node.neighbor", style: { "text-opacity": 1, "z-index": 900 } },
      // The focal (tapped) node: accent ring, larger, on top.
      {
        selector: "node.highlight",
        style: {
          "border-width": 3,
          "border-color": cssVar("--accent"),
          width: 30,
          height: 30,
          "text-opacity": 1,
          "z-index": 999,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": (e) => relColor(e.data("type")),
          "target-arrow-color": (e) => relColor(e.data("type")),
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "curve-style": "bezier",
          opacity: 0.07,               // nearly invisible by default — a faint hint
          "transition-property": "opacity, width",
          "transition-duration": "0.18s",
        },
      },
      // Self-loops (Wittgenstein → Wittgenstein, etc.)
      {
        selector: "edge[source = target]",
        style: { "loop-direction": "-45deg", "loop-sweep": "-90deg" },
      },
      // Highlighted edges pop.
      { selector: "edge.highlight", style: { width: 2.2, opacity: 0.95, "z-index": 999 } },
      // Trail edges: the whole path stays visible while walking a trail.
      { selector: "edge.trail", style: { width: 1.8, opacity: 0.5, "z-index": 800 } },
      // Dim hides things that aren't part of the current selection.
      { selector: ".dim", style: { opacity: 0.04 } },
      // While something is selected, also dim non-highlight elements.
    ];
  }

  function clearHighlight() {
    if (!cy) return;
    cy.elements().removeClass("dim highlight neighbor trail");
  }

  // Light up a whole trail: every edge on the path stays visible with its
  // endpoints labeled; the current stop pops with the full highlight.
  function showTrail(edgeIds, currentId) {
    if (!cy) return;
    clearHighlight();
    cy.elements().addClass("dim");
    (edgeIds || []).forEach((id) => {
      const e = cy.getElementById(id);
      if (e.empty()) return;
      e.removeClass("dim").addClass("trail");
      e.connectedNodes().removeClass("dim").addClass("neighbor");
    });
    if (currentId) {
      const cur = cy.getElementById(currentId);
      if (!cur.empty()) cur.removeClass("trail").addClass("highlight");
    }
  }

  // Pan/zoom so both endpoints of an edge are comfortably in view.
  function focusEdge(id) {
    if (!cy) return;
    const e = cy.getElementById(id);
    if (e.empty()) return;
    cy.animate({ fit: { eles: e.connectedNodes(), padding: 130 } }, { duration: 450 });
  }

  // Trail framing: like focusEdge, but frames the hop into the part of the
  // graph the essay sheet does NOT cover, so the highlighted pair stays
  // visible while you read. On mobile the sheet is a bottom peek (frame into
  // the top strip); on desktop it's a right rail (frame into the left area).
  // The trail bar's own height is measured so the pair clears it too.
  function focusTrailHop(id) {
    if (!cy) return;
    const e = cy.getElementById(id);
    if (e.empty()) return;
    const bb = e.connectedNodes().boundingBox();
    const W = cy.width(), H = cy.height();
    const mobile = window.innerWidth <= 820;

    let top = 0, bottom = 0, right = 0;
    const bar = document.getElementById("trail-bar");
    if (bar && !bar.hidden) top = bar.getBoundingClientRect().height + 10;
    if (mobile) {
      bottom = Math.round(H * 0.58);                       // essay peek height
    } else {
      right = Math.min(460, window.innerWidth * 0.92) + 12; // right rail width
    }

    const pad = mobile ? 44 : 80;
    const availW = Math.max(80, W - right - 2 * pad);
    const availH = Math.max(80, H - top - bottom - 2 * pad);
    const fitZoom = Math.min(availW / Math.max(bb.w, 1), availH / Math.max(bb.h, 1));
    const zoom = Math.max(0.35, Math.min(fitZoom, 1.25));

    const mx = bb.x1 + bb.w / 2, my = bb.y1 + bb.h / 2;    // model-space centre
    const rx = (W - right) / 2;                            // centre of visible band
    const ry = top + (H - top - bottom) / 2;
    cy.animate({ zoom, pan: { x: rx - mx * zoom, y: ry - my * zoom } },
      { duration: 450, easing: "ease-in-out" });
  }

  // Focal node gets .highlight (ring + larger); its neighbors get
  // .neighbor (labeled, undimmed, normal size); everything else dims.
  function highlightNode(id) {
    const node = cy.getElementById(id);
    if (node.empty()) return;
    const neighborhood = node.closedNeighborhood();
    cy.elements().addClass("dim");
    neighborhood.removeClass("dim");
    node.connectedEdges().addClass("highlight");
    neighborhood.nodes().addClass("neighbor");
    node.removeClass("neighbor").addClass("highlight");
  }

  function highlightEdge(id) {
    const edge = cy.getElementById(id);
    if (edge.empty()) return;
    cy.elements().addClass("dim");
    edge.removeClass("dim").addClass("highlight");
    edge.connectedNodes().removeClass("dim").addClass("neighbor");
  }

  function focusNode(id) {
    const node = cy.getElementById(id);
    if (node.empty()) return;
    cy.animate({ center: { eles: node }, zoom: 1.0 }, { duration: 350 });
    clearHighlight();
    highlightNode(id);
  }

  // Center the viewport on a school's lane (used by the drawer's school links).
  function focusSchool(school) {
    if (!cy) return;
    const nodes = cy.nodes(`[school = "${school}"]`);
    if (nodes.empty()) return;
    cy.animate({ fit: { eles: nodes, padding: 40 } }, { duration: 400 });
  }

  function setTypeVisible(type, visible) {
    cy.edges(`[type = "${type}"]`).style("display", visible ? "element" : "none");
  }

  function setSchoolVisible(school, visible) {
    const nodes = cy.nodes(`[school = "${school}"]`);
    nodes.style("display", visible ? "element" : "none");
    nodes.connectedEdges().style("display", visible ? "element" : "none");
    relabel();   // hidden lanes free up label space
  }

  function refreshTheme() { if (cy) { cy.style(styles()); relabel(); } }

  // Inject a newly generated philosopher + its relations into the live
  // graph, position it, flash a highlight, and pan to it. Returns true on
  // success, false if the id already exists (caller can focus instead).
  function addPhilosopher(philosopher, relations) {
    if (!cy) return false;
    if (!cy.getElementById(philosopher.id).empty()) return false;

    // Count existing nodes in this lane to choose a non-overlapping offset.
    const laneCount = cy.nodes(`[school = "${philosopher.school}"]`).length;
    const pos = positionFor(philosopher, laneCount);

    cy.add({ group: "nodes", data: { id: philosopher.id, label: philosopher.name, school: philosopher.school, ref: philosopher }, position: pos });
    const addedLaneY = laneCenters[philosopher.school];
    if (addedLaneY != null && pos.y < addedLaneY) cy.getElementById(philosopher.id).addClass("label-above");
    (relations || []).forEach((r) => {
      // Only add edges whose endpoints exist.
      if (cy.getElementById(r.source).empty() || cy.getElementById(r.target).empty()) return;
      if (!cy.getElementById(r.id).empty()) return;
      cy.add({ group: "edges", data: { id: r.id, source: r.source, target: r.target, type: r.type, ref: r } });
    });

    // Re-run label placement so the new node's label competes for space.
    relabel();
    clearHighlight();
    highlightNode(philosopher.id);
    cy.animate({ center: { eles: cy.getElementById(philosopher.id) }, zoom: Math.max(cy.zoom(), 0.7) }, { duration: 450 });
    return true;
  }

  // Frame the graph: zoom in just enough to read labels, then centre on the
  // busiest stretch of the map. Every node is tried as a window centre; the
  // window (the viewport at the target zoom) holding the most thinkers,
  // weighted by connections so hubs pull harder, wins, and the view settles
  // on that window's weighted centroid. Data-driven, so it keeps working as
  // the time scale, lanes or dataset change.
  function framInitial() {
    const containerW = cy.width();
    const containerH = cy.height();
    const isMobile = containerW < 700;
    // Above the label threshold (0.42) so users see names immediately on desktop.
    // Slightly lower on mobile so more lanes fit at a glance.
    const targetZoom = isMobile ? 0.55 : 0.6;
    const halfW = containerW / targetZoom / 2;
    const halfH = containerH / targetZoom / 2;
    const pts = cy.nodes().map((n) => ({ x: n.position("x"), y: n.position("y"), w: 1 + n.degree(false) }));
    const inWindow = (c) => pts.filter((p) => Math.abs(p.x - c.x) <= halfW && Math.abs(p.y - c.y) <= halfH);
    let best = [], bestScore = -1;
    pts.forEach((c) => {
      const members = inWindow(c);
      const score = members.reduce((s, p) => s + p.w, 0);
      if (score > bestScore) { bestScore = score; best = members; }
    });
    const total = best.reduce((s, p) => s + p.w, 0) || 1;
    const focusX = best.reduce((s, p) => s + p.x * p.w, 0) / total;
    const focusY = best.reduce((s, p) => s + p.y * p.w, 0) / total;
    cy.zoom({ level: targetZoom, renderedPosition: { x: containerW / 2, y: containerH / 2 } });
    cy.pan({ x: containerW / 2 - focusX * targetZoom, y: containerH / 2 - focusY * targetZoom });
  }

  // Zoom-dependent labels. Labels keep a readable on-screen size (never
  // below LABEL_MIN_PX, capped at LABEL_MAX_PX when zoomed in), so zoomed
  // out a label is large relative to the gaps between thinkers and only a
  // few fit. Which ones: greedily, most-connected first, a label is shown
  // only if its box clears every label already placed and every other
  // thinker's dot that is big enough on screen to matter (below
  // DOT_BLOCK_PX only already-labelled dots block, so a speck can't veto a
  // hub's name). Hubs win when zoomed out; names fill in as you zoom.
  // Geometry here depends only on zoom (pan is a translation), so labels
  // stay stable while panning. Focused nodes (.highlight/.neighbor) keep
  // their forced labels via the stylesheet regardless.
  const BASE_FONT = 10;         // model px; natural size when zoomed in
  const LABEL_MIN_PX = 11;      // on-screen floor
  const LABEL_MAX_PX = 15;      // on-screen cap
  const LABEL_GAP_PX = 3;       // breathing room between labels, on screen
  const DOT_BLOCK_PX = 9;       // dots at least this big on screen block labels
  const LABEL_BOX = { includeNodes: false, includeEdges: false, includeLabels: true, includeOverlays: false };
  const BODY_BOX = { includeNodes: true, includeEdges: false, includeLabels: false, includeOverlays: false };

  function overlaps(a, b) {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  }

  function relabel() {
    if (!cy) return;
    const z = cy.zoom();
    const f = Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, BASE_FONT * z)) / z;
    const gap = LABEL_GAP_PX / z;
    const nodes = cy.nodes().filter((n) => n.style("display") !== "none");
    const isAbove = (n) => n.style("text-valign") === "top";
    const sideStyle = (above) => ({
      "text-valign": above ? "top" : "bottom",
      "text-margin-y": (above ? -1 : 1) * f * 0.35,
    });

    // One batched restyle at the new size (keeping each label's current side),
    // then measure every label once.
    cy.batch(() => {
      nodes.forEach((n) => n.style({
        "font-size": f,
        "text-max-width": f * 8,
        "text-outline-width": f * 0.2,
        ...sideStyle(isAbove(n)),
      }));
    });

    // A label sits symmetrically about its dot (same margin either side), so
    // its box on the other side is the measured box mirrored through the
    // dot's centre. That avoids a restyle per candidate side, which made
    // this pass ~100ms instead of a few.
    const labelBox = (n, above) => {
      const b = n.boundingBox(LABEL_BOX);
      const box = above === isAbove(n) ? b
        : { x1: b.x1, x2: b.x2, y1: 2 * n.position("y") - b.y2, y2: 2 * n.position("y") - b.y1 };
      return { x1: box.x1 - gap, x2: box.x2 + gap, y1: box.y1 - gap, y2: box.y2 + gap };
    };

    const allDotsBlock = NODE_SIZE * z >= DOT_BLOCK_PX;
    const bodies = nodes.map((n) => ({ id: n.id(), box: n.boundingBox(BODY_BOX) }));
    const placed = [];
    const side = new Map();       // node -> chosen side (true = above)
    const shownIds = new Set();
    nodes.sort((a, b) => (b.degree(false) - a.degree(false)) || a.id().localeCompare(b.id()))
      .forEach((n) => {
        // Try the lane's default side first (see .label-above), then the
        // other: in a crowded row, alternating neighbours can both fit.
        const preferAbove = n.hasClass("label-above");
        side.set(n, preferAbove);   // unplaced labels keep the default side (focus may force them on)
        for (const above of [preferAbove, !preferAbove]) {
          const box = labelBox(n, above);
          if (placed.some((p) => overlaps(p, box))) continue;
          if (bodies.some((o) => o.id !== n.id() && (allDotsBlock || shownIds.has(o.id)) && overlaps(o.box, box))) continue;
          placed.push(box);
          side.set(n, above);
          shownIds.add(n.id());
          return;
        }
      });

    cy.batch(() => {
      side.forEach((above, n) => { if (above !== isAbove(n)) n.style(sideStyle(above)); });
      cy.nodes().forEach((n) => n.toggleClass("shown", shownIds.has(n.id())));
    });
  }

  // Zoom fires continuously during a pinch or wheel; relabel once it settles.
  let relabelTimer = null;
  function scheduleRelabel() {
    clearTimeout(relabelTimer);
    relabelTimer = setTimeout(relabel, 90);
  }

  function init(containerId, philosophers, relations, h) {
    handlers = h || {};
    const positions = computePositions(philosophers);

    cy = cytoscape({
      container: document.getElementById(containerId),
      elements: buildElements(philosophers, relations, positions),
      style: styles(),
      layout: { name: "preset" },
      wheelSensitivity: 0.22,
      minZoom: 0.05,
      maxZoom: 3,
      // Philosophers are pinned to their point in time (their x = birth year,
      // their lane = school), so nodes must never be draggable.
      autoungrabify: true,
    });

    // Stagger labels: nodes sitting above their lane's centre line show their
    // label on top, so stacked contemporaries never overlap label-on-node.
    cy.nodes().forEach((n) => {
      const laneY = laneCenters[n.data("school")];
      if (laneY != null && n.position("y") < laneY) n.addClass("label-above");
    });

    // Initial framing: fit all lanes vertically with comfortable padding,
    // then pan horizontally to a populated era (roughly the modern dense zone).
    framInitial();

    relabel();
    cy.on("zoom", scheduleRelabel);
    cy.on("pan zoom render", () => { if (handlers.onViewportChange) handlers.onViewportChange(); });

    cy.on("tap", "node", (evt) => {
      const p = evt.target.data("ref");
      clearHighlight();
      highlightNode(p.id);
      if (handlers.onNode) handlers.onNode(p);
    });

    cy.on("tap", "edge", (evt) => {
      const r = evt.target.data("ref");
      clearHighlight();
      highlightEdge(r.id);
      if (handlers.onEdge) handlers.onEdge(r);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        clearHighlight();
        if (handlers.onBackground) handlers.onBackground();
      }
    });

    return cy;
  }

  // Min/max years across all current nodes (for the century axis).
  function getTimeBounds() {
    if (!cy) return { min: minYear, max: minYear };
    const years = cy.nodes().map((n) => parseYear(n.data("ref").dates));
    return { min: Math.min(...years), max: Math.max(...years) };
  }

  return {
    init,
    highlightNode, highlightEdge, clearHighlight, focusNode, focusSchool,
    showTrail, focusEdge, focusTrailHop,
    setTypeVisible, setSchoolVisible, refreshTheme, addPhilosopher,
    getCy: () => cy,
    getLaneCenters: () => laneCenters,
    getSchoolOrder: () => SCHOOL_ORDER.slice(),
    getMinYear: () => minYear,
    yearToX, getTimeBounds,
  };
})();
