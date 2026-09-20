/**
 * A demo shop, for the marketing site's screenshots.
 *
 *   npm run demo:shop           # create or refresh it
 *   npm run demo:shop -- --drop # remove it entirely
 *
 * Why this exists
 * ---------------
 * `npm run shots` photographs the real console, which is the only way a
 * landing page stays honest about the product. But it photographs whatever the
 * signed-in account happens to have, and a development account has one item
 * called "Test Product" and three sales. The choice is between a screenshot
 * that lies about the software and one that lies about the shop, and the second
 * is the only one a customer can check: every pixel below comes out of the real
 * schema, through the real readers, drawn by the real screens. Only the rows
 * are made up, and they are made up the way a Lahore kiryana's rows actually
 * look.
 *
 * Everything lands under one tenant, so `--drop` is a single delete that
 * cascades. Nothing here touches the shop you are working in.
 *
 * Deliberately NOT a migration. Migrations are the schema every real shop
 * inherits, and a demo kiryana is not part of anybody's schema.
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Values may come from the real environment instead.
}

const DROP = process.argv.includes("--drop");

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  die("Missing Supabase env. Run `npm run doctor` first — it names what is absent.");
}

const db = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ------------------------------------------------------------------ shop -- */

/**
 * Fixed ids, so re-running replaces rather than accumulates, and so the shots
 * script can find the shop without guessing at a name.
 */
const TENANT = "d1e70000-0000-4000-8000-000000000001";
const BRANCH = "d1e70000-0000-4000-8000-000000000002";
const COUNTER_FRONT = "d1e70000-0000-4000-8000-000000000003";
const COUNTER_BACK = "d1e70000-0000-4000-8000-000000000004";

const SHOP = {
  shop_name: "Al-Madina Kiryana Store",
  owner_name: "Bilal Ahmed",
  phone: "+92 300 842 1176",
  email: "owner@almadina.flopos.pk",
  city: "Lahore",
  shop_type: "kiryana",
};

/** The demo staff. Passwords are printed at the end, not stored here. */
const PEOPLE = [
  { key: "owner", email: "owner@almadina.flopos.pk", name: "Bilal Ahmed", role: "owner", counter: null },
  { key: "manager", email: "hamza@almadina.flopos.pk", name: "Hamza Raza", role: "manager", counter: COUNTER_BACK },
  { key: "cashier", email: "ayesha@almadina.flopos.pk", name: "Ayesha Siddiqui", role: "cashier", counter: COUNTER_FRONT },
];

const PASSWORD = "flo-demo-shop-2026";

/* ----------------------------------------------------------------- stock -- */

/**
 * A general store's tree as a general store keeps it: aisles, then shelves.
 * Two levels, because that is all `0016` allows and all anybody browses.
 */
const TREE = {
  "Grocery": ["Atta & Rice", "Daal & Pulses", "Cooking Oil & Ghee", "Sugar & Salt", "Masala"],
  "Beverages": ["Tea & Coffee", "Soft Drinks", "Juices & Water"],
  "Dairy & Bakery": ["Milk & Dahi", "Bread & Rusk", "Eggs"],
  "Snacks & Confectionery": ["Biscuits", "Chips & Namkeen", "Chocolate & Toffee"],
  "Household": ["Detergent & Soap", "Cleaning", "Paper & Foil"],
  "Personal Care": ["Hair & Skin", "Oral Care"],
};

/**
 * The list. Cost and price are both real, because the dashboard's profit and
 * margin come off `cost_price` and a catalog with no costs in it photographs as
 * a shop making 100 per cent on everything.
 *
 * [name, urdu, department, category, unit, cost, price, stock, lowAt, supplier, taxRate, barcode]
 */
