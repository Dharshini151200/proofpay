import { inr, totals, dueInfo, checks, score } from './domain.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const fd = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ft = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const head = (t) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)} · ProofPay</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%232563eb'/><path d='M9 16.5l4.5 4.5L23 11' stroke='white' stroke-width='3.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
<link rel="stylesheet" href="/static/style.css"></head>`;

export function layout(title, body, { ws, wide } = {}) {
  return `${head(title)}<body><header class="top"><div class="wrap ${wide ? 'wide' : ''}"><a class="brand" href="${ws ? '/app' : '/'}"><span class="logo">✓</span>ProofPay</a>
<nav>${ws ? `<a href="/app">Records</a><a href="/app/settings">Connect Claude & profile</a><form method="post" action="/logout"><button class="linkbtn">Log out</button></form>`
    : `<a href="/#pricing">Pricing</a><a href="/login">Log in</a><a class="btn sm" href="/signup">Start free</a>`}</nav></div></header>
<main class="wrap ${wide ? 'wide' : ''}">${body}</main></body></html>`;
}

export function landing() {
  return layout('Get paid on time by big buyers', `
<section class="hero"><p class="eyebrow">For MSME suppliers selling to retailers, distributors & enterprises</p>
<h1>Every delivery, proven.<br>Every invoice, paid on time.</h1>
<p class="lead">Send Claude your PO, signed delivery challan and invoice. ProofPay turns them into one dispute-ready record. It checks that all three match, counts down your legal 45-day payment deadline, and gives the buyer's accounts team a link to confirm receipt and approve payment.</p>
<p><a class="btn" href="/signup">Create free account</a> <a class="btn ghost" href="/login">Try the demo</a></p></section>
<section class="steps">
  <div><b>1 · Send Claude the papers</b><p>"Create a delivery record for PO-1045 and attach its invoice and POD."</p></div>
  <div><b>2 · ProofPay checks & shares</b><p>Quantities and rates are matched across PO, POD and invoice. The buyer gets one link with everything.</p></div>
  <div><b>3 · Buyer approves, you get paid</b><p>Receipt confirmed, approved for payment, paid. If they're late, Claude drafts the reminder or the formal notice.</p></div>
</section>
<section id="pricing" class="pricing"><h2>Pricing</h2><div class="tiers">
  <div class="tier"><h3>Starter</h3><p class="price">₹499<span>/month</span></p><p>Up to 30 delivery records a month · 3 buyers · Claude connector</p></div>
  <div class="tier hot"><h3>Growth</h3><p class="price">₹999<span>/month</span></p><p>Unlimited records & buyers · due-date alerts · evidence packs for disputes</p></div>
  <div class="tier"><h3>Pro</h3><p class="price">₹1,999<span>/month</span></p><p>Team logins · multiple GSTINs · export to Tally · priority support</p></div></div>
