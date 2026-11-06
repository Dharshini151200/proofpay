// ProofPay business logic: plain data rules and arithmetic. No AI anywhere in this app.
import crypto from 'node:crypto';
import { store } from './store.js';

export const id = (n = 12) => crypto.randomBytes(n).toString('base64url');
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 32), Buffer.from(hash, 'hex'));
}

export const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(n || 0));
export const DOC_KINDS = ['PO', 'Invoice', 'POD', 'E-way bill', 'GRN', 'Other'];
export const STATUSES = ['draft', 'shared', 'received', 'approved', 'disputed', 'paid'];
export const log = (r, by, note) => { (r.activity ||= []).push({ at: new Date().toISOString(), by, note }); };

const today = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10); // IST date
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const num = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));

// MSMED Act s.15 / Income-tax s.43B(h): pay within agreed days but max 45 from acceptance; 15 days if no written agreement.
export function dueInfo(r) {
  const start = r.acceptedOn || r.deliveryDate;
  if (!start) return { due: null, basis: 'Add the delivery / acceptance date to start the clock' };
  const days = r.writtenAgreement ? Math.min(Number(r.agreedDays) || 45, 45) : 15;
  const due = addDays(start, days);
  const left = daysBetween(today(), due);
  return { due, days, left, overdue: left < 0 && r.status !== 'paid',
    basis: r.writtenAgreement ? `${days} days from acceptance (written agreement, capped at 45 by law)` : '15 days from acceptance (no written agreement)' };
}

export function totals(r) {
  const items = r.items || [];
  const sum = (f) => items.reduce((s, it) => s + (num(it[f.q]) || 0) * (num(it[f.r]) || 0), 0);
  const invoiced = sum({ q: 'qtyInvoiced', r: 'invoiceRate' });
  const poValue = sum({ q: 'qtyOrdered', r: 'poRate' });
  const paid = (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const invoiceAmount = num(r.invoiceAmount) ?? Math.round(invoiced * (1 + (Number(r.gstRate) || 0) / 100));
  return { invoiced, poValue, invoiceAmount, paid, outstanding: Math.max(0, invoiceAmount - paid) };
}

// Deterministic three-way match: PO vs delivery (POD) vs invoice.
export function checks(r) {
  const out = [];
  const kinds = new Set((r.documents || []).map((d) => d.kind));
  for (const k of ['PO', 'Invoice', 'POD']) if (!kinds.has(k)) out.push({ level: 'warn', text: `${k} not attached yet` });
  (r.items || []).forEach((it) => {
    const o = num(it.qtyOrdered), d = num(it.qtyDelivered), i = num(it.qtyInvoiced);
    const name = it.description || 'Item';
    if (o != null && d != null && d < o) out.push({ level: 'warn', text: `${name}: delivered ${d} of ${o} ordered (short by ${o - d})` });
    if (d != null && i != null && i > d) out.push({ level: 'bad', text: `${name}: invoiced ${i} but only ${d} delivered — buyer will dispute this` });
    if (o != null && i != null && i > o) out.push({ level: 'bad', text: `${name}: invoiced ${i}, more than the ${o} on the PO` });
    const pr = num(it.poRate), ir = num(it.invoiceRate);
    if (pr != null && ir != null && Math.abs(pr - ir) > 0.005) out.push({ level: 'bad', text: `${name}: invoice rate ₹${ir} ≠ PO rate ₹${pr}` });
  });
  if (!r.receivedBy) out.push({ level: 'warn', text: 'No receiver name/signature recorded on the POD' });
  const t = totals(r);
  const expected = Math.round(t.invoiced * (1 + (Number(r.gstRate) || 0) / 100));
  if (num(r.invoiceAmount) != null && t.invoiced && Math.abs(expected - num(r.invoiceAmount)) > 1)
    out.push({ level: 'warn', text: `Invoice total ${inr(r.invoiceAmount)} ≠ line items + GST (${inr(expected)})` });
  if (!out.length) out.push({ level: 'ok', text: 'PO, delivery and invoice match — dispute-ready' });
  const pod = (r.documents || []).find((d) => d.kind === 'POD');
  if (pod && !pod.fileId) out.push({ level: 'info', text: 'Original signed challan not attached yet. Add it with the upload link, since it is your strongest proof in a dispute' });
  return out;
}
export const issues = (r) => checks(r).filter((x) => x.level === 'bad' || x.level === 'warn');

export const score = (r) => { const c = issues(r); return !c.length ? 100 : Math.max(10, 100 - c.filter((x) => x.level === 'bad').length * 25 - c.filter((x) => x.level === 'warn').length * 10); };

function cleanItems(items) {
  return (items || []).filter((it) => it && String(it.description || '').trim()).map((it) => ({
    description: String(it.description).slice(0, 300), unit: String(it.unit || '').slice(0, 20),
    qtyOrdered: num(it.qtyOrdered ?? it.qty_ordered), qtyDelivered: num(it.qtyDelivered ?? it.qty_delivered), qtyInvoiced: num(it.qtyInvoiced ?? it.qty_invoiced),
    poRate: num(it.poRate ?? it.po_rate), invoiceRate: num(it.invoiceRate ?? it.invoice_rate ?? it.poRate ?? it.po_rate),
  }));
}
function cleanDocs(docs) {
  return (docs || []).filter((d) => d && (d.reference || d.summary || d.fileId || d.transcript)).map((d) => ({
    id: d.id || id(6), kind: DOC_KINDS.includes(d.kind) ? d.kind : 'Other', reference: String(d.reference || '').slice(0, 100),
    date: String(d.date || '').slice(0, 10), summary: String(d.summary || '').slice(0, 1000),
    transcript: String(d.transcript || '').slice(0, 12000), fileId: d.fileId || null, fileName: d.fileName || null,
  }));
}

const FIELDS = ['poNumber', 'poDate', 'invoiceNumber', 'invoiceDate', 'deliveryDate', 'acceptedOn', 'receivedBy', 'notes'];

export async function createRecord(ws, a, by = 'supplier') {
  const now = new Date().toISOString();
  const r = {
    id: id(), workspaceId: ws.id, slug: id(9), uploadToken: id(12), status: 'draft', createdBy: by, createdAt: now, updatedAt: now,
    buyer: { name: String(a.buyer?.name || a.buyerName || '').slice(0, 200), gstin: String(a.buyer?.gstin || a.buyerGstin || '').slice(0, 20), contact: String(a.buyer?.contact || a.buyerContact || '').slice(0, 200) },
    poNumber: '', poDate: '', invoiceNumber: '', invoiceDate: '', deliveryDate: '', acceptedOn: '', receivedBy: '', notes: '',
    invoiceAmount: num(a.invoiceAmount), gstRate: num(a.gstRate) ?? 18,
    writtenAgreement: a.writtenAgreement ?? true, agreedDays: num(a.agreedDays) ?? 45,
    items: cleanItems(a.items), documents: cleanDocs(a.documents), payments: [], followups: [], activity: [],
  };
  for (const k of FIELDS) if (a[k] != null) r[k] = String(a[k]).slice(0, 2000);
  log(r, by, by === 'claude' ? 'Record created by Claude from the documents' : 'Record created');
  if (a.share) { r.status = 'shared'; r.sharedAt = now; log(r, by, 'Shared with buyer'); }
  await store.save('records', r);
  return r;
}

export async function updateRecord(r, p, by = 'supplier') {
  const changed = [];
  const LABEL = { poNumber: 'PO number', poDate: 'PO date', invoiceNumber: 'invoice number', invoiceDate: 'invoice date', deliveryDate: 'delivery date', acceptedOn: null, receivedBy: 'POD signatory', notes: 'notes', invoiceAmount: 'invoice total', gstRate: 'GST %', agreedDays: 'payment days' };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of FIELDS) if (p[k] !== undefined && p[k] !== null && String(p[k]) !== r[k]) { r[k] = String(p[k]).slice(0, 2000); if (LABEL[k]) changed.push(LABEL[k]); }
  if (p.buyer) { const nb = { ...r.buyer, ...Object.fromEntries(Object.entries(p.buyer).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])) }; if (!same(nb, r.buyer)) { r.buyer = nb; changed.push('buyer'); } }
  for (const k of ['invoiceAmount', 'gstRate', 'agreedDays']) if (p[k] !== undefined && num(p[k]) !== r[k]) { r[k] = num(p[k]); changed.push(LABEL[k]); }
  if (p.writtenAgreement !== undefined && !!p.writtenAgreement !== r.writtenAgreement) { r.writtenAgreement = !!p.writtenAgreement; changed.push('agreement'); }
  if (p.items) { const ni = cleanItems(p.items); if (!same(ni, r.items)) { r.items = ni; changed.push('line items'); } }
  if (p.documents) { const nd = cleanDocs(p.documents); if (!same(nd, r.documents)) { r.documents = nd; changed.push('documents'); } }
  if (changed.length) log(r, by, `Edited ${changed.join(', ')}`);
  if (p.status && STATUSES.includes(p.status) && p.status !== r.status) {
    r.status = p.status;
    if (p.status === 'shared') r.sharedAt ||= new Date().toISOString();
    log(r, by, `Status → ${p.status}`);
  }
  r.updatedAt = new Date().toISOString();
  await store.save('records', r);
  return r;
}

