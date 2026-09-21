@AGENTS.md

# Flo — marketing site

Public marketing site for **Flo**, a point-of-sale product for Pakistani
supermarkets. Next.js 16 App Router, React 19, Tailwind v4, TypeScript strict.
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

`npm run shots` drives a live `npm run dev` and writes thirteen PNGs of the real
console. The `SHOTS` list in `scripts/shots.mjs` is the contract: a screen not
on it has no photograph, and a claim on the site with no photograph behind it is
copy nobody has checked against the product. **Re-run it after any change to how
`/app` looks**, or the marketing site starts showing a product that no longer
exists. It signs in as the demo shop `npm run demo:shop` builds — a
self-contained tenant, deletable in one command, so no screenshot ever carries a
real person's email or a development account's "Test Product".

That shop has to carry a floor under every photographed screen, which is why
`demo-shop.mjs` seeds five purchase orders, three deliveries with carriage on
them and four supplier payments beside the sales: `/app/purchasing` photographed
empty is a claim with a picture of nothing beside it. Those rows are inserted
directly, like the sales — **no stock moves and no `cost_price` is rewritten by
seeding**, so the counts in `ITEMS` stay the counts on the shelf. The freight
apportioning is restated there a third time (after `record_receipt` and
`receiptTotals`) and has to keep matching them to the paisa.

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

Database work goes through the **Supabase MCP** — `apply_migration` for a
migration, `execute_sql` to look. There is no Docker on this machine, so
`supabase start`, `supabase db reset` and `supabase test db` are not available
and pgTAP cannot run at all. Migrations are still plain SQL in
`supabase/migrations/`, applied in filename order, and the file is written
*and* applied in the same step so the folder and the database cannot disagree.

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
- `supabase/` — `migrations/` (plain SQL, applied in filename order) and
  `config.toml` (local stack). There is no `tests/`: `rls.test.sql` was 1,700
  lines of pgTAP that needed a local Postgres to run, and with no Docker here it
  could only ever be edited and hoped over. It was removed in favour of not
  carrying a gate nobody can open — recoverable from git history if a machine
  with Docker ever runs this.
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
held to. `0034` went further with `restaurant_mode` and removed the key, which
is what a flag gets when the answer is never rather than not yet. Flip one back in the same migration that lands the feature — `0021`
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
   support impersonation is read-only.
5. `audit_log` is append-only, enforced by a trigger rather than by policy,
   because the service role has `bypassrls`.

**Nothing verifies any of that automatically any more.** `rls.test.sql` proved
all five rules and is gone with the Docker that ran it, so the five are now
held up by review alone. A migration that adds a business table therefore has
to be read against them by hand — enable and force RLS, select-only for tenant
JWTs, `private.*` claim helpers wrapped in `(select …)`, no platform-admin
escape on a write path — and a `security definer` function granted to
`authenticated` has to be argued for in its own header, because there is no
longer a test that will notice.

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

The platform console is real since `0036` — see **The platform console**
below. The `/app` layout still calls `getShopName()` for the rail's account
block, and both that and the dashboard fall back rather than fail, so an account
with a null `tenant_id` still reaches the dashboard and is shown a shop that has
sold nothing — keep that true. Nothing reads `branches`; there is no branch
picker and no counters list until a shop can actually have a second one.
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
rule. The marketing site said purchase orders were not built for several
migrations after that; `/pricing`, `/products`, `/roadmap` and `/solutions` were
corrected when the console screenshots were re-taken and Buying became visible
in the rail of every one of them. `/app/purchasing?tab=orders` is now one of the
photographs (`public/shots/purchasing.png`) and has a panel of its own in
`product-tour.tsx`, which is what the claim rests on. Buying is on the
**Standard** plan's list, because nothing gates it by plan.

### The supplier ledger

`0029` answers the one question a shopkeeper actually asks about a distributor —
*kitna dena hai*. `?tab=payments` is what went out this month, with a bank
statement in the other hand; `?tab=suppliers&supplier=<id>` is one account, the
way `?customer=<id>` is one person's record.

