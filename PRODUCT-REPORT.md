# Flo — what is built, what is missing, and what it takes to sell

**Date:** 19 September 2026 · **Against:** `main` @ `c240610` · migrations `0001`–`0019`

This report was written by reading the code, the schema and the RLS tests rather
than the plan. Where the two disagree, the code wins — `Plan.md` describes a
product several parts ahead of what `record_sale` actually does.

---

## 1 · What the product does today

Flo is a **single-branch, online-only, cash-and-card point of sale** with a real
catalog, a real customer list and a real dashboard. Everything below is wired
end to end: a screen, a reader, a Server Action, a table, and an RLS policy.

### The register

| | |
|---|---|
| Counters | A shop has as many tills as `subscriptions.max_registers` allows, each with its own receipt prefix, series and drawer. Which till a tablet bills from is a **device** cookie (`flo_counter`), re-checked against the shop's open counters on every load. |
| Finding an item | One box searches name, Urdu name, SKU and barcode. A USB scanner works with no code at all (it is a keyboard). The tablet's own camera works through the platform `BarcodeDetector` — no 300 KB WASM decoder shipped to a Rs 25,000 device. |
| The bill | One line per item; scanning the same bottle twice raises the quantity. Loose goods take decimals (0.25 kg), packaged goods do not. Sales tax is **inclusive** — the price is what the customer hands over. |
| The customer | Optional, attached from the bill panel before payment, searched by name or phone. A walk-in is the default, because a register that insists on a name has a queue behind it. |
| Payment | Cash (with quick-tender notes and change due) or card, per what the counter is switched on for. |
| The write | `public.record_sale` — one security-definer function, one transaction. It claims the counter's next receipt number, inserts the sale, its lines and its tender together, checks the customer belongs to the shop, and stamps `cost_snapshot` from `items.cost_price` inside the transaction. |
| Safety | The `saleId` is minted in the browser, so a retry after a dropped connection replays instead of billing twice. **The browser never decides what anything costs** — the action re-prices every line from the catalog and recomputes the total. |
| When the write fails | The payment sheet offers to print anyway. That receipt carries an unmistakable `UNSAVED-` number, is stamped NOT RECORDED on the roll, and is **not in the takings**. |
| Printing | An `@media print` block: the receipt element stays visible, everything else is hidden. `@page` is mounted in the component so it cannot set the marketing site to 80 mm. |

### Sales history — `/app/sales`

Two tabs over one table, because they are two questions.

- **Bills** — a window of trading days fetched in **one** round trip (capped at
  2,000), then searched, filtered and paged entirely in the browser. Filters:
  counter, who rang it up, tender. The figures above the table are the figures
  **of the rows under it**, and the caption says so whenever they are not all of
  them. Opening a bill is a sheet, not a navigation; arrow keys walk the
  filtered list. **Reprints are stamped DUPLICATE.** Export is client-side CSV
  of the filtered rows, money as bare numbers with a BOM so Excel reads Urdu.
- **Day close** — per-counter bills, cash, card, total, and each counter's last
  receipt number, so a drawer is counted against its own row.

Everything windows on `sales.business_day`, stamped once by the register from
the shop's own `day_ends_at` — a dhaba that shuts at 1 am gets its last hour on
the day it opened.

### Dashboard — `/app`

Every figure is **one** call to `public.dashboard_summary`, grouped in Postgres:
sales, profit, cost of goods, margin, each against the previous window; a
sales-and-profit trend by day; the split by department; top sellers; the last
eight bills. Eight window presets plus a custom range, resolved to trading days
and clamped to the shop's own today.

**Profit is real** because `sale_lines.cost_snapshot` is stamped at the moment
of sale. Joining last month's sales to today's cost column would rewrite last
month's margins every time a supplier raises a price.

### Products & stock — `/app/inventory`

- Items carry barcode, SKU, Urdu name, unit (piece/kg/gram/litre/dozen/packet/
  carton/plate), tracking mode, cost, selling price, tax rate, stock on hand, a
  **per-item** low-stock cut, supplier and `is_active`.
