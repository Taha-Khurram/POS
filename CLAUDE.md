@AGENTS.md

# Flo — marketing site

Public marketing site for **Flo**, a point-of-sale product for Pakistani shops and
restaurants. Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict.
Supabase session plumbing is wired but there is **no backend yet** — every form is
front end only.

## Commands

```bash
npm run dev     # next dev
npm run build   # next build
npm run lint    # eslint (flat config, next core-web-vitals + typescript)
```

```bash
npm run doctor        # Supabase preflight: env, schema, bucket, JWT claims
npm run demo:shop     # seed (or --drop) the demo shop the site is photographed from
npm run shots         # photograph the running console into public/shots/
```

`npm run shots` drives a live `npm run dev` and writes eleven PNGs of the real
console. **Re-run it after any change to how `/app` looks**, or the marketing
site starts showing a product that no longer exists. It signs in as the demo
shop `npm run demo:shop` builds — a self-contained tenant, deletable in one
command, so no screenshot ever carries a real person's email or a development
account's "Test Product".

There are no tests and no CI. `npm run lint` and `npm run build` are the only
verification gates, and both must be green at the end of every part. `tsc` has
no script — type errors surface through `next dev`/`next build`.

When something in Supabase looks broken, run `npm run doctor` before reading
code. The costly failures there are silent — an access-token hook that is off
makes every RLS policy see null and 404s you out of your own console.

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable, not the legacy anon key),
and `SUPABASE_SERVICE_ROLE_KEY`. See `.env.example`. The service-role key
bypasses RLS — it must never be `NEXT_PUBLIC_*` and must never be imported
outside `utils/supabase/admin.ts`.

Database work uses the Supabase CLI: `supabase start`, `supabase db reset`,
`supabase test db`. Migrations are plain SQL in `supabase/migrations/`, applied
in filename order.

## Layout

Three route groups under a single root layout. `app/layout.tsx` is html, body
and fonts only — chrome belongs to the group.

- `app/(site)/` — the public marketing routes. `(site)/layout.tsx` adds `Nav`
  and `Footer`. One folder per route, each a server component exporting
  `metadata`; route-local client components live beside their page
  (`app/(site)/demo/demo-form.tsx`).
- `app/(auth)/login/` — sign-in, in its own group precisely so it gets neither
  `Nav` nor `Footer`. `(auth)/layout.tsx` is a bare full-height wrapper.
- `app/(app)/app/` — the client's product: register and back office.
  `layout.tsx` is the auth gate and the light `.pos-root` shell.
- `app/not-found.tsx` sits above the groups, so it carries `Nav`/`Footer`
  itself.
- `components/site/` — page sections and site chrome (`nav`, `footer`, `hero`,
  `page-header`, `cta`, …). Composed by pages; not generic UI primitives.
  `product-tour.tsx` and `dashboard-shot.tsx` render the PNGs in
  `public/shots/`; nothing on the site redraws the console by hand any more, and
  the replica that used to (`dashboard-mock.tsx`, `sales-chart.tsx`) is deleted
  because it drifted silently every time `/app` moved.
- `components/motion/` — the animation primitives: `Reveal`, `CountUp`, `Tilt`,
  and the `useInView` / `usePrefersReducedMotion` hooks.
