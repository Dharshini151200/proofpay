// MCP endpoint at /mcp/<supplier-token>. Claude reads the documents and writes; these tools only store and read data.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { store } from './store.js';
import { createRecord, updateRecord, findByPo, summary, checks, totals, dueInfo, addPayment, inr, log, id, DOC_KINDS } from './domain.js';

const Item = z.object({
  description: z.string(), unit: z.string().optional(),
  qty_ordered: z.number().optional().describe('Quantity on the PO'),
  qty_delivered: z.number().optional().describe('Quantity received per the signed delivery challan / POD'),
  qty_invoiced: z.number().optional().describe('Quantity billed on the invoice'),
  po_rate: z.number().optional().describe('Unit rate on the PO, before GST'),
  invoice_rate: z.number().optional().describe('Unit rate on the invoice, before GST'),
});
const Doc = z.object({
  kind: z.enum(DOC_KINDS), reference: z.string().optional().describe('Document number, e.g. challan no.'),
  date: z.string().optional().describe('YYYY-MM-DD'), summary: z.string().optional().describe('One line on what this document shows, e.g. "Signed by R. Kumar, stores, 96 cartons received"'),
  transcript: z.string().optional().describe('Faithful plain-text copy of the whole document exactly as you read it: header, parties, GSTINs, every line item with qty/rate/amount, totals, terms, remarks, and who signed/stamped it. Do not summarise or correct it.'),
});
const out = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

