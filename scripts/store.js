/* ============================================================
   store.js — Persists user-added philosophers in localStorage and
   exports them as JSON for merging back into the repo's data files.
   Base data (the bundled JSON) is never touched here; this only
   holds the user's own additions.
   ============================================================ */

const Store = (() => {
  const KEY = "philographAdditions";

  // Returns { philosophers: [...], relations: [...] } — always arrays.
  function loadAdditions() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { philosophers: [], relations: [] };
      const parsed = JSON.parse(raw);
      return {
        philosophers: Array.isArray(parsed.philosophers) ? parsed.philosophers : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      };
    } catch {
      return { philosophers: [], relations: [] };
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // Append one generated philosopher and its relations. De-dupes by id.
  function addPhilosopher({ philosopher, relations }) {
    const data = loadAdditions();
    if (!data.philosophers.some((p) => p.id === philosopher.id)) {
      data.philosophers.push(philosopher);
    }
    (relations || []).forEach((r) => {
      if (!data.relations.some((x) => x.id === r.id)) data.relations.push(r);
    });
    save(data);
    return data;
  }

  function count() {
    return loadAdditions().philosophers.length;
  }

  // Download the additions as a JSON file the user can merge into
  // data/philosophers.json and data/relations.json.
  function exportJSON() {
    const data = loadAdditions();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "philograph-additions.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  return { loadAdditions, addPhilosopher, exportJSON, count, clear };
})();
