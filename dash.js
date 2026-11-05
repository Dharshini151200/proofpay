// Live dashboard: polls so a test created from Claude, or a new student attempt, shows up without a refresh.
(() => {
  let stamp = null;
  async function tick() {
    try {
      const r = await fetch('/api/stamp'); if (!r.ok) return;
      const d = await r.json();
      if (stamp !== null && d.stamp !== stamp) { sessionStorage.setItem('pp-flash', '1'); return location.reload(); }
      stamp = d.stamp;
    } catch {}
  }
  if (sessionStorage.getItem('pp-flash')) { sessionStorage.removeItem('pp-flash'); document.querySelector('#list a.row')?.classList.add('flash'); }
  tick(); setInterval(tick, 4000);
})();
