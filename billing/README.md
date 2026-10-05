# JMS Textiles — Billing & Stock

Full-stack shop billing with a Node.js/Express backend, MongoDB storage and a responsive browser frontend. Designed for **GitHub → Vercel**, with the frontend and API in one Vercel project. No database password or shop password is shipped to the browser.

## Included

- Password-protected shop workspace; HTTP-only session cookies.
- One product/SKU per size and colour; opening stock, price, low-stock threshold.
- Printable QR labels, camera scanning, USB scanner input and manual SKU entry.
- Live stock checks, bills, discounts, Cash/UPI/Card payment recording, receipt printing/PDF.
- Transactional checkout: bill, sequence number, stock deductions and movement records commit together.
- Duplicate-request protection, including a pending checkout preserved in the same browser tab across reloads.
- All-time bill count, today's completed sales in India time, stock count, low-stock count.
- Searchable bill history, individual receipt details, stock movement logs.
- Bill cancellation restores stock once and retains the original bill. Refunds must be handled separately.
- Stock adjustments require a reason and retain a movement record.

## Architecture

Browser → Vercel `/api/*` → MongoDB Atlas.

Local development: Browser → local Node.js → local MongoDB replica set.

MongoDB cannot run inside this Vercel app, and a Vercel backend cannot connect to your computer's `localhost`. Use **MongoDB Atlas for the live app**. The local database and Atlas are separate databases; this version does not automatically sync them.

## GitHub → Vercel configuration

Repository: `Mageshjithin/jms-textiles-fashion`

Billing branch: `jms-billing-mongodb`

Billing root directory: `billing`

Create a **separate Vercel project** for billing; preserve the existing fashion website project. Use the billing branch as this project's production branch. If Vercel initially imports `main`, change the production branch to `jms-billing-mongodb` and deploy that branch after selecting the `billing` root directory.

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | `billing` |
| Node.js | 22.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `public` |
| Production branch | `jms-billing-mongodb` |

Add these variables in **Vercel → Project → Settings → Environment Variables**, for Production and whichever Preview deployments you intend to use:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Your Atlas driver connection string with a dedicated database user's credentials |
| `MONGODB_DB` | `jms_textiles` |
| `ADMIN_PASSWORD` | A unique shop password, at least 12 characters |
| `SESSION_SECRET` | A random secret, at least 32 characters |

Use a separate test database for preview deployments to avoid changing live shop stock while testing. Do not put secrets in GitHub, frontend JavaScript, or chat. Generate a session secret locally:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

In Atlas, create the database user with access to `jms_textiles` and configure network access for your deployment. Prefer a restricted network configuration/static egress where available; do not expose a local MongoDB port to the internet. Redeploy after changing environment variables. Vercel's generated project URL serves the UI; append `/api/health` for the database health check. API data routes require login.

Once the Git integration, production branch and root are configured, pushes to this billing branch trigger Vercel deployments. No Vercel API token is needed in source code.

## Run locally (Windows / VS Code)

