# Flo — Product Development Plan

**Written:** 11 Sep 2026 · **Revised:** 11 Sep 2026 (owner console promoted, FBR
deferred) · **Target ship:** 9 Oct 2026 (28 days) · **Tooling budget:** Rs 0

---

## 0. Where we actually stand

What exists today is a **marketing site only** — 9 routes, a design system in
`app/globals.css`, motion primitives, and Supabase cookie plumbing in
`utils/supabase/`. There is no database, no auth, no register, no tenant model.
`app/login/login-form.tsx` fakes a pending state; `app/demo/demo-form.tsx`
resolves locally.

So this is not "finish the site" — it is **build the product** in a month, on top
of a good-looking shell.

### What v1 is

Three things, in this order of importance:

1. **The owner console** (`/admin`) — *your* dashboard. You sell a package over
   WhatsApp or in person, the money lands in your account, and you activate that
   client in under a minute with the plan, branch count, and price you actually
   agreed. Nobody can create an account any other way. §3 specifies this.
2. **The register** — offline-first billing that survives load-shedding, on a
   Rs 25,000 Android tablet.
3. **Stock, udhaar khata, staff, and reports** — the modules that make Flo worth
   Rs 5,000 a month rather than a calculator.

### What v1 is not, and why

`app/products/page.tsx` promises 7 modules, `app/solutions/page.tsx` promises 6
industry configurations, and `app/pricing/page.tsx` promises FBR fiscal
invoicing, PRA/SRB filing, Foodpanda reconciliation, payroll export, loyalty
campaigns, and API access. All of that in 28 days produces a demo, not a product
someone keeps paying for.

So v1 targets **kiryana/general store and restaurant**, and everything else is
dated in §10 with the site copy corrected in Part 8 — so nothing is ever sold
that doesn't exist.

**FBR is deferred** at your instruction. §7 covers what that costs you
commercially and the one cheap hedge that keeps it from becoming a rewrite later.

---

## 1. Non-negotiable constraints

| Constraint | Consequence for the build |
|---|---|
| **No paid tools** | Supabase free tier, free hosting, zero paid SaaS. See §2. |
| **You activate every client** | No self-signup, ever. Account creation happens only through your console or a payment you verified. See §3. |
| **Pakistani counter reality** | Power cuts, dead internet, 2 GB RAM tablets, thermal printers, Urdu item names, udhaar. Offline-first is not a feature, it is the architecture. See §4. |
| **28 days, small team** | Every part has a Definition of Done. If a part slips it takes budget from §10 — never from Parts 1–3 or Part 7. |

---

## 2. Stack — every line of it free

### Already in `package.json`

Next.js 16.3.4, React 19.2.8, Tailwind v4, TypeScript strict, `@supabase/ssr`.

### To add — all MIT or free tier, commercial use permitted

| Need | Choice | Why this one |
|---|---|---|
| Database, auth, storage, realtime | **Supabase free tier** | 500 MB Postgres, 50k MAU, 1 GB storage, Edge Functions, `pg_cron`. Already wired. |
| Offline store on the tablet | **Dexie** (Apache-2.0) | Smallest sane IndexedDB wrapper; survives tab kills. |
| Service worker / PWA | **Serwist** (MIT) | Maintained `next-pwa` successor; works with App Router. |
| Barcode scanning | Native **`BarcodeDetector`** + **`zxing-wasm`** fallback | Free, no camera SDK. USB scanners need *no code* — they are keyboard-wedge. |
| Thermal printing | Hand-rolled **ESC/POS over WebUSB + Web Bluetooth**; `@media print` 80 mm CSS fallback | No driver, no paid SDK. ~300 lines. |
| IDs that work offline | **ULID** (tiny, MIT) | Sortable, collision-free, client-generatable — the key to conflict-free sync. |
| Charts | **Hand-rolled SVG** — extend `components/site/sales-chart.tsx` | Zero KB. A chart library is 60 KB we don't need. |
| Transactional email | **Supabase Auth email** → **Brevo free (300/day)** when outgrown | Invite links, renewal notices, daily summaries. |
| WhatsApp | **`wa.me` deep links** (you or your staff tap *Send*) | See the honest note below. |
| Your own 2FA | **Supabase MFA** (free) | Your console can activate paid accounts. It gets a second factor. |
| Error tracking | **Sentry free (5k events/mo)** | Catches the tablet crashes you can't reproduce. |
| Analytics | **Cloudflare Web Analytics** (free, no cookie banner) | |
| Hosting | **Cloudflare Workers** via `@opennextjs/cloudflare`, *or* **Oracle Cloud Always Free** ARM VM | **Important:** Vercel's Hobby tier forbids commercial use. Since you are selling this, Hobby is not an option. Cloudflare's free tier and Oracle's Always Free VM both permit commercial use. |
| CI | **GitHub Actions** free tier | `npm run lint && npm run build` on every push. |