const ITEMS = [
  ["Sunridge Chakki Atta 10 kg", "سن رج آٹا ۱۰ کلو", "Grocery", "Atta & Rice", "packet", 1180, 1320, 46, 12, "Sunridge", 0, "8964000418109"],
  ["Bake Parlor Maida 1 kg", "میدہ ۱ کلو", "Grocery", "Atta & Rice", "packet", 150, 180, 38, 10, "Bake Parlor", 0, "8964000201013"],
  ["Basmati Super Kernel — loose", "باسمتی سپر کرنل", "Grocery", "Atta & Rice", "kg", 290, 345, 118.5, 25, "Ravi Traders", 0, null],
  ["Sella Rice — loose", "سیلا چاول", "Grocery", "Atta & Rice", "kg", 215, 260, 74.25, 20, "Ravi Traders", 0, null],
  ["Chana Daal — loose", "چنے کی دال", "Grocery", "Daal & Pulses", "kg", 235, 290, 41.5, 15, "Shalimar Pulses", 0, null],
  ["Masoor Daal — loose", "مسور کی دال", "Grocery", "Daal & Pulses", "kg", 310, 375, 28.75, 15, "Shalimar Pulses", 0, null],
  ["Moong Daal — loose", "مونگ کی دال", "Grocery", "Daal & Pulses", "kg", 320, 390, 9.5, 15, "Shalimar Pulses", 0, null],
  ["White Chana — loose", "سفید چنا", "Grocery", "Daal & Pulses", "kg", 340, 410, 33, 12, "Shalimar Pulses", 0, null],
  ["Dalda Cooking Oil 5 L", "ڈالڈا کوکنگ آئل", "Grocery", "Cooking Oil & Ghee", "carton", 4450, 4890, 17, 6, "Dalda", 18, "8964000114001"],
  ["Habib Sunflower Oil 1 L", "حبیب سن فلاور آئل", "Grocery", "Cooking Oil & Ghee", "piece", 560, 640, 54, 15, "Habib Oil Mills", 18, "8964000322017"],
  ["Dalda Banaspati Ghee 1 kg", "ڈالڈا بناسپتی گھی", "Grocery", "Cooking Oil & Ghee", "packet", 640, 720, 31, 10, "Dalda", 18, "8964000114018"],
  ["Refined Sugar — loose", "چینی", "Grocery", "Sugar & Salt", "kg", 168, 195, 212, 40, "Ittefaq Sugar", 0, null],
  ["National Iodised Salt 800 g", "نیشنل نمک", "Grocery", "Sugar & Salt", "packet", 52, 70, 66, 20, "National Foods", 0, "8964000031020"],
  ["National Red Chilli 200 g", "لال مرچ", "Grocery", "Masala", "packet", 210, 265, 42, 12, "National Foods", 18, "8964000031501"],
  ["Shan Biryani Masala 50 g", "شان بریانی مصالحہ", "Grocery", "Masala", "packet", 85, 110, 88, 24, "Shan Foods", 18, "8964000253021"],
  ["Shan Karahi Masala 50 g", "شان کڑاہی مصالحہ", "Grocery", "Masala", "packet", 85, 110, 61, 24, "Shan Foods", 18, "8964000253038"],
  ["National Haldi 200 g", "ہلدی", "Grocery", "Masala", "packet", 165, 210, 37, 12, "National Foods", 18, "8964000031518"],

  ["Tapal Danedar 475 g", "تپال دانے دار", "Beverages", "Tea & Coffee", "packet", 1050, 1180, 44, 12, "Tapal", 18, "8964000064016"],
  ["Lipton Yellow Label 190 g", "لپٹن چائے", "Beverages", "Tea & Coffee", "packet", 430, 495, 29, 10, "Unilever", 18, "8964000077016"],
  ["Nescafé Classic 50 g", "نیسکیفے", "Beverages", "Tea & Coffee", "packet", 690, 790, 14, 8, "Nestlé", 18, "8964000091012"],
  ["Coca-Cola 1.5 L", "کوکا کولا", "Beverages", "Soft Drinks", "piece", 155, 190, 96, 24, "Coca-Cola Icecek", 18, "8964000012017"],
  ["Pepsi 1.5 L", "پیپسی", "Beverages", "Soft Drinks", "piece", 152, 190, 78, 24, "Pepsi-Cola Intl", 18, "8964000013014"],
  ["Sprite 500 ml", "سپرائٹ", "Beverages", "Soft Drinks", "piece", 62, 80, 120, 30, "Coca-Cola Icecek", 18, "8964000012024"],
  ["Nestlé Fruita Vitals Mango 1 L", "فروٹا وائٹلز آم", "Beverages", "Juices & Water", "piece", 265, 320, 36, 12, "Nestlé", 18, "8964000091029"],
  ["Nestlé Pure Life 1.5 L", "نیسلے واٹر", "Beverages", "Juices & Water", "piece", 75, 95, 144, 36, "Nestlé", 0, "8964000091036"],

  ["Olpers Milk 1 L", "اولپرز دودھ", "Dairy & Bakery", "Milk & Dahi", "piece", 245, 285, 62, 24, "Engro Foods", 0, "8964000141014"],
  ["Nurpur Butter 200 g", "نور پور مکھن", "Dairy & Bakery", "Milk & Dahi", "packet", 470, 550, 11, 8, "Fauji Foods", 18, "8964000152010"],
  ["Dahi — loose", "دہی", "Dairy & Bakery", "Milk & Dahi", "kg", 180, 240, 12.5, 6, "Local dairy", 0, null],
  ["Dawn Milky Bread", "ڈان بریڈ", "Dairy & Bakery", "Bread & Rusk", "piece", 130, 160, 23, 10, "Dawn Bread", 0, "8964000180013"],
  ["Bake Parlor Rusk 350 g", "رسک", "Dairy & Bakery", "Bread & Rusk", "packet", 195, 240, 19, 8, "Bake Parlor", 18, "8964000201020"],
  ["Farm Eggs — dozen", "انڈے درجن", "Dairy & Bakery", "Eggs", "dozen", 330, 390, 26, 10, "Big Bird", 0, null],

  ["Sooper Biscuit — family pack", "سوپر بسکٹ", "Snacks & Confectionery", "Biscuits", "packet", 145, 180, 72, 24, "EBM", 18, "8964000021016"],
  ["Gala Biscuit — family pack", "گالا بسکٹ", "Snacks & Confectionery", "Biscuits", "packet", 140, 175, 58, 24, "Bisconni", 18, "8964000024017"],
  ["Prince Chocolate Roll", "پرنس رول", "Snacks & Confectionery", "Biscuits", "piece", 38, 50, 210, 48, "LU", 18, "8964000027018"],
  ["Lays Masala 62 g", "لیز مصالحہ", "Snacks & Confectionery", "Chips & Namkeen", "packet", 78, 100, 134, 36, "PepsiCo", 18, "8964000035011"],
  ["Kurkure Chutney Chaska", "کرکرے", "Snacks & Confectionery", "Chips & Namkeen", "packet", 38, 50, 168, 48, "PepsiCo", 18, "8964000035028"],
  ["Slanty Salted 35 g", "سلانٹی", "Snacks & Confectionery", "Chips & Namkeen", "packet", 22, 30, 190, 60, "Kolson", 18, "8964000041012"],
  ["Dairy Milk 36 g", "ڈیری ملک", "Snacks & Confectionery", "Chocolate & Toffee", "piece", 145, 180, 64, 24, "Cadbury", 18, "8964000052018"],
  ["Sonnet Toffee — loose", "ٹافی", "Snacks & Confectionery", "Chocolate & Toffee", "kg", 620, 780, 6.75, 8, "Hilal", 18, null],

  ["Surf Excel 1 kg", "سرف ایکسل", "Household", "Detergent & Soap", "packet", 690, 790, 41, 12, "Unilever", 18, "8964000077023"],
  ["Ariel 1 kg", "ایریل", "Household", "Detergent & Soap", "packet", 720, 830, 27, 12, "P&G", 18, "8964000088019"],
  ["Lifebuoy Soap 130 g", "لائف بوائے صابن", "Household", "Detergent & Soap", "piece", 110, 140, 96, 30, "Unilever", 18, "8964000077030"],
  ["Bonus Dishwash Bar", "برتن دھونے کا صابن", "Household", "Cleaning", "piece", 48, 65, 112, 36, "Unilever", 18, "8964000077047"],
  ["Harpic 500 ml", "ہارپک", "Household", "Cleaning", "piece", 340, 410, 22, 10, "Reckitt", 18, "8964000099015"],
  ["Rose Petal Tissue Box", "ٹشو باکس", "Household", "Paper & Foil", "piece", 195, 250, 33, 12, "Rose Petal", 18, "8964000110017"],
  ["Aluminium Foil 9 m", "ایلومینیم فوائل", "Household", "Paper & Foil", "piece", 260, 330, 8, 10, "Rose Petal", 18, "8964000110024"],

  ["Sunsilk Shampoo 185 ml", "سن سلک شیمپو", "Personal Care", "Hair & Skin", "piece", 420, 500, 24, 10, "Unilever", 18, "8964000077054"],
  ["Fair & Lovely 50 g", "کریم", "Personal Care", "Hair & Skin", "piece", 310, 380, 18, 8, "Unilever", 18, "8964000077061"],
  ["Dabur Amla Hair Oil 200 ml", "املہ تیل", "Personal Care", "Hair & Skin", "piece", 480, 570, 13, 8, "Dabur", 18, "8964000121013"],
  ["Colgate Toothpaste 145 g", "کولگیٹ", "Personal Care", "Oral Care", "piece", 330, 400, 29, 12, "Colgate", 18, "8964000132019"],
  ["Medicam Toothpaste 70 g", "میڈی کیم", "Personal Care", "Oral Care", "piece", 120, 155, 36, 12, "Medicam", 18, "8964000132026"],
  ["Oral-B Toothbrush", "برش", "Personal Care", "Oral Care", "piece", 130, 170, 44, 15, "P&G", 18, "8964000088026"],
];