function buildServer(ws, base) {
  const s = new McpServer({ name: 'ProofPay', version: '1.0.0' }, {
    instructions: `ProofPay keeps dispute-ready delivery records for ${ws.profile?.name || 'this supplier'}, an MSME supplier. ` +
      'When the user shares a PO, delivery challan/POD or invoice (photo, PDF or text), read it carefully and call create_delivery_record (or update_delivery_record for an existing PO) with every line item and quantity. ' +
      'ProofPay itself runs the PO–delivery–invoice match, computes the legal payment due date (MSMED Act / Sec 43B(h): 45 days with a written agreement, else 15), and gives the buyer a link to confirm receipt and approve payment. ' +
      'For every document, include a transcript: a faithful text copy of the whole document as you read it. ' +
      'Then attach the original files yourself when you can run commands: for each file the user gave you, POST its raw bytes to `<upload_link>/files?name=<file name>&kind=<PO|Invoice|POD|E-way bill|GRN|Other>&ref=<document number>&by=claude` with the file\'s Content-Type (application/pdf, image/jpeg, image/png…; max 5 MB), e.g. `curl -sS -X POST -H "Content-Type: application/pdf" --data-binary @DC-921.pdf "<upload_link>/files?name=DC-921.pdf&kind=POD&ref=DC-921&by=claude"`. The reply lists which documents now have their original attached. ' +
      'When the user attaches files for several POs at once, group them by the PO number printed on each document, then create or update one record per PO and upload its files. ' +
      'Only if you cannot reach ProofPay to upload (no shell, or the request is refused), show the user the upload_link and ask them to attach the originals there — the original signed challan is the strongest proof in a dispute. ' +
      'Also show the edit_url and buyer_link. For overdue records you can draft reminders or formal notices with add_followup.',
  });

  s.registerTool('get_supplier_profile', { title: 'Supplier profile & summary', description: 'Supplier details (GSTIN, Udyam/MSME number), known buyers, and totals: outstanding, overdue, disputed.', inputSchema: {} }, async () => {
    const recs = await store.list('records', 'workspaceId', ws.id);
    const sum = (f) => inr(recs.filter(f).reduce((a, r) => a + totals(r).outstanding, 0));
    return out({ supplier: ws.profile, buyers: [...new Set(recs.map((r) => r.buyer.name))],
      outstanding: sum((r) => r.status !== 'paid'), overdue: sum((r) => dueInfo(r).overdue), disputed: sum((r) => r.status === 'disputed'), records: recs.length });
  });

  s.registerTool('create_delivery_record', {
    title: 'Create a delivery record',
    description: 'Create one dispute-ready record for a purchase order: buyer, PO, invoice, delivery/POD details, line items with ordered/delivered/invoiced quantities and rates, and the documents seen. Returns match results, the payment due date, an edit link and a buyer link.',
    inputSchema: {
      buyer_name: z.string(), buyer_gstin: z.string().optional(), buyer_contact: z.string().optional().describe('AP / stores contact name or email'),
      po_number: z.string(), po_date: z.string().optional(),
      invoice_number: z.string().optional(), invoice_date: z.string().optional(), invoice_amount: z.number().optional().describe('Invoice total including GST'),
      gst_rate: z.number().optional().describe('GST %, default 18'),
      delivery_date: z.string().optional().describe('Date goods were delivered/accepted, YYYY-MM-DD — starts the payment clock'),
      received_by: z.string().optional().describe('Name/designation of the person who signed the POD'),
      written_agreement: z.boolean().optional().describe('Is there a written agreement/PO with payment terms? Default true'),
      agreed_payment_days: z.number().optional().describe('Payment terms on the PO, e.g. 30'),
      items: z.array(Item).min(1), documents: z.array(Doc).optional(),
      notes: z.string().optional().describe('Anything unusual you noticed in the documents'),
      share_with_buyer: z.boolean().optional(),
    },
  }, async (a) => {
    if (await findByPo(ws, a.po_number)) return out(`A record for ${a.po_number} already exists — use update_delivery_record.`);
    const r = await createRecord(ws, {
      buyer: { name: a.buyer_name, gstin: a.buyer_gstin, contact: a.buyer_contact }, poNumber: a.po_number, poDate: a.po_date,
      invoiceNumber: a.invoice_number, invoiceDate: a.invoice_date, invoiceAmount: a.invoice_amount, gstRate: a.gst_rate,
      deliveryDate: a.delivery_date, acceptedOn: a.delivery_date, receivedBy: a.received_by, writtenAgreement: a.written_agreement,
      agreedDays: a.agreed_payment_days, items: a.items, documents: a.documents, notes: a.notes, share: a.share_with_buyer,
    }, 'claude');
    return out({ ...summary(r, base), due_rule: dueInfo(r).basis,
      next_step: 'Now upload each original file: POST its bytes to upload_link + "/files?name=…&kind=…&ref=<document number>&by=claude" (see server instructions). If you cannot reach ProofPay, give the user upload_link to attach them instead.' });
  });

  s.registerTool('update_delivery_record', {
    title: 'Update a delivery record',
    description: 'Add a document (e.g. the signed POD arrived), correct quantities, or share with the buyer. Only fields you pass change; passing items replaces all items; documents are ADDED to the existing list.',
    inputSchema: {
      po_number: z.string(), invoice_number: z.string().optional(), invoice_date: z.string().optional(), invoice_amount: z.number().optional(),
      delivery_date: z.string().optional(), received_by: z.string().optional(), agreed_payment_days: z.number().optional(), written_agreement: z.boolean().optional(),
      items: z.array(Item).optional(), add_documents: z.array(Doc).optional(), notes: z.string().optional(),
      status: z.enum(['draft', 'shared']).optional().describe('"shared" sends it to the buyer link'),
    },
  }, async (a) => {
    const r = await findByPo(ws, a.po_number);
    if (!r) return out(`No record for ${a.po_number}.`);
    await updateRecord(r, {
      invoiceNumber: a.invoice_number, invoiceDate: a.invoice_date, invoiceAmount: a.invoice_amount, deliveryDate: a.delivery_date,
      acceptedOn: a.delivery_date, receivedBy: a.received_by, agreedDays: a.agreed_payment_days, writtenAgreement: a.written_agreement,
      items: a.items, notes: a.notes, status: a.status, documents: a.add_documents ? [...r.documents, ...a.add_documents] : undefined,
    }, 'claude');
    return out(summary(r, base));
  });

  s.registerTool('list_records', {
    title: 'List delivery records', description: 'All records with status, amount outstanding, due date and days left/overdue. Filter to find what to chase.',
    inputSchema: { filter: z.enum(['all', 'overdue', 'due_this_week', 'disputed', 'unpaid']).optional() },
  }, async ({ filter = 'all' }) => {
    let recs = await store.list('records', 'workspaceId', ws.id);
    recs = recs.filter((r) => {
      const d = dueInfo(r);
      return filter === 'all' || (filter === 'overdue' && d.overdue) || (filter === 'disputed' && r.status === 'disputed') ||
        (filter === 'unpaid' && r.status !== 'paid') || (filter === 'due_this_week' && r.status !== 'paid' && d.left != null && d.left >= 0 && d.left <= 7);
    }).sort((a, b) => (dueInfo(a).due || '9').localeCompare(dueInfo(b).due || '9'));
    return out({ count: recs.length, records: recs.map((r) => summary(r, base)) });
  });

  s.registerTool('get_record', {
    title: 'Get a delivery record', description: 'Full record: items, documents, match results, buyer actions (receipt confirmed, approved, queries), payments, follow-ups and history.',
    inputSchema: { po_number: z.string() },
  }, async ({ po_number }) => {
    const r = await findByPo(ws, po_number);
    if (!r) return out(`No record for ${po_number}.`);
    return out({ ...summary(r, base), buyer: r.buyer, dates: { po: r.poDate, invoice: r.invoiceDate, delivered: r.deliveryDate }, received_by: r.receivedBy,
      due_rule: dueInfo(r).basis, items: r.items, documents: r.documents.map(({ fileId, ...d }) => ({ ...d, original_file_attached: !!fileId })),
      checks: checks(r), totals: totals(r), buyer_query: r.dispute || null, payments: r.payments, followups: r.followups, history: r.activity });
  });

  s.registerTool('add_followup', {
    title: 'Save a payment follow-up',
    description: 'Save a reminder or formal notice you drafted for a record. It is stored with the record, shown to the supplier to send, and shown on the buyer link.',
    inputSchema: { po_number: z.string(), kind: z.enum(['reminder', 'formal_notice', 'dispute_reply']), subject: z.string(), message: z.string() },
  }, async (a) => {
    const r = await findByPo(ws, a.po_number);
    if (!r) return out(`No record for ${a.po_number}.`);
    r.followups.push({ id: id(5), at: new Date().toISOString(), kind: a.kind, subject: a.subject.slice(0, 200), message: a.message.slice(0, 6000) });
    log(r, 'claude', `${a.kind.replace('_', ' ')} drafted: "${a.subject}"`);
    r.updatedAt = new Date().toISOString();
    await store.save('records', r);
    return out({ saved: true, ...summary(r, base) });
  });

  s.registerTool('record_payment', {
    title: 'Record a payment', description: 'Log a payment received against a PO (full or part). Marks the record paid when nothing is outstanding.',
    inputSchema: { po_number: z.string(), amount: z.number(), date: z.string().optional(), reference: z.string().optional().describe('UTR / cheque number') },
  }, async (a) => {
    const r = await findByPo(ws, a.po_number);
    if (!r) return out(`No record for ${a.po_number}.`);
    addPayment(r, a, 'claude'); r.updatedAt = new Date().toISOString();
    await store.save('records', r);
    return out(summary(r, base));
  });

  return s;
}