### Two honest gaps, and the free workaround for each

**Payments.** There is no free payment gateway in Pakistan — Safepay, PayFast,
and 1LINK acquiring all cost money and need company documents. **This is
actually fine, and it now matches how you want to sell.** You take the transfer,
you verify it, you activate the client from your console. Costs nothing, and it
is how most Pakistani B2B SaaS onboards its first hundred customers. Swap in a
gateway at ~50 paying shops, when the manual step starts costing you evenings.

**WhatsApp.** The Cloud API's free tier only covers *user-initiated*
conversations; business-initiated template messages — udhaar reminders, renewal
nudges — are billed. So v1 ships **`wa.me` deep links**: Flo composes the Urdu
message, you or the shop's staff tap once, and it sends from a real number the
recipient recognises. Slightly manual, completely free, and it converts better.

---

## 3. The owner console — you are the only way in

This is now the centre of the product, so it is specified before anything else
and built in Part 1.

### 3.1 Two activation paths, one code path

**A · Direct activation — the primary path**

You close a deal on WhatsApp or at the shop. The Rs 5,000 lands in your Meezan
account or on Easypaisa. You open `/admin/clients/new` and fill:

> shop name · owner name · phone · city · shop type · **plan** (Standard /
> Premium) · branches · registers · billing cycle (monthly / quarterly / yearly)
> · **price actually agreed** · trial days · start date · notes

Press **Activate**. In one transaction that creates the tenant, its first
branch, the subscription, and a hashed single-use invite — then hands you a
**copyable Urdu/English WhatsApp message** containing the signup link, ready to
paste into the chat you are already in. Target: under 60 seconds, no page reload.

The "price actually agreed" field matters more than it looks. Pakistani B2B
sales involve haggling — *"bhai 4,000 kar do"* — and a system that can only
charge the list price forces you to either lose the deal or lie to your own
records. The plan sets entitlements; the price is a separate number.

**B · Self-serve checkout — the secondary path**

For inbound traffic that arrives while you are asleep:

```
/pricing ──"Get started"──▶ /checkout
                                │ Server Action
                                ▼
                    orders row: status = awaiting_payment
                    reference = FLO-7K2M9Q  (unique, human-readable)
                                │
                                ▼
                    /order/[ref]  (public, unguessable ref)
                    · Bank / Easypaisa / JazzCash details
                    · "Put FLO-7K2M9Q in the reference field"
                    · Upload payment screenshot → Supabase Storage
                                │
                                ▼
                    /admin/orders — you match it against your bank statement
                                │  ✅ Verify   ❌ Reject (with reason)
                                ▼
                    ░ calls the SAME activateClient() action as path A ░
```

**Both paths funnel through one `activateClient()` server action**, so there is
exactly one place in the codebase that can bring a tenant into existence. That is
the whole point — one function to audit, one function to get right.

### 3.2 Then, and only then, the client signs up

```
/signup?token=…   ◀── THE ONLY ROUTE THAT CREATES A USER
· token validated server-side (sha256 compare, expiry, unused)
· supabase.auth.admin.createUser  (service role, server only)
· profile attached to tenant as role = owner
· invite marked used_at — single use, forever
        ▼
      /app   (the register)
```

### 3.3 Enforcement — five layers, not one

1. **Supabase Dashboard → Authentication → disable "Allow new users to sign
   up".** This is the real lock: the public `/auth/v1/signup` endpoint returns
   422 even if someone calls it directly with your publishable key. Everything
   below is defence in depth.
2. **Users are only ever created with the service-role key**, inside a Server
   Action or Edge Function. That key never reaches the browser and lives only in
   the host's env vars — never `NEXT_PUBLIC_*`.
3. **Invite tokens are stored hashed**, single-use, 72-hour expiry, bound to one
   tenant. A leaked database dump yields no usable invite.
4. **Rate limit `/checkout` and `/signup`** by IP — an order row costs nothing,
   but a flood of them is noise in your queue.
5. **`profiles` RLS** means a user with no `tenant_id` sees nothing at all, so a
   half-created account is inert rather than dangerous.

`/signup` without a valid token renders a polite "Invites come with an activated
subscription — book a demo" page, never a form. There is no signup link anywhere
on the site.

### 3.4 The console screens

