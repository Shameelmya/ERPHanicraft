# Hanicraft ERP

Stock-centred fulfilment for Hanicraft Creative LLP. Responsive local application with individual staff accounts, role checks, production handoffs, customer history and accounting records.

## Run locally

Requires **Node.js 24.15 or newer**. No package installation is required.

```sh
npm start
```

Open http://localhost:3000. The supplied Downloads copy includes the cleaned local database and retained employee accounts. Existing passwords remain unchanged; the login page does not publish credentials.

For a fresh GitHub checkout only:

```sh
npm run setup
npm start
```

Setup creates one administrator with a randomly generated password in the ignored `data/initial-admin.txt`. The MD can create other individual accounts. Optional setup environment variables are `HANICRAFT_ADMIN_EMAIL` and `HANICRAFT_ADMIN_PASSWORD`. Set these privately; never commit them.

Import a source CSV into an empty product master:

```sh
node scripts/import-stock.mjs "path/to/stock.csv"
```

The source import includes every distinct catalogue code, preserves all source rows, flags duplicate counts and retains blanks as unknown. `CUSTOM` is a source marker, not an interchangeable inventory item: each custom order line creates a distinct custom product. Descriptions, units, prices, costs and taxes absent from the source must be entered by the responsible staff. Source stock counts require Stock verification before reservation or shortage requests. Unknown minimum levels prevent a stocks-full alert.

## Workflows

- Sales registers a customer first or inline with a new sale. Only name, phone, WhatsApp and place are required. Optional DOB, company, address, tags and repeatable special dates are retained.
- Sales uses locked catalogue prices or estimates a unique custom item. Leads can be converted once into orders.
- Finance approves custom pricing and tax, records cleared receipts and releases the order to Stock only after the required advance. The advance covers the full custom line total, including its tax.
- Stock reserves available goods and requests only uncovered catalogue demand or custom order manufacture. Independent catalogue replenishment is limited to the verified minimum-level shortage, less pending production.
- Production plans Cutting, selected Finishing stages and optional Acrylic. Workers receive, start, pause, reject or submit; managers assign, reassign and verify. Rejection returns to the assigning manager with a reason.
- QC splits failed output into rework. Stock verifies approved receipts and packs complete orders.
- Finance posts the invoice and grants clearance after full payment. Dispatch requires current clearance and deducts physical stock once.
- A red Sales warning appears only when all active catalogue targets/counts are verified and full, no custom demand exists, and no production remains active.
- Only actual MD and GM roles can edit staff identity, contact details, photo URL and position. Account privilege changes have additional restrictions. Ordinary staff can change their own password, not their identity.
- Every active employee except the MD has a personal Attendance screen for the current day's check-in and check-out. Staff can review only their own monthly record.
- MD and GM Staff management includes attendance corrections, paid and unpaid leave, holidays, absences and approved overtime. Every correction requires a management note and is recorded in the audit trail.
- MD and GM can set each employee's default monthly salary and overtime hourly rate, preview month-end pay, and save an auditable salary calculation. The calculation prorates Monday-Saturday expected workdays, treats paid leave and holidays as paid, deducts absent/unpaid/unmarked days, and adds approved overtime. Saved calculations do not post a bank payment automatically.
- Only the MD can configure daily and monthly sales-booking and production-value targets. The MD home screen compares actual performance with those targets, charts the latest seven days, projects month-end sales and production, and shows booked sales, recognised revenue, receipts, pending collections and an executive health score. Production value is recorded when output passes QC.
- Products are archived by Delete; their audit and transaction history remain. Active reservations, orders and production block archival.

## Data and performance

- Runtime: Node HTTP server, built-in SQLite, vanilla JavaScript ES modules, CSS and bundled Lucide icons.
- Active database: `data/hanicraft-live.sqlite`; override with `HANICRAFT_DB`.
- SQLite transactions, WAL, balanced journal checks, idempotency receipts, optimistic versions and append-only audit events.
- Indexed keyset pagination; bounded list responses and search; bounded lookup queries; lazy-loaded forms and profile images.
- Browser GET cache with in-flight deduplication, 30-second expiry and invalidation on writes/logout; revision polling every 15 seconds while visible.
- Server response caches invalidate on changes. Audit records track changed rows instead of rescanning the whole database. Static files use ETags.
- Dashboard totals use SQL aggregation across the full applicable dataset. P&L aggregates journal lines on the server. Operational detail reports show the latest 50 rows, with all-record totals; section lists and exports access the remaining records.
- No sample business records are seeded in normal startup. Test fixtures exist only for isolated tests.

## Verification

```sh
npm run build
npm test
```

The build command checks module syntax and required assets; this application has no bundling step. Tests cover fulfilment, advance and final-payment gates, permissions, receipt idempotency, QC/rework, staff profiles, attendance, manager-controlled overtime, salary calculations, MD-only business targets and executive metrics, custom pricing, source reconciliation, atomic inline customers, archival and pagination.

## Production boundary

This is a **local implementation, not an internet production deployment**. It binds to loopback, uses local password sessions and SQLite, and deliberately refuses `NODE_ENV=production`. Firebase Auth, managed PostgreSQL and a Vercel server adapter are not implemented in this runtime. Do not deploy the local SQLite file to Vercel's ephemeral filesystem.

Before commercial deployment: implement cloud identity/MFA and the persistent database adapter; migrate validated opening balances and tax settings; review statutory invoice requirements with the business accountant; implement production-cost reconciliation, credit/refund settlement and period-end accounting; add monitored backups with restore tests, external notification delivery, durable document storage, load/security tests and business acceptance testing. P&L remains provisional where prices/costs or opening balances are incomplete. Notifications currently operate inside the app.

The supplied original database backup, stock CSV and staff data remain private and are excluded from Git. The GitHub source contains no live database or real staff/customer information.
