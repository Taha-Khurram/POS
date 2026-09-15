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
  the client filter, so it carries no `server-only` and no imports.
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
and `counters` (`0010`) back the currency/clock, permissions and counter cards,
read through the shop's own JWT in `lib/pos/shop.ts` and written by
`app/(app)/app/settings/actions.ts` on the service role. Writes are owner-only;
`readOnly` on the panels is presentation, and the action checks the role again
for itself.

The register bills but does not yet record. `counters.is_active` is the gate —
shut, `/app/register` shows the switch and links to it; open, it is the till in
`app/(app)/app/register/till.tsx`: scan or search, one line per item, and a
total. `lib/pos/counter.ts` holds every figure on that screen and carries no
`server-only`, because the till is a client component and `saveCounter` has to
validate against the same lists. Payment is cash or card, and the bill prints
through the `@media print` block at the foot of `globals.css` — the receipt
element is left visible and everything else is hidden, so what is on screen is
what comes off the roll. `@page` is mounted in `receipt.tsx` rather than in the
stylesheet, because it cannot be scoped and would otherwise set the marketing
site's pages to 80 mm too.

Nothing is written to `sales`, `sale_lines` or `sale_tenders`. That wants a
branch row (`sales.branch_id` is not-null), real `items` rows, and the offline
outbox, which is Part 4 — so receipt numbers are the counter's own daily series
kept in `localStorage`, and `/app/sales` is still a placeholder. The items the
till rings up are `SAMPLE_ITEMS`, the same rows Products & stock shows, so the
two screens cannot disagree about what is on the shelf.