| Route | What it does |
|---|---|
| `/admin` | Overview: active clients, MRR, trials ending in 7 days, subscriptions expiring in 7 days, orders awaiting verification, sales volume processed this month, clients with no sale in 3 days (your churn early-warning). |
| `/admin/clients` | The table you will live in: shop, city, plan, branches, status pill, expires, last sale seen, monthly value. Filter by status / plan / city, search by shop or phone. |
| `/admin/clients/new` | Direct activation (path A). |
| `/admin/clients/[id]` | One client's record — see §3.5. |
| `/admin/orders` | Self-serve queue with the payment-proof viewer, Verify / Reject. |
| `/admin/payments` | Record a renewal against a client; extends `current_period_end` and logs who took it. |
| `/admin/plans` | Plan definitions and their feature flags, editable **without a deploy** — so "Premium now includes X" is a form, not a release. |
| `/admin/leads` | `demo-form.tsx` submissions, with a wa.me link to call each one. |
| `/admin/audit` | Every admin action, append-only. Non-negotiable: this console can activate paid accounts and read client data. |

### 3.5 The client record — what you need at 11 pm on a support call

- **Plan and entitlement editor** — change plan, branch count, register count,
  agreed price, or flip an individual feature for this one client.
- **Lifecycle controls** — extend period, suspend, reactivate, cancel, convert
  trial to paid. Each writes an audit row with your user id.
- **Payment history** — every rupee taken, method, reference, and who recorded it.
- **Invite status** — resend, revoke, or regenerate the link if the owner lost it.
- **Health** — last sale timestamp, last sync, pending outbox size, registered
  devices, staff count, item count. This tells you whether a shop is *actually*
  using Flo before you ask them to renew.
- **Open as client (read-only)** — support impersonation, audit-logged, with a
  persistent banner. This is what lets you answer a WhatsApp question in Urdu in
  two minutes instead of asking for screenshots.
- **Notes** — free text, timestamped. Who introduced you, what they haggled to,
  which printer they bought.

### 3.6 Subscription lifecycle and what suspension means

```
trialing ──▶ active ──▶ past_due ──▶ suspended ──▶ cancelled
     └──────────┴──────────┴────────────┘
              (you can move it anywhere, audited)
```

A **suspended** tenant can still log in, but `/app` renders a renewal screen with
your payment details and a wa.me link to you. Critically: **shift close and data
export stay available.** Never hold a shop's own sales hostage — it is indecent,
it is the fastest way to earn a bad reputation in a bazaar, and in a dispute over
their records it is the weaker position to be in.

`pg_cron` runs daily and surfaces clients expiring in 7 / 3 / 1 days on your
dashboard plus a morning email digest, each with a pre-written Urdu wa.me nudge.

### 3.7 Your own access, secured properly

- A separate **`platform_admins`** table — you are not a tenant. Roles:
  `super_admin` (you) and `support` (whoever you hire later, no billing rights).
- The access-token hook stamps a `platform_role` claim, so RLS can check a claim
  instead of a subquery.
- **Read paths only** get an `or is_platform_admin()` clause on tenant tables.
  Writes to tenant data never get a blanket bypass — impersonation is read-only.
- **MFA required** on your account (Supabase MFA is free).
- `/admin` returns **404, not 403**, to non-admins, so it isn't discoverable.
- Every mutation in the console writes to `audit_log`. Including yours.

### 3.8 Staff are not auth users — a deliberate design choice

Cashiers get **no email and no password**. The shop owner creates staff inside the
app with a **4-digit PIN** (bcrypt-hashed, tenant-scoped) and per-role
permissions. Only the shop owner — and optionally one manager — is a real
Supabase user. This means:

- One paid tenant = one or two auth users, so you stay far inside the free MAU tier.
- The pricing promise "unlimited staff PINs" is literally true.
- A cashier's PIN is revoked in two taps and never touches auth.
- The tablet stays signed in as the tenant; PIN switching is instant and offline.

---

## 4. Architecture decisions that determine whether this works

Five calls, made now, because reversing any of them in week 3 costs the month.

### 4.1 Offline-first, and conflict-free by construction

The register must bill through a dead internet connection and a dead router. So:

- **The tablet is the source of truth for the current shift.** Every sale writes
  to Dexie first and renders from Dexie. The network is a background detail.
- **Client-generated ULIDs** on every row — no round-trip needed to create a sale.
- **An outbox queue.** Pending mutations POST in batches with an idempotency key;
  the server applies them `on conflict (id) do nothing`. Retrying a batch ten
  times has the same effect as once.
- **Sales are append-only and immutable.** A mistake becomes a *return* row, not
  an edit — so two registers can never conflict on a sale.
- **Stock is a ledger, never a counter.** `stock_moves` rows are appended; on-hand
  is a sum, materialised per item/branch for speed. Two offline registers each
  selling the last packet of Dalda both succeed, and the branch simply goes to
  −1 with a flag — which is the truth, and is recoverable. A mutable `quantity`
  column would silently lose one of those sales.
- **Pull is cursor-based** on `updated_at` plus tombstones, per tenant per branch.

This is the most important section in this document. Everything sellable about
Flo in Pakistan follows from it.

### 4.2 Multi-tenant Postgres with RLS from the first migration

