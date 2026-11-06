import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';
import { id, hashPassword, checkPassword, createRecord, updateRecord, addPayment, log, guessKind, DOC_KINDS } from './domain.js';
import { mountMcp } from './mcp.js';
import * as V from './views.js';
import { seedDemo, DEMO } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
const STATIC = { 'style.css': 'text/css', 'editor.js': 'text/javascript', 'dash.js': 'text/javascript', 'upload.js': 'text/javascript' };
app.get('/static/:f', (req, res) => {
  const type = STATIC[req.params.f];
  if (!type) return res.sendStatus(404);
  res.type(type).set('Cache-Control', 'public, max-age=3600').sendFile(path.join(__dirname, req.params.f));
});

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const baseUrlOf = (req) => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const sign = (v) => `${v}.${crypto.createHmac('sha256', SECRET).update(v).digest('base64url')}`;
const unsign = (s) => { const i = (s || '').lastIndexOf('.'); const v = s?.slice(0, i); return v && sign(v) === s ? v : null; };
const login = (res, ws) => res.cookie('pp', sign(ws.id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 864e5 });
const current = async (req) => { const w = unsign(req.cookies.pp); return w ? store.get('workspaces', 'id', w) : null; };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (json = false) => wrap(async (req, res, next) => {
  const ws = await current(req);
  if (!ws) return json ? res.status(401).json({ error: 'Not logged in' }) : res.redirect('/login');
  req.ws = ws; next();
});
async function own(req, res) {
  const r = await store.get('records', 'id', req.params.id);
  if (!r || r.workspaceId !== req.ws.id) { res.status(404).json({ error: 'Not found' }); return null; }
  return r;
}
const OK_MIME = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/pdf)$/;
// Attach one uploaded file to a record: fill the first document of the same type that has no file yet, else add a new document.
// Matching order: exact document id → same reference (e.g. "DC-921", ignoring case/punctuation) → first empty slot of the same type.
const normRef = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function attachFile(r, { name, mime, buffer, kind, docId, ref }, by) {
  if (!OK_MIME.test(mime)) return { error: 'Only PDF or photo files' };
  if (!buffer?.length) return { error: 'Empty file' };
  const f = { id: id(), workspaceId: r.workspaceId, recordId: r.id, name: String(name || 'file').slice(0, 120), mime, data: buffer.toString('base64') };
  await store.save('files', f);
  const k = DOC_KINDS.includes(kind) ? kind : guessKind(f.name);
  const nr = normRef(ref);
  const doc = (docId && r.documents.find((d) => d.id === docId))
    || (nr && r.documents.find((d) => normRef(d.reference) === nr && (!kind || d.kind === k)))
    || r.documents.find((d) => d.kind === k && !d.fileId);
  if (doc) { doc.fileId = f.id; doc.fileName = f.name; }
  else r.documents.push({ id: id(6), kind: k, reference: f.name, date: '', summary: 'Original file uploaded', transcript: '', fileId: f.id, fileName: f.name });
  log(r, by, `Original file attached: ${f.name}${doc ? ` → ${doc.kind} ${doc.reference || ''}`.trimEnd() : ''}`);
  r.updatedAt = new Date().toISOString();
  await store.save('records', r);
  return { ok: true };
}
async function fileMap(r) {
  const m = {};
  for (const d of r.documents) if (d.fileId) { const f = await store.get('files', 'id', d.fileId); if (f) m[d.fileId] = { name: f.name, mime: f.mime }; }
  return m;
}

// ---------- public ----------
app.get('/', wrap(async (req, res) => ((await current(req)) ? res.redirect('/app') : res.send(V.landing()))));
app.get('/login', (_q, res) => res.send(V.authPage('login', '', DEMO)));
app.get('/signup', (_q, res) => res.send(V.authPage('signup')));
app.get('/health', (_q, res) => res.json({ ok: true }));
app.post('/signup', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (await store.get('workspaces', 'email', email)) return res.send(V.authPage('signup', 'That email already has an account.'));
  const ws = { id: id(), email, passwordHash: hashPassword(String(req.body.password)), mcpToken: id(18), createdAt: new Date().toISOString(),
    profile: { name: String(req.body.name || 'My business').slice(0, 120), gstin: '', udyam: '', category: 'Micro', phone: '', upiId: '', address: '' } };
  await store.save('workspaces', ws); login(res, ws); res.redirect('/app/settings');
}));
app.post('/login', wrap(async (req, res) => {
  const ws = await store.get('workspaces', 'email', String(req.body.email || '').trim().toLowerCase());
  if (!ws || !checkPassword(String(req.body.password || ''), ws.passwordHash)) return res.send(V.authPage('login', 'Wrong email or password.', DEMO));
  login(res, ws); res.redirect('/app');
}));
app.post('/logout', (_q, res) => { res.clearCookie('pp'); res.redirect('/'); });

