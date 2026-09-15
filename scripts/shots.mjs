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
const EMAIL = process.env.SHOTS_EMAIL ?? process.env.ADMIN_EMAIL ?? process.argv[2];
const OUT = path.join(process.cwd(), "public", "shots");

// What the counter is called in the picture. The console dresses itself from
// constants today, so the name is only ever cosmetic — but the email is a real
// person's and must never reach a landing page.
const SHOP = "Khurram Cloth House";

const DRESSING = [
  [/tahakhurramofficial@gmail\.com/gi, "owner@khurramcloth.pk"],
  [/\bYour shop\b/g, SHOP],
];

/** 2x so the hero stays crisp on a retina panel; Next resizes down from here. */
const VIEWPORT = { width: 1280, height: 820 };

const SHOTS = [
  { name: "dashboard-dark", theme: "dark" },
  { name: "dashboard-light", theme: "light" },
];

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

if (!EMAIL) {
  die(
    "No account to sign in as.\n" +
      "  Pass one:  npm run shots -- you@example.com\n" +
      "  Or set SHOTS_EMAIL in .env.local.",
  );
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
  ]);

  const page = await context.newPage();
  await page.goto(`${BASE}/app?range=7d`, { waitUntil: "networkidle" });

  if (page.url().includes("/login")) {
    die("Landed back on /login — the session cookies were rejected.");
  }

  await page.waitForSelector("main");
  await page.evaluate(() => document.fonts.ready);

  // `next dev` paints a floating badge over the bottom-right corner, and it
  // photographs. Hidden here rather than through `devIndicators: false`, which
  // would take it away while actually working too.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important }" });

  // Dress over the signed-in identity. A walk over text nodes rather than a
  // selector: it survives every re-layout of the rail and the topbar.
  await page.evaluate(({ rules, initial }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const patterns = rules.map(([source, flags, to]) => [new RegExp(source, flags), to]);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const [from, to] of patterns) {
        if (from.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(from, to);
      }
    }

    // The avatars hold one letter taken from the shop's name, which the walk
    // above has just changed underneath them.
    for (const stamp of document.querySelectorAll(".pos-stamp")) {
      stamp.textContent = initial;
    }
  }, {
    rules: DRESSING.map(([from, to]) => [from.source, from.flags, to]),
    initial: SHOP.charAt(0).toUpperCase(),
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

Captured at ${VIEWPORT.width}×${VIEWPORT.height} at 2x from \`/app?range=7d\`,
with motion reduced so entrances are settled and the signed-in account's email
dressed over. The figures in them are the dashboard's own sample data.
`,
  "utf8",
);

console.log("\n  Done. The hero picks these up automatically.\n");