`tenant_id uuid not null` on every business table. A **custom access token hook**
stamps `tenant_id`, `role`, and `platform_role` into the JWT, so RLS policies
read a claim instead of sub-querying `profiles` on every row — the difference
between a 40 ms and a 900 ms report.

> Before writing any SQL, load the **`supabase-postgres-best-practices`** skill
> (vendored in `.agents/skills/`). It covers RLS policy shape, index choices, and
> the `security definer` patterns we need. Not optional — a tenant-leak bug found
> by a customer ends the business.

### 4.3 Entitlements are server-side, plan-driven, and per-client overridable

```
plans.features jsonb   →  { max_branches, max_registers, restaurant_mode,
                            multi_branch_dashboard, api_access, … }
subscriptions.feature_overrides jsonb  →  the one-off deal you cut for one client
```

A single server-side `getEntitlements(tenantId)` is the only authority. Layouts
and Server Actions call it; **client-side gating is UX only and never a control.**
Register count is enforced at device registration, branch count at branch
creation. This is what makes `/admin/plans` a form instead of a deploy, and it is
what stops a Standard client from using Premium features by editing a request.

### 4.4 Three route groups

```
app/
  (site)/          ← existing marketing routes, unchanged, public
  (app)/app/       ← the client's product: register + back office. Auth-gated.
  (admin)/admin/   ← YOUR console. platform_role-gated, 404 to everyone else.
```

`middleware.ts` keeps doing *only* `updateSession` — the `getUser()` call stays
untouched, per the rule in CLAUDE.md. Route protection is a **layout-level
`getUser()` check**, not middleware logic.

Two visual languages, deliberately:

- **`/admin` reuses the marketing design system.** `.panel`, `.rim`, `.field`,
  `.btn-primary`, `iris-*` — the dark glass aesthetic is right for a dashboard
  you open on a laptop, and it costs almost no new CSS.
- **`/app` does not.** The register is light, high-contrast, huge tap targets, no
  motion. Dark glass does not belong on a counter under a tube light at 2 pm.
  `components/pos/` is a new, independent primitive layer.

### 4.5 Server components stay the default

Per CLAUDE.md only ten files are `"use client"` today. The register is genuinely
interactive, so `(app)/app/register/` will be client-heavy — but the whole admin
console, plus back office, reports, and settings, stays server components driven
by Server Actions. Interactivity pushes to leaves.

---

## 5. The month, in eight parts

Each part lists its Definition of Done. **`npm run lint && npm run build` must
pass at the end of every part** — those are the only gates this repo has.

---

### Part 0 · Foundations (Days 1–2)

**Goal:** a database and a deploy target, both real.

- Supabase project created; `.env.local` filled; **public signup disabled**; MFA
  enabled on your account.
- `supabase/migrations/0001_init.sql` — `tenants`, `branches`, `profiles`,
  `platform_admins`, `plans`, `subscriptions`, `orders`, `payments`, `invites`,
  `leads`, `audit_log`.
- `plans` seeded with Standard (Rs 5,000) and Premium (Rs 10,000) and their
  feature JSON, matching `app/pricing/page.tsx` minus what §10 parks.
- Custom access token hook stamping `tenant_id`, `role`, `platform_role`.
- RLS on every table with a written policy, plus `tests/rls.sql` asserting that
  tenant A cannot read tenant B **and** that a tenant user cannot read
  `platform_admins`, `plans`, or another tenant's `subscriptions`. Runs in CI.
- Route groups created; `(app)/layout.tsx` auth gate; `(admin)/layout.tsx`
  platform-role gate returning `notFound()`.
- Cloudflare (or Oracle VM) staging deploy live; GitHub Actions running lint + build.

**DoD:** a hand-inserted tenant logs in at `/login` and reaches an empty `/app`;
your admin account reaches `/admin` and a tenant user gets a 404 there. The RLS
test passes. The staging URL is green.

---

### Part 1 · Your console and client activation (Days 3–6)

**Goal:** everything in §3, working, with nothing bypassable. Four days — this is
now the second-largest block, because it is the part *you* use every day and the
part that protects the revenue.

- `activateClient()` — one server action, one transaction: tenant + branch +
  subscription + hashed invite + audit row. Both paths call it.
- `/admin/clients/new` — direct activation with the copy-ready Urdu/English
  WhatsApp message on success.
- `/admin/clients` and `/admin/clients/[id]` — the table and the client record
  from §3.5, including plan/entitlement editing, lifecycle controls, payment
  history, invite resend/revoke, health panel, and notes.
- `/admin` overview with MRR, expiries, trials, and the no-sales-in-3-days list.
- `/admin/plans`, `/admin/payments`, `/admin/leads`, `/admin/audit`.
- Read-only **Open as client** impersonation with a persistent banner and an
  audit row per session.