export function addPayment(r, { amount, date, reference }, by) {
  r.payments.push({ amount: Number(amount) || 0, date: date || today(), reference: String(reference || '').slice(0, 80), by });
  const t = totals(r);
  log(r, by, `Payment of ${inr(amount)} recorded${reference ? ` (ref ${reference})` : ''}`);
  if (t.outstanding <= 0) { r.status = 'paid'; log(r, by, 'Fully paid'); }
}

export function summary(r, base) {
  const t = totals(r), d = dueInfo(r);
  return {
    po_number: r.poNumber, buyer: r.buyer.name, invoice_number: r.invoiceNumber, invoice_amount: inr(t.invoiceAmount),
    outstanding: inr(t.outstanding), status: r.status, payment_due: d.due, days_left: d.left ?? null, overdue: !!d.overdue,
    match: issues(r).length ? issues(r).map((x) => x.text) : 'clean',
    original_files: (r.documents || []).map((d) => `${d.kind}: ${d.fileId ? 'attached' : 'not attached'}`),
    edit_url: `${base}/app/records/${r.id}`, buyer_link: `${base}/b/${r.slug}`,
    upload_link: `${base}/u/${r.uploadToken}`,
  };
}

export async function findByPo(ws, po) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (await store.list('records', 'workspaceId', ws.id)).find((r) => norm(r.poNumber) === norm(po)) || null;
}
export { today, addDays, daysBetween };

export const guessKind = (name) => (/invoice|\binv\b|tax/i.test(name) ? 'Invoice' : /grn/i.test(name) ? 'GRN' : /challan|pod|delivery|\bdc\b|dc-|receipt/i.test(name) ? 'POD'
  : /e-?way/i.test(name) ? 'E-way bill' : /\bpo\b|po-|purchase|order/i.test(name) ? 'PO' : 'Other');