// ---------- buyer link ----------
async function bySlug(req, res) {
  const r = await store.get('records', 'slug', req.params.slug);
  if (!r) { res.status(404).send(V.layout('Not found', '<h1>This link is not valid.</h1>')); return {}; }
  return { r, ws: await store.get('workspaces', 'id', r.workspaceId) };
}
app.get('/b/:slug', wrap(async (req, res) => {
  const { r, ws } = await bySlug(req, res); if (!r) return;
  const viewer = await current(req);
  if ((!viewer || viewer.id !== r.workspaceId) && !r.buyerViewedAt) { r.buyerViewedAt = new Date().toISOString(); log(r, 'buyer', 'Buyer opened the record'); await store.save('records', r); }
  const msg = { received: 'Receipt confirmed. Thank you.', approved: 'Approved for payment. Thank you.', query: 'Your query was sent to the supplier.' }[req.query.done];
  res.send(V.buyerPage(ws, r, await fileMap(r), { flash: msg }));
}));
const buyerAction = (fn) => wrap(async (req, res) => {
  const { r } = await bySlug(req, res); if (!r) return;
  if (r.status !== 'paid') { fn(r, String(req.body.name || '').slice(0, 100), req.body); r.updatedAt = new Date().toISOString(); await store.save('records', r); }
  res.redirect(`/b/${r.slug}?done=${req.path.split('/').pop()}`);
});
app.post('/b/:slug/received', buyerAction((r, name) => { r.receivedConfirmedBy = name; r.receivedConfirmedAt = new Date().toISOString(); if (['draft', 'shared'].includes(r.status)) r.status = 'received'; log(r, 'buyer', `Receipt confirmed by ${name}`); }));
app.post('/b/:slug/approve', buyerAction((r, name) => { r.approvedBy = name; r.approvedAt = new Date().toISOString(); r.status = 'approved'; r.dispute = null; log(r, 'buyer', `Approved for payment by ${name}`); }));
app.post('/b/:slug/query', buyerAction((r, name, b) => { r.dispute = { reason: String(b.reason || '').slice(0, 1000), by: name, at: new Date().toISOString() }; r.status = 'disputed'; log(r, 'buyer', `Query raised by ${name}: "${r.dispute.reason}"`); }));

