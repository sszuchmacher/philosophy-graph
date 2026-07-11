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
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add("is-shown"));
    clearTimeout(timer);
    timer = setTimeout(() => {
      t.classList.remove("is-shown");
      setTimeout(() => { t.hidden = true; }, 220);
    }, ms || 1800);
  }

  return { show };
})();