**It is a running account, not invoice matching.** `supplier_payments` has no
link to a delivery and never will: Ravi Trading's man takes fifty thousand on a
Thursday against the account, not against invoice 4821. Allocation would mean a
join table, a screen for it, and a shopkeeper reconciling line by line for a
figure they already keep in their head as one number.

**Ageing is a walk, not a table.** `ageOf` in `lib/pos/ledger.ts` sorts the
deliveries oldest first and spends the payments against them until they run out;
whatever is left is aged by its delivery's date. Nothing is stored, so it cannot
drift from the payments it came from — and the screen states the assumption out
loud, because a figure an owner cannot account for is one they stop believing.
The buckets sum to the balance by construction.

**The balance is defined once**, in `balanceOf`: opening + invoiced − paid.
Three screens quote it — the Suppliers column, the account, and the Buying tile
— off one `listSupplierBalances` read, so they cannot disagree.
`public.supplier_balances` is `security invoker` like `dashboard_summary`, so
`p_tenant` is a filter and RLS is the gate; it is the third function granted to
`authenticated`; naming another shop returns nothing, because the policy and
not the argument is what decides.

**The opening balance is what makes day one believable**, and it carries a date
(`opening_balance_on`) because a balance with no date is a figure nobody can
check against their own book. Zero needs no date.

`suppliers.opening_balance` is **signed** — negative is an advance the shop has
paid — and `balanceState` is the one place that decides what a negative balance
is called, so nothing draws "owed" in red at a shop that is in credit.
`ageOf` leaves an advance out of the walk entirely: it is not a debt and has no
age. The owed tile sums only the accounts actually in debit, because netting an
advance off would understate what has to be found on Friday.

A payment is a **real delete**, unlike a refunded sale in `0024`. A sale is a
thing that happened to a customer holding a receipt; a payment row is the shop's
own note about its own account, and the commonest reason to remove one is a typo
two minutes old. `audit_log` keeps it either way.

`plans.features` gains nothing here — `purchase_orders` already covers Buying,
and a flag per tab is a flag nobody reads.

## Batches and expiry

`0030` makes a pharmacy and half a grocery possible. `items.stock` is one
number, which is the whole truth for a bag of flour and no truth at all for
forty strips of Panadol across three expiry dates.

**Tracking is per item and off by default.** `items.tracks_batches` is opt-in,
and everything in `0030` is a no-op for an item that has not opted in — a second
dropdown between a shopkeeper and a saved item is the mistake `0016` undid when
it dropped `subcategory`.

**`items.stock` stays the running total; `item_batches` is the sub-ledger under
it.** They cannot disagree, because `private.move_stock` writes both in one call
and is still the only writer of either. Making the batches the only truth and
`items.stock` a view would have been cleaner on paper and would have rewritten
every reader, report and stock gate that already answers correctly.

**Sold first-expired-first, not FIFO.** `private.take_from_batches` orders on
`expires_on` and breaks ties on arrival: a carton received in March expiring in
June must go before one received in April expiring in December. `byFefo` in
`lib/pos/batch.ts` is the same ordering for the browser, so the batch panel
lists them in the order the till will actually take them.

**An expired batch cannot be sold.** This is the one hard refusal in the
product — harder than the stock gate, which concerns a number somebody can go
and count. The allocation skips expired stock and `record_sale` fails with the
item named and the in-date figure. The way through is a write-off, which is
`adjust_batch` with a target of nought and reason `'expired'` — a deliberate,
recorded act, and its own ledger reason because "how much did we throw away last
quarter" has to be a `sum()` rather than a text search.