app.get('/f/:fid', wrap(async (req, res) => {
  const f = await store.get('files', 'id', req.params.fid);
  if (!f) return res.sendStatus(404);
  const viewer = await current(req);
  let ok = viewer && viewer.id === f.workspaceId;
  if (!ok && req.query.b) { const r = await store.get('records', 'slug', String(req.query.b)); ok = r && r.id === f.recordId; }
  if (!ok) return res.sendStatus(403);
  res.set('Content-Type', f.mime).set('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`).set('X-Content-Type-Options', 'nosniff').send(Buffer.from(f.data, 'base64'));
}));

// ---------- upload link (from Claude's reply; no login — the long random token is the key) ----------
async function byToken(req, res) {
  const r = req.params.token && req.params.token.length >= 12 ? await store.get('records', 'uploadToken', req.params.token) : null;
  if (!r) { res.status(404).send(V.layout('Not found', '<h1>This upload link is not valid.</h1>')); return {}; }
  return { r, ws: await store.get('workspaces', 'id', r.workspaceId) };
}
app.get('/u/:token', wrap(async (req, res) => { const { r, ws } = await byToken(req, res); if (r) res.send(V.uploadPage(ws, r)); }));
app.post('/u/:token/files', express.raw({ type: '*/*', limit: '5mb' }), wrap(async (req, res) => {
  const { r } = await byToken(req, res); if (!r) return;
  const out = await attachFile(r, { name: req.query.name, mime: String(req.get('content-type') || ''), buffer: req.body, kind: req.query.kind, ref: req.query.ref },
    req.query.by === 'claude' ? 'claude' : 'supplier');
  if (out.error) return res.status(415).json(out);
  res.json({ ok: true, documents: r.documents.map((d) => ({ kind: d.kind, reference: d.reference, attached: !!d.fileId, fileName: d.fileName })) });
}));

// ---------- supplier app ----------
const mine = (ws) => store.list('records', 'workspaceId', ws.id);
app.get('/app', auth(), wrap(async (req, res) => res.send(V.dashboard(req.ws, await mine(req.ws)))));
app.get('/app/settings', auth(), (req, res) => res.send(V.settings(req.ws, baseUrlOf(req), req.query.saved)));
app.post('/app/settings', auth(), wrap(async (req, res) => {
  const b = req.body; Object.assign(req.ws.profile, { name: b.name, gstin: b.gstin, udyam: b.udyam, category: b.category, phone: b.phone, upiId: b.upiId, address: b.address });
  await store.save('workspaces', req.ws); res.redirect('/app/settings?saved=1');
}));
app.post('/app/records', auth(), wrap(async (req, res) => {
  const r = await createRecord(req.ws, { buyer: { name: 'New buyer' }, poNumber: `PO-${Date.now() % 100000}`, items: [{ description: 'Item', qtyOrdered: 1, qtyDelivered: 1, qtyInvoiced: 1, poRate: 0 }] }, 'supplier');
  res.redirect(`/app/records/${r.id}`);
}));
app.get('/app/records/:id', auth(), wrap(async (req, res) => {
  const r = await store.get('records', 'id', req.params.id);
  if (!r || r.workspaceId !== req.ws.id) return res.status(404).send(V.layout('Not found', '<h1>Record not found</h1>', { ws: req.ws }));
  res.send(V.editor(req.ws, r, baseUrlOf(req)));
}));

app.get('/api/stamp', auth(true), wrap(async (req, res) => res.json({ stamp: (await mine(req.ws)).map((r) => r.id + r.updatedAt + r.status).sort().join('|') })));
app.get('/api/records/:id', auth(true), wrap(async (req, res) => { const r = await own(req, res); if (r) res.json(r); }));
app.put('/api/records/:id', auth(true), wrap(async (req, res) => {
  const r = await own(req, res); if (!r) return;
  const b = req.body;
  await updateRecord(r, { poNumber: b.poNumber, poDate: b.poDate, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, deliveryDate: b.deliveryDate,
    acceptedOn: b.deliveryDate, receivedBy: b.receivedBy, notes: b.notes, buyer: b.buyer, invoiceAmount: b.invoiceAmount, gstRate: b.gstRate,
    agreedDays: b.agreedDays, writtenAgreement: b.writtenAgreement, items: b.items, documents: b.documents,
    status: ['draft', 'shared'].includes(b.status) ? b.status : undefined }, 'supplier');
  res.json(r);
}));
app.post('/api/records/:id/payments', auth(true), wrap(async (req, res) => {
  const r = await own(req, res); if (!r) return;
  addPayment(r, req.body, 'supplier'); r.updatedAt = new Date().toISOString(); await store.save('records', r); res.json(r);
}));
app.post('/api/records/:id/files', auth(true), express.raw({ type: '*/*', limit: '5mb' }), wrap(async (req, res) => {
  const r = await own(req, res); if (!r) return;
  const out = await attachFile(r, { name: req.query.name, mime: String(req.get('content-type') || ''), buffer: req.body, kind: req.query.kind, docId: req.query.doc }, 'supplier');
  if (out.error) return res.status(415).json(out);
  res.json(r);
}));
app.delete('/api/records/:id', auth(true), wrap(async (req, res) => {
  const r = await own(req, res); if (!r) return;
  await store.remove('files', 'recordId', r.id); await store.remove('records', 'id', r.id); res.json({ ok: true });
}));

mountMcp(app, baseUrlOf);
app.use((err, _q, res, _n) => { console.error(err); res.status(500).send('Something went wrong.'); });
const port = Number(process.env.PORT) || 3000;
await store.init(); await seedDemo();
for (const r of await store.all('records')) if (!r.uploadToken) { r.uploadToken = id(12); await store.save('records', r); } // older records get an upload link
app.listen(port, () => console.log(`ProofPay on http://localhost:${port}`));