export function mountMcp(app, baseUrlOf) {
  app.post('/mcp/:token', async (req, res) => {
    const ws = await store.get('workspaces', 'mcpToken', req.params.token);
    if (!ws) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown ProofPay connector link' }, id: null });
    const server = buildServer(ws, baseUrlOf(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (e) { console.error('MCP error', e); if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
  });
  const no = (_q, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  // Opened in a browser (e.g. a reviewer clicking the link): explain what it is instead of showing a raw protocol error.
  app.get('/mcp/:token', async (req, res, next) => {
    if (!String(req.get('accept') || '').includes('text/html')) return no(req, res);
    try {
      const ws = await store.get('workspaces', 'mcpToken', req.params.token);
      const base = baseUrlOf(req), url = `${base}/mcp/${req.params.token}`;
      const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      res.status(ws ? 200 : 404).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProofPay MCP connector</title><link rel="stylesheet" href="/static/style.css"></head>
<body class="public"><main class="paper">${ws ? `
<p class="ok">✓ This ProofPay connector link is working, for ${esc(ws.profile.name)}.</p>
<h1>Paste this link into Claude</h1>
<p>This is an MCP link. It's meant for Claude, not for opening in a browser. Connect it in a minute:</p>
<div class="copyline"><code id="u">${esc(url)}</code><button class="btn sm" onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Copied ✓'">Copy</button></div>
<ol><li>In Claude (claude.ai or the desktop app), open <b>Settings → Connectors</b>.</li>
<li>Click <b>Add custom connector</b>. Name: <b>ProofPay</b>. URL: the link above. Click <b>Add</b>.</li>
<li>Start a <b>new chat</b>, open the <b>+</b> / tools menu and switch <b>ProofPay</b> on.</li>
<li>Attach a PO, a signed delivery challan and an invoice, then say: <i>"Create a delivery record for PO-1045 and attach its invoice and POD."</i></li>
<li>Open the app to see the record appear: <a href="${base}/login">${esc(base)}/login</a> (demo login is pre-filled).</li></ol>` : '<h1>This connector link is not valid.</h1><p>Copy the correct link from <b>Connect Claude & profile</b> in the ProofPay app.</p>'}
<p class="foot muted small">ProofPay · no AI runs inside this app, your own Claude does the reading.</p></main></body></html>`);
    } catch (e) { next(e); }
  });
  app.delete('/mcp/:token', no);
}