**A return goes back into the batches that sale took it from**, never a fresh
FEFO pick — that would put June's stock into December's batch and extend its
life by six months, the precise failure this migration prevents.
Of those batches, **soonest-expiring first**: the obvious rule (unwind newest
movement first) is not available, because every movement one sale writes shares
a single `created_at` — `now()` is transaction-start time — so ordering on it
within a sale is undefined. That was caught by a partial return landing in the
wrong batch. The conservative rule is deterministic and better anyway.

**A whole-item stocktake is refused for a tracked item.** `set_stock` raises and
the product sheet's stock box is dead rather than a control that bounces: one
figure cannot say which batch it belonged to, and guessing would shorten or
extend something's life by the difference. `adjust_batch` counts one batch, the
same absolute-in relative-down adapter under a row lock.

**The expiry date is captured on the delivery line**, because that is the one
moment somebody is holding the carton — every later screen is typing from
memory. It is *not* required even for a tracked item: the person at the door has
a queue behind them, and a delivery recorded without a batch is worth more than
a delivery not recorded. It lands in the item's plain stock and the batch panel
says how much is untracked.

`expiryState` in `lib/pos/batch.ts` is the single definition of expired /
critical / soon, taking the shop's own `today` and never the browser's — a
tablet on the wrong date would mark good stock expired. `expiryCounts` counts
the bell's notices through that same function rather than a date predicate in
SQL, because a second definition is the copy that drifts from the badge the
shopkeeper is looking at. A batch that expires *today* is not expired, in both
TypeScript and `take_from_batches` — the two have to agree or the till refuses
stock the screen calls fine.

`lib/pos/batch.ts` carries no `server-only`; `lib/pos/batches.ts` is its reader
and, like every other reader in `lib/pos/`, **may not be wrapped in React
`cache()`**. Writes are `app/(app)/app/inventory/batch-actions.ts` on the service
role, gated by `can_edit_items` — not `can_manage_purchasing`, because writing
expired stock off is a stocktake decision made by whoever is at the shelf
holding it.

## Variants

`0031` makes a cloth house and a shoe shop possible. `items.tracking =
'variant'` has existed since `0008` and meant nothing — the product sheet drew
the SKUs a matrix *would* generate and said so, because `item_variants` did not
exist.

**This is the batch problem one shape over, solved the same way on purpose.**
Stock lives in rows under the item, `private.move_stock` writes the row and
`items.stock` together and is still the only writer of either, and `items.stock`
stays the running total every reader already asks. What differs is who chooses:
a batch is picked by the till, a variant by the customer.

**Two axes, not a jsonb bag.** `option_a` and `option_b` are what a grid can
draw and a thumb can tap; the axis *names* live on `items.variant_axes` so one
item's rows cannot disagree about what its columns mean. A third axis is a
matrix nobody can find a size in.

**An item is variant-tracked or batch-tracked, never both** — a check
constraint, because batches-per-variant is a third level for a shop that does
not exist.

**A barcode means exactly one thing.** Item codes and variant codes live in two
tables, so no single unique index can say it; `private.one_barcode_per_code` is
a trigger on both that refuses a code the other holds. Scanning something that
could be two things is the one failure a till cannot recover from. The honest
caveat is in the migration: two simultaneous inserts could both pass, which is
unreachable through the product since every write is one service-role Server
Action.

**`selling_price` and `cost_price` are nullable and null means the item's.**
Most of a cloth house's sizes are one price and the XXL is not, so the exception
is stored and the rule is an absence. `priceOf`/`costOf` in `lib/pos/variant.ts`
resolve it, and `recordSale` resolves it again server-side — the browser never
decides what anything costs, variants included, and a crafted body pairing a
cheap variant with a dear item is refused because the variant must belong to
that item.

**`CartLine.id` is no longer the item's id.** It is `cartKey(itemId, variantId)`
— the item id alone for an ordinary line, `item:variant` for one. That is what
lets a bill carry a medium blue and a large blue as two rows while a bottle
scanned twice stays one. `itemId` and `variantId` ride beside it and are what
the sale payload sends, because `sale_lines` has two columns and a composite key
in one of them is a value nothing can join on.

