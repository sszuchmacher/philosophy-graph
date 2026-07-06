/* ============================================================
   graph.js — Chronological + school-lane layout.
   Time runs left-to-right (X = year), schools stack as
   horizontal lanes (Y). Deterministic positions; no force-
   directed pileup. Labels appear only at higher zoom and on
   highlighted nodes. Edges are nearly invisible by default
   and snap to full opacity when their endpoints are selected.
   ============================================================ */

const Graph = (() => {
  let cy = null;
  let handlers = {};
  let laneCenters = {};        // school -> Y in model coords
  let labelsOn = false;
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

  const LANE_HEIGHT = 130;     // vertical spacing between lanes
  const X_SCALE = 4.5;         // pixels per year of history
  const JITTER = [0, -28, 28, -48, 48, -14, 14]; // sub-row offsets within a lane (max ±48 so lanes don't bleed)

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

  // X coordinate for a given year (depends on minYear, set during layout).
  function yearToX(year) { return (year - minYear) * X_SCALE; }

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
      arr.forEach((item, i) => { positions[item.p.id] = positionFor(item.p, i); });
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
          width: 22,
          height: 22,
          "border-width": 0,
          "transition-property": "opacity, border-width, text-opacity",
          "transition-duration": "0.18s",
        },
      },
      // When zoomed in, all node labels appear.
      { selector: "node.shown", style: { "text-opacity": 1 } },
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
  }

  function refreshTheme() { if (cy) cy.style(styles()); }

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
    (relations || []).forEach((r) => {
      // Only add edges whose endpoints exist.
      if (cy.getElementById(r.source).empty() || cy.getElementById(r.target).empty()) return;
      if (!cy.getElementById(r.id).empty()) return;
      cy.add({ group: "edges", data: { id: r.id, source: r.source, target: r.target, type: r.type, ref: r } });
    });

    // Make sure the new node's label shows even if zoomed out.
    if (labelsOn) cy.getElementById(philosopher.id).addClass("shown");
    clearHighlight();
    highlightNode(philosopher.id);
    cy.animate({ center: { eles: cy.getElementById(philosopher.id) }, zoom: Math.max(cy.zoom(), 0.7) }, { duration: 450 });
    return true;
  }

  // Frame the graph: zoom in just enough to read labels, then center on
  // the modern-era cluster (where most connections live).
  function framInitial() {
    const bb = cy.elements().boundingBox();
    const containerW = cy.width();
    const containerH = cy.height();
    const isMobile = containerW < 700;
    // Above the label threshold (0.42) so users see names immediately on desktop.
    // Slightly lower on mobile so more lanes fit at a glance.
    const targetZoom = isMobile ? 0.55 : 0.6;
    // Center horizontally on the modern era — 65th percentile of node X
    // lands somewhere in the 1700s–1800s where the graph is densest.
    const xs = cy.nodes().map((n) => n.position("x")).sort((a, b) => a - b);
    const focusX = xs[Math.floor(xs.length * 0.65)] || (bb.x1 + bb.w / 2);
    // Center vertically on the middle of the lane stack.
    const focusY = bb.y1 + bb.h / 2;
    cy.zoom({ level: targetZoom, renderedPosition: { x: containerW / 2, y: containerH / 2 } });
    cy.pan({ x: containerW / 2 - focusX * targetZoom, y: containerH / 2 - focusY * targetZoom });
  }

  // Show node labels only when zoomed in enough to read them.
  function syncLabels() {
    const want = cy.zoom() > 0.42;
    if (want === labelsOn) return;
    labelsOn = want;
    if (want) cy.nodes().addClass("shown");
    else cy.nodes().removeClass("shown");
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
    });

    // Initial framing: fit all lanes vertically with comfortable padding,
    // then pan horizontally to a populated era (roughly the modern dense zone).
    framInitial();

    syncLabels();
    cy.on("zoom", syncLabels);
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
    showTrail, focusEdge,
    setTypeVisible, setSchoolVisible, refreshTheme, addPhilosopher,
    getCy: () => cy,
    getLaneCenters: () => laneCenters,
    getSchoolOrder: () => SCHOOL_ORDER.slice(),
    getMinYear: () => minYear,
    yearToX, getTimeBounds,
  };
})();
