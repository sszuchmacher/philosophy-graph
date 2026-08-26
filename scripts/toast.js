/* ============================================================
   toast.js — Tiny transient message ("Link copied").
   ============================================================ */

const Toast = (() => {
  let el = null;
  let timer = null;

  function ensure() {
    if (!el) el = document.getElementById("toast");
    return el;
  }

  function show(msg, ms) {
    const t = ensure();
    if (!t) return;
    t.hidden = false;
    // Clear first, then set the real text next frame: an aria-live region
    // only announces on a content *change*, so setting identical back-to-back
    // messages (e.g. two "Link copied" toasts) would otherwise stay silent
    // the second time.
    t.textContent = "";
    requestAnimationFrame(() => {
      t.textContent = msg;
      t.classList.add("is-shown");
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      t.classList.remove("is-shown");
      setTimeout(() => { t.hidden = true; }, 220);
    }, ms || 1800);
  }

  return { show };
})();