**Rows are switched off, never deleted.** `save_variants` writes the grid whole
and switches off what the grid no longer names — a combination may be on last
month's receipts and may still have stock, and stock that vanished with a row is
stock `items.stock` still counts.

**A whole-item stocktake is refused** once a grid exists, exactly as it is for a
batch-tracked item: one figure cannot say which colour it is. `adjust_variant`
counts one row under a lock. `variant_count` is written by `save_variants` alone
— the product sheet deliberately does not post it, or correcting a price on an
item whose grid nobody opened would null it.

`lib/pos/variant.ts` carries no `server-only`; `lib/pos/variants.ts` is its
reader and, like every reader in `lib/pos/`, **may not be wrapped in React
`cache()`**. The till reads `variantsByItem` whole for the reason it reads the
catalog whole — a grid behind a round trip per tap is a grid nobody uses.

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

## Tenders

`sale_tenders` has been one-to-many since `0001` and `record_sale` wrote exactly
one row into it until `0032`. The table was right and the code was not: a
customer who puts two thousand on a card and hands over the rest in notes is an
ordinary Saturday.

**The sum of the tenders is the bill, to the paisa.** `record_sale` refuses
anything else. Every takings figure, every shift variance and the whole of
`/app/sales` is a `sum()` over these rows, so a bill whose parts do not add up
is a day that will not reconcile and nobody will know which bill did it.

**Nothing here is an integration.** Raast, Easypaisa, JazzCash and bank transfer
are ways of *recording* how the money arrived, typed by the cashier, with
`sale_tenders.reference` for the TID or approval code. Nothing in Flo talks to a
wallet or a bank. That is worth having before any integration exists, because it
is what makes a day reconcile against a JazzCash statement — and the day one
ships, it writes these same rows.

**Cash covers the remainder; it is never typed.** The payment sheet takes an
explicit amount for each non-cash part and gives cash whatever is left, which is
how a counter works: the customer says "two thousand on the card" and hands over
notes, and nobody types the cash figure. The recorded cash tender is what it
*covers*, not the note handed over — recording the note would overstate the
drawer by the change and every shift would be short by exactly that.

**`counters.accepted_tenders` is a list, not a flag per method.**
`accepts_cash`/`accepts_card` were two booleans on the way to becoming six;
`0032` backfilled an array and dropped both, the same call `0027` made about
`items.supplier`. `tendersOn` orders it by `TENDERS`' own order, so cash is
first on every till whatever order the array was stored in.

**`inDrawer` is the one place that decides what lands in a drawer**, and only
cash does. `close_shift` still filters `method = 'cash'` for `expected_cash`;
what changed in `0032` is its other half — it summed `method = 'card'` and now
sums everything that is not cash, because a JazzCash bill counted as neither
went missing from both figures on the Shifts tab. `shifts.card_total` keeps its
name and now means "took, but not into the drawer".

`takings.ts` gained an `other` bucket for the same reason and with an `else`, so
`cash + card + other` equals `total` by construction — a method falling through
to nothing is a day whose columns do not add up to the figure beside them. The
day-close screen draws that column only when there is something in it.

## No restaurant mode

`0033` built it — a floor map, an order per table, kitchen tickets, modifiers,
`settle_table_order` — and `0034` took all of it out: six tables, seven
functions, `tenant_settings.restaurant_mode`, the `tables` module key, the rail
row, the Settings tab, `lib/pos/restaurant.ts` and `lib/pos/tables.ts`. **Flo is
a supermarket till and only that**: aisles, barcodes, a trolley at a counter.

It is deleted rather than left standing unread, the call `0018` made about the
khata and `0016` made about `items.subcategory` — a table nothing writes is how
a product ends up claiming something it cannot do, and the next person to read
the schema cannot tell a dead branch from a quiet one. It cost nothing to do it
now: every one of the six tables was empty, because the module shipped into a
private preview and no shop ever laid a floor out. A settled table order is a
receipt somebody holds, so the same migration a month later would have had to
be an export first.