- `lib/` — server-only domain logic, each module opening with `import
  "server-only"`: `auth.ts` (session claims and the `/app` gate),
  `entitlements.ts` (the single authority on what a plan allows), `audit.ts`,
  `format.ts`, `pos/` (the dashboard's window and data contract). The one
  exception is `lib/pos/timeframe-options.ts` — the period list is shared with
  the client filter, so it carries no `server-only` and no imports. The same
  goes for `lib/pos/modules.ts` and `lib/pos/notices.ts`: both are pure
  functions the server calls and the chrome types against, and for
  `lib/pos/catalog.ts`, which holds the item vocabulary, the field limits and
  the margin/stock/barcode arithmetic that the add-product sheet, the till and
  the Server Actions all have to agree about. The catalog's *rows* are read by
  `lib/pos/items.ts` and its tree by `lib/pos/tree.ts`, both `server-only` like
  the rest. `lib/pos/customer.ts` is the same split again — the shape, the field
  limits, the phone normalisation and the matcher, shared by the Customers
  screen and the till — with `lib/pos/customers.ts` as its `server-only`
  reader. And once more for `lib/pos/history.ts`, which holds the sales
  history's window presets, its search matcher and its CSV writer — the page
  resolves the window on the server and the filter bar draws the same list in
  the browser — with `lib/pos/bills.ts` as its `server-only` reader.
- `utils/supabase/` — `client.ts` (browser), `server.ts` (takes an awaited
  `cookies()` store), `middleware.ts` (`updateSession`), `admin.ts` (service
  role, server only). `proxy.ts` at the root calls `updateSession` on every
  non-static path purely to refresh the session cookie; don't insert logic
  between creating that client and `auth.getUser()`. Route protection is never
  proxy logic.
- `supabase/` — `migrations/` (plain SQL, applied in filename order),
  `tests/rls.test.sql` (pgTAP, a CI gate), `config.toml` (local stack).
- `@/*` maps to the repo root.

Next 16 renamed `middleware.js` to `proxy.js`; the export is `proxy`, not
`middleware`. The old name still works but is deprecated.

## Styling — read `app/globals.css` first

Tailwind v4, CSS-first config. All tokens live in the `@theme` block and all
reusable classes in `@layer components`. **Use the existing classes instead of
re-deriving them from raw utilities:**

- Layout — `.shell` (max-width container), `.section` (vertical rhythm)
- Type — `.display`, `.heading`, `.lede`, `.eyebrow`, `.text-gradient`
- Surfaces — `.glass`, `.panel`, `.rim` (lit top edge), `.card-lift`, `.fan-card`
- Controls — `.btn` + `.btn-primary` / `.btn-ghost` / `.btn-sm`, `.field`, `.label`
- Ambience — `.glow` (blurred blob), `.stars` (cheap CSS starfield), `.spotlight`
  (pointer-tracked, fed by `--mx`/`--my` from `Tilt`), `.marquee-mask`/`.marquee-track`

Color scales: `ink-*` (violet-black surfaces), `iris-*` (brand — a violet at
every step, not just at its deep end), `mist-*` (text), `flare/mint/sun-400`
(signals). Fonts through `font-display` (Plus Jakarta Sans)
and the default sans (Inter). Easings are tokens — `var(--ease-out-soft)`,
`--ease-out-back`, `--ease-in-out-soft`.

**Two visual languages.** The marketing site is dark. `/app` is the exception:
the counter is light and
high-contrast, because dark glass is unreadable under a tube light at 2 pm. It
gets `.pos-root` (which also sets `color-scheme: light`), `.pos-card`, and the
`paper-*` (white surfaces) / `graphite-*` (text) / `orchid-*` (the violet
interactive ramp, 50 → 900) scales. Don't reach for Tailwind's built-in
`slate-*`, `gray-*`, `violet-*` or `purple-*` there.

The work surface is white — `paper-100` and `paper-50` are both `#fff`, and a
card is told from the canvas by its `pale-lilac` hairline, not by a change of
ground. `orchid-700`/`800` are the site's `iris-600`/`700` to the hex, so the
console's deep accents and the marketing site's brand are one purple.

`/app` also has an opt-in dark theme (`.pos-root[data-theme="dark"]`, set from
a cookie, never `prefers-color-scheme`). It works by re-pointing those same
tokens at the site's own `ink-*`/`iris-*`/`mist-*` stack, so the night console
and the marketing page are one palette by construction. That only holds because
the whole brand is one violet: **colour belongs in a token, not in a
component** — a hard-coded hex in a `.tsx` file survives the theme flip, and a
blue one left anywhere is what made the site and the product disagree in the
first place.

## Conventions worth matching

- **Server components by default.** Only ten files are `"use client"`; keep it
  that way — push interactivity into a leaf component rather than the page.
- **Two animation modes.** Above-the-fold content uses a local
  `entrance(delay)` helper returning an inline `fade-up` animation (pages can
  stay server components); everything below the fold wraps in `<Reveal>`, which
  shares one IntersectionObserver and toggles `.is-in` on `[data-reveal]`.
  Reduced motion is handled globally in `globals.css`, plus
  `usePrefersReducedMotion()` for JS-driven animation (`CountUp`, `Starfield`,
  `Tilt`). `app/layout.tsx` carries a `<noscript>` fallback that
  un-hides reveals — keep it working.
- **Metadata.** `app/layout.tsx` sets a title template, so pages export a bare
  `title` ("Pricing", not "Pricing — Flo").
- **`PageHeader`** is the masthead for every route except `/`, which has `Hero`.
- **`FloMark`** is the full wordmark: size it by height (`h-7 w-auto`) and never
  put a "Flo" text label beside it.
- **Static content sits in module-level `const` arrays** above the component
  (`LINKS`, `PLANS`, `EXPECT`, …) and is `.map`ped in the JSX.
- **Comments explain the non-obvious choice**, not the code. Match that density.

## Copy

The voice is specific and local: rupee prices, the register book,
load-shedding, named cities and shop types, occasional Urdu ("Shukriya"). Keep
new copy concrete and in that register — no generic SaaS filler.

**The site may only claim what the code does.** It once promised FBR digital
invoicing, Raast and wallet payments, offline billing, recipe depletion, kitchen
printing, batch and expiry, size/colour variants, attendance and payroll, a
multi-branch dashboard, WhatsApp campaigns, an AI that drafts purchase orders,
six customer logos and a benchmark across 900 counters. None of it existed.
Every one of those is gone, and the rule that replaced them is in
`components/site/product-tour.tsx`: **a claim on the site must be visible in the
screenshot beside it.** `/roadmap` is where anything not yet built belongs —
named, ordered, and without an invented date. `PRODUCT-REPORT.md` holds the full
before-and-after audit.

**There is no udhaar khata and no credit anywhere in Flo** — `0018` removed the
last of it from the schema and the site, so no new copy may promise a balance, a
limit or a reminder about money owed.

**`plans.features` is copy too.** `0020` flipped `stock_ledger`, `shift_close`,
`offline_register`, `staff_pins`, `restaurant_mode`, `advanced_reports` and the
multi-branch flags back to false, because a flag is a promise the console can be
held to. Flip one back in the same migration that lands the feature — `0021`
did exactly that for `advanced_reports` on Premium, `0022` for `stock_ledger`
and `0026` for `shift_close`, both on both plans, because a shelf that never
moves and a drawer that is never counted are not a tier. Standard's stays false and
now understates what it gets, because nothing gates Reports by plan: the module
is reached through `can_view_reports` alone. Either gate it or raise the flag,
but deliberately.

## Next.js 16 notes

`PageProps<'/route'>` and `LayoutProps<'/route'>` are **global** types (no
import) generated into `.next/types` — run `next dev` or `next build` at least
once or they won't resolve. Per `AGENTS.md`, check
`node_modules/next/dist/docs/` before writing framework code; this version
differs from older App Router conventions.

## Database and access control

Load the `supabase-postgres-best-practices` skill (vendored in `.agents/skills/`,
symlinked into `.claude/skills/`) **before** touching anything under
`supabase/`. Five rules every migration inherits from `0001_init.sql`:

1. `tenant_id uuid not null` on every business table, with RLS enabled and
   forced from the same migration that creates it.
2. **RLS reads JWT claims, never a subquery.** `public.custom_access_token_hook`
   stamps `tenant_id`, `tenant_role`, `branch_id` and `platform_role`; policies
   read them through the `private.*` helpers wrapped in `(select …)` so they
   evaluate once per statement instead of once per row. Never stamp a claim
   named `role` — Supabase already uses it for the Postgres role.
3. **Tenant users get `select` policies only.** There is no
   insert/update/delete policy anywhere, and those privileges are revoked from
   `anon` and `authenticated` outright. Every write goes through the service
   role inside a Server Action, so there is one auditable path.
4. Read paths may carry `or private.is_platform_admin()`. Write paths never do —
   support impersonation is read-only, and the RLS test asserts it.
5. `audit_log` is append-only, enforced by a trigger rather than by policy,
   because the service role has `bypassrls`.

`supabase/tests/rls.test.sql` is the gate for all of that. It runs in CI and has
to stay green.

## Gating a route

**Two different shapes of permission, and they are enforced in two places.**
`ModuleAccess` is which *screens* a session may reach — checked once by
`requireModule` before anything renders, and it is what the rail draws.
`TillAccess` (`tillAccess` in `modules.ts`, `getTillAccess` in `access.ts`) is
what a session may *do* on a screen everybody is allowed on: discount, refund,
open or close a drawer. Each of those is re-checked by the Server Action behind
it, because a control the browser does not draw is not an endpoint nobody can
call. Both cross to the client as the resolved answer and never as the
`role_permissions` row behind them — the till needs to know it may give 5% away;
it has no business knowing what the manager's ceiling is. Neither is `cache()`d,
for the reason the readers in `shop.ts` are not.

`getSessionContext()` is wrapped in React `cache()`, so repeated gates in one
request verify the token once.

`requireSession()` then asks whether the account is still standing — one
primary-key read of the caller's own `profiles` row, also `cache()`d. No row
means the account was deleted (the row cascades from `auth.users`); `is_active`
false means suspended. Either sends them to `/logout`, which is the only place
that can clear the cookie, and on to `/login?ended=…`. The check exists because
the access token is self-contained: deleting or banning somebody stops the next
sign-in but leaves the token already in the tablet valid until it expires — and
valid to RLS, which reads its claims. It is skipped for a token with no
`tenant_id`, which is the unattached account that must still reach the dashboard
to be told so, and it fails open, because an unreachable database is not
evidence that anybody was sacked.

## The catalog

`public.items` is real (`0008`, widened into a shop's item list by `0015`):
barcode, the tree, cost, tax, stock, the per-item low-stock cut, and
`is_active`. **`items.stock` is a running total with a ledger under it since
`0022`** — `private.move_stock` is its only writer anywhere, and
`public.stock_movements` records every change with its reason, its receipt and
what the count read afterwards. The stock box on the product sheet is therefore
a stocktake rather than a column: `saveProduct` strips it out of the `update`
and sends it to `set_stock`, which works the difference out under a lock. `lib/pos/items.ts` reads it through the shop's own JWT — and, like
the readers in `shop.ts`, **none of them may be wrapped in React `cache()`**, or
the re-render a `revalidatePath` triggers redraws the list as it stood before
the save.

Writes are `app/(app)/app/inventory/actions.ts` (the items) and
`tree-actions.ts` (the departments and categories) on the service role, gated by
`can_edit_items` rather than by the owner role — the permission is named for
this screen, so a manager an owner trusted with stock can add it. Settings and
Staff stay owner-only.

`readProduct` in that file is the one validator, and the CSV import builds a
`FormData` per row so it goes through exactly that: a price the add-product
sheet refuses is a price the import refuses, in the same words. The import
inserts in chunks and retries a refused chunk one row at a time, so a single
duplicate barcode never costs the other ninety-nine rows, and every skip is
reported by its line in the file.

**The import grows the tree.** `growTree` in the same file adds the departments
and categories the file names and the shop does not have yet, which is what
makes a first import possible at all now that `0017` leaves a new shop with no
tree: the sheet a shop already keeps is the truest description of how that shop
files its stock. Only additive, bounded (40 new departments, 400 categories, or
the whole file is refused with the column to look at), and shown by name on the
review step before anything is written. The department each row lands in is
resolved *before* `readProduct` sees it and handed over by its exact stored
name, because `placeInTree` falls an unrecognised department to the shop's
first one — right for a dropdown that only offers real ones, and quietly wrong
for four hundred rows nobody re-reads.

`treeName()` and `IMPORT_MAX` live in `lib/pos/catalog.ts` for the usual
reason: the browser draws the preview's verdict and the action draws the real
one, and a name one side would take and the other would not is a row that
disappears between the two screens.

Two unique indexes carry the weight: `(tenant_id, barcode)` and
`(tenant_id, sku)`, both partial on not-null. `conflict()` turns a 23505 from
either into the sentence the owner needs — a duplicate barcode almost always
means the shop already stocks the thing being added.

**The item list exports.** `productsToCsv` in `lib/pos/catalog.ts` writes the
filtered rows — what is on screen is what comes out, the same bargain
`/app/sales` strikes. Its headings are the *import's* own spellings, which is
why it breaks `billsToCsv`'s rule and puts no currency in the `cost` and `price`
headings: there a heading is a label a human reads, here it is a key
`import-panel.tsx` matches aliases against, and `cost (Rs)` normalises to
`costrs`, which matches nothing. Nothing derived is written — a `margin` column
is right when exported and wrong the moment somebody edits the cost beside it.

The **tree is the shop's own** (`0016`): `departments` and `categories`, two
levels and no third. `lib/pos/catalog.ts` used to hold six hard-coded
departments every shop was stuck inside — a hardware store filed its whole list
under "Grocery". **A shop's tree now starts empty** (`0017` dropped the seed
`0016` shipped with): a supermarket's aisle list is not a head start for a cloth
house, it is six rows to delete before you can type "Lawn". So an empty tree is
the first-run state, not an error — the Categories tab draws it as an
invitation, and the add-product sheet's save buttons are dead until there is a
department to file into.

`items.department` and `items.category` stay **text**, not foreign keys: they
are the names as they stood when the item was filed, and the till, the import
and the tree counts all read them as words. That only holds because the only
writes are adding a node and removing an empty one — `tree-actions.ts` refuses
to delete a branch with items under it, and there is no rename, because a rename
has to carry every matching item row with it in the same transaction. Category
is **optional** on an item; department is not.

`items.subcategory` was the third level and is dropped by `0016`. Nobody browsed
by it and it was one more dropdown between a shopkeeper and a saved item.

Deleting an item is a real delete. `sale_lines.item_id` is `on delete set null`
beside a not-null `name_snapshot`, so every past receipt still prints exactly as
it was rung up and only stops pointing at a row; what is lost is the ability to
group last month's sales by that item, which is why the sheet offers switching
it off first. Variants are counted (`variant_count`) but not enumerated —
`item_variants` does not exist, so the matrix shows the SKUs it would generate
and says so.

## Not built yet

Sign-in is real, but deliberately narrow while the product is in private
preview: `app/(auth)/login/actions.ts` holds an `ALLOWED_EMAILS` list of one
address, checked *before* Supabase verifies the password, and every successful
sign-in lands on `/app` — there is no `next` return path and no role-based
fork. Delete the constant and its check to open it up.

There is no platform console. The layout calls `getShopName()` for the rail's
account block, and both that and the dashboard fall back rather than fail, so an
account with a null `tenant_id` still reaches the dashboard and is shown a shop
that has sold nothing — keep that true. Nothing reads `branches`; there is no
branch picker and no counters list until a shop can actually have a second one.
`Plan.md` has the order the modules arrive in.

Settings is real. `tenant_settings` and `role_permissions` (migration `0009`)
and `counters` (`0010`, reshaped by `0011`) back the currency/clock, permissions
and counter cards, read through the shop's own JWT in `lib/pos/shop.ts` and
written by `app/(app)/app/settings/actions.ts` on the service role. Writes are
owner-only; `readOnly` on the panels is presentation, and the action checks the
role again for itself.

**None of the four readers in `lib/pos/shop.ts` may be wrapped in React
`cache()`.** It is scoped to the request, and a Server Action plus the re-render
its `revalidatePath` triggers are one request — so a memoised read hands that
re-render the row as it was before the write and the form redraws itself with
the values the owner just changed away from. `getShopName` is the exception and
is only read by the layout.

## Buying

`public.suppliers` (`0027`) is who the shop buys from. **The name is the
identity, not the phone** — the opposite of `customers`, and deliberate: a
customer is a person and two of them are called Bilal, but a supplier is a
business you know by the name on its invoice, and the man who answers its phone
changes twice a year. Two rows called Ravi Trading is two ledgers for one party
and neither balances, so `suppliers_tenant_name_idx` is unique on the folded
name — trimmed, single-spaced, lower-cased. `foldName` in `lib/pos/supplier.ts`
is those same three things written for the browser, and the two have to stay
identical: the sheet warns on a clash before the save and the index is the
control, but a browser that folds harder than the index refuses a name the
database would take.

**`items.supplier` is gone.** It was a text column since `0015`, which for a
four-hundred-item list meant four hundred independently typed spellings of six
distributors, and no way to ask what any of them cost or supplied.
`0027` lifts the distinct spellings into rows, points `items.supplier_id` at
them and drops the column — not both, because a text column and a foreign key
holding one fact is exactly the drift `0018`'s header complains about.
`Product.supplier` is still a plain name in TypeScript, read through a PostgREST
embed, so the screens that only ever wanted the word did not change.
`lib/pos/items.ts` normalises that embed through `embedded()`: with no generated
database types, supabase-js infers an array for a many-to-one embed and
PostgREST returns an object.

**The import grows the supplier list**, the way it grows the tree and for the
same reason — the sheet a shop already keeps is the truest description of who it
buys from, and making an owner type six distributors in before their first
import is how a first import does not happen. `growSuppliers` in
`app/(app)/app/inventory/actions.ts` is additive only and bounded at 60, because
a Supplier column mis-mapped to a brand would otherwise add a party per row.

`lib/pos/suppliers.ts` reads the rows through the shop's own JWT and — like
`items.ts`, `customers.ts` and the readers in `shop.ts` — **none of them may be
wrapped in React `cache()`**. Writes are
`app/(app)/app/purchasing/supplier-actions.ts` on the service role, gated by
`can_manage_purchasing` (`0027`). That is deliberately not `can_edit_items`:
receiving a delivery writes what the shop paid, and a cost price is the number
every margin on Reports is worked out from, which is not a thing to hand to
everybody who may correct a shelf count.

### Orders and deliveries

`/app/purchasing` is three tabs over one route, because they are three
questions. `?tab=orders` — the default — is asked with a distributor on the
phone: what am I still owed. `?tab=deliveries` is asked when a margin looks
wrong: what did this actually cost me, carriage and all. `?tab=suppliers` is
asked when the shelf is empty on a Friday: who do I ring.

**An order is an intention and a delivery is a fact.** `purchase_orders`
(`0028`) moves no stock and no money. `goods_receipts` is the one that does —
and its `purchase_order_id` is **nullable**, deliberately: most kiryana buying
is a van that turns up with no paperwork in front of it, and a screen that
demands an order first is a screen the shop works around.

**Nothing stores how much of an order has arrived.** No status column, no
`received_quantity` — it is counted off the receipt lines pointing at the order
lines, the same call `0024` made for `returned`. A stored counter is a second
copy of the truth, and the copy that drifts is the one saying a shop is owed
forty bottles it took last week. The cost of that decision is real and lands in
`listPurchaseOrders`, which pays a second read to tally it.
`purchase_orders.status` is the *human* lifecycle only: draft, placed, closed,
cancelled.

**An order with goods against it cannot have its lines changed.**
`save_purchase_order` refuses, and the sheet says so before anybody types.
Deleting a line a delivery points at would leave goods that physically arrived
against an order that no longer asks for them. Closing it is the move.

**Landed cost is the point of the whole migration.** `record_receipt`
apportions freight and other costs across the lines pro rata and puts the
rounding remainder on the last one — the identical arithmetic `record_sale`
uses for a bill discount, and for the identical reason: `sum(landed_unit_cost ×
quantity)` has to equal the receipt total exactly, or stock valuation and the
purchase ledger differ by a rupee nobody can find. `receiptTotals` in
`lib/pos/purchase.ts` is that arithmetic restated for the browser, so the
receiving sheet can show what a Rs 500 bhaara does to a carton *before* anybody
saves. The figure that lands is always the function's.

`goods_receipt_lines.landed_unit_cost` is **stored**, for the reason
`cost_snapshot` is stored: correcting the freight next week must not rewrite
what last month's stock cost, and with it every margin already reported off it.

**Receiving sets `items.cost_price` to the last landed cost, not a moving
average.** A deliberate product call: a shopkeeper quotes the rate off the last
invoice they were handed, and a weighted average is a number they cannot check
against any piece of paper in the shop. Past sales are untouched —
`sale_lines.cost_snapshot` is exactly why that column exists.

Stock moves inside the receipt's own transaction through `private.move_stock`,
which `0028` widened by a `p_receipt` argument and whose reason list gained
`'purchase'` — the first reason in the ledger that is positive by design.
A line with no catalog item behind it is allowed and moves no shelf, which is
how a shop orders something it does not stock yet.

Numbering is `public.document_series`, one running number per shop per kind,
claimed by `private.next_number` in one `on conflict do update` so two tablets
cannot both read 14. Its own table rather than columns on `tenant_settings`,
because a counter is not a preference and has no business queueing behind
somebody changing the timezone. **It has no read policy at all** — nothing draws
it, and a running count of a shop's orders tells a competitor how much it buys.

`lib/pos/purchase.ts` carries no `server-only` (the sheets are client
components); `lib/pos/purchases.ts` is its `server-only` reader, and like every
other reader in `lib/pos/` **may not be wrapped in React `cache()`**. Writes are
`order-actions.ts` and `receipt-actions.ts` on the service role; `load-actions.ts`
reads one order or delivery behind the same gate, the call `loadBill` makes on
`/app/sales`.

A goods-received note is **read-only once written**. Editing one would have to
unwind a stock movement and guess what the cost should go back to. A delivery
entered wrongly is corrected the way a shop corrects one on paper — by counting
the shelf on Products & stock, which writes its own movement and says why.

`0028` flipped `plans.features.purchase_orders` true on both plans, per `0020`'s
rule. The marketing site still says purchase orders are not built (`/pricing`,
`/products`, `/roadmap`) — that copy is now the wrong way round, and like the
Reports copy it is a product-announcement decision rather than a code one.

**Still not built here:** the supplier ledger. There is no opening balance, no
supplier payment, and no "what do I owe him" — `goods_receipts.total` is what a
delivery came to and nothing yet totals it against anything paid. No tile on
the Buying screen claims otherwise.

## Customers

`public.customers` (`0018`) is the shop's regulars: a name, an optional phone,
an address, a note and `is_active`. **The phone is the identity, not the name** —
two brothers are both called Bilal, and one number is one person. It is stored
normalised by `normalisePhone` in `lib/pos/customer.ts`, so `+92 300 1234567`
and `0300-1234567` collide on `customers_tenant_phone_idx` instead of becoming
the same customer twice.

`lib/pos/customers.ts` reads the rows through the shop's own JWT and — like
`items.ts` and the readers in `shop.ts` — **none of them may be wrapped in React
`cache()`**, or the re-render a `revalidatePath` triggers redraws the list as it
stood before the save. Writes are `app/(app)/app/customers/actions.ts` on the
service role, gated by `can_manage_customers`.

`/app/customers` is the list; `?customer=<id>` is one person's record and their
last hundred bills. The cap is stated on the screen rather than papered over,
because the totals above the table are the totals *of those bills*.

`sales.customer_id` is `on delete set null` beside a not-null `receipt_number`,
so deleting somebody leaves every receipt printing and still counted — what is
lost is the ability to total what they spent, which is why the sheet offers
switching them off first. The till attaches a customer from the bill panel
before the payment sheet opens, and it is always optional: a walk-in is most
bills in most shops, and a register that insists on a name has a queue behind
it.

**The khata is not coming.** The plan specified `customers` plus an
`udhaar_ledger` of debits and credits, a per-customer limit at the register and
ageing buckets. It is not being built, and `0018` removed everything that
pointed at it rather than leaving it standing: `role_permissions.can_sell_on_khata`
and `khata_ceiling` (replaced by `can_manage_customers`, carrying the old
value), the `udhaar` tender on `sale_tenders`, and the `udhaar_khata` flag on
both plans. Don't add a balance to `Customer`.

## Notifications

The bell and the toaster are two halves of one vocabulary and share their tones.

`lib/pos/notices.ts` derives the bell's list at render time from rows the
console already holds — the subscription, the shop's counters, the catalog's
stock counts. There is no notifications table and nothing is written, so a
notice disappears when its cause is dealt with. Every notice names the
`ModuleKey` it belongs to, and `visibleNotices` drops the ones this session's
`ModuleAccess` does not cover; `ownerOnly` carries the ones the `settings`
module is too wide for, which is anything about money. That filter is the
control, not a courtesy — a notice is its own payload and there is nothing
further in to re-check it. The badge is lit by comparing `noticeSignature` with
the `flo_seen` cookie, so looking clears it and a change brings it back.

`components/pos/toaster.tsx` is mounted once by `ConsoleShell`, which is what
puts it on the register too — the till is the one screen where nobody is
watching the form they submitted. `useActionToast(state, …)` keys off the
`savedAt` an action stamps, never the state object, or the `revalidatePath`
re-render announces the same save twice. Standing warnings from the bell are
also said once per tab by `NoticeToasts`, guarded in `sessionStorage`.

## The register

A shop has as many counters as `subscriptions.max_registers` allows, each with
its own receipt series, its own register and its own day-end total.
`?tab=counter` is a list; `?tab=counter&counter=<id>` is one counter's editor.
Which counter a tablet bills from is the `flo_counter` cookie beside the rail
and theme prefs — a device preference, not a user one, because the till by the
door is the till by the door whoever is standing at it. It is re-checked against
the shop's open counters on every load.

`app/(app)/app/register/till.tsx` is the till: scan or search, one line per
item, a running total. `lib/pos/counter.ts` holds every figure on that screen
and carries no `server-only`, because the till is a client component and the
Server Actions have to validate against the same lists.

**The browser never decides what anything costs.** It sends item ids and
quantities — and, when one is attached, a customer id and nothing else about
them; `app/(app)/app/register/actions.ts` re-prices every line from the catalog,
re-reads the customer, and recomputes the total with the same `billOf` the
screen used. The write is `public.record_sale` — one security-definer function,
one transaction, which since `0018` also checks the customer belongs to the shop
before it claims a number —
which claims the counter's next receipt number and inserts the sale, its lines
and its tender together. A number claimed against a sale that then failed to
insert is a hole in the shop's series. `saleId` is minted in the browser so a
retry replays instead of recording twice.

When that write fails the payment sheet says so and offers to print anyway. A
sale printed that way carries an unmistakable `UNSAVED-` number, is stamped NOT
RECORDED on the roll, and is not in the takings — the shop keeps selling and
nothing lies about what was counted.

Printing goes through the `@media print` block at the foot of `globals.css`: the
receipt element is left visible and everything else is hidden, so what is on
screen is what comes off the roll. `@page` is mounted in `receipt.tsx` rather
than in the stylesheet, because it cannot be scoped and would otherwise set the
marketing site's pages to 80 mm too.

`sales.business_day` is stamped once by the register from the shop's own
`day_ends_at`, so a dhaba that shuts at 1 am gets its last hour on the day it
opened and no report re-derives that window. Everything on `/app/sales` windows
on that column and never on a timestamp.

**The discount is a first-class control on the bill, not a setting on the
payment sheet** (`0023`). Haggling is Tuesday in a Pakistani shop, and a till
that cannot take Rs 20 off is a till the cashier works around — out of the
drawer, or by ringing up one item fewer. So `DiscountBar` sits beside the
subtotal, where the haggling actually happens, and the payment sheet stays two
questions. `discountOf` in `counter.ts` resolves per cent or rupees against the
cashier's own `discount_ceiling_pct`, the action resolves it again from
`getTillAccess`, and `record_sale` raises if it is over — the action is the gate
and the function is the floor, because a discount is the one field on a bill
where the person typing it benefits from the number being wrong. Over the
ceiling clamps and says so; it never refuses.

`record_sale` **apportions the discount across the lines** pro rata and writes
the remainder onto the last one, so `sum(line_total)` still equals
`sales.total`. That is not tidiness: every share on a report is worked out over
the sum of line totals, and a bill-level discount left off the lines would make
departments add up to something other than a hundred and leave a discounted item
showing its full margin for ever.

**Stock moves inside the sale's own transaction** (`0022`). `private.move_stock`
is the only writer of `items.stock` anywhere, and it writes
`public.stock_movements` beside every change — what moved, why, which bill, and
what the count read afterwards.

**The count is a gate at the till.** An item at zero cannot go on a bill at
all, the plus button will not step a line past what is counted, and the Charge
button refuses a bill that is over — naming the item and both numbers, because
the fix is a stocktake on Products & stock and the cashier needs to know which
row to open. `recordSale` enforces the same rule on the server with its own
fresher read, since a control the browser draws is not a control nobody can
call. The cost is real and lands at the counter: `items` is read once at page
load, the till by the door is selling from the same shelf, and a cashier
holding stock the console has not caught up with has to count it in before they
can sell it. That was a deliberate product call, not a default — the till used
to warn and sell anyway.

`set_stock` is the absolute-to-relative adapter for the Products screen: it
locks the row, works the difference out there, and hands `move_stock` a delta.
The obvious implementation — read, subtract, write in the Server Action — reads
the count before counter 2 sells two and writes a number that silently un-sells
them. `saveProduct` therefore never puts `stock` in its `update`.

**A parked bill is not a sale** (`0025`). `public.held_bills` holds item ids,
quantities, who it was for and what was agreed off it — and no prices, because
resuming re-prices from the catalog and a stored price is a quiet way to sell at
yesterday's cost. It is a separate table rather than `sales.status = 'held'`
precisely so it never claims a receipt number: a number claimed before anybody
pays is a hole in the series that `record_sale`'s single transaction exists to
prevent. `0025` dropped 'held' from the status check outright. Nothing moves
stock; a parked bill is shopping on a counter.

**A shift is required before a counter can charge anything** (`0026`).
`public.shifts` is keyed on a counter now, not on the `register_devices` row
nothing ever wrote. `record_sale` and `record_return` look the open shift up
from the counter rather than taking one from the browser, so a tablet cannot
put a sale in somebody else's drawer.

The gate itself is in the Server Actions, not in SQL — the same placement as
the stock gate, and for the same reason: a refusal there can be a sentence a
cashier acts on, where a raise from a function is a failed write. `shift_id`
stays nullable, because it has to hold every sale rung up before the gate
existed and a null is still the honest record of a sale that belonged to no
drawer. What the gate buys is that no new ones are created. The shut strip at
the top of the register is therefore the way through rather than a note beside
it, and it clears in one tap and a float.

`close_shift` works the expected figure out from the shift's own sales and then
**stores it**, for the reason `cost_snapshot` is stored: a bill refunded next
Tuesday is a negative tender on next Tuesday's shift, and re-deriving the figure
afterwards would rewrite what somebody's drawer was short by last week. Cash
only — the card machine never went into the drawer.

**The cashier counts and `can_close_shift` decides who sees the variance.**
Anybody may close their own drawer; only somebody with the permission is handed
back the over-or-short, on the register and in the Shifts tab. The closing sheet
shows no expected figure at all before the count is typed, whoever is looking,
because a cashier who can see what should be there is a cashier who can count to
it. The row records both figures whoever pressed the button — withholding a
figure from a screen is not the same as not writing it down.

Still not real: there is no offline outbox — `sync_outbox` exists in the schema
and nothing writes it.

## Sales history

`/app/sales` is three tabs over one table, because they are three questions.
`?tab=history` — the default — is asked with a customer at the counter holding a
receipt: find it, see what was on it, print it again, take part of it back.
`?tab=day` is asked at 11 pm with a drawer of notes in one hand: what should be
in counter 1. `?tab=shifts` is asked on Sunday: whose drawer was short, and by
how much. `lib/pos/takings.ts` answers the second and now carries no receipt
list at all, because two lists of the same rows on one screen is how they drift
apart; `lib/pos/shifts.ts` answers the third. Day close is what a *counter* took
between opening and midnight; the Shifts tab is what a *person's* drawer came to
over four hours, which is the one that makes a Rs 300 gap visible at all — the
same Rs 300 against forty thousand is noise.

**One read, then everything is instant.** `listBills` fetches a whole window of
trading days in one round trip (capped at `HISTORY_MAX`, 2,000) and the panel
searches, narrows and pages in the browser — the same bargain the item and
customer lists strike, for the same reason: a round trip per keystroke over shop
3G is a search box a shopkeeper stops using. Only the *window* navigates, so it
lives in the URL and last Tuesday can be sent to an accountant as a link. When
the cap bites the screen says so with the real count beside it — `count: "exact"`
rides along on the same query for exactly that.

The figures above the table are the figures **of the rows under it**, and the
caption says which rows those are every time it is not all of them. That is what
makes "what did counter 2 take in cash last week" three taps rather than a
report, and the one thing a shopkeeper could not catch is a total quietly added
up from something other than what is on screen.

Opening a row is a sheet, not a navigation — a list somebody searched their way
to must survive looking at a bill. Only the lines are fetched, by `loadBill` in
`actions.ts`: a read through a Server Action, so the gate is the same
`requireSession` + module check as every other entry point. The arrows in its
footer, and the arrow keys, walk the filtered list.

**Reprints are marked.** The sheet renders the register's own `Receipt` with
`reprint: true`, which stamps DUPLICATE on the roll — a copy that looks like an
original is a bill a customer can present twice. What it cannot reprint is the
sales-tax line: `sale_lines` stores the price and not the rate behind it, so the
duplicate carries the lines, the subtotal and the total exactly and breaks out no
tax it would have to guess. `Sale.tenders` is a list rather than one `TenderId`
for the same honesty — `sale_tenders` is one-to-many, and a split bill must print
both halves the day the payment sheet can settle one.

**A refund is a sale with a minus in front of it** (`0024`). Not a second table
and not a flag on the original: `public.sales` gains a row with
`status = 'refund'`, a negative subtotal and total, negative line quantities and
a negative tender, pointing at the bill it reverses through `refunds_sale_id`.
Every reader in the console already sums those columns, so a refund nets out of
the takings, the dashboard, all five report tabs and this screen's own totals by
arithmetic rather than by each of them remembering to subtract it. The
alternative needs every sum in the product to grow a second half, and the one
that gets forgotten is the one that overstates what the shop earned. Money nets;
counts do not — `bills` is filtered to the positive rows everywhere, because the
shop served that customer twice and did not un-serve them.

**The original bill is never edited.** It keeps its status, its total and its
lines exactly as they were rung up. Rewriting it is how a receipt in a
customer's hand stops matching the shop's own record, and how a total gets
subtracted twice.

A refund needs an open drawer on the counter handing the money back, the same
gate the register charges under and for a stronger reason: a refund is notes
leaving a till, and a till nobody has counted into has no count for them to
leave. Refund rows are drawn red in the history — a badge in the first column,
the tender badge and the total — because the minus sign at the far end of a
line is not where the eye lands.

`record_return` refunds a line at `line_total / quantity` — what was actually
paid after any discount, never `unit_price` — copies `cost_snapshot` off the
original rather than re-reading `items`, and counts what is still returnable
from `sale_lines.refunds_line_id` with the original's lines locked. Two tablets
refunding the last unsold unit at the same moment is exactly how a shop refunds
three of two. **Stock only goes back if the shopkeeper says so**: a sealed
packet goes on the shelf and a burst bag of atta does not, and restocking
everything builds a count that is wrong in exactly the cases somebody would
notice. The slip prints stamped REFUND naming the bill it reverses, for a
stronger version of the reason a duplicate is stamped DUPLICATE.

Which counter a refund leaves from is the device's own `flo_counter` cookie, or
the single open till in a one-counter shop, and null otherwise — the button is
not drawn at all rather than guessing a drawer, because guessing is how a
day-end count stops balancing.

Export is client-side CSV of the filtered rows, not of the window: what is on
screen is what comes out, the same bargain printing strikes. Money leaves as bare
numbers with the currency in the heading, because a spreadsheet cannot add up
"Rs 1,250.00", and the file opens with a BOM so Excel reads a customer named in
Urdu as UTF-8.

## The dashboard

`/app` is real since `0019`. Every figure on it is **one** call to
`public.dashboard_summary` — the window and the one before it, the trend, the
departments, the best sellers and the last eight bills, grouped in Postgres.
`takings.ts` totals a day in TypeScript and says why; the dashboard's windows
are months, and a month of a busy kiryana is tens of thousands of sale lines
with no business crossing shop 3G to be added up in a browser runtime.

The function is `security invoker`, so it runs under the shop's own JWT and
`p_tenant` is a filter rather than a permission — a caller who names another
shop gets that shop's rows refused by the policy. It is the only function here
granted to `authenticated`, and `rls.test.sql` proves the claim. Like every
other reader in `lib/pos/`, `getDashboardData` **may not be wrapped in React
`cache()`**.

**Profit is real because the cost is on the line.** `sale_lines.cost_snapshot`
is stamped by `record_sale` from `items.cost_price` at the moment of sale, for
the reason `name_snapshot` is stamped beside it: a bill is what happened, and
joining last month's sales to today's cost column rewrites last month's margins
every time a supplier raises a price. The cost is read inside the transaction
and never taken from the Server Action's payload — it is the one number on a
bill the customer never sees and nobody would notice being wrong. What is still
honest-but-lossy: a line whose item never had a cost filled in reads as pure
profit rather than as unknown.

**The window is `sales.business_day`**, like everything else that reports. The
time filter resolves to instants because it also fills two date inputs;
`businessWindow` in `lib/pos/dashboard.ts` is the one place those become trading
days, and it clamps to the shop's own today — at 1 am in a shop that shuts at 3
the calendar says today and the books still say yesterday, and a window running
to the calendar date would come back empty with a shop full of customers. The
page captions what it actually read rather than what the filter is called.

Departments come off `items` through `sale_lines.item_id`, so an item since
deleted has no department to read — `sale_lines` keeps the name it was sold
under and not where it was filed. That money is grouped under "Not filed" rather
than dropped. Best sellers group by the catalog row where there is one and by
the printed name where there is not, because two deleted items that shared a
name were one thing on the shelf.

## Reports

`/app/reports` is real since `0021`. Five tabs over one period, because they are
five different questions: what the period came to, which items made it, which
half of the shop made it, how it was paid for and by whose till, and what is
still on the shelves. Four of them are **one** call to
`public.reports_summary` — the window and the one before it, the day-by-day
takings, hour-of-day, profit by item, both levels of the tree, the tender mix,
the counters and the cashiers, all grouped in Postgres. `security invoker` like
`dashboard_summary`, so `p_tenant` is a filter and RLS is the gate, and
`rls.test.sql` proves it and proves the two functions cost a window identically.
Like every other reader in `lib/pos/`, `getReportData` **may not be wrapped in
React `cache()`**.

`lib/pos/report.ts` carries no `server-only` — the period list is shared with
the picker, the same split as `history.ts`/`bills.ts` — and holds three things
the screen cannot have two copies of:

- **`EXPLAIN` is the single source for how every figure is worked out.** Every
  hover tip, every card caption that quotes a sum, and every CSV heading reads
  from it. A report is only worth anything if the owner believes the number, and
  the fastest way to lose that is for the screen and the spreadsheet to explain
  the same figure differently. One sentence per figure, in the shop's words.
- **The arithmetic.** Profit, margin, averages and shares are derived once. The
  SQL deliberately returns sales and cost and nothing derived from them.
  `marginOf` is profit over the *selling price*, not over cost, and
  `EXPLAIN.margin` says so on the screen — a supplier quoting "25% on cost" is
  20% here, and that is the kind of gap an owner finds after acting on it.
- **The window**, built on `history.ts`'s exported day and month arithmetic
  rather than a second copy of it. Reports has its own longer period list
  (a quarter, and the shop's own financial year off `fiscalYearStarts`) because
  the sales history's list stops at thirty days by design.

The hover tips are **`components/pos/info-tip.tsx` and pure CSS** — `.pos-info`
shows the bubble on `:hover` and on `:focus-within`, so a tap works. The
explanation is the button's `aria-label` and the bubble is `aria-hidden`, which
is what lets it be a server component: an `aria-describedby` would need a
`useId`. The only JavaScript this route ships is the period picker and the
export buttons.

Every share on a windowed tab uses **one denominator** — the sum of line totals,
which is what the department, category and item tables are all summing — so
departments add up to a hundred, so do categories, and an item's share is
comparable with both.

**Exports are a Server Action** (`exportReport`), not a CSV string sitting in the
page payload. The tables are server-rendered, so the browser is not holding the
rows, and shipping every figure twice for a button nobody may press is the wrong
trade on shop 3G — the opposite call from `/app/sales`, which is a client
component already holding its rows. The action re-resolves the window from the
same period id the URL carries, so the file and the table cannot describe two
different windows.

**Stock value is not windowed, and the tab says so twice.** `items.stock` is
what is on the shelf right now and there is no stock ledger, so Flo cannot
rewind it to the 1st. The period picker is replaced by a "counted today" badge
on that tab rather than left standing over figures it does not change.

**There is no sales-tax summary and there will not be one** until a line carries
the rate it was taxed at. `sale_lines` stores the price and not the rate behind
it, so any tax figure would be reverse-engineered from `items.tax_rate` as it
stands today — the same mistake as costing last month's sales from today's
`cost_price`. The reprint on `/app/sales` already refuses to guess it.

The marketing site still says the reports module is not built
(`/pricing`, `/products`, `/roadmap`). That copy is now the wrong way round and
is a product-announcement decision, not a code one.