<p class="muted small">No AI runs inside ProofPay. You bring your own Claude, so we never pay per record.</p></section>`);
}

export function authPage(kind, error = '', demo = null) {
  const up = kind === 'signup';
  return layout(up ? 'Sign up' : 'Log in', `<div class="card auth"><h1>${up ? 'Create your ProofPay' : 'Log in'}</h1>${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/${kind}">${up ? '<label>Business name<input name="name" required></label>' : ''}
<label>Email<input name="email" type="email" required value="${!up && demo ? esc(demo.email) : ''}"></label>
<label>Password<input name="password" type="password" required minlength="6" value="${!up && demo ? esc(demo.password) : ''}"></label>
<button class="btn full">${up ? 'Create account' : 'Log in'}</button></form>
${!up && demo ? `<p class="muted small">Demo account is pre-filled: <b>${esc(demo.email)}</b> / <b>${esc(demo.password)}</b></p>` : ''}
<p class="muted small">${up ? 'Have an account? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create an account</a>'}</p></div>`);
}

const badge = (s) => `<span class="badge ${s}">${s}</span>`;
function dueChip(r) {
  const d = dueInfo(r);
  if (r.status === 'paid') return '<span class="chip ok">Paid</span>';
  if (!d.due) return '<span class="chip">No date</span>';
  if (d.overdue) return `<span class="chip bad">${-d.left}d overdue</span>`;
  if (d.left <= 7) return `<span class="chip warn">${d.left}d left</span>`;
  return `<span class="chip">${d.left}d left</span>`;
}

export function row(r) {
  const t = totals(r), sc = score(r);
  return `<a class="row" href="/app/records/${r.id}">
  <span class="num">${esc(r.poNumber || '—')}</span>
  <span class="ttl"><b>${esc(r.buyer.name)}</b><small>Inv ${esc(r.invoiceNumber || '—')} · delivered ${fd(r.deliveryDate)}</small></span>
  <span class="by">${r.createdBy === 'claude' ? '<span class="claude">✦ Claude</span>' : 'You'}</span>
  <span>${badge(r.status)}</span>
  <span><span class="proof ${sc === 100 ? 'ok' : sc >= 70 ? 'warn' : 'bad'}">${sc === 100 ? '✓ Proof complete' : `⚠ ${checks(r).length} issue${checks(r).length > 1 ? 's' : ''}`}</span></span>
  <span>${dueChip(r)}</span>
  <span class="amt">${inr(t.outstanding)}</span></a>`;
}

export function dashboard(ws, recs) {
  const sum = (f) => recs.filter(f).reduce((a, r) => a + totals(r).outstanding, 0);
  const overdue = sum((r) => dueInfo(r).overdue);
  const week = sum((r) => { const d = dueInfo(r); return r.status !== 'paid' && d.left != null && d.left >= 0 && d.left <= 7; });
  recs.sort((a, b) => (a.status === 'paid') - (b.status === 'paid') || (dueInfo(a).due || '9').localeCompare(dueInfo(b).due || '9'));
  return layout('Records', `
<div class="head"><div><h1>${esc(ws.profile.name)}</h1><p class="muted">Updates live. Ask Claude to create a record and it appears here.</p></div>
<form method="post" action="/app/records"><button class="btn">+ New record</button></form></div>
<div class="stats">
  <div><small>Outstanding</small><b>${inr(sum((r) => r.status !== 'paid'))}</b></div>
  <div class="${overdue ? 'alert' : ''}"><small>Past legal due date</small><b>${inr(overdue)}</b></div>
  <div><small>Due in 7 days</small><b>${inr(week)}</b></div>
  <div><small>In dispute</small><b>${inr(sum((r) => r.status === 'disputed'))}</b></div>
</div>
<div class="list pp" id="list">
  <div class="row hdr"><span>PO</span><span>Buyer</span><span>Created by</span><span>Status</span><span>Proof</span><span>Due</span><span class="amt">Outstanding</span></div>
  ${recs.map(row).join('') || `<div class="empty">No records yet. Connect Claude in <a href="/app/settings">settings</a> and say: <i>"Create a delivery record for PO-1045 and attach its invoice and POD."</i></div>`}
</div><script src="/static/dash.js"></script>`, { ws, wide: true });
}

export function editor(ws, r, base) {
  return layout(`${r.poNumber} · ${r.buyer.name}`, `
<div class="head"><div><a class="muted small" href="/app">← All records</a>
<h1>${esc(r.poNumber || 'New record')} ${r.createdBy === 'claude' ? '<span class="claude">✦ Created by Claude</span>' : ''}</h1></div>
<div class="actions"><span id="status"></span>
  <button class="btn ghost" id="copy" data-link="${esc(base)}/b/${esc(r.slug)}">Copy buyer link</button>
  <a class="btn ghost" target="_blank" href="/b/${esc(r.slug)}">Preview / evidence pack</a>
  <button class="btn" id="share"></button></div></div>
<div class="grid"><div class="card" id="editor"></div>
<aside>
  <div class="card" id="duecard"></div>
  <div class="card"><h3>Proof check</h3><ul class="checks" id="checks"></ul></div>
  <div class="card"><h3>Payments</h3><div id="pay"></div>
    <form id="payform" class="payform"><input name="amount" type="number" placeholder="₹ amount" required><input name="reference" placeholder="UTR / ref"><button class="btn sm">Add</button></form></div>
  <div class="card" id="fucard"><h3>Follow-ups by Claude</h3><div id="followups"></div></div>
  <div class="card"><h3>History</h3><ul class="timeline" id="activity"></ul></div>
  <div class="card"><button class="linkbtn danger" id="del">Delete record</button></div>
</aside></div>
<script>window.REC=${JSON.stringify(r).replace(/</g, '\\u003c')};</script><script src="/static/editor.js"></script>`, { ws, wide: true });
}

export function settings(ws, base, saved) {
  const p = ws.profile, url = `${base}/mcp/${ws.mcpToken}`;
  const f = (n, l, v) => `<label>${l}<input name="${n}" value="${esc(v ?? '')}"></label>`;
  return layout('Connect Claude', `<h1>Connect Claude</h1>
<div class="card connect"><p>Your private connector link:</p>
<div class="copyline"><code id="mcp">${esc(url)}</code><button class="btn sm" onclick="navigator.clipboard.writeText(document.getElementById('mcp').textContent);this.textContent='Copied ✓'">Copy</button></div>
<ol><li>In Claude (web or desktop), open <b>Settings → Connectors</b>.</li><li>Click <b>Add custom connector</b>, name it <b>ProofPay</b>, paste the link and click <b>Add</b>.</li>
<li>In a new chat, turn on ProofPay from the tools menu, attach a PO, a signed challan and an invoice, and say: <i>"Create a delivery record for PO-1045 and attach its invoice and POD."</i></li></ol>
<p class="muted small">Keep this link private. Anyone with it can create records in your account.</p></div>
<h2>Supplier profile</h2>${saved ? '<p class="ok">Saved ✓</p>' : ''}
<form class="card form2" method="post" action="/app/settings">${f('name', 'Business name', p.name)}${f('gstin', 'GSTIN', p.gstin)}${f('udyam', 'Udyam (MSME) registration no.', p.udyam)}${f('category', 'MSME category (Micro / Small / Medium)', p.category)}${f('phone', 'Phone', p.phone)}${f('upiId', 'UPI ID / bank for payment', p.upiId)}
<label class="span2">Address<input name="address" value="${esc(p.address)}"></label><button class="btn">Save profile</button></form>`, { ws });
}

// ---------- buyer-facing record + evidence pack ----------
export function buyerPage(ws, r, files, { flash } = {}) {
  const t = totals(r), d = dueInfo(r), c = checks(r), p = ws.profile;
  const locked = ['paid'].includes(r.status);
  const actions = locked ? '' : `<div class="accept no-print"><h3>Buyer actions</h3>
  ${!r.receivedConfirmedBy ? `<form method="post" action="/b/${esc(r.slug)}/received"><label>Your name & role<input name="name" required placeholder="e.g. R. Kumar, Stores"></label><button class="btn full">✓ Confirm goods received as per POD</button></form>`
    : r.status !== 'approved' ? `<form method="post" action="/b/${esc(r.slug)}/approve"><label>Your name & role<input name="name" required placeholder="e.g. Priya, Accounts Payable"></label><button class="btn full">Approve invoice for payment</button></form>` : `<p class="ok">Approved for payment by ${esc(r.approvedBy)}. Due ${fd(d.due)}.</p>`}
  <details ${r.status === 'disputed' ? 'open' : ''}><summary>Something doesn't match? Raise a query</summary>
    <form method="post" action="/b/${esc(r.slug)}/query"><label>What's wrong?<textarea name="reason" rows="2" required placeholder="e.g. We received 96 cartons, invoice says 100"></textarea></label><label>Your name<input name="name" required></label><button class="btn ghost">Send query to supplier</button></form></details></div>`;
  const fu = (r.followups || []).filter((x) => x.kind !== 'dispute_reply' || true).slice(-1)[0];
  return `${head(`${r.poNumber} — ${p.name}`)}<body class="public"><main class="paper">
${flash ? `<p class="ok">${esc(flash)}</p>` : ''}
<div class="phead"><div><p class="muted small">SUPPLIER</p><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.address || '')}${p.gstin ? `<br>GSTIN ${esc(p.gstin)}` : ''}${p.udyam ? `<br>Udyam ${esc(p.udyam)}${p.category ? ` (${esc(p.category)} enterprise)` : ''}` : ''}</p></div>
<div class="right"><p class="muted small">DELIVERY RECORD</p><h3>${esc(r.poNumber)}</h3><p class="small">Buyer: <b>${esc(r.buyer.name)}</b>${r.buyer.gstin ? `<br>GSTIN ${esc(r.buyer.gstin)}` : ''}<br>${badge(r.status)}</p></div></div>
<div class="facts four">
  <div><b>${inr(t.invoiceAmount)}</b><small>Invoice ${esc(r.invoiceNumber || '')}</small></div>
  <div><b>${fd(r.deliveryDate)}</b><small>Delivered & accepted</small></div>
  <div class="${d.overdue ? 'badbox' : ''}"><b>${d.due ? fd(d.due) : '—'}</b><small>Payment due${d.overdue ? ` · ${-d.left} days overdue` : d.left != null && r.status !== 'paid' ? ` · ${d.left} days left` : ''}</small></div>
  <div><b>${inr(t.outstanding)}</b><small>Outstanding</small></div></div>
<p class="small muted">Due date basis: ${esc(d.basis)}. Under the MSMED Act, 2006 (s.15) and Income-tax Act s.43B(h).</p>
${fu ? `<div class="notice"><b>${esc(fu.subject)}</b><p class="small">${nl(fu.message)}</p><p class="muted small">${ft(fu.at)}</p></div>` : ''}
<h3>Three-way match</h3>
<table class="items"><thead><tr><th>Item</th><th class="r">PO qty</th><th class="r">Delivered</th><th class="r">Invoiced</th><th class="r">PO rate</th><th class="r">Inv. rate</th></tr></thead><tbody>
${r.items.map((it) => `<tr><td><b>${esc(it.description)}</b>${it.unit ? ` <small class="muted">(${esc(it.unit)})</small>` : ''}</td><td class="r">${it.qtyOrdered ?? '—'}</td><td class="r ${it.qtyDelivered < it.qtyOrdered ? 'warnc' : ''}">${it.qtyDelivered ?? '—'}</td><td class="r ${it.qtyInvoiced > it.qtyDelivered ? 'badc' : ''}">${it.qtyInvoiced ?? '—'}</td><td class="r">${it.poRate != null ? '₹' + it.poRate : '—'}</td><td class="r ${it.poRate != null && it.invoiceRate !== it.poRate ? 'badc' : ''}">${it.invoiceRate != null ? '₹' + it.invoiceRate : '—'}</td></tr>`).join('')}
</tbody></table>
<ul class="checks">${c.map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join('')}</ul>
<h3>Documents</h3>
<table class="items docs"><tbody>${r.documents.map((doc) => `<tr><td><span class="kind">${esc(doc.kind)}</span></td><td><b>${esc(doc.reference || '—')}</b> <small class="muted">${fd(doc.date)}</small><br><small>${esc(doc.summary)}</small></td><td class="r">${doc.fileId && files[doc.fileId] ? `<a href="/f/${esc(doc.fileId)}?b=${esc(r.slug)}" target="_blank">View file</a>` : '<small class="muted">details only</small>'}</td></tr>`).join('') || '<tr><td class="muted">No documents yet</td></tr>'}</tbody></table>
${r.receivedBy ? `<p class="small">POD signed by: <b>${esc(r.receivedBy)}</b></p>` : ''}
${r.dispute ? `<div class="done no"><h3>Query from buyer</h3><p>"${esc(r.dispute.reason)}"</p><p class="muted small">${esc(r.dispute.by)} · ${ft(r.dispute.at)}</p></div>` : ''}
${r.payments.length ? `<h3>Payments</h3><ul class="checks">${r.payments.map((x) => `<li class="ok">${inr(x.amount)} on ${fd(x.date)}${x.reference ? ` · ref ${esc(x.reference)}` : ''}</li>`).join('')}</ul>` : ''}
${actions}
<h3>History</h3><ul class="timeline">${[...r.activity].reverse().map((a) => `<li class="by-${a.by}">${esc(a.note)}<small>${a.by === 'buyer' ? 'Buyer' : a.by === 'claude' ? 'Supplier (via Claude)' : 'Supplier'} · ${ft(a.at)}</small></li>`).join('')}</ul>
<p class="foot muted small no-print"><a href="javascript:print()">Download evidence pack (PDF)</a> · Powered by <a href="/">ProofPay</a></p>
</main></body></html>`;
}