**Do not re-add it a screen at a time.** A dining room is a different product —
that is `0033`'s own header, and it is the reason this is on `/roadmap` under
what Flo will never build rather than under what is coming. `plans.features`
lost the `restaurant_mode` key outright rather than going back to false, because
false says "not yet, on a tier we may sell you".

**The shop type is one value.** `SHOP_TYPES` in `lib/pos/settings-options.ts`
holds `supermarket` alone and `0034` narrows the check constraint on
`tenants.shop_type` to match — the list is what the product is, not a survey of
what a shop might be. The checkout form reads that same array rather than the
second copy it used to keep. `orders.shop_type` and `leads.shop_type` are free
text and were deliberately not rewritten: they record what somebody said about
their own shop, and the constraint is the right place to find out that Flo does
not run a dhaba.

`moduleAccess` no longer takes the shop at all, which hands the owner's rail
back the read `restaurant_mode` used to cost it on every request.

## The platform console

`/admin` is the product owner's own console, built by `0036` on tables
`0001_init.sql` has carried since day one — `tenants`, `plans`,
`subscriptions`, `orders`, `payments`, `invites`, `leads`, `audit_log`,
`tenant_notes`. Nothing had ever called any of it: a shop was activated by hand
in the SQL editor.

**It is the same console, not a second product.** `app/(admin)/admin/` is its
own route group so it inherits neither the site's `Nav`/`Footer` nor `/app`'s
tenant chrome, but `components/admin/admin-shell.tsx` is the same `.pos-shell`,
`.pos-rail` and `.pos-topbar`, the same `paper-*`/`graphite-*`/`orchid-*`
palette and the same `flo_theme` cookie. Two consoles that looked like two
products is how an operator ends up unsure which one they are in with a
shopkeeper on the phone. It is deliberately *not* `ConsoleShell`: that one takes
a `ModuleAccess`, a shop name and the bell's notices, all of which are a
tenant's.

**`/admin` 404s, it never refuses.** `requirePlatform()` in
`lib/platform/access.ts` is the gate and it calls `notFound()` — a console that
can activate paid accounts and read every client's sales should not be
discoverable, and "you are not allowed here" has already confirmed there is a
here. Signed out is the one case that redirects to `/login` instead. The gate is
in the layout *and* in every page, because Next renders a page and its layout in
parallel.

**Every read is through the operator's own JWT** (`lib/platform/console.ts`,
`server-only`), never the service role. Every platform table's read policy
already carries `or private.is_platform_admin()`, so RLS is the gate here too —
and if the access-token hook stops stamping `platform_role` the console goes
empty rather than quietly working with a gate nobody is checking. Like every
reader in `lib/pos/`, **none of them may be wrapped in React `cache()`**. The
one exception is `proofUrl`, which signs a ten-minute link to a payment
screenshot in the private `payment-proofs` bucket: storage has no policy for the
platform role, and the alternative is a bucket every signed-in account can read.

**Every write is a service-role Server Action that re-checks for itself.**
`requireBilling()` returns a sentence rather than a 404, because a form has to
say something back. A `support` operator reads every screen, works the leads and
writes notes, and is refused anything that touches money — checked in the
action, not trusted from the rail.

**Two writes are one transaction each, in SQL.** `public.activate_tenant` writes
the tenant, its primary branch, the subscription and a hashed invite together,
because a half-done activation is the worst row in the system: a shop that signs
in to a console with no plan behind it, or a link already pasted into a chat
pointing at a tenant that has none. `public.record_subscription_payment` locks
the subscription row, works the new period out and inserts the payment beside
it, so two operators recording the same renewal cannot both extend from the same
end date. Both are granted to `service_role` alone, which is why neither needs
`security definer`.