- Margin, stock state and SKU/internal-barcode suggestions are computed from one
  shared module the sheet, the till and the Server Actions all read.
- **The tree is the shop's own** — departments and categories, two levels, and a
  new shop starts empty rather than inheriting six departments a hardware store
  would have to delete.
- **CSV bulk import** builds a `FormData` per row and runs it through the same
  validator the add-product sheet uses, so a price the sheet refuses the import
  refuses in the same words. It inserts in chunks, retries a refused chunk one
  row at a time (one duplicate barcode never costs the other ninety-nine), grows
  the tree with the departments the file names, and reports every skip by its
  line in the file. Cap: 5,000 rows.
- Two unique indexes, `(tenant_id, barcode)` and `(tenant_id, sku)`, turn a
  23505 into "you may already stock it".
- Deleting is a real delete; `sale_lines` keeps `name_snapshot`, so every past
  receipt still prints. The sheet offers switching the item off first.

### Customers — `/app/customers`

Name, optional phone, address, note, `is_active`. **The phone is the identity** —
normalised on write, so `+92 300 1234567` and `0300-1234567` collide instead of
becoming two people. `?customer=<id>` is one person's record and their last
hundred bills, with the cap stated on screen because the totals above the table
are the totals *of those bills*.

**There is no khata and no credit anywhere in Flo.** `0018` removed the last of
it from the schema.

### Staff & settings

- **Staff** — the owner creates a cashier or a store manager, Flo mints a work
  email (`bilal@almadina.flopos.pk`) and a password to read out, assigns them a
  counter, and can suspend or reactivate. One owner per shop, and this screen
  cannot make a second.
- **Settings** — shop details; currency, currency format, timezone, the hour the
  day ends, week start, fiscal year; the counters (name, prefix, cash/card,
  receipt footer, auto-print, open/shut); and role permissions with a discount
  ceiling per access level. Owner-only, checked again in the action.

### The chrome

Light console by default (dark glass is unreadable under a tube light at 2 pm),
with an opt-in dark theme driven by a cookie, never `prefers-color-scheme`. A
collapsible rail. A notification bell derived at render time from rows the
console already holds — subscription state, counters, stock counts — filtered by
what this session may see, with the badge lit by comparing a signature against a
cookie. One toaster, mounted by the shell so it reaches the till.

### Security posture (better than most products at this stage)

1. `tenant_id` on every business table, RLS enabled **and forced**.
2. RLS reads JWT claims through `private.*` helpers wrapped in `(select …)`, so
   they evaluate once per statement, never once per row. No subqueries.
3. **Tenant users get `select` policies only.** Insert/update/delete are revoked
   from `anon` and `authenticated` outright. Every write goes through the
   service role inside a Server Action — one auditable path.
4. Support impersonation is read-only. `rls.test.sql` asserted it when this was
   written; that suite has since been removed — see `supabase/README.md`.
5. `audit_log` is append-only, enforced by a trigger because the service role
   has `bypassrls`.
6. `requireSession()` re-reads the caller's own `profiles` row on every gated
   request, because a self-contained access token stays valid to RLS after
   somebody is sacked. It fails open — an unreachable database is not evidence
   that anybody was sacked.

### Marketing-side plumbing that exists

Checkout writes an order and takes a payment proof into a private bucket; an
invite mints an account against an activated subscription; the demo form writes
to `leads` with IP rate limiting; `npm run doctor` is a Supabase preflight that
names what is broken instead of 404-ing you out of your own console.

---

## 2 · What is not built

Grouped by whether it stops a shop buying.

### 2a · Blockers — a real shop cannot run a week on this

