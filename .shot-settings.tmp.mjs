/**
 * Scratch: screenshot /app/settings with a dropdown open, light and dark.
 * Sign-in flow lifted from scripts/shots.mjs.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

process.loadEnvFile(".env.local");

const BASE = "http://localhost:3000";
const EMAIL = process.env.SHOTS_EMAIL ?? process.env.ADMIN_EMAIL ?? process.argv[2];
const OUT = process.argv[3];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (linkError) throw linkError;

const redeemer = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: verified, error: verifyError } = await redeemer.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (verifyError) throw verifyError;

const jar = [];
const recorder = createServerClient(url, publishableKey, {
  cookies: { getAll: () => [], setAll: (c) => jar.push(...c) },
});
await recorder.auth.setSession({
  access_token: verified.session.access_token,
  refresh_token: verified.session.refresh_token,
});

const claims = JSON.parse(
  Buffer.from(verified.session.access_token.split(".")[1], "base64").toString(),
);
console.log("tenant_id:", claims.tenant_id, "tenant_role:", claims.tenant_role);

const { hostname } = new URL(BASE);
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: theme,
  });

  await context.addCookies([
    ...jar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    })),
    { name: "flo_theme", value: theme, domain: hostname, path: "/" },
    { name: "flo_rail", value: "0", domain: hostname, path: "/" },
  ]);

  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  [${theme}] page error:`, e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [${theme}] console:`, m.text());
  });

  await page.goto(`${BASE}/app/settings`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) throw new Error("bounced to /login");

  await page.waitForSelector("main");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal{display:none}" });

  await page.screenshot({ path: path.join(OUT, `settings-${theme}.png`), fullPage: true });

  // Open the "Written as" dropdown — the one with per-option captions.
  const triggers = page.locator(".pos-select");
  console.log(`  [${theme}] dropdowns on the store tab:`, await triggers.count());
  await triggers.nth(2).click();
  await page.waitForSelector('[role="listbox"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `settings-open-${theme}.png`) });

  // Keyboard: arrow down twice then Enter should land on the third option.
  await page.keyboard.press("Escape");
  await triggers.nth(3).focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForSelector('[role="listbox"]');
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const picked = await triggers.nth(3).innerText();
  console.log(`  [${theme}] after ArrowDown x2 + Enter:`, JSON.stringify(picked));
  console.log(
    `  [${theme}] hidden input value:`,
    await page.locator('input[name="currency_format"]').inputValue(),
  );

  // The roles tab.
  await page.goto(`${BASE}/app/settings?tab=roles`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal{display:none}" });
  await page.screenshot({ path: path.join(OUT, `settings-roles-${theme}.png`), fullPage: true });

  await context.close();
}

await browser.close();
console.log("done ->", OUT);