**The invite token is minted in the Server Action and never reaches Postgres.**
`activate_tenant` takes the sha256, because a function's arguments end up in
`pg_stat_statements` and the slow-query log. The plaintext is returned once, in
`AdminState.invite`, drawn by `components/admin/invite-card.tsx` with the
WhatsApp message already composed — and is then unrecoverable by anything. An
operator who loses it regenerates, which revokes the one they lost;
`invites_one_live_per_tenant_role` is what makes that the only safe move.

**Both activation paths are one function.** `/admin/orders`' Verify button and
the direct form both call `activateShop` in `clients/activate.ts`, which is
`server-only` and deliberately *not* in a `"use server"` module — every export
of one is a callable endpoint, so a shared body taking its actor as an argument
would be a way to activate a shop as anybody. Verify claims the order first
through `orders.verification_started_at` (`0005`), because one order becoming
two tenants is the failure that queue has.

**The reads are grouped in Postgres.** `platform_clients()` returns one row per
shop with its plan, standing, monthly value, last sale and item count;
`platform_overview()` is the strip. Both are `security invoker` like
`dashboard_summary`, with an `is_platform_admin()` guard on top — a tenant who
found the RPC would otherwise get a one-row "platform" of their own shop, which
is not a leak but is a screen that lies about what it is. `last_sale_at` is read
live off `sales` rather than from `tenant_health`, which has existed since
`0004` and which nothing has ever written a row into.

**MRR counts `active` and `past_due` only.** A trial is not revenue, and a
suspended shop is money that has stopped arriving — which is what the figure is
for. `private.monthly_value` and `monthlyValue` in `lib/platform/admin.ts` are
the same division written twice, and have to stay identical.

**What suspension means is the whole of "disable", and it is deliberately
narrow.** A suspended shop still signs in, still reads every sale it ever made,
still exports it and still closes the drawer it opened this morning. What stops
is ringing up a new one: `recordSale` refuses through `getEntitlements`, and the
register draws a strip above the till saying so. Holding a shop's own books
hostage over an unpaid invoice is indecent and, in a dispute about their
records, the weaker position to stand in. `past_due` stays operable on purpose —
suspension is a decision somebody takes, not a date that arrives.

**`plans.features` is still copy.** The plan editor says so on the screen:
nothing in `/app` gates a screen on a flag, so unticking a box changes
`/pricing` and not what a shop can open. `PLAN_FEATURES` marks which ones the
product actually honours, and `0020`'s rule stands — flip a flag in the
migration that lands the feature. The one entitlement that bites is
`subscriptions.max_registers`, which Settings enforces, and it lives on the
subscription rather than the plan precisely so a haggled "teen counter kar do"
is a one-row update.

`lib/platform/admin.ts` carries no `server-only` — the activation form and the
plan editor are client components and the actions validate against the same
lists. Note that `SelectRow` is a listbox the page owns and not an `<input>`:
every one of them needs its own hidden field, or the action gets a body with no
plan in it and refuses a form that looked complete.

The invite link's origin comes off the request headers, overridable with
`NEXT_PUBLIC_SITE_URL` behind a proxy that rewrites the host. A link that is
nearly right is one nobody notices until the shop rings up.

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
granted to `authenticated`. Like every other reader in `lib/pos/`,
`getDashboardData` **may not be wrapped in React `cache()`**.

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
`dashboard_summary`, so `p_tenant` is a filter and RLS is the gate.
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

The marketing site said for several migrations that the reports module was not
built. `/pricing`, `/products` and `/roadmap` were corrected when the
screenshots were re-taken — Reports is in the rail of every light shot, so the
old copy was being contradicted by the picture beside it. It is now photographed
in its own right (`public/shots/reports.png`, `?range=30d`) with a panel in
`product-tour.tsx`.

**It is on both plans.** `0035` raised `advanced_reports` on Standard rather
than gating the module, because nothing has ever read that flag — `/app/reports`
is reached through `can_view_reports`, a permission an owner grants a cashier,
not a tier. What Premium buys is four counters and a named person, and
`/pricing` now says so.
