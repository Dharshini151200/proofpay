# ProofPay

**Every delivery, proven. Every invoice, paid on time.**

ProofPay helps small suppliers (MSMEs) that sell to large retailers, distributors and enterprise buyers. The supplier connects their own Claude to ProofPay over MCP.

**Claude does the thinking.** It reads the purchase order, the signed delivery challan (proof of delivery, or POD) and the invoice, whether they come as photos, PDFs or text. It pulls out every line item, quantity, rate and date. When payment is late, it drafts the reminder or the formal notice.

**ProofPay does everything else:**
- Keeps one dispute-ready **delivery record** per PO.
- Runs a **three-way match** (PO vs delivered vs invoiced) using fixed rules.
- Counts down the **legal payment due date**: 45 days from acceptance with a written agreement, 15 days without (MSMED Act s.15 / Income-tax Act s.43B(h)).
- Gives the buyer's accounts team **one link** to view the documents, confirm receipt, approve payment or raise a query.
- Tracks payments, and turns any record into a printable **evidence pack** for MSME Samadhaan or a legal notice.

**No AI runs inside this app.** There are no OpenAI, Anthropic or other model keys. Every MCP tool in `mcp.js` only reads or writes the database.

## Try it

| | |
|---|---|
| Live app | `https://<your-app>.onrender.com` |
| Supplier login | `demo@proofpay.app` / `demo1234` |
| MCP link | `https://<your-app>.onrender.com/mcp/demo-volopay-2026` |

### Connect it to Claude
1. In Claude (web or desktop), open **Settings → Connectors → Add custom connector**.
2. Name it `ProofPay`, paste the MCP link and click **Add**.
3. Start a new chat and turn on **ProofPay** in the tools menu. Attach a PO, a delivery challan and an invoice (photos or PDFs), then ask:
   > Create a delivery record for PO-1045 and attach its invoice and POD.
4. Open the app. The record appears on the dashboard within a few seconds, with the match results and the due-date countdown. Edit any field or attach the actual files, then open the buyer link to confirm and approve as the buyer.

Other things to ask Claude:
- *"Which payments are past the legal due date?"*
- *"Draft a payment reminder for PO-1038."*
- *"Urban Basket says they got 960 boxes. Update PO-1041 and draft a reply."*
- *"Record ₹70,800 received against PO-1043, UTR HDFC123."*

> The free Render server sleeps after 15 minutes idle. If the first request is slow, open the app link once and try again.

## MCP tools
| Tool | What it does |
|---|---|
| `get_supplier_profile` | Supplier details (GSTIN, Udyam), buyers, and totals outstanding, overdue and disputed |
| `create_delivery_record` | Creates the record for a PO from what Claude read. Returns the match results, due date, edit link and buyer link |
| `update_delivery_record` | Adds documents, corrects quantities, or shares the record with the buyer |
| `list_records` | Filter by overdue, due this week, disputed or unpaid |
| `get_record` | Full detail, including buyer actions, queries, payments and history |
| `add_followup` | Saves a reminder, formal notice or dispute reply that Claude drafted to the record |
| `record_payment` | Logs a full or part payment |

## Claude attaches the originals itself
Every record has an upload link (`/u/<token>`). Claude can upload straight to it from its workspace, and the file bytes never pass through the chat:

```
POST /u/<token>/files?name=<file>&kind=<PO|Invoice|POD|E-way bill|GRN|Other>&ref=<document no.>&by=claude
Content-Type: application/pdf   (or image/jpeg, image/png…; max 5 MB)
<raw file bytes>
```
Each file is matched to its document row by `ref` (e.g. `DC-921`), then falls back to the first empty row of the same `kind`. `scripts/pp_upload.py <upload_link> file:kind:ref …` wraps this.

On claude.ai, allow your app's domain (e.g. `proofpay-xxxx.onrender.com`) under **Settings → Capabilities**, or Claude's uploads are blocked.

## Run locally
```bash
npm install
npm start    # http://localhost:3000. Data goes in data/db.json; set DATABASE_URL to use Postgres
```
Stack: Node 20+, Express, `@modelcontextprotocol/sdk` (stateless Streamable HTTP), Postgres (JSONB). Files (PDF and images up to 5 MB) are stored in the database.

## Deploy (Render, free)
Push this folder to GitHub. In Render, choose **New → Blueprint**, pick the repo and click **Apply**. `render.yaml` creates the web service and a Postgres database.

*Legal timelines are shown for information. ProofPay is not legal advice.*
