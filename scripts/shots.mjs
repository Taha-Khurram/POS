/**
 * Screenshots of the real console, for the marketing site.
 *
 *   npm run dev            # in one terminal — the script drives a live app
 *   npm run shots          # in another
 *
 * One-time setup: `npx playwright install chromium`.
 *
 * The hero used to show a hand-built replica of the dashboard. A replica drifts
 * — it kept the old blue palette for a week after the console went violet, and
 * nobody noticed because nothing links the two files. This does: re-run it
 * after a visual change and the site is honest again in twenty seconds.
 *
 * Signing in without a password
 * -----------------------------
 * The service-role key mints a one-time magic-link token, which is redeemed
 * here in Node for a real session. The session is then handed to
 * `createServerClient` from `@supabase/ssr` with a cookie jar that records
 * instead of storing — so the cookies the browser gets are the exact ones the
 * app's own middleware would have written, produced by the same library at the
 * same version. Nothing here knows or guesses a cookie name.
 *
 * Identity is dressed over before the shutter: the signed-in account's email is
 * a real person's, and it must not end up on a landing page.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Values may come from the real environment instead.
}

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "public", "shots");

/**
 * The shop in the pictures.
 *
 * `npm run demo:shop` builds it: a Lahore kiryana with a real department tree,
 * fifty-odd items priced in rupees, twenty regulars and six weeks of trading.
 * The screens, the readers and the arithmetic are the product’s own — only the
 * rows are seeded, which is the one thing a screenshot of a development
 * account gets wrong in a way nobody outside the team can check.
 *
 * Pass another address to photograph a different account. The dressing below
 * catches a real person’s email before it can reach a landing page.
 */
const DEMO_EMAIL = "owner@almadina.flopos.pk";

const EMAIL =
  process.argv[2] ?? process.env.SHOTS_EMAIL ?? process.env.ADMIN_EMAIL ?? DEMO_EMAIL;

const DRESSING = [
  [/tahakhurramofficial@gmail\.com/gi, DEMO_EMAIL],
];

/** 2x so the hero stays crisp on a retina panel; Next resizes down from here. */
const VIEWPORT = { width: 1280, height: 820 };

/**
 * Every screen the marketing site is allowed to show.
 *
 * One entry per picture, and the list is the contract: a page that is not here
 * has no photograph, and a page on the site with no photograph behind it is
 * copy nobody has checked against the product. `prepare` runs after the page
 * has settled, for the screens that only look like themselves once somebody has
 * touched them — the till is an empty box until something is on the bill.
 */
const SHOTS = [
  { name: "dashboard-dark", theme: "dark", path: "/app?range=7d" },
  { name: "dashboard-light", theme: "light", path: "/app?range=7d" },
  { name: "register", theme: "light", path: "/app/register", needsCounter: true, prepare: ringUpABill },
  { name: "inventory", theme: "light", path: "/app/inventory?tab=items" },
  { name: "categories", theme: "light", path: "/app/inventory?tab=tree" },
  { name: "customers", theme: "light", path: "/app/customers" },
  { name: "sales-history", theme: "light", path: "/app/sales?tab=history" },
  { name: "day-close", theme: "light", path: "/app/sales?tab=day" },
  { name: "staff", theme: "light", path: "/app/employees" },
  { name: "settings", theme: "light", path: "/app/settings?tab=store" },
  { name: "permissions", theme: "light", path: "/app/settings?tab=roles" },
];

/**
 * Put a few lines on the bill before the shutter.
 *
 * Typed into the real search box and picked off the real menu, rather than
 * seeded through some photograph-only hatch — a till with a hatch in it is a
 * till whose picture can show a bill the product cannot produce.
 */
async function ringUpABill(page) {
  const search = page.locator('input[placeholder^="Scan a barcode"]');

  // Distinct enough that each one lands on a different row — three queries that
  // all match the same item photograph as one line with a quantity of three.
  for (const query of ["Sunridge", "Basmati", "Tapal", "Coca", "Surf"]) {
    await search.fill(query);

    const option = page.locator(".pos-option").first();
    try {
      await option.waitFor({ state: "visible", timeout: 2500 });
    } catch {
      continue; // Nothing matched that in this shop's catalog.
    }

    await option.click();
    await page.waitForTimeout(120);
  }

  // A regular on the bill, because attaching one is the till's own step and a
  // picture of the walk-in case says nothing about it.
  const customer = page.locator('input[placeholder^="Walk-in"]');
  await customer.fill("Hafiz");

  const match = page.locator(".pos-option").first();
  try {
    await match.waitFor({ state: "visible", timeout: 2500 });
    await match.click();
  } catch {
    await customer.fill("");
  }

  await search.fill("");
  await page.keyboard.press("Escape");
  // The bill panel animates its new rows in; let them land.
  await page.waitForTimeout(400);
}

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !publishableKey || !serviceRoleKey) {
  die("Missing Supabase env. Run `npm run doctor` first — it names what is absent.");
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  die("Playwright is not installed. Run `npm i` then `npx playwright install chromium`.");
}