| Gap | Where it bites |
|---|---|
| **Stock does not move when you sell.** `record_sale` never touches `items.stock`. | The inventory screen is a manual count, the low-stock bell is decoration, and "stock that adds up" is the one claim the product cannot make. **This is the single most important thing to fix.** |
| **No returns.** `role_permissions.can_refund` exists; nothing implements it. | Every shop takes returns. Today the answer is "open the drawer and hand cash back", and the books never learn. |
| **No discounts.** `can_discount` and `discount_ceiling_pct` are stored and shown; `sales.discount_total` is always `0`. | Haggling is the norm. A till that cannot take Rs 20 off is a till the cashier works around. |
| **No held / parked bills.** | One customer goes back for dahi and the whole queue waits. |
| **No shift.** The `shifts` table exists and nothing writes it. `can_close_shift` does nothing. | No opening float, no expected-vs-counted, no over/short, no per-cashier accountability. Day close totals the day, not the person. |
| **No offline.** `sync_outbox` exists and nothing writes it. | The register needs the internet for every sale. On a Pakistani counter that is a Tuesday. The current fallback is an `UNSAVED-` receipt outside the takings — honest, but not a business continuity story. |
| **No self-serve sign-up.** `ALLOWED_EMAILS` in `login/actions.ts` holds one address. | Every new shop is a hand-minted invite. Fine for a pilot, fatal for growth. |

### 2b · Expected by a paying shop, missing

- **Reports** is a placeholder screen with a date on it.
- **Purchasing** — no purchase orders, no goods-received note, no supplier
  ledger, no landed cost. `supplier` is a text field on the item.
- **Batch and expiry** — nothing. Rules out pharmacy and most of grocery's
  perishables as a serious pitch.
- **Variants** — `variant_count` is a number; `item_variants` does not exist.
  The screen says so. Rules out cloth and footwear.
- **Multi-branch** — `branches` exists, one row is written, nothing reads it.
  No branch picker, no central catalog, no cross-branch report.
- **Tenders** — cash and card only. No Raast, no Easypaisa/JazzCash, no split
  payment. `sale_tenders` is one-to-many and the schema is ready; the
  integrations are not.
- **Hardware** — printing goes through the browser's print dialog. No cash
  drawer kick, no weighing-scale integration, no kitchen/bar printer routing.
- **Restaurant mode** — no tables, no KOT, no modifiers, no courses, no parcel
  vs dine-in.
- **Nothing sends anything** — no WhatsApp, no SMS, no email, no receipt to a
  phone number.
- **No catalog export.** Sales export to CSV; the item list does not. A shop
  that cannot get its own price list back out is a shop that feels locked in.
- **No Urdu interface.** Urdu item names only; every label is English.
- **No FBR digital invoicing, no PRA/SRB/KPRA.** Both plan rows carry
  `fbr_invoicing: false`.
- **No platform console.** Tenants, plans and subscriptions are managed with SQL.

### 2c · The schema is ahead of the product

`shifts`, `sync_outbox`, `register_devices`, `branches`, `renewal_reminders`,
`tenant_health` and `tenant_notes` all exist and are unread. That is a good
position — the migrations for the next four features are largely written — but
it is also how a roadmap starts believing itself. Nothing in this report counts
a table as a feature.

---

## 3 · The road to sellable

### Tier 0 — before the first paying shop (≈ 6–8 weeks)

1. **Stock movement on sale.** Decrement inside `record_sale`'s transaction, and
   add a `stock_movements` ledger (sale, return, receipt, adjustment, wastage)
   so a count can be explained rather than just overwritten. Without this
   nothing else about inventory is true.
2. **Returns.** A return against a receipt, line-level, gated by `can_refund`,
   reversing stock and money, printed and marked. Reuse the bill drawer.
3. **Discounts.** Line and bill level, ceilinged by `discount_ceiling_pct`,
   re-checked server-side, landing in `sales.discount_total`.
4. **Shift open/close.** Opening float, expected vs counted, over/short, one row
   per cashier per drawer. The table is already there.
5. **Held bills.** Local to the counter; no schema needed.
6. **Sign-up.** Delete `ALLOWED_EMAILS`, put a real trial flow behind checkout.

### Tier 1 — the first ten shops (≈ 8–12 weeks after)

