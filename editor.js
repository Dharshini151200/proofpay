// Record editor: everything Claude extracted is editable; the app re-runs the match and due date live.
(() => {
  let r = window.REC;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const KINDS = ['PO', 'Invoice', 'POD', 'E-way bill', 'GRN', 'Other'];
  const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);
  const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const fd = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  // same rules as the server (src/domain.js), for instant feedback while typing
  function due() {
    const s = r.deliveryDate; if (!s) return null;
    const days = r.writtenAgreement ? Math.min(+r.agreedDays || 45, 45) : 15;
    const d = addDays(s, days); const left = Math.round((Date.parse(d) - Date.parse(todayIST())) / 864e5);
    return { d, days, left };
  }
  function totals() {
    const inv = r.items.reduce((s, i) => s + (num(i.qtyInvoiced) || 0) * (num(i.invoiceRate) || 0), 0);
    const amt = num(r.invoiceAmount) ?? Math.round(inv * (1 + (+r.gstRate || 0) / 100));
    const paid = r.payments.reduce((s, p) => s + (+p.amount || 0), 0);
    return { inv, amt, paid, out: Math.max(0, amt - paid) };
  }
  function checks() {
    const o = []; const k = new Set(r.documents.map((d) => d.kind));
    ['PO', 'Invoice', 'POD'].forEach((x) => { if (!k.has(x)) o.push(['warn', `${x} not attached yet`]); });
    r.items.forEach((it) => {
      const [q, d, i, pr, ir] = [num(it.qtyOrdered), num(it.qtyDelivered), num(it.qtyInvoiced), num(it.poRate), num(it.invoiceRate)];
      const n = it.description || 'Item';
      if (q != null && d != null && d < q) o.push(['warn', `${n}: delivered ${d} of ${q} ordered (short by ${q - d})`]);
      if (d != null && i != null && i > d) o.push(['bad', `${n}: invoiced ${i} but only ${d} delivered — buyer will dispute this`]);
      if (q != null && i != null && i > q) o.push(['bad', `${n}: invoiced ${i}, more than the ${q} on the PO`]);
      if (pr != null && ir != null && Math.abs(pr - ir) > 0.005) o.push(['bad', `${n}: invoice rate ₹${ir} ≠ PO rate ₹${pr}`]);
    });
    if (!r.receivedBy) o.push(['warn', 'No receiver name/signature recorded on the POD']);
    const t = totals(), exp = Math.round(t.inv * (1 + (+r.gstRate || 0) / 100));
    if (num(r.invoiceAmount) != null && t.inv && Math.abs(exp - num(r.invoiceAmount)) > 1) o.push(['warn', `Invoice total ${inr(r.invoiceAmount)} ≠ line items + GST (${inr(exp)})`]);
    return o.length ? o : [['ok', 'PO, delivery and invoice match — dispute-ready']];
  }

  const f = (k, label, type = 'text', obj = r, attr = 'data-k') => `<label>${label}<input ${attr}="${k}" type="${type}" value="${esc(obj[k] ?? '')}"></label>`;
  function render() {
    $('#editor').innerHTML = `
      <h3>Buyer</h3><div class="form2">
        ${f('name', 'Buyer name', 'text', r.buyer, 'data-b')}${f('gstin', 'Buyer GSTIN', 'text', r.buyer, 'data-b')}
        <label class="span2">AP / stores contact<input data-b="contact" value="${esc(r.buyer.contact)}"></label></div>
      <h3>Order, delivery & invoice</h3><div class="form2">
        ${f('poNumber', 'PO number')}${f('poDate', 'PO date', 'date')}
        ${f('invoiceNumber', 'Invoice number')}${f('invoiceDate', 'Invoice date', 'date')}
        ${f('deliveryDate', 'Delivered / accepted on (starts the clock)', 'date')}${f('receivedBy', 'POD signed by')}
        ${f('invoiceAmount', 'Invoice total incl. GST (₹)', 'number')}${f('gstRate', 'GST %', 'number')}
        <label class="toggle"><input type="checkbox" data-k="writtenAgreement" ${r.writtenAgreement ? 'checked' : ''}> Written agreement / PO with payment terms</label>
        ${f('agreedDays', 'Agreed payment days', 'number')}</div>
      <h3>Line items: PO vs delivered vs invoiced</h3>
      <table class="ied"><thead><tr><th>Item</th><th>Unit</th><th>PO qty</th><th>Delivered</th><th>Invoiced</th><th>PO rate</th><th>Inv. rate</th><th></th></tr></thead><tbody>
      ${r.items.map((it, i) => `<tr data-i="${i}"><td><input data-f="description" value="${esc(it.description)}"></td><td style="width:60px"><input data-f="unit" value="${esc(it.unit)}"></td>
        ${['qtyOrdered', 'qtyDelivered', 'qtyInvoiced', 'poRate', 'invoiceRate'].map((k) => `<td style="width:84px"><input data-f="${k}" type="number" step="any" value="${it[k] ?? ''}"></td>`).join('')}
        <td><button class="x" data-act="delitem">×</button></td></tr>`).join('')}</tbody></table>
      <button class="btn ghost sm" id="additem">+ Add item</button>
      <h3 style="margin-top:18px">Documents</h3>
      <table class="ied"><thead><tr><th>Type</th><th>Number</th><th>Date</th><th>What it shows</th><th>File</th><th></th></tr></thead><tbody>
      ${r.documents.map((d, i) => `<tr data-d="${i}"><td style="width:100px"><select data-g="kind">${KINDS.map((k) => `<option ${k === d.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
        <td style="width:120px"><input data-g="reference" value="${esc(d.reference)}"></td><td style="width:130px"><input data-g="date" type="date" value="${esc(d.date)}"></td>
        <td><input data-g="summary" value="${esc(d.summary)}"></td>
        <td style="width:90px">${d.fileId ? `<a href="/f/${d.fileId}" target="_blank">View</a>` : `<label class="linkbtn" style="margin:0;color:var(--acc);cursor:pointer">Attach<input type="file" accept="image/*,application/pdf" data-up="${esc(d.id)}" style="display:none"></label>`}</td>
        <td><button class="x" data-act="deldoc">×</button></td></tr>`).join('')}</tbody></table>
      <div class="drop" id="drop">Drop the PO, challan and invoice here, several at once is fine (PDF or photo, up to 5 MB each), or <u>browse</u><input type="file" id="fileinp" multiple accept="image/*,application/pdf" style="display:none"></div>
      <label style="margin-top:14px">Notes<textarea data-k="notes" rows="2">${esc(r.notes)}</textarea></label>
      <p class="saving" id="saving"></p>`;
    side();
  }

  function side() {
    $('#status').innerHTML = `<span class="badge ${r.status}">${r.status}</span>`;
    const sh = $('#share'); sh.textContent = r.status === 'draft' ? 'Share with buyer' : 'Save';
    const d = due(), t = totals();
    $('#duecard').innerHTML = `<h3>Legal payment due date</h3>${d ? `<div class="due ${r.status === 'paid' ? 'ok' : d.left < 0 ? 'bad' : d.left <= 7 ? 'warn' : ''}">${r.status === 'paid' ? 'Paid ✓' : d.left < 0 ? `${-d.left} days overdue` : `${d.left} days left`}</div>
      <p class="small">Due <b>${fd(d.d)}</b> · ${d.days} days from acceptance ${r.writtenAgreement ? '(written agreement, max 45 by law)' : '(no written agreement → 15 days)'}</p>` : '<p class="muted small">Add the delivery date to start the clock.</p>'}
      <div class="sumrow"><span>Invoice</span><span>${inr(t.amt)}</span></div><div class="sumrow"><span>Paid</span><span>${inr(t.paid)}</span></div>
      <div class="sumrow grand"><span>Outstanding</span><span>${inr(t.out)}</span></div>`;
    $('#checks').innerHTML = checks().map(([l, x]) => `<li class="${l}">${esc(x)}</li>`).join('') +
      (r.receivedConfirmedBy ? `<li class="ok">Buyer confirmed receipt: ${esc(r.receivedConfirmedBy)}</li>` : '') + (r.approvedBy ? `<li class="ok">Approved for payment: ${esc(r.approvedBy)}</li>` : '') +
      (r.dispute ? `<li class="bad">Buyer query: "${esc(r.dispute.reason)}" (${esc(r.dispute.by)})</li>` : '');
    $('#pay').innerHTML = r.payments.map((p) => `<div class="sumrow small"><span>${fd(p.date)}${p.reference ? ' · ' + esc(p.reference) : ''}</span><span>${inr(p.amount)}</span></div>`).join('') || '<p class="muted small">No payments yet.</p>';
    $('#followups').innerHTML = (r.followups || []).slice().reverse().map((x) => `<div class="fu"><b>${esc(x.subject)}</b> <span class="chip">${esc(x.kind.replace('_', ' '))}</span><pre>${esc(x.message)}</pre><button class="btn ghost sm" data-copy="${esc(x.id)}">Copy text</button></div>`).join('') ||
      '<p class="muted small">Ask Claude: "Draft a payment reminder for ' + esc(r.poNumber) + '".</p>';
    $('#activity').innerHTML = [...r.activity].reverse().slice(0, 14).map((a) => `<li class="by-${a.by === 'buyer' ? 'client' : a.by}">${esc(a.note)}<small>${a.by === 'buyer' ? 'Buyer' : a.by === 'claude' ? 'Claude' : 'You'} · ${new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></li>`).join('');
  }

  let timer = null;
  async function save(extra = {}) {
    clearTimeout(timer);
    if ($('#saving')) $('#saving').textContent = 'Saving…';
    const res = await fetch(`/api/records/${r.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r, status: undefined, ...extra }) });
    timer = null;
    if (!res.ok) { $('#saving').textContent = 'Could not save. Check your connection.'; return; }
    const fresh = await res.json(); Object.assign(r, { status: fresh.status, activity: fresh.activity, updatedAt: fresh.updatedAt, documents: fresh.documents });
    side();
    if ($('#saving')) $('#saving').textContent = `Saved ✓ ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  const soon = () => { $('#saving').textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 800); };

  const guessKind = (name) => /invoice|\binv\b|tax/i.test(name) ? 'Invoice' : /challan|pod|delivery|\bdc\b|dc-|grn|receipt/i.test(name) ? (/grn/i.test(name) ? 'GRN' : 'POD')
    : /e-?way/i.test(name) ? 'E-way bill' : /\bpo\b|po-|purchase|order/i.test(name) ? 'PO' : 'Other';

  // Upload one or many files. Each file is matched to an existing document row of the same type that has no file yet
  // (e.g. the PO/Invoice/POD rows Claude created); otherwise a new document row is added.
  async function uploadMany(fileList, forcedDocId) {
    const files = [...fileList];
    if (!files.length) return;
    if (timer) await save();
    let done = 0, failed = [];
    for (const file of files) {
      $('#saving').textContent = `Uploading ${done + 1} of ${files.length}: ${file.name}…`;
      if (file.size > 5e6) { failed.push(`${file.name} (over 5 MB)`); continue; }
      const kind = guessKind(file.name);
      const target = forcedDocId || r.documents.find((d) => d.kind === kind && !d.fileId)?.id;
      const res = await fetch(`/api/records/${r.id}/files?name=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind)}${target ? `&doc=${target}` : ''}`,
        { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
      if (!res.ok) { failed.push(`${file.name} (${(await res.json().catch(() => ({}))).error || 'failed'})`); continue; }
      r = await res.json(); done++; forcedDocId = null;
    }
    render();
    $('#saving').textContent = `Attached ${done} file${done === 1 ? '' : 's'} ✓${failed.length ? ` · Not attached: ${failed.join(', ')}` : ''}`;
  }

  document.addEventListener('input', (e) => {
    const el = e.target, tr = el.closest('tr');
    const v = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.k) r[el.dataset.k] = v;
    else if (el.dataset.b) r.buyer[el.dataset.b] = v;
    else if (el.dataset.f && tr) r.items[tr.dataset.i][el.dataset.f] = v;
    else if (el.dataset.g && tr) r.documents[tr.dataset.d][el.dataset.g] = v;
    else return;
    side(); soon();
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.up !== undefined && e.target.files.length) uploadMany(e.target.files, e.target.dataset.up);
    if (e.target.id === 'fileinp' && e.target.files.length) { uploadMany(e.target.files); e.target.value = ''; }
  });
  document.addEventListener('click', async (e) => {
    const el = e.target, tr = el.closest('tr');
    if (el.id !== 'fileinp' && el.closest('#drop')) { $('#fileinp').click(); return; }
    if (el.id === 'additem') { r.items.push({ description: '', unit: '', qtyOrdered: null, qtyDelivered: null, qtyInvoiced: null, poRate: null, invoiceRate: null }); render(); return; }
    if (el.dataset.act === 'delitem') { r.items.splice(tr.dataset.i, 1); render(); save(); return; }
    if (el.dataset.act === 'deldoc') { r.documents.splice(tr.dataset.d, 1); render(); save(); return; }
    if (el.id === 'share') { await save(r.status === 'draft' ? { status: 'shared' } : {}); return; }
    if (el.id === 'copy') { await navigator.clipboard.writeText(el.dataset.link).catch(() => prompt('Buyer link', el.dataset.link)); el.textContent = 'Copied ✓'; setTimeout(() => (el.textContent = 'Copy buyer link'), 1500); return; }
    if (el.dataset.copy) { const x = r.followups.find((y) => y.id === el.dataset.copy); await navigator.clipboard.writeText(`${x.subject}\n\n${x.message}`).catch(() => {}); el.textContent = 'Copied ✓'; return; }
    if (el.id === 'del' && confirm('Delete this record and its files?')) { await fetch(`/api/records/${r.id}`, { method: 'DELETE' }); location.href = '/app'; }
  });
  document.addEventListener('dragover', (e) => { const d = e.target.closest?.('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { e.target.closest?.('#drop')?.classList.remove('over'); });
  document.addEventListener('drop', (e) => { const d = e.target.closest?.('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files.length) uploadMany(e.dataTransfer.files); } });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'payform') return; e.preventDefault();
    const fdata = Object.fromEntries(new FormData(e.target));
    const res = await fetch(`/api/records/${r.id}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fdata) });
    if (res.ok) { r = await res.json(); e.target.reset(); side(); }
  });

  // Live: pick up buyer actions and Claude's edits/follow-ups while open.
  setInterval(async () => {
    if (timer) return;
    const res = await fetch(`/api/records/${r.id}`); if (!res.ok) return;
    const fresh = await res.json();
    if (fresh.updatedAt !== r.updatedAt) { const by = fresh.activity.at(-1)?.by; r = fresh; by === 'supplier' ? side() : render(); }
  }, 4000);

  render();
})();