/** Two seasonal lines switched off, so the list shows what "off" looks like. */
const RETIRED = new Set(["Sonnet Toffee — loose", "Aluminium Foil 9 m"]);

/* ------------------------------------------------------------- customers -- */

const CUSTOMERS = [
  ["Shoaib Anwar", "+923008421176", "House 14, Street 7, Johar Town", "Buys the month's atta and oil on the 1st."],
  ["Rabia Aslam", "+923214559032", "Flat 3B, Askari 10", "Wants Olpers, never Nurpur."],
  ["Hafiz Abdullah", "+923334417720", "Masjid-e-Noor, Model Town Link Road", "Orders for the masjid — daal and rice in bulk."],
  ["Saima Malik", "+923005512340", "23-C, Gulberg III", null],
  ["Usman Ghani", "+923217788901", "Shop 4, Ichhra Bazaar", "Re-sells; give the carton rate."],
  ["Rehana Bibi", "+923451123409", "Street 2, Samanabad", null],
  ["Kashif Mehmood", "+923009988776", "House 88, Wapda Town", "Pays by card, always."],
  ["Nadia Iqbal", "+923331200456", "Phase 5, DHA", null],
  ["Imran Shah", "+923004455667", "Shadman Market", "Runs the tea stall at the corner."],
  ["Farhan Qureshi", "+923217654321", "12-A, Faisal Town", null],
  ["Tahira Anwar", "+923001122334", "Street 9, Garden Town", "Eid week — order mithai boxes in advance."],
  ["Zubair Hussain", "+923336677889", "House 5, Township", null],
  ["Sana Javed", "+923452233445", "Block C, Johar Town", null],
  ["Abdul Rehman", "+923008877665", "Chungi Amar Sidhu", "Wholesale rate agreed on daal."],
  ["Maryam Noor", "+923215544332", "Lake City", null],
  ["Shahid Nazir", "+923339900112", "Green Town", null],
  ["Hina Aslam", "+923006677445", "Allama Iqbal Town", null],
  ["Waqar Younis", "+923214433221", "Muslim Town", "Wants the bill on WhatsApp."],
  ["Bushra Khan", "+923337788556", "Cavalry Ground", null],
  ["Adnan Tariq", "+923002211998", "Bahria Town, Sector C", null],
];