7. **Reports.** Sales by day/item/category/cashier/hour, profit by item,
   purchase vs sale, exportable. The dashboard's SQL function is the pattern.
8. **Purchasing.** PO → receive → cost update → supplier rate history. This is
   what turns the margin column from a guess into a fact.
9. **Offline.** Service worker + `sync_outbox`, catalog cached, sale queued,
   receipt number reserved in a per-device block. Hard, and the single biggest
   differentiator against browser-based competitors in this market.
10. **Hardware.** Cash drawer kick via the printer, a tested thermal printer
    list, a scale for the kiryana counter.
11. **Catalog export**, and a "download everything" button. Cheap; buys trust.

### Tier 2 — the market, not the pilot

12. **FBR digital invoicing.** This is a gate for tier-1 urban retail and a
    non-issue for the corner shop. Do it when a customer is blocked on it, not
    before — and stop claiming it until then.
13. **Raast and wallet QR.** Same rule.
14. **Multi-branch.** The moment one customer opens a second outlet.
15. **Vertical depth** — batch/expiry (pharmacy), variants (cloth), tables and
    KOT (restaurant). Each is a different product. Pick one.

---

## 4 · Making it sellable

### 4.1 Pick one shop type and win it

The site currently pitches kiryana, restaurants, bakeries, pharmacies, cloth
retail and chains. The product supports **one** of them: a general store selling
packaged goods and loose weight. A pharmacy needs batch and expiry; a cloth
house needs variants; a restaurant needs tables and a kitchen printer. Claiming
six verticals with one vertical's feature set is how a demo ends in silence.

**Recommendation:** kiryana and general store, one city, fifty shops. Everything
in Tier 0 serves exactly that shop.

### 4.2 Sell the things that are actually rare

Most POS products in this market are worse than Flo at specific, demonstrable
things. Lead with those:

- **The server re-prices every line.** A cashier cannot edit a price into the
  bill. Say it plainly — every owner has been robbed at the till.
- **Real profit, not guessed profit.** The cost is stamped on the line at the
  moment of sale, so last month's margin does not move when a supplier raises a
  rate next week. Almost nothing in this price band does this correctly.
- **Reprints say DUPLICATE.** A copy that looks like an original is a bill a
  customer can present twice.
- **Numbered receipt series per counter, claimed inside the transaction.** No
  holes, no collisions between two tablets on one till.
- **One screen, one search box, Urdu names on the shelf label.** Staff training
  is the real switching cost, and it is where a demo is won.
- **The shop's own department tree**, not a template it has to delete.
- **Your data leaves whenever you want** — say it, then build the export.

### 4.3 The onboarding *is* the product

Nobody in this market migrates themselves. The import already validates exactly
the way the manual form does and grows the tree from the file — that is a
genuinely good migration story and it should be the centre of the sales motion:
*send us your rate list, we load it before the call, you see Flo ringing up your
own items.* Measure time-to-first-real-bill and make it under an hour.

### 4.4 Pricing

Rs 5,000 / Rs 10,000 per branch per month is defensible for a shop doing
Rs 3M/month, but two things are wrong today:

- **The plan rows promise what the product does not.** Both plans carry
  `stock_ledger: true` and `shift_close: true`. They are not true. Flip them to
  `false` until they are — entitlements are the one place a lie becomes a
  support ticket.
- **There is no trial.** "No free plan" is a fine stance; "no way to try it" is
  not. A 14-day trial with the real product, seeded from the customer's own
  price list, converts better than any feature list.

Consider a lower entry tier (Rs 2,500) for a single counter once Tier 0 lands.
The corner shop's alternative is a Rs 0 notebook, and the gap from Rs 0 to
Rs 5,000 is where most of this market dies.

### 4.5 Proof

There are no customers yet, so there are no numbers. Say nothing rather than
inventing them. Three pilot shops with a named owner, a city and one honest
before/after figure each will outsell a page of invented benchmarks — and the
invented ones are a legal problem the day one is checked.

### 4.6 Support