- Self-serve path: `/checkout`, `/order/[ref]` with Storage proof upload,
  `/admin/orders` verify/reject.
- `/signup?token=…` token-gated owner creation via service-role `createUser`.
- `login-form.tsx` wired to `signInWithPassword` with real error states; password
  reset through Supabase recovery email.
- Suspension screen at `/app` per §3.6, with shift close and export still working.
- IP rate limits on `/checkout` and `/signup`.

**DoD:** you activate a Premium client with 3 branches at a haggled Rs 8,500 in
under 60 seconds, paste the link into WhatsApp, and they are billing inside
`/app`. Then prove there is **no other path in**: the public signup endpoint
returns 422; a forged, expired, or already-used token is refused; a second use of
a valid token fails; a Standard tenant cannot reach a Premium-only feature by
crafting the request; and a tenant user gets 404 on every `/admin` route.

---

### Part 2 · The register, offline (Days 7–12) — *the make-or-break part*

**Goal:** billing that never stops. Six days — the largest block, deliberately.

- `components/pos/` primitives: numpad, item grid, cart, tender sheet, toast.
- Dexie schema mirroring the sale tables plus the outbox; Serwist service worker
  so `/app/register` loads with the network unplugged.
- **Catalog search that fits Pakistan:** substring and prefix match across
  English, Urdu script, *and* roman Urdu (`chini` → چینی → Sugar) via a
  `search_terms text[]` column. Debounced, indexed, fast on 5,000 items offline.
- Cart: piece / kilo / carton / plate units, manual weight entry, per-line
  discount within the cashier's PIN limit, hold-and-recall, returns against a
  bill number.
- Tender: cash with change calculation, card, Raast QR, Easypaisa, JazzCash,
  **split tender**, and *udhaar* (posts to the khata rather than counting as paid).
- **Receipt printing:** ESC/POS encoder over WebUSB and Web Bluetooth, 58 mm and
  80 mm, Urdu shop name, itemised lines, the shop's NTN/STRN, a **reserved block
  where the FBR QR will go** (see §7), and a browser `@media print` fallback.
- **Shifts:** open with a counted float, close with a cash count, over/short
  computed and locked. Nothing in a Pakistani shop matters more than the drawer
  reconciling at 11 pm.
- Sync engine: outbox flush, cursor pull, a visible connection pill
  (`Synced · 3 pending · Offline`), and a manual "push now".
- Device registration counted against the plan's `max_registers`.

**DoD — test it exactly this way:** turn off Wi-Fi. Bill 40 mixed sales across
two cashier PINs, including a split tender and an udhaar sale. Force-kill the
browser twice. Print six receipts. Close the shift. Turn Wi-Fi back on. Every
sale appears in Postgres exactly once, the drawer reconciles, there are no
duplicate rows — and the client's health panel in your console shows the correct
last-sale time.

---

### Part 3 · Stock, khata, staff (Days 13–18)

**Goal:** the three modules that make Flo worth Rs 5,000 rather than a calculator.

**Stock — a ledger, per §4.1**

- `items`, `variants`, `categories`, `units`, `suppliers`, `stock_moves`,
  `stock_levels` (materialised), `batches` (expiry).
- Goods receipt, wastage, branch-to-branch transfer, physical stock-count session.
- Low-stock and near-expiry lists. Supplier rate history per item.
- **Bulk import** from the owner's existing rate list: CSV/XLSX upload → column
  mapper → preview → commit. Onboarding lives or dies on this one screen, and it
  is also *your* onboarding tool — you will run it for clients over a call.

**Udhaar khata**

- `customers` keyed on phone number; `udhaar_ledger` as debits and credits.
- Per-customer limit enforced at the register; ageing buckets (0–30 / 30–60 / 60+).
- Part payments applied against the oldest bill first.
- **Urdu statement and reminder composed into a `wa.me` link** — one tap to send.
- Printed khata statement.

**Staff**

- `staff` with bcrypt PIN, role, and granular permission flags: discount ceiling,
  return authority, shift close, price edit, report access.
- PIN switch at the register — instant, offline, no auth round-trip.
- Attendance in/out; shift-wise cash accountability per cashier.

**DoD:** import a 600-item rate list from a spreadsheet in under three minutes;
sell 20 items and watch on-hand fall correctly; put Rs 3,000 on a khata, take
Rs 1,000 back, send the reminder; and prove a cashier PIN cannot exceed its
discount limit or close a shift.

---

### Part 4 · Reports and the owner's phone (Days 19–21)

**Goal:** "one number per question", as `app/products/page.tsx` promises.

- Day-close report: sales, tender mix, discounts, returns, drawer over/short.
- Sales by hour (heatmap), by item, by category, by cashier, by branch.
- Stock valuation, dead stock, top and bottom movers.
- Khata ageing summary.
- **Mobile-first owner dashboard** — this is what the shop owner opens in the car.
  Hand-rolled SVG, no library.