/* ----------------------------------------------------------------- dates -- */

/** How many trading days of history the shop has. */
const DAYS = 45;

const dayString = (date) => date.toISOString().slice(0, 10);

const shiftDays = (date, by) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + by);
  return next;
};

/**
 * A repeatable shuffle. The demo shop must photograph the same way twice, or
 * two shots taken a week apart show two different businesses.
 */
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry(20260919);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (low, high) => low + random() * (high - low);
const round2 = (value) => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ drop -- */

async function drop() {
  // `profiles` cascades from `auth.users`, and everything else cascades from
  // the tenant — so the people go first and the shop takes the rest with it.
  for (const person of PEOPLE) {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = data?.users?.find((user) => user.email === person.email);
    if (found) await db.auth.admin.deleteUser(found.id);
  }

  const { error } = await db.from("tenants").delete().eq("id", TENANT);
  if (error) die(`Could not remove the demo shop — ${error.message}`);

  console.log("\n  Demo shop removed.\n");
}

/* ------------------------------------------------------------------ seed -- */

async function upsert(table, rows, onConflict) {
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) die(`${table}: ${error.message}`);
}

async function insert(table, rows) {
  // Chunked, because a month of a busy kiryana is a few thousand sale lines and
  // one request with all of them in it is a request that times out.
  for (let at = 0; at < rows.length; at += 500) {
    const { error } = await db.from(table).insert(rows.slice(at, at + 500));
    if (error) die(`${table}: ${error.message}`);
  }
}