// The script drives the running app rather than building its own — the point
// is a picture of what is actually being served.
try {
  const probe = await fetch(BASE, { redirect: "manual" });
  if (probe.status >= 500) throw new Error(String(probe.status));
} catch {
  die(`Nothing is answering at ${BASE}. Start it with \`npm run dev\` and re-run.`);
}

/* ---------------------------------------------------------------- session -- */

console.log(`\n  Signing in as ${EMAIL}…`);

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});

if (linkError || !link?.properties?.hashed_token) {
  die(`Could not mint a link for ${EMAIL} — ${linkError?.message ?? "no token returned"}`);
}

const redeemer = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: verified, error: verifyError } = await redeemer.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});

if (verifyError || !verified?.session) {
  die(`The link would not redeem — ${verifyError?.message ?? "no session returned"}`);
}

// A cookie jar that records rather than stores, so @supabase/ssr hands us the
// exact cookies it would have set on a response.
const jar = [];

const recorder = createServerClient(url, publishableKey, {
  cookies: {
    getAll: () => [],
    setAll: (cookies) => jar.push(...cookies),
  },
});

await recorder.auth.setSession({
  access_token: verified.session.access_token,
  refresh_token: verified.session.refresh_token,
});

if (jar.length === 0) {
  die("@supabase/ssr wrote no cookies. Its storage contract has moved — check the version.");
}

const claims = JSON.parse(
  Buffer.from(verified.session.access_token.split(".")[1], "base64").toString(),
);

if (!claims.tenant_id) {
  console.warn(
    "  ! The token carries no tenant_id — the access token hook is off, and\n" +
      "    every gated screen will photograph its empty state.",
  );
}

/* -------------------------------------------------------------- the shots -- */

const { hostname } = new URL(BASE);
const browser = await chromium.launch();

await mkdir(OUT, { recursive: true });

/**
 * Which till the register photographs from.
 *
 * Read here rather than clicked through the picker: the picker is a screen in
 * its own right and photographing it would mean every register shot started by
 * capturing something else. The cookie is exactly what `chooseCounter` writes,
 * and the page re-checks it against the shop's open counters anyway.
 */
const { data: openCounters } = await admin
  .from("counters")
  .select("id, name")
  .eq("tenant_id", claims.tenant_id ?? "00000000-0000-0000-0000-000000000000")
  .eq("is_active", true)
  .order("sort_order", { ascending: true })
  .limit(1);

const counterId = openCounters?.[0]?.id ?? null;

if (!counterId) {
  console.warn(
    "  ! No open counter on this shop — the register will photograph its " +
      "\"counter is shut\" screen rather than a till.",
  );
}

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    // Entrances and count-ups settle instantly, so the still is the screen at
    // rest rather than whatever frame the shutter caught.
    reducedMotion: "reduce",
    colorScheme: shot.theme === "dark" ? "dark" : "light",
  });

  await context.addCookies([
    ...jar.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    })),
    // The console's own two preferences, read by the layout before first byte.
    { name: "flo_theme", value: shot.theme, domain: hostname, path: "/" },
    { name: "flo_rail", value: "0", domain: hostname, path: "/" },
    ...(shot.needsCounter && counterId
      ? [{ name: "flo_counter", value: counterId, domain: hostname, path: "/" }]
      : []),
  ]);

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });

  if (page.url().includes("/login")) {
    die("Landed back on /login — the session cookies were rejected.");
  }

  await page.waitForSelector("main");
  await page.evaluate(() => document.fonts.ready);

  // `next dev` paints a floating badge over the bottom-right corner, and it
  // photographs. Hidden here rather than through `devIndicators: false`, which
  // would take it away while actually working too.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

  // Before the dressing, so whatever it puts on the screen is dressed too.
  if (shot.prepare) await shot.prepare(page);

  // Dress over the signed-in identity. A walk over text nodes rather than a
  // selector: it survives every re-layout of the rail and the topbar.
  await page.evaluate(({ rules }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const patterns = rules.map(([source, flags, to]) => [new RegExp(source, flags), to]);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const [from, to] of patterns) {
        if (from.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(from, to);
      }
    }

  }, {
    rules: DRESSING.map(([from, to]) => [from.source, from.flags, to]),
  });

  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  await context.close();

  console.log(`  ✓ public/shots/${shot.name}.png`);
}

await browser.close();

// A note beside the files, because a PNG cannot say where it came from.
await writeFile(
  path.join(OUT, "README.md"),
  `# Console screenshots

Generated — do not edit by hand, and do not retouch. Re-run \`npm run shots\`
after any change to the console's look, or the marketing site starts showing a
product that no longer exists.

Captured at ${VIEWPORT.width}×${VIEWPORT.height} at 2x, with motion reduced so
entrances are settled and the signed-in account's email dressed over. The
figures in them are one real shop's own rows.

${SHOTS.map((shot) => `- \`${shot.name}.png\` — \`${shot.path}\`${shot.theme === "dark" ? " (dark)" : ""}`).join("\n")}
`,
  "utf8",
);

console.log("\n  Done. The hero picks these up automatically.\n");