- CSV export on every report (and it keeps working while suspended, per §3.6).
- **Daily closing summary** at 11:30 pm via `pg_cron` + an Edge Function → email,
  with a `wa.me` link the owner can forward.
- The same aggregates feed your `/admin` overview — build them once.

**DoD:** every figure on every report ties to the sum of `sale_lines` for the same
range, and reports render in under a second across 90 days of a busy branch.

---

### Part 5 · Multi-branch and restaurant mode (Days 22–23)

**Goal:** make the Rs 10,000 Premium tier worth its price. Both features are
entitlement-flagged, so you can switch them on per client from your console.

- Branch switcher; per-branch roles (a Lahore manager sees only Lahore).
- Central catalog with per-branch price overrides; push a rate change everywhere.
- Cross-branch comparison report.
- **Restaurant mode:** floor/table map, dine-in vs parcel vs delivery,
  order-then-pay, KOT printing routed to kitchen vs bar/tandoor printers, split
  bill by item or by head, table transfer.

**DoD:** two branches under one tenant with separate stock and one catalog; a
restaurant tenant seats a table, fires a KOT to a second printer, splits the bill
three ways, and closes it; and flipping `restaurant_mode` off in your console
removes it from their app on the next request.

---

### Part 6 · Billing lifecycle and renewals (Day 24)

**Goal:** the console keeps working in month two, when clients start expiring.

- `pg_cron` daily job → expiring-in-7/3/1 lists on `/admin`, plus your morning
  email digest with pre-written Urdu wa.me nudges per client.
- Record-a-payment flow that extends `current_period_end` correctly across
  monthly / quarterly / yearly cycles, prorated when branches change mid-period.
- Auto-transition `active → past_due` on expiry, and `past_due → suspended`
  after a grace period you configure. Both audited, neither silent.
- Client-facing renewal screen and in-app "your plan expires in N days" banner.
- A simple MRR / active-clients / churn strip on `/admin`, computed from
  `subscriptions` and `payments` — the numbers you will actually run the
  business on.

**DoD:** roll a test client's period end into the past and watch it move through
`past_due` → `suspended` with the right screens and audit rows; record a payment
and watch it come back to `active` with the correct new period end.

---

### Part 7 · Hardening for a Rs 25,000 tablet (Days 25–27)

The part that separates a demo from something a shop trusts. **Three days now,
taken from the deferred FBR work. Do not spend them on features.**

- **Test on real low-end hardware** — a 2 GB RAM Android tablet on Chrome, not
  your laptop. Budget: register interactive under 2.5 s on 3G, item search under
  100 ms across 5,000 items, add-to-cart under 50 ms.
- Kill-test: force-close mid-sale, pull power mid-print, fill the disk, revoke the
  session mid-shift, change the device clock (offline receipts must not break),
  run two tablets on one branch simultaneously, suspend a tenant mid-shift (the
  shift must still close).
- Sentry wired, plus a "report a problem" button that attaches the outbox state
  and surfaces in your console against that client.
- Error boundaries and offline empty states on every screen — never a white page.
- Backups: `pg_dump` on a GitHub Actions cron to a private repo or R2, with a
  restore rehearsed once. Supabase's free tier has no PITR, and you now hold
  other businesses' sales records.
- **Security pass** — run the **`security-review`** skill and verify: service-role
  key isolation, Storage bucket policies, RLS on every new table, impersonation
  is read-only and logged, entitlements unforgeable from the client, `/admin`
  invisible to tenants, and every §3.3 bypass test still red.
- Print-quality pass on both a 58 mm and an 80 mm printer, with Urdu text.

**DoD:** the kill-test list is fully green on the cheap tablet, and the security
review has no open findings.

---

### Part 8 · Truthful copy, onboarding, launch (Day 28)

- **Fix the FBR copy** — the specific edits are listed in §7. This is the single
  highest-risk item in the launch, because FBR is currently a headline promise on
  three pages.
- **Reconcile the rest of the site with reality.** Move Foodpanda reconciliation,
  payroll export, loyalty campaigns, API access, and PRA/SRB filing out of the
  Premium feature list into a dated "Coming this quarter" section — or cut them.
  Selling a feature that doesn't exist is the fastest way to lose a Pakistani
  shopkeeper's trust, and word travels down the bazaar faster than any ad.
- `/pricing` CTAs: **"Get started"** → `/checkout` as primary, "Book a demo" as
  secondary. Both now land somewhere real.
- `demo-form.tsx` wired to a Server Action writing to `leads`, visible in
  `/admin/leads`.