WhatsApp, in Urdu, 9 to 9, answered by someone who has stood behind a counter.
This is not a feature list item; in this market it is most of the purchase
decision. Budget for it before budgeting for the next module.

---

## 5 · The site, before and after

The marketing site was describing a product roughly two years ahead of the
repository. Everything below was on the site and is not in the code; all of it
has been removed or rewritten in this change.

| Claimed | Reality |
|---|---|
| FBR digital invoicing, IRIS integration, fiscal invoice numbers, verification QR, PRA/SRB/KPRA filing | Not built. Both plans carry `fbr_invoicing: false`. Appeared on the hero, products, pricing, FAQ, solutions, demo, resources and footer. |
| Raast, Easypaisa, JazzCash, 1LINK card acquiring, split payments | `TENDERS` in `lib/pos/counter.ts` is cash and card. The wallet tenders were removed from the column. |
| "Works offline through power cuts", "syncs every invoice the moment it's back" | `sync_outbox` is written by nothing. |
| Recipe/BOM depletion, kitchen and bakery print routing, table and parcel orders, Foodpanda | No restaurant features of any kind. |
| Expiry and batch tracking, strip-level sale, trade vs retail rate | No batch, no expiry, one price per item. |
| Size and colour matrices, per-metre cutting, tailor jobs | `item_variants` does not exist. |
| Attendance, roster, overtime, payroll export, PIN-level permissions | Staff are accounts with a role. No attendance, no PINs. |
| Multi-branch dashboard, central catalog, branch comparisons, per-branch roles | Nothing reads `branches`. |
| "Flo AI orders stock like your best munshi", "6 orders drafted" | There is no AI in this product. |
| WhatsApp/SMS campaigns, loyalty, daily WhatsApp closing summary, order-ready messages | Nothing sends anything. |
| Returns and holds at the counter | Neither is built. |
| "900+ counters running Flo", 38% faster billing, 96% repeat match, six named customer logos, a 900-counter benchmark report | There are no customers. |
| Six guides, a playbook, a template library, developer docs, a status page | None of it exists. |
| "Unlimited staff PINs", "up to 2 registers", REST API, webhooks | No PINs, no API. Register limits are real (`subscriptions.max_registers`). |

What replaced it: the eleven screens in `public/shots/`, photographed by
`npm run shots` from the running console, and copy that describes only what
those screenshots show. `/resources` — six guides, a playbook, a template
library and a benchmark report, none of which had been written — is now
`/roadmap`, which says what is built, what is next, what is further out and what
is never.

Two fixes outside the marketing site fell out of the same pass:

- **`0020_plans_tell_the_truth.sql`** flips `stock_ledger`, `shift_close`,
  `offline_register`, `staff_pins`, `restaurant_mode`, `advanced_reports` and
  the three multi-branch flags to `false` on both plan rows, and drops Premium's
  `max_branches` from 25 to 1. A feature flag is a promise the console can be
  held to, and nine of them were false.
- **`/app/settings?tab=roles`** told the owner a cashier was a "4-digit PIN at
  the register", checked on the tablet, that would keep working "with the
  internet down". There are no PINs — staff sign in with a work email and a
  password — and there is no offline. That copy is in the product, not the
  brochure, and an owner plans a shift around it. Corrected.

---

## 6 · Keeping the site honest

Two scripts now carry this:

- `npm run demo:shop` seeds a self-contained demo tenant — a Lahore kiryana with
  a real department tree, 52 items priced in rupees, 20 regulars, two counters
  and six weeks of trading. `npm run demo:shop -- --drop` removes it. Nothing in
  the UI is faked; only the rows are seeded.
- `npm run shots` signs into that shop and photographs eleven screens of the
  running app. **Re-run it after any visual change**, or the site starts showing
  a product that no longer exists.

The rule worth keeping: **a page on the site with no screenshot behind it is
copy nobody has checked against the product.** Every feature claim on the site
now points at a screen in `public/shots/`, and the list in `scripts/shots.mjs`
is the contract.
