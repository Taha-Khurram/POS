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

There are no tests. `npm run build` and `npm run lint` are the verification gates.
`tsc` has no script — type errors surface through `next dev`/`next build`.

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
- `app/(app)/app/` — the client's product: register and back office.
  `layout.tsx` is the auth gate and the light `.pos-root` shell.
- `app/(admin)/admin/` — the owner console. `layout.tsx` gates on the
  `platform_role` claim and calls `notFound()` for everyone else, so `/admin`
  answers 404 rather than 403 and is not discoverable.
- `app/not-found.tsx` sits above the groups, so it carries `Nav`/`Footer`
  itself. It is also what a non-admin sees at any `/admin` URL.
- `components/site/` — page sections and site chrome (`nav`, `footer`, `hero`,
  `page-header`, `cta`, …). Composed by pages; not generic UI primitives.
- `components/motion/` — the animation primitives: `Reveal`, `CountUp`, `Tilt`,
  and the `useInView` / `usePrefersReducedMotion` hooks.
- `lib/` — server-only domain logic, each module opening with `import
  "server-only"`: `auth.ts` (session claims and the two route gates),
  `entitlements.ts` (the single authority on what a plan allows), `audit.ts`,
  `format.ts`.
- `utils/supabase/` — `client.ts` (browser), `server.ts` (takes an awaited
  `cookies()` store), `middleware.ts` (`updateSession`), `admin.ts` (service
  role, server only). `proxy.ts` at the root calls `updateSession` on every
  non-static path purely to refresh the session cookie; don't insert logic
  between creating that client and `auth.getUser()`. Route protection is a
  layout-level check, never proxy logic.
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

Color scales: `ink-*` (near-black surfaces), `iris-*` (brand), `mist-*` (text),
`flare/mint/sun-400` (signals). Fonts through `font-display` (Plus Jakarta Sans)
and the default sans (Inter). Easings are tokens — `var(--ease-out-soft)`,
`--ease-out-back`, `--ease-in-out-soft`.

**Two visual languages.** The marketing site and `/admin` are dark and share
everything above — the console reuses `.panel`, `.rim`, `.field`, `.btn-primary`
and adds no CSS of its own. `/app` is the exception: the counter is light and
high-contrast, because dark glass is unreadable under a tube light at 2 pm. It
gets `.pos-root` (which also sets `color-scheme: light`), `.pos-card`, and the
`paper-*` / `graphite-*` scales. Don't reach for Tailwind's built-in `slate-*`
or `gray-*` there.

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

## Not built yet

`app/(site)/login/login-form.tsx` fakes a pending state and
`app/(site)/demo/demo-form.tsx` swaps to a thank-you panel locally — nothing is
sent anywhere. Wire them to `supabase.auth.signInWithPassword` and a Server
Action writing to `leads` respectively. `/app` and `/admin` are gated shells
with no modules behind them yet; `Plan.md` has the order they arrive in.