async function seed() {
  console.log(`\n  Building ${SHOP.shop_name}…`);

  /* -- people. The owner has to exist before the tenant names them. -------- */

  const { data: existing } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const ids = {};

  for (const person of PEOPLE) {
    const found = existing?.users?.find((user) => user.email === person.email);

    if (found) {
      ids[person.key] = found.id;
      await db.auth.admin.updateUserById(found.id, { password: PASSWORD });
      continue;
    }

    const { data, error } = await db.auth.admin.createUser({
      email: person.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: person.name },
    });

    if (error || !data?.user) die(`Could not create ${person.email} — ${error?.message}`);
    ids[person.key] = data.user.id;
  }

  /* -- the shop ----------------------------------------------------------- */

  await upsert("tenants", [{ id: TENANT, ...SHOP, created_by: ids.owner }], "id");

  await upsert(
    "branches",
    [{
      id: BRANCH,
      tenant_id: TENANT,
      name: "Johar Town",
      city: "Lahore",
      address: "Shop 12, Main Boulevard, Johar Town, Lahore",
      phone: SHOP.phone,
      is_primary: true,
    }],
    "id",
  );

  await upsert(
    "counters",
    [
      {
        id: COUNTER_FRONT,
        tenant_id: TENANT,
        branch_id: BRANCH,
        name: "Front counter",
        receipt_prefix: "ALM",
        is_active: true,
        accepts_cash: true,
        accepts_card: true,
        receipt_footer: "Shukriya! Exchange within 3 days with this receipt.",
        auto_print: true,
        sort_order: 1,
      },
      {
        id: COUNTER_BACK,
        tenant_id: TENANT,
        branch_id: BRANCH,
        name: "Back counter",
        receipt_prefix: "ALM2",
        is_active: true,
        accepts_cash: true,
        accepts_card: false,
        receipt_footer: "Shukriya! Exchange within 3 days with this receipt.",
        auto_print: true,
        sort_order: 2,
      },
    ],
    "id",
  );

  await upsert(
    "tenant_settings",
    [{
      tenant_id: TENANT,
      currency: "PKR",
      currency_format: "rs-prefix",
      timezone: "Asia/Karachi",
      // A kiryana that pulls the shutter down at half eleven wants the last
      // half hour on the day it opened.
      day_ends_at: "01:00",
      week_starts_on: "monday",
      fiscal_year_starts: "07-01",
    }],
    "tenant_id",
  );

  await upsert(
    "role_permissions",
    [
      {
        tenant_id: TENANT,
        access_level: "cashier",
        can_discount: true,
        discount_ceiling_pct: 5,
        can_manage_customers: true,
        can_refund: false,
        can_open_drawer: false,
        can_close_shift: false,
        can_edit_items: false,
        can_change_price: false,
        can_view_reports: false,
      },
      {
        tenant_id: TENANT,
        access_level: "manager",
        can_discount: true,
        discount_ceiling_pct: 15,
        can_manage_customers: true,
        can_refund: true,
        can_open_drawer: true,
        can_close_shift: true,
        can_edit_items: true,
        can_change_price: false,
        can_view_reports: true,
      },
    ],
    "tenant_id,access_level",
  );

  const { data: plan } = await db
    .from("plans")
    .select("id, list_price")
    .eq("code", "premium")
    .maybeSingle();

  if (plan) {
    const { data: already } = await db
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", TENANT)
      .maybeSingle();

    const row = {
      tenant_id: TENANT,
      plan_id: plan.id,
      status: "active",
      billing_cycle: "monthly",
      agreed_price: plan.list_price,
      max_branches: 1,
      max_registers: 4,
      current_period_start: new Date().toISOString(),
      current_period_end: shiftDays(new Date(), 22).toISOString(),
    };

    const { error } = already
      ? await db.from("subscriptions").update(row).eq("id", already.id)
      : await db.from("subscriptions").insert(row);

    if (error) die(`subscriptions: ${error.message}`);
  }

  await upsert(
    "profiles",
    PEOPLE.map((person) => ({
      id: ids[person.key],
      tenant_id: TENANT,
      branch_id: BRANCH,
      tenant_role: person.role,
      full_name: person.name,
      email: person.email,
      phone: SHOP.phone,
      is_active: true,
      counter_id: person.counter,
    })),
    "id",
  );

  /* -- the tree ----------------------------------------------------------- */

  await db.from("departments").delete().eq("tenant_id", TENANT);

  const departments = Object.keys(TREE).map((name, index) => ({
    tenant_id: TENANT,
    name,
    sort_order: index + 1,
  }));

  const { data: saved, error: treeError } = await db
    .from("departments")
    .insert(departments)
    .select("id, name");

  if (treeError) die(`departments: ${treeError.message}`);

  await insert(
    "categories",
    saved.flatMap((department) =>
      TREE[department.name].map((name, index) => ({
        tenant_id: TENANT,
        department_id: department.id,
        name,
        sort_order: index + 1,
      })),
    ),
  );

  /* -- the catalog -------------------------------------------------------- */

  await db.from("items").delete().eq("tenant_id", TENANT);

  /* -- the suppliers ------------------------------------------------------
     Rows since 0027, not a text column on the item. Seeded off the distinct
     names in ITEMS so the two cannot drift: adding a distributor to a row up
     there is the whole of adding one to the shop. Folded the way
     `suppliers_tenant_name_idx` folds, so a stray double space in the table
     does not become a second party. */

  await db.from("suppliers").delete().eq("tenant_id", TENANT);

  const fold = (value) => value.trim().replace(/\s+/g, " ");

  const supplierNames = [
    ...new Map(
      ITEMS.map((row) => fold(row[9] ?? ""))
        .filter((name) => name.length >= 2 && name.length <= 80)
        .map((name) => [name.toLowerCase(), name]),
    ).values(),
  ];

  const { data: suppliers, error: supplierError } = await db
    .from("suppliers")
    .insert(
      supplierNames.map((name) => ({ tenant_id: TENANT, name, is_active: true })),
    )
    .select("id, name");

  if (supplierError) die(`suppliers: ${supplierError.message}`);

  const supplierId = new Map(
    (suppliers ?? []).map((row) => [fold(row.name).toLowerCase(), row.id]),
  );

  const terms = ({ name, urdu, sku, barcode }) => [
    ...new Set(
      [name, urdu ?? "", sku ?? "", barcode ?? "", ...name.split(/\s+/)]
        .map((part) => part.trim())
        .filter((part) => part.length > 1)
        .map((part) => (/[a-z0-9]/i.test(part) ? part.toLowerCase() : part)),
    ),
  ];

  const itemRows = ITEMS.map((row, index) => {
    const [name, urdu, department, category, unit, cost, price, stock, lowAt, supplier, taxRate, barcode] = row;
    const sku = `ALM-${String(index + 1).padStart(4, "0")}`;

    return {
      tenant_id: TENANT,
      sku,
      name,
      name_urdu: urdu,
      search_terms: terms({ name, urdu, sku, barcode }),
      unit,
      tracking: unit === "kg" || unit === "gram" || unit === "litre" ? "weight" : "unit",
      department,
      category,
      cost_price: cost,
      selling_price: price,
      tax_rate: taxRate,
      stock,
      low_at: lowAt,
      supplier_id: supplierId.get(fold(supplier ?? "").toLowerCase()) ?? null,
      barcode,
      is_active: !RETIRED.has(name),
    };
  });

  const { data: items, error: itemError } = await db
    .from("items")
    .insert(itemRows)
    .select("id, name, unit, selling_price, cost_price, is_active");

  if (itemError) die(`items: ${itemError.message}`);

  /* -- customers ---------------------------------------------------------- */

  await db.from("customers").delete().eq("tenant_id", TENANT);

  const { data: customers, error: customerError } = await db
    .from("customers")
    .insert(
      CUSTOMERS.map(([name, phone, address, notes]) => ({
        tenant_id: TENANT,
        name,
        phone,
        address,
        notes,
        is_active: true,
      })),
    )
    .select("id");

  if (customerError) die(`customers: ${customerError.message}`);

  /* -- the trading history ------------------------------------------------ */

  await db.from("sales").delete().eq("tenant_id", TENANT);

  const sellable = items.filter((item) => item.is_active);
  const today = new Date(`${dayString(new Date())}T00:00:00Z`);

  const sales = [];
  const lines = [];
  const tenders = [];
  const serials = { [COUNTER_FRONT]: { day: null, at: 0 }, [COUNTER_BACK]: { day: null, at: 0 } };

  for (let back = DAYS - 1; back >= 0; back -= 1) {
    const date = shiftDays(today, -back);
    const businessDay = dayString(date);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;

    // A general store's week: heavier at the weekend, and busier as the month
    // turns, when salaries land and the month's atta gets bought.
    const turn = date.getUTCDate() <= 5 ? 1.35 : 1;
    const bills = Math.round(between(52, 78) * (weekend ? 1.25 : 1) * turn);

    for (let n = 0; n < bills; n += 1) {
      const counterId = random() < 0.62 ? COUNTER_FRONT : COUNTER_BACK;
      const counter = serials[counterId];

      if (counter.day !== businessDay) {
        counter.day = businessDay;
        counter.at = 0;
      }
      counter.at += 1;

      const prefix = counterId === COUNTER_FRONT ? "ALM" : "ALM2";
      const stamp = businessDay.slice(2).replace(/-/g, "");
      const receipt = `${prefix}-${stamp}-${String(counter.at).padStart(4, "0")}`;

      // Bills cluster around the evening rush, which is what the hour-by-hour
      // shape of the chart is made of.
      const hour = random() < 0.55 ? Math.floor(between(17, 22)) : Math.floor(between(9, 17));
      const at = new Date(`${businessDay}T00:00:00Z`);
      at.setUTCHours(hour - 5, Math.floor(between(0, 60)), Math.floor(between(0, 60)));

      const saleId = crypto.randomUUID();
      // A kiryana basket is two or three things, not a supermarket trolley.
      const howMany = Math.max(1, Math.round(between(0.6, 4.4)));
      const chosen = new Map();

      for (let l = 0; l < howMany; l += 1) {
        const item = pick(sellable);
        if (chosen.has(item.id)) continue;

        const fractional = item.unit === "kg" || item.unit === "litre" || item.unit === "gram";
        const quantity = fractional
          ? Math.max(0.25, Math.round(between(0.25, 2) * 4) / 4)
          : random() < 0.78
            ? 1
            : Math.max(2, Math.round(between(2, 3.4)));

        chosen.set(item.id, { item, quantity });
      }

      let subtotal = 0;

      for (const { item, quantity } of chosen.values()) {
        const price = Number(item.selling_price);
        const total = round2(price * quantity);
        subtotal += total;

        lines.push({
          tenant_id: TENANT,
          sale_id: saleId,
          item_id: item.id,
          name_snapshot: item.name,
          unit: item.unit,
          quantity,
          unit_price: price,
          discount: 0,
          line_total: total,
          cost_snapshot: Number(item.cost_price),
        });
      }

      subtotal = round2(subtotal);

      // Most bills in most shops are a walk-in. The regulars are the minority
      // that makes the customer screen worth opening.
      const customer = random() < 0.28 ? pick(customers).id : null;
      // Card only at the front counter, which is the one that takes it.
      const method = counterId === COUNTER_FRONT && random() < 0.22 ? "card" : "cash";

      sales.push({
        id: saleId,
        tenant_id: TENANT,
        branch_id: BRANCH,
        counter_id: counterId,
        customer_id: customer,
        receipt_number: receipt,
        business_day: businessDay,
        status: "completed",
        subtotal,
        discount_total: 0,
        total: subtotal,
        created_by: counterId === COUNTER_FRONT ? ids.cashier : ids.manager,
        created_at: at.toISOString(),
      });

      tenders.push({ tenant_id: TENANT, sale_id: saleId, method, amount: subtotal });
    }
  }

  await insert("sales", sales);
  await insert("sale_lines", lines);
  await insert("sale_tenders", tenders);

  // The counters carry where their series got to, so the next real sale on this
  // shop continues the numbering rather than starting the day again.
  for (const [counterId, counter] of Object.entries(serials)) {
    await db
      .from("counters")
      .update({ receipt_day: counter.day, receipt_serial: counter.at })
      .eq("id", counterId);
  }

  const takings = sales.reduce((sum, sale) => sum + sale.total, 0);

  console.log(`
  ✓ ${items.length} items across ${saved.length} departments
  ✓ ${customers.length} customers
  ✓ ${sales.length} sales over ${DAYS} trading days — Rs ${Math.round(takings).toLocaleString("en-PK")}

  Sign in as  ${PEOPLE[0].email}
  Password    ${PASSWORD}

  Photograph it:  npm run shots -- ${PEOPLE[0].email}
  Remove it:      npm run demo:shop -- --drop
`);
}

await (DROP ? drop() : seed());
