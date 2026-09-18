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
```

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
  `lib/pos/items.ts`, which is `server-only` like the rest.
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
  `usePrefersReducedMotion()` for JS-driven animation (`CountUp`, `SalesChart`,
  `Starfield`, `Tilt`). `app/layout.tsx` carries a `<noscript>` fallback that
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

The voice is specific and local: rupee prices, FBR digital invoicing, udhaar
khata, load-shedding, named cities and shop types, occasional Urdu ("Shukriya").
Keep new copy concrete and in that register — no generic SaaS filler.

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
`is_active`. `lib/pos/items.ts` reads it through the shop's own JWT — and, like
the readers in `shop.ts`, **none of them may be wrapped in React `cache()`**, or
the re-render a `revalidatePath` triggers redraws the list as it stood before
the save.

Writes are `app/(app)/app/inventory/actions.ts` on the service role, gated by
`can_edit_items` rather than by the owner role — the permission is named for
this screen, so a manager an owner trusted with stock can add it. Settings and
Staff stay owner-only.

`readProduct` in that file is the one validator, and the CSV import builds a
`FormData` per row so it goes through exactly that: a price the add-product
sheet refuses is a price the import refuses, in the same words. The import
inserts in chunks and retries a refused chunk one row at a time, so a single
duplicate barcode never costs the other ninety-nine rows, and every skip is
reported by its line in the file.

Two unique indexes carry the weight: `(tenant_id, barcode)` and
`(tenant_id, sku)`, both partial on not-null. `conflict()` turns a 23505 from
either into the sentence the owner needs — a duplicate barcode almost always
means the shop already stocks the thing being added.

Deleting an item is a real delete. `sale_lines.item_id` is `on delete set null`
beside a not-null `name_snapshot`, so every past receipt still prints exactly as
it was rung up and only stops pointing at a row; what is lost is the ability to
group last month's sales by that item, which is why the sheet offers switching
it off first. Variants are counted (`variant_count`) but not enumerated —
`item_variants` does not exist, so the matrix shows the SKUs it would generate
and says so.

## Not built yet

`app/(site)/demo/demo-form.tsx` swaps to a thank-you panel locally — nothing is
sent anywhere. Wire it to a Server Action writing to `leads`.

Sign-in is real, but deliberately narrow while the product is in private
preview: `app/(auth)/login/actions.ts` holds an `ALLOWED_EMAILS` list of one
address, checked *before* Supabase verifies the password, and every successful
sign-in lands on `/app` — there is no `next` return path and no role-based
fork. Delete the constant and its check to open it up.

There is no platform console. `/app` reads one `tenants` column and nothing
else: the layout calls `getShopName()` for the rail's account block, and both
that and the dashboard's sample figures fall back rather than fail, so an
account with a null `tenant_id` still reaches the dashboard — keep that true.
Nothing reads `branches`; there is no branch picker and no counters list until
a shop can actually have a second one. `lib/pos/dashboard.ts` documents the
queries that replace the sample data, and `Plan.md` has the order the modules
arrive in.

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
quantities; `app/(app)/app/register/actions.ts` re-prices every line from the
catalog and recomputes the total with the same `billOf` the screen used. The
write is `public.record_sale` — one security-definer function, one transaction —
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
opened and no report re-derives that window. `/app/sales` reads it: each
counter's cash, card and total, then all counters together.

Still not real: there is no offline outbox, no shift, and no reprint or returns
— `sync_outbox` and `shifts` exist in the schema and nothing writes them.