- Onboarding kit: a 3-minute Urdu screen recording, a one-page printed counter
  guide, a rate-list CSV template, and a WhatsApp support number in the app. Your
  console links to all four from the client record, so activating a client and
  sending them the kit is one flow.
- Terms, refund policy (the pricing page promises a full first-month refund —
  honour it in writing), and a privacy page that matches what you actually store.

**DoD:** you activate a stranger who paid this morning, they reach a first real
sale on their own counter without a call from you, and nothing on the site claims
a capability v1 doesn't have.

---

### Days 29–30 · Pilot, not launch

Put Flo in **three real shops free for a month** — ideally one kiryana, one
restaurant, one bakery — activated through your console exactly as a paying
client would be. Sit at the counter during their rush. Fix what breaks. Their
receipts and their words become your entire sales collateral.

---

## 6. Timeline at a glance

| Days | Part | Output |
|---|---|---|
| 1–2 | 0 · Foundations | Schema, RLS, plans, auth + admin gates, deploy, CI |
| 3–6 | 1 · **Your console** | Activate clients, plans, entitlements, invites, orders, impersonation |
| 7–12 | 2 · Register | Offline billing, printing, shifts, sync |
| 13–18 | 3 · Stock · Khata · Staff | The three value modules + bulk import |
| 19–21 | 4 · Reports | Day-close, owner dashboard, daily summary |
| 22–23 | 5 · Multi-branch · Restaurant | Premium tier, KOT, tables |
| 24 | 6 · Billing lifecycle | Renewals, expiry transitions, MRR |
| 25–27 | 7 · Hardening | Low-end tablet, kill-tests, security, backups |
| 28 | 8 · Copy · Launch | Honest site, onboarding kit, checkout live |
| 29–30 | Pilot | Three real shops |

**What changed from the first draft:** FBR (was Days 24–25) is removed. Those two
days went to Part 1 (+1 day, because the console grew) and Part 7 (+1 day, so
hardening gets three days instead of two). Part 5 tightened to two days.

**Slip rule:** Parts 0–3 and Part 7 are untouchable. If the month runs short, cut
Part 5 first (restaurant mode ships in week 5), then Part 4 beyond the day-close
report, then Part 6 (do renewals by hand for the first month — with under 20
clients you can). **Never cut Part 7** — an unhardened POS loses a shop's money,
and that is not a bug you recover from commercially.

---

## 7. Deferring FBR — the cost, and the hedge

You asked to skip FBR for now. That is a reasonable call for a 28-day v1, and
Part 6's two days are better spent on hardening. But three consequences are worth
naming before you sell anything.

### 7.1 It closes one market segment

FBR POS integration is **mandatory for tier-1 retailers** — large chains, shops
in air-conditioned malls, and businesses above the turnover threshold. Without
it you cannot legally sell to them, and their procurement will ask on the first
call.

Your v1 market is therefore **small and medium kiryana stores, dhabas, cafés,
bakeries, and single-branch retail** — which is the far larger market by count,
and the one that actually pays Rs 5,000/month without a procurement process. So
this is a narrowing, not a wound. It just needs to be a deliberate one.

### 7.2 The site currently promises it in five places — all must change on Day 28

| Where | Current claim | What it becomes |
|---|---|---|
| `app/pricing/page.tsx` metadata | "FBR digital invoicing included on both" | Drop the FBR clause |
| Standard features list | "FBR digital invoicing with QR receipts" | "Tax invoices with your NTN and STRN" |
| Premium features list | "PRA and SRB service-tax filing support" | Move to "Coming this quarter" |
| The FBR FAQ answer | A detailed IRIS/POS-registration promise | Rewrite: what Flo does today, and that FBR integration arrives when your branch is registered |
| `app/products/page.tsx` "FBR & tax" module card | POS integration, offline queueing, PRA/SRB | Retitle to "Tax & records": proper tax invoices, per-rate tax breakdown, export for your accountant |
| `app/solutions/page.tsx`, `app/page.tsx` | Check for incidental FBR mentions | Sweep them |

The rewritten copy must stay in the register CLAUDE.md describes — rupees, named
cities, concrete nouns, no generic SaaS filler.

### 7.3 The hedge, which costs nothing now

Build the invoice **FBR-shaped from day one**, even with no integration:

- `sales` carries nullable `fiscal_invoice_no`, `fbr_status`, `pos_id`, and
  `fbr_posted_at` columns from migration 0001.
- The receipt template reserves the QR block and the fiscal-number line, hidden
  when null.
- Tax is stored **per line, per rate** — not as a single total. This is the one
  that would otherwise force a data migration *and* a reprint-template rewrite
  later, and it is 20 minutes of thought today.

With that in place, adding FBR later is a queue table, an adapter, and a
credentials swap — roughly the two days you just reclaimed, spent when the
paperwork actually lands. Without it, it is a schema migration across live client
data.

---

