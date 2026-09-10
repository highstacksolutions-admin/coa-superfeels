# Super Feels — COA Portal

Batch-level **Certificate of Analysis** lookup for [coa.superfeels.com](https://coa.superfeels.com).

A customer scans the QR code (or opens the site), types the **batch code** printed on
their product, and sees that batch's independent laboratory report — potency, pesticides,
heavy metals, microbials and the rest — rendered live on the page, with the lab's own
signed PDF to view and download. An admin panel manages products, batches, results, lab
reports and customer enquiries, with analytics on what people are looking up.

Same brand system, stack and conventions as the Super Feels wholesale portal.

---

## What it does

**Public**
- **Batch lookup** — enter a code in any form (`SF-2409-A12`, `sf2409a12`, `sf 2409 a12`);
  punctuation and case are ignored, matching on a normalised key.
- **Report page** — overall pass/fail/pending verdict (derived from the panels, so the
  badge can never disagree with the results), potency headline, full cannabinoid and
  terpene tables, and safety panels that collapse to their verdict.
- **Inline PDF viewer** — the lab's report is drawn onto a canvas with PDF.js from base64
  text, and the download/open actions run from an in-page `blob:` URL. This renders the
  same on every device (no dependency on a browser PDF plugin) and is not intercepted by
  download-manager extensions such as IDM.
- **Content pages** (How to read a COA, FAQ) and a **contact form** that stores and emails
  enquiries.

**Admin** (`/admin`)
- Dashboard with lookup analytics and a "needs attention" queue
- Products, Batches (with a per-panel **results editor** and PDF upload), Labs
- Editable content pages and public copy
- Enquiries (with batch-code matching), Team (roles), Activity log (audit trail)
- Analytics (7 / 30 / 90-day windows) and System diagnostics (mail + storage)

---

## Stack

- **Node.js** (≥ 18.17) + **Express 4**, **EJS** server-rendered views
- **MySQL 8 / MariaDB 10.5+** via `mysql2`
- `express-session` with a MySQL store (separate cookie + table for admin)
- `helmet` CSP, synchroniser-token CSRF, `bcryptjs`, per-IP/per-email rate limiting
- `multer` (uploads), `sharp` (product images), `nodemailer` (mail), PDF.js (vendored)

No build step. Views and CSS are edited and served directly.

---

## Local setup

Requires Node ≥ 18.17 and a MySQL 8 / MariaDB 10.5+ you can create a database on.

```bash
# 1. Install
npm install

# 2. Create the database
mysql -u root -e "CREATE DATABASE superfeels_coa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. Configure
cp .env.example .env      # then edit DB_*, SESSION_SECRET, BOOTSTRAP_ADMIN_*

# 4. Migrate + (optional) demo data
npm run migrate
npm run seed:demo         # a few products, labs and pass/fail/pending batches

# 5. Run
npm run dev               # http://localhost:3000  (auto-restarts on change)
```

The gate is at `/`, the admin at `/admin` (sign in with the `BOOTSTRAP_ADMIN_*` credentials
from your `.env`). With `AUTO_MIGRATE=1` the app migrates and creates the first admin on
boot, for hosts with no terminal step.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with `--watch` (auto-restart) |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run seed:admin -- "Name" email pass [admin\|editor]` | Create/reset a staff account |
| `npm run seed:demo` | Load demo products, labs and batches |
| `npm run check:storage` | Assert the storage root is outside the web root |

---

## Configuration

All configuration is environment variables — see [`.env.example`](.env.example) for the full,
commented list. The essentials:

| Variable | Purpose |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Database connection |
| `SESSION_SECRET` | Session signing key (32+ chars in production) |
| `STORAGE_PATH` | Where lab PDFs are stored — **must be outside `public/`**; the app refuses to boot otherwise |
| `UPLOADS_PATH` | Public product images (inside `public/`) |
| `SMTP_*`, `MAIL_FROM`, `CONTACT_RECIPIENT` | Email; leave `SMTP_HOST` empty to run without mail (enquiries are still stored) |
| `AUTO_MIGRATE`, `BOOTSTRAP_ADMIN_*` | First-boot migration + admin for shell-less hosts |
| `ANALYTICS_SNIPPET` | Optional analytics tag injected into every page |

---

## How the data fits together

```
products ──< batches ──< coa_files        (the lab's PDF, primary + extras)
                   └────< result_panels ──< results   (per-analyte rows)
                   └ lab (attribution)
lookups         every batch search, hit or miss (drives analytics)
coa_downloads   every deliberate PDF open/download
enquiries       contact-form messages
content_pages   editable static pages
activity_log    staff audit trail
```

A batch carries both `batch_code` (as printed) and `batch_key` (normalised, uniquely
indexed) so `SF-2409-A12` and `SF2409A12` can never become two racing batches.

---

## Security notes

- Lab PDFs live outside the web root and are streamed only through `/download/:id`, which
  checks the batch is published and counts the hit — an unpublished report is unreachable.
- Admin sessions use a separate cookie and store from the public session.
- CSP is nonce-based for scripts; CSRF is enforced on every state-changing request
  (including multipart uploads); auth and lookup routes are rate-limited per IP and email.
- Passwords are bcrypt (cost 12) with constant-time comparison against a dummy hash for
  missing accounts, so sign-in timing does not reveal which emails exist.

---

## Deployment

Designed to run behind a reverse proxy (set `TRUST_PROXY=1`, `FORCE_HTTPS=1`). Point the
storage path at a directory outside the web root, set real `SMTP_*` and DNS
(SPF/DKIM/DMARC) for reliable mail, and run under a process manager. `AUTO_MIGRATE=1`
applies schema changes on deploy.

---

Private project — Super Feels / High Stack Solutions.
