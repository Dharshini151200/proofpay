// Demo supplier with a few realistic records, so the dashboard shows overdue, disputed, due-soon and paid cases.
import { store } from './store.js';
import { id, hashPassword, createRecord, addPayment, log, today, addDays, totals } from './domain.js';

export const DEMO = { email: process.env.DEMO_EMAIL || 'demo@proofpay.app', password: process.env.DEMO_PASSWORD || 'demo1234' };
const ago = (n) => addDays(today(), -n);
const at = (n) => new Date(Date.parse(ago(n) + 'T11:00:00+05:30')).toISOString();

export async function seedDemo() {
  if (await store.get('workspaces', 'email', DEMO.email)) return;
  const ws = { id: id(), email: DEMO.email, passwordHash: hashPassword(DEMO.password), mcpToken: process.env.DEMO_MCP_TOKEN || 'demo-volopay-2026', createdAt: new Date().toISOString(),
    profile: { name: 'Shree Ganesh Packaging', gstin: '29AAKFS1234M1Z8', udyam: 'UDYAM-KR-03-0012345', category: 'Micro', phone: '+91 98860 00000', upiId: 'shreeganesh@okhdfcbank', address: 'Peenya Industrial Area, Bengaluru 560058' } };
  await store.save('workspaces', ws);
  const box = (o, d, i, rate, ir = rate) => [{ description: '5-ply corrugated box 18×12×10"', unit: 'pcs', qtyOrdered: o, qtyDelivered: d, qtyInvoiced: i, poRate: rate, invoiceRate: ir }];
  const docs = (po, inv, ch, days, by) => [
    { kind: 'PO', reference: po, date: ago(days + 6), summary: 'Purchase order with 45-day payment terms' },
    { kind: 'POD', reference: ch, date: ago(days), summary: `Delivery challan signed and stamped by ${by}` },
    { kind: 'Invoice', reference: inv, date: ago(days), summary: 'GST tax invoice' }];

  const specs = [
    { po: 'PO-1031', buyer: ['Nimbus Foods Ltd', '29AABCN4321K1Z2', 'ap@nimbusfoods.example'], inv: 'SGP/25-26/212', ch: 'DC-881', days: 62, by: 'S. Rao, Stores', items: box(2000, 2000, 2000, 24), paid: true },
    { po: 'PO-1038', buyer: ['Metro Fresh Retail Pvt Ltd', '29AAECM7788P1Z9', 'payables@metrofresh.example'], inv: 'SGP/25-26/219', ch: 'DC-894', days: 58, by: 'Imran K., Warehouse', items: box(3000, 3000, 3000, 23.5), received: true, overdueNote: true },
    { po: 'PO-1041', buyer: ['Urban Basket Stores', '29AAGCU5566Q1Z4', 'accounts@urbanbasket.example'], inv: 'SGP/25-26/224', ch: 'DC-902', days: 20, by: 'Store 4 receiving', items: box(1000, 960, 1000, 25), dispute: true },
    { po: 'PO-1043', buyer: ['Nimbus Foods Ltd', '29AABCN4321K1Z2', 'ap@nimbusfoods.example'], inv: 'SGP/25-26/229', ch: 'DC-910', days: 40, by: 'S. Rao, Stores', items: box(2500, 2500, 2500, 24), received: true, approved: true },
  ];
  for (const s of specs) {
    const r = await createRecord(ws, { buyer: { name: s.buyer[0], gstin: s.buyer[1], contact: s.buyer[2] }, poNumber: s.po, poDate: ago(s.days + 6), invoiceNumber: s.inv, invoiceDate: ago(s.days),
      deliveryDate: ago(s.days), acceptedOn: ago(s.days), receivedBy: s.by, writtenAgreement: true, agreedDays: 45, gstRate: 18, items: s.items, documents: docs(s.po, s.inv, s.ch, s.days, s.by) }, 'claude');
    r.invoiceAmount = Math.round(s.items[0].qtyInvoiced * s.items[0].invoiceRate * 1.18);
    r.createdAt = at(s.days); r.activity[0].at = r.createdAt;
    r.status = 'shared'; r.sharedAt = at(s.days); log(r, 'supplier', 'Shared with buyer'); r.activity.at(-1).at = r.sharedAt;
    r.buyerViewedAt = at(s.days - 1); log(r, 'buyer', 'Buyer opened the record'); r.activity.at(-1).at = r.buyerViewedAt;
    if (s.received || s.paid) { r.status = 'received'; r.receivedConfirmedBy = s.by; log(r, 'buyer', `Receipt confirmed by ${s.by}`); r.activity.at(-1).at = at(s.days - 1); }
    if (s.approved) { r.status = 'approved'; r.approvedBy = 'Kavitha, Accounts Payable'; log(r, 'buyer', 'Approved for payment by Kavitha, Accounts Payable'); r.activity.at(-1).at = at(s.days - 8); }
    if (s.dispute) { r.status = 'disputed'; r.dispute = { reason: 'We received 960 boxes as per the signed challan, but the invoice bills 1,000.', by: 'Ankit, Accounts', at: at(s.days - 3) }; log(r, 'buyer', `Query raised by Ankit, Accounts: "${r.dispute.reason}"`); r.activity.at(-1).at = r.dispute.at; }
    if (s.overdueNote) {
      r.followups.push({ id: id(5), at: at(5), kind: 'reminder', subject: `Payment reminder: ${s.inv} against ${s.po}`,
        message: `Dear Metro Fresh Accounts team,\n\nOur invoice ${s.inv} for ${s.po} (goods delivered and receipt confirmed on the signed challan DC-894) fell due on ${addDays(ago(s.days), 45)}. As a registered micro enterprise (UDYAM-KR-03-0012345), payment is due within 45 days of acceptance under Section 15 of the MSMED Act, 2006. All documents are on the link below. We'd be grateful if you could release the payment this week.\n\nRegards,\nShree Ganesh Packaging` });
      log(r, 'claude', `reminder drafted: "Payment reminder: ${s.inv} against ${s.po}"`); r.activity.at(-1).at = at(5);
    }
    if (s.paid) { addPayment(r, { amount: totals(r).invoiceAmount, date: ago(s.days - 40), reference: 'UTR HDFCN52025' }, 'supplier'); r.activity.slice(-2).forEach((x) => (x.at = at(s.days - 40))); }
    r.updatedAt = r.activity.at(-1).at;
    await store.save('records', r);
  }
  console.log(`Seeded demo supplier ${DEMO.email} (MCP token ${ws.mcpToken})`);
}