## 8. What makes this sellable in Pakistan

Ranked by how often each will close a deal. Every one is a v1 commitment.

1. **It bills with the internet and the power down.** Every competitor demo dies
   at this question. Ours is the answer.
2. **Roman-Urdu item search.** Typing `chawal` finds چاول. Nobody does this well.
3. **The drawer reconciles at 11 pm** — shift close with counted cash and
   over/short, per cashier.
4. **Udhaar khata with a one-tap Urdu WhatsApp reminder.** Replaces the notebook
   *and* the awkward phone call.
5. **Onboarding from the rate list they already have** — spreadsheet or old
   software export in, 600 items live in three minutes.
6. **You can activate them while still on the WhatsApp call.** Money confirmed,
   link sent, billing in ten minutes. That responsiveness is itself a selling
   point against imported software with a two-week provisioning cycle.
7. **Receipts that look professional on a 58 mm printer**, in Urdu, with the
   shop's own name.
8. **The owner's phone shows today's number before they reach home.**
9. **Runs on a Rs 25,000 tablet**, not a Rs 200,000 terminal.
10. **Support in Urdu on WhatsApp**, answered by a person who can see their
    account read-only and fix it in two minutes.
11. **Their data exports in full, whenever they ask — even if suspended.** This
    removes the lock-in fear that kills Pakistani SaaS deals.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Offline sync produces duplicate or lost sales | Medium | Immutable sales + ULIDs + idempotent batches + ledger stock (§4.1). Part 2's DoD tests exactly this. |
| Part 2 overruns and eats the month | **High** | Six days budgeted, largest block, scheduled right after the console. If day 12 arrives unfinished, cut Part 5 at once — not Part 7. |
| Tenant data leak via a missing RLS policy | Low / catastrophic | RLS in migration 0001, `tests/rls.sql` in CI, `security-review` in Part 7. |
| A client unlocks Premium features on Standard | Medium | Entitlements resolved server-side only (§4.3); client-side gating is UX. Tested in Part 1's DoD. |
| Your admin account is compromised | Low / catastrophic | It can activate paid accounts and read every client's sales. MFA required, `/admin` returns 404, impersonation read-only, every action audited. |
| Site over-promises FBR against v1 | **Certain today** | §7.2 lists every edit. Do them on Day 28, before the first paid client — not after. |
| Manual activation doesn't scale past ~50 clients | Medium, and a good problem | Path B (self-serve checkout) already exists; add a real gateway when the manual step starts costing you evenings. |
| Thermal printer variety in the market | Medium | ESC/POS covers the vast majority; browser print covers the rest. Buy two cheap printers and test both. |
| Supabase free tier outgrown (500 MB) | Low in month 1 | ~50k sales per tenant fits comfortably; archive `sale_lines` older than 18 months. By then you have revenue. |

---

## 10. Explicitly parked, with dates, so it can be sold honestly

| Feature | Promised on | When |
|---|---|---|
| **FBR digital invoicing + POS registration** | `/pricing`, `/products` | **Deferred by decision.** ~2 days of build once FBR credentials and the per-register POS ID are in hand. Schema is pre-shaped for it (§7.3). |
| Recipe / BOM depletion for kitchens | `/products`, `/pricing` | Week 5 |
| Purchase orders + full supplier rate history | `/pricing` | Week 5 |
| Attendance → payroll export | `/pricing` | Week 6 |
| Foodpanda / delivery reconciliation | `/pricing` | Week 7 — needs their partner API |
| Loyalty + SMS/WhatsApp campaigns | `/pricing` | Week 8+ — needs the paid WhatsApp API |
| PRA / SRB / KPRA service-tax filing | `/pricing` | After FBR lands |
| Public API access | `/pricing` | Week 9+ |
| Card acquiring at 1.9% | `/pricing` | Needs a commercial acquirer contract |
| Pharmacy strip-level sale, clothing size/colour grids, tailor jobs | `/solutions` | Weeks 6–8, one vertical at a time |
| Payment gateway on `/checkout` | — | At ~50 paying clients |
| Hardware bundle at Rs 65,000 | `/pricing` | A sourcing job, not a build job |

---

## 11. First three commands

```bash
# 1. Load the database skill BEFORE writing migration 0001
#    (Skill: supabase-postgres-best-practices)

# 2. Create the Supabase project, then immediately:
#    Dashboard → Authentication → Providers → disable "Allow new users to sign up"
#    Dashboard → Authentication → MFA → enable, and enrol your own account

# 3. Verify the gates after every part
npm run lint && npm run build
```

**Rule for every part:** read `node_modules/next/dist/docs/` before writing
framework code (per `AGENTS.md` — this Next.js differs from older App Router
conventions), reuse the classes in `app/globals.css` rather than re-deriving them
from raw utilities, and keep server components the default.