Install Node.js 22 LTS and Docker Desktop. Open a terminal in the `billing` folder (or this extracted project's root):

```sh
npm ci
```

Copy `.env.example` to `.env`:

```bat
copy .env.example .env
```

On macOS/Linux, use `cp .env.example .env`. Enter your own `ADMIN_PASSWORD` and `SESSION_SECRET` in `.env`.

```sh
docker compose up -d
docker compose ps
npm run build
npm start
```

Wait for MongoDB to become healthy, then open `http://localhost:3000`. The compose file initialises a single-node replica set and keeps the database in a Docker volume. It binds port 27017 only to your computer's loopback address. Do not run `docker compose down -v` unless you intend to delete this local database.

If MongoDB is already installed instead of Docker, configure it as a replica set named `rs0`. A standalone MongoDB server cannot run the transactions used by checkout. Do not run Docker and an existing MongoDB service on the same port.

The local development server listens on loopback. Phone camera scanning works on the HTTPS Vercel site; desktop webcam scanning also works on localhost. USB scanners should be configured to append Enter after the decoded value.

## First bill

1. Sign in with your shop password.
2. Set shop name, address and phone in Shop settings.
3. Add a product: SKU `KURTI-BLUE-M`, Cotton kurti, M, Blue, price ₹599, opening stock 10. This is an example only; the app starts with no sample products.
4. Select **QR** → **Print label**. Attach labels to that exact variant.
5. At Billing desk scan the QR, enter the SKU, or use **Add** in inventory.
6. Choose quantity/customer/payment, enter received amount or select **Mark fully paid**.
7. Complete the bill. A sale of 2 pieces leaves 8 pieces in stock.
8. Print the receipt. Find it again under Bill history.

After a network interruption, keep the tab open or reload the same tab and use **Retry / confirm this bill**. This reuses the same request key. Do not start the same sale from a different browser while its outcome is uncertain. The server checks current inventory again; a displayed quantity is not a stock reservation.

## Inspect data in MongoDB Compass / mongosh

Connect to the configured local URI or Atlas cluster. Select `jms_textiles`.

```javascript
use jms_textiles

// All product variants and remaining stock
db.products.find({}, {sku:1, name:1, size:1, color:1, stock:1, priceCents:1})

// Availability of one size / colour
db.products.findOne({sku: 'KURTI-BLUE-M'})

// Total bills, including cancellations
db.bills.countDocuments({})

// Completed / cancelled counts
db.bills.countDocuments({status: 'COMPLETED'})
db.bills.countDocuments({status: 'CANCELLED'})

// Recent bills
db.bills.find({}, {number:1, createdAt:1, customer:1, totalCents:1, status:1}).sort({createdAt:-1})

// Full bill, including product snapshots, quantities, price, discount and payment
// Replace the value below with a bill number displayed in the app.
db.bills.findOne({number: 'YOUR-BILL-NUMBER'})

// Stock movement audit trail
db.movements.find({sku: 'KURTI-BLUE-M'}).sort({createdAt:-1})

// Low stock
db.products.find({$expr: {$lte: ['$stock', '$lowStock']}})
```

Money fields ending in `Cents` store integer paise (₹599 = 59900). `gstBps` stores percentage ×100 (5% = 500). Dates are UTC in MongoDB and displayed in India time.

Collections: `products`, `bills`, `movements`, `counters`, `settings`, `operations` (stock adjustment retry protection), `loginAttempts` (automatically expired login-rate records). Check stock through the application; avoid manually changing these collections because direct changes bypass billing validation.

## API overview

All mutations require `Content-Type: application/json` and `X-JMS-Request: 1`. Data routes require the session cookie from login.

| Method / route | Purpose |
| --- | --- |
| GET `/api/health` | Database connectivity |
| POST `/api/login`, `/api/logout` | Shop session |
| GET/PUT `/api/settings` | Shop receipt settings |
| GET/POST `/api/products` | List/create product variants |
| PUT `/api/products/:id` | Edit metadata/price, not stock |
| GET `/api/scan?code=...` | Look up `JMS:<product-id>` or SKU |
| GET `/api/products/:id/qr` | QR label PNG |
| POST `/api/products/:id/stock` | Signed stock adjustment with reason and unique `requestKey` |
| GET `/api/products/:id/movements` | Latest 100 stock changes |
| POST `/api/bills` | Create transactional bill with unique `requestKey` |
| GET `/api/bills` | Search/paginate bill history |
| GET `/api/bills/:id` | All details of one bill |
| POST `/api/bills/:id/cancel` | Cancel and restore stock exactly once |
| GET `/api/dashboard` | Counts and completed-sales totals |

## Tests and limits

```sh
npm test
npm run test:integration
```

Integration tests download and start a temporary MongoDB replica set; they do not use your shop database. They test authentication, real transaction contention, duplicate requests, insufficient-stock rollback, cancellation, stock changes and history counts.

The calculation tests and frontend build were verified during preparation. The integration suite could not start MongoDB in the preparation environment (`open: Operation not permitted`), so real-database test results must be confirmed in GitHub Actions or on your machine before live billing.

This is a single-shop, shared-admin version. It does not include multi-user roles, payment collection, automatic refunds, partial returns, a supplier purchase ledger, receivable settlement after saving a bill, or local-to-cloud synchronisation. Cancellation handles the whole bill. Existing browser-only bills are not automatically migrated; retain the old app's exported backup for historical records. Product prices are inclusive of the GST you configure, but receipts are not a complete statutory GST invoicing solution.

Back up the MongoDB database with your chosen Atlas backup configuration or `mongodump`. A source-code ZIP is not a stock/bill database backup.

Official deployment references:
- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/docs/functions
- https://www.mongodb.com/docs/manual/core/transactions-production-consideration/
