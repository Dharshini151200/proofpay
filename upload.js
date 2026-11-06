// Upload page behind the link Claude shares: send several files, one after another.
(() => {
  const inp = document.getElementById('files'), msg = document.getElementById('msg'), list = document.getElementById('docs'), drop = document.getElementById('drop');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function send(files) {
    files = [...files]; let ok = 0; const bad = [];
    for (const [i, f] of files.entries()) {
      msg.textContent = `Uploading ${i + 1} of ${files.length}: ${f.name}…`;
      if (f.size > 5e6) { bad.push(`${f.name} (over 5 MB)`); continue; }
      const res = await fetch(`${window.UP}?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { bad.push(`${f.name} (${d.error || 'failed'})`); continue; }
      ok++;
      list.innerHTML = d.documents.map((x) => `<li class="${x.attached ? 'ok' : 'warn'}"><b>${esc(x.kind)}</b> ${esc(x.reference)} — ${x.attached ? `attached (${esc(x.fileName)})` : 'waiting for original'}</li>`).join('');
    }
    msg.textContent = `Attached ${ok} file${ok === 1 ? '' : 's'} ✓${bad.length ? ' · Not attached: ' + bad.join(', ') : ' · You can close this page.'}`;
    inp.value = '';
  }
  inp.addEventListener('change', () => inp.files.length && send(inp.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) send(e.dataTransfer.files); });
})();
