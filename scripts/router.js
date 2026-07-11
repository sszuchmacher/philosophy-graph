/* ============================================================
   router.js — Hash-based deep links.

   Formats:
     #/p/<philosopherId>          — a philosopher's card
     #/r/<relationId>             — a relation's essay
     #/t/<trailId>/<stepNumber>   — a stop in a guided trail (1-based)

   Navigating within the app updates the hash so the current view can
   be copied/shared and the back button retraces it; loading a hash
   directly (a shared link, or the user pressing back/forward)
   re-opens that exact view. Router itself holds no app state — it
   just parses/writes the hash and calls whatever handlers app.js
   registers.
   ============================================================ */

const Router = (() => {
  let handlers = { onPhilosopher: null, onRelation: null, onTrailStep: null };
  let skipNext = false; // true while we're applying our own navigate() call

  function parse(hash) {
    const h = (hash || "").replace(/^#\/?/, "");
    if (!h) return null;
    const parts = h.split("/").filter(Boolean);
    if (parts[0] === "p" && parts[1]) return { type: "p", id: decodeURIComponent(parts[1]) };
    if (parts[0] === "r" && parts[1]) return { type: "r", id: decodeURIComponent(parts[1]) };
    if (parts[0] === "t" && parts[1]) {
      const step = parseInt(parts[2], 10);
      return { type: "t", id: decodeURIComponent(parts[1]), step: Number.isFinite(step) ? step : 1 };
    }
    return null;
  }

  function dispatch(hash) {
    const route = parse(hash);
    if (!route) return false;
    if (route.type === "p" && handlers.onPhilosopher) return handlers.onPhilosopher(route.id) !== false;
    if (route.type === "r" && handlers.onRelation) return handlers.onRelation(route.id) !== false;
    if (route.type === "t" && handlers.onTrailStep) return handlers.onTrailStep(route.id, route.step) !== false;
    return false;
  }

  function onHashChange() {
    // Our own navigate() calls trigger this event too; ignore that one
    // "echo" so we don't re-render what we just rendered. A user pressing
    // back/forward (or editing the hash by hand) is NOT skipped.
    if (skipNext) { skipNext = false; return; }
    dispatch(location.hash);
  }

  // Point the URL at `path` (e.g. "p/kant"). No-ops if already there.
  // Pushes a history entry, so the back button retraces navigation.
  function navigate(path) {
    const newHash = "#/" + path;
    if (location.hash === newHash) return;
    skipNext = true;
    location.hash = newHash;
  }

  // Drop back to the home view (no hash) without pushing a history entry
  // or triggering a dispatch — used when the panel/trail closes.
  function clear() {
    if (!location.hash) return;
    history.replaceState(null, "", location.pathname + location.search);
  }

  // Parse whatever hash the page loaded with and dispatch once. Returns
  // true if a known route was found and opened (callers use this to
  // decide whether to skip the first-visit welcome overlay).
  function start() {
    return dispatch(location.hash);
  }

  function init(h) {
    handlers = { ...handlers, ...h };
    window.addEventListener("hashchange", onHashChange);
  }

  return { init, start, navigate, clear };
})();
