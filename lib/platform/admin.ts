/**
 * The owner console's vocabulary, and the arithmetic behind every figure on it.
 *
 * No `server-only`, for the reason `lib/pos/catalog.ts` carries none: the
 * activation form and the plan editor are client components, and the Server
 * Actions behind them have to validate against exactly the same lists. One
 * list, read from both sides — a status the form offers and the action refuses
 * is a deal somebody closed on WhatsApp and cannot record.
 *
 * Every id below is also a check constraint in `0001_init.sql`, so a value that
 * slips past this file still cannot reach the table.
 *
 * The readers live in `lib/platform/console.ts` (`server-only`), and the gate in
 * `lib/platform/access.ts`. The same split as `history.ts`/`bills.ts`.
 */

import { monthlyEquivalent } from "@/lib/format";

export type Option<T extends string> = {
  id: T;
  label: string;
  description?: string;
};

/* -------------------------------------------------------------------------- */
/* Where a shop stands with us                                                */
/* -------------------------------------------------------------------------- */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

export type StatusTone = "good" | "info" | "warn" | "bad";

/**
 * The lifecycle, in the order it is usually walked.
 *
 * `operable` is the whole of what "disabled" means in Flo, and it is worth
 * being precise about it: a suspended shop can still sign in, still read its
 * own sales, still close its drawer and still export everything it has. What
 * it cannot do is ring up a new sale. Holding a shop's own books hostage over
 * an unpaid invoice is indecent, it is the fastest way to earn a bad name in a
 * bazaar, and in a dispute about their records it is the weaker position to be
 * standing in.
 *
 * `past_due` is deliberately still operable. The invoice is late, the till goes
 * on working, and the shopkeeper gets a nudge rather than a shut counter —
 * suspension is a decision somebody takes, not a date that arrives.
 */
export const SUB_STATUSES = [
  {
    id: "trialing",
    label: "Trial",
    description: "Using Flo, not paying yet. The till works.",
    tone: "info",
    operable: true,
  },
  {
    id: "active",
    label: "Active",
    description: "Paid up to the end of the period.",
    tone: "good",
    operable: true,
  },
  {
    id: "past_due",
    label: "Past due",
    description: "The invoice is late. The till still works.",
    tone: "warn",
    operable: true,
  },
  {
    id: "suspended",
    label: "Suspended",
    description: "The register will not charge. Reading and export stay open.",
    tone: "bad",
    operable: false,
  },
  {
    id: "cancelled",
    label: "Cancelled",
    description: "Gone. The data stays; the till does not charge.",
    tone: "bad",
    operable: false,
  },
] as const satisfies readonly (Option<SubscriptionStatus> & {
  tone: StatusTone;
  operable: boolean;
})[];

export const statusOf = (id: string) =>
  SUB_STATUSES.find((status) => status.id === id) ?? SUB_STATUSES[1];

export const isStatus = (value: string): value is SubscriptionStatus =>
  SUB_STATUSES.some((status) => status.id === value);

/**
 * What a shop's standing is, including having no subscription at all.
 *
 * `platform_clients()` left-joins `subscriptions`, so `status` is null for a
 * tenant whose subscription was deleted by hand. Every screen used to read that
 * as `statusOf(status ?? "active")` and draw a green **Active** badge over a
 * shop that has no plan, no price and no period — the one row in the console
 * that most needs looking at, painted as the one that needs nothing. It is a
 * real state and it gets drawn as one.
 *
 * `operable` is false for it, which is also the truth: `getEntitlements`
 * returns null with no subscription row, so the till refuses the sale.
 */
export const NO_SUBSCRIPTION = {
  id: "none",
  label: "No subscription",
  description: "No plan behind this shop. The till will not charge.",
  tone: "bad",
  operable: false,
} as const satisfies Option<"none"> & { tone: StatusTone; operable: boolean };

export const standingOf = (status: SubscriptionStatus | null) =>
  status === null
    ? NO_SUBSCRIPTION
    : (SUB_STATUSES.find((entry) => entry.id === status) ?? NO_SUBSCRIPTION);

export type BillingCycle = "monthly" | "quarterly" | "yearly";

export const BILLING_CYCLES = [
  { id: "monthly", label: "Monthly", months: 1, description: "The usual" },
  { id: "quarterly", label: "Quarterly", months: 3, description: "Three months up front" },
  { id: "yearly", label: "Yearly", months: 12, description: "Twelve months up front" },
] as const satisfies readonly (Option<BillingCycle> & { months: number })[];

export const isCycle = (value: string): value is BillingCycle =>
  BILLING_CYCLES.some((cycle) => cycle.id === value);

export const cycleMonths = (cycle: string) =>
  BILLING_CYCLES.find((entry) => entry.id === cycle)?.months ?? 1;

/**
 * What a shop is worth in a month, whatever it pays in.
 *
 * `private.monthly_value` in `0036` is this same division, and the two have to
 * stay identical: the strip across the top of `/admin` is summed in Postgres
 * and the client record works its own out here, and a console whose two screens
 * disagree about revenue is a console nobody trusts with either figure.
 */
export const monthlyValue = (price: number, cycle: string) =>
  Math.round(monthlyEquivalent(price, cycle) * 100) / 100;

/* -------------------------------------------------------------------------- */
/* Money in                                                                   */
/* -------------------------------------------------------------------------- */

export type PaymentMethod =
  | "bank_transfer"
  | "easypaisa"
  | "jazzcash"
  | "cash"
  | "card"
  | "other";

export const PAYMENT_METHODS = [
  { id: "bank_transfer", label: "Bank transfer", description: "Meezan, HBL, Alfalah…" },
  { id: "easypaisa", label: "Easypaisa" },
  { id: "jazzcash", label: "JazzCash" },
  { id: "cash", label: "Cash", description: "Taken at the shop" },
  { id: "card", label: "Card" },
  { id: "other", label: "Something else" },
] as const satisfies readonly Option<PaymentMethod>[];

export const isMethod = (value: string): value is PaymentMethod =>
  PAYMENT_METHODS.some((method) => method.id === value);

export const methodLabel = (id: string) =>
  PAYMENT_METHODS.find((method) => method.id === id)?.label ?? id;

/* -------------------------------------------------------------------------- */
/* The self-serve queue                                                       */
/* -------------------------------------------------------------------------- */

export type OrderStatus =
  | "awaiting_payment"
  | "proof_submitted"
  | "verified"
  | "rejected"
  | "expired";

export const ORDER_STATUSES = [
  {
    id: "awaiting_payment",
    label: "Awaiting payment",
    tone: "info",
    description: "They have the reference. Nothing has landed.",
  },
  {
    id: "proof_submitted",
    label: "Proof sent",
    tone: "warn",
    description: "Match it against the bank statement, then verify.",
  },
  { id: "verified", label: "Verified", tone: "good", description: "Activated." },
  { id: "rejected", label: "Rejected", tone: "bad" },
  { id: "expired", label: "Expired", tone: "bad" },
] as const satisfies readonly (Option<OrderStatus> & { tone: StatusTone })[];

export const orderStatusOf = (id: string) =>
  ORDER_STATUSES.find((status) => status.id === id) ?? ORDER_STATUSES[0];

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

export const LEAD_STATUSES = [
  { id: "new", label: "New", tone: "warn" },
  { id: "contacted", label: "Called", tone: "info" },
  { id: "qualified", label: "Interested", tone: "info" },
  { id: "won", label: "Sold", tone: "good" },
  { id: "lost", label: "Lost", tone: "bad" },
] as const satisfies readonly (Option<LeadStatus> & { tone: StatusTone })[];

export const leadStatusOf = (id: string) =>
  LEAD_STATUSES.find((status) => status.id === id) ?? LEAD_STATUSES[0];

export const isLeadStatus = (value: string): value is LeadStatus =>
  LEAD_STATUSES.some((status) => status.id === value);

/* -------------------------------------------------------------------------- */
/* Who may work the console                                                   */
/* -------------------------------------------------------------------------- */

export type PlatformRole = "super_admin" | "support";

export const PLATFORM_ROLES = [
  {
    id: "super_admin",
    label: "Full access",
    description: "Activates shops, changes plans, takes money.",
  },
  {
    id: "support",
    label: "Support",
    description: "Reads everything, answers WhatsApp. Touches no billing.",
  },
] as const satisfies readonly Option<PlatformRole>[];

export const isPlatformRole = (value: string): value is PlatformRole =>
  PLATFORM_ROLES.some((role) => role.id === value);

/**
 * What a support account may not do.
 *
 * The split is money, and only money: anything that changes what a shop pays,
 * what it is entitled to, or whether it can trade. A support account exists so
 * somebody can answer a WhatsApp question at 11 pm without being able to
 * activate a free year for their cousin — so it reads every screen, writes
 * notes and works the leads list, and every action in `clients/actions.ts`,
 * `plans/actions.ts`, `orders/actions.ts` and `payments/actions.ts` checks for
 * `super_admin` itself rather than trusting the rail not to draw the button.
 */
export const canBill = (role: PlatformRole | null) => role === "super_admin";

/* -------------------------------------------------------------------------- */
/* The plan's feature list                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `plans.features`, written out so the plan editor is a form rather than a
 * JSON textarea.
 *
 * Two kinds of entry and the difference matters more than it looks. A `wired`
 * flag is one the product can be held to — it names something `/app` actually
 * does, and `0020`'s rule applies to it: flip it in the same migration that
 * lands the feature. The rest are **copy**: they describe the plan on
 * `/pricing` and nothing in the console reads them, because nothing calls
 * `hasFeature` yet. The editor says so on the screen rather than letting an
 * operator believe that unticking a box takes a screen away from a shop.
 *
 * The one ceiling that is real is `subscriptions.max_registers`, which Settings
 * enforces when a shop adds a counter — and it lives on the subscription, not
 * here, precisely so a haggled deal is a one-row update and not a release.
 */
export type FeatureKind = "wired" | "copy";

export const PLAN_FEATURES = [
  { key: "sales_history", label: "Sales history", kind: "wired" },
  { key: "receipt_reprint", label: "Reprint a receipt", kind: "wired" },
  { key: "day_close_report", label: "Day close", kind: "wired" },
  { key: "shift_close", label: "Shift close and variance", kind: "wired" },
  { key: "stock_ledger", label: "Stock ledger", kind: "wired" },
  { key: "purchase_orders", label: "Buying — orders and deliveries", kind: "wired" },
  { key: "customer_directory", label: "Customer list", kind: "wired" },
  { key: "profit_reporting", label: "Profit and margin", kind: "wired" },
  { key: "advanced_reports", label: "Reports", kind: "wired" },
  { key: "role_permissions", label: "Roles and permissions", kind: "wired" },
  { key: "staff_accounts", label: "Staff accounts", kind: "wired" },
  { key: "bulk_import", label: "CSV import", kind: "wired" },
  { key: "csv_export", label: "CSV export", kind: "wired" },
  { key: "catalog_roman_urdu_search", label: "Roman Urdu search", kind: "wired" },
  { key: "thermal_printing", label: "Thermal printing", kind: "wired" },
  { key: "whatsapp_support", label: "WhatsApp support", kind: "copy" },
  { key: "priority_support", label: "Priority support", kind: "copy" },
  { key: "staff_pins", label: "Staff PINs", kind: "copy" },
  { key: "offline_register", label: "Offline register", kind: "copy" },
  { key: "fbr_invoicing", label: "FBR digital invoicing", kind: "copy" },
  { key: "provincial_tax_filing", label: "Provincial tax filing", kind: "copy" },
  { key: "loyalty_campaigns", label: "Loyalty campaigns", kind: "copy" },
  { key: "recipe_depletion", label: "Recipe depletion", kind: "copy" },
  { key: "delivery_reconciliation", label: "Delivery reconciliation", kind: "copy" },
  { key: "central_catalog", label: "Central catalog", kind: "copy" },
  { key: "cross_branch_reports", label: "Cross-branch reports", kind: "copy" },
  { key: "multi_branch_dashboard", label: "Multi-branch dashboard", kind: "copy" },
  { key: "payroll_export", label: "Payroll export", kind: "copy" },
  { key: "api_access", label: "API access", kind: "copy" },
] as const satisfies readonly { key: string; label: string; kind: FeatureKind }[];

/** The numeric entries in the same JSON. Ceilings, not switches. */
export const PLAN_LIMITS = [
  { key: "max_branches", label: "Branches" },
  { key: "max_registers", label: "Counters" },
  { key: "max_staff_pins", label: "Staff", nullMeans: "No limit" },
] as const;

export type FeatureFlags = Record<string, unknown>;

export const flagOn = (features: FeatureFlags, key: string) => features[key] === true;

/* -------------------------------------------------------------------------- */
/* Field limits, shared by the form and the action                            */
/* -------------------------------------------------------------------------- */

export const SHOP_NAME_MAX = 80;
export const PERSON_MAX = 80;
export const CITY_MAX = 60;
export const NOTES_MAX = 600;
export const REFERENCE_MAX = 80;
/** Rs 1,000,000 a cycle. Above this is a typo, not a deal. */
export const PRICE_MAX = 1_000_000;
export const TRIAL_DAYS_MAX = 90;
export const REGISTERS_MAX = 20;
export const BRANCHES_MAX = 50;
/** A link that lives longer than a week is a link nobody has chased. */
export const INVITE_DAYS = 7;

export type ClientDraft = {
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  planId: string;
  billingCycle: string;
  agreedPrice: string;
  branches: string;
  registers: string;
  trialDays: string;
  notes: string;
};

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * The complaint about an activation, or null.
 *
 * Called by the form as it is typed and again by the Server Action before
 * anything is written, so the sentence the operator reads under the field is
 * the sentence that comes back from the server. One function, two callers —
 * the same bargain `checkCustomer` strikes.
 */
export function checkClient(draft: ClientDraft): string | null {
  if (!draft.shopName.trim()) return "The shop needs a name — it prints on every receipt.";
  if (draft.shopName.length > SHOP_NAME_MAX) return "That shop name is too long.";
  if (!draft.ownerName.trim()) return "Whose shop is it? A name to ask for on the phone.";
  if (draft.ownerName.length > PERSON_MAX) return "That name is too long.";

  const phone = digits(draft.phone);
  if (!phone) return "A phone number is how the invite gets to them.";
  if (phone.length < 10) return "That does not look like a phone number. A mobile is 11 digits — 0300 1234567.";

  if (!draft.city.trim()) return "Which city? It is how you find them in the list later.";
  if (draft.city.length > CITY_MAX) return "That city name is too long.";

  const email = draft.email.trim();
  if (email && !email.includes("@")) return "That email address does not look right.";

  if (!draft.planId) return "Pick a plan.";
  if (!isCycle(draft.billingCycle)) return "Pick how often they are billed.";

  const price = Number(draft.agreedPrice);
  if (!Number.isFinite(price) || price < 0) return "The agreed price has to be a number.";
  if (price > PRICE_MAX) return `Rs ${PRICE_MAX.toLocaleString("en-PK")} a cycle is the most this will take.`;

  const registers = Number(draft.registers);
  if (!Number.isInteger(registers) || registers < 1 || registers > REGISTERS_MAX) {
    return `Counters has to be between 1 and ${REGISTERS_MAX}.`;
  }

  const branches = Number(draft.branches);
  if (!Number.isInteger(branches) || branches < 1 || branches > BRANCHES_MAX) {
    return `Branches has to be between 1 and ${BRANCHES_MAX}.`;
  }

  const trial = Number(draft.trialDays);
  if (!Number.isInteger(trial) || trial < 0 || trial > TRIAL_DAYS_MAX) {
    return `A trial is between 0 and ${TRIAL_DAYS_MAX} days.`;
  }

  if (draft.notes.length > NOTES_MAX) return "That note is too long.";

  return null;
}

/* -------------------------------------------------------------------------- */
/* How every figure on this console is worked out                             */
/* -------------------------------------------------------------------------- */

/**
 * The one place that says what a number on `/admin` means.
 *
 * The same bargain `EXPLAIN` strikes in `lib/pos/report.ts`, for a stronger
 * reason: a shopkeeper can check a figure against their own till roll, and
 * nobody can check these against anything. An operator quoting MRR on a call,
 * or telling a shopkeeper what they have paid to date, is trusting a number
 * they have no second copy of — so every one of them says how it was reached,
 * in one sentence, from one place. Three explanations of one figure is how a
 * console stops being believed.
 *
 * Each entry is written against the SQL that actually produces it —
 * `platform_overview()` and `platform_clients()` in `0036`, as `0038` and
 * `0039` left them. When one of those windows moves, the sentence moves with
 * it in the same commit, or this file becomes the most confident liar in the
 * product.
 */
export const EXPLAIN = {
  /* ---- The strip across the top of /admin ---- */

  mrr: {
    formula: "Σ agreed price ÷ cycle months, active and past-due shops",
    plain:
      "What every shop is contracted to pay in a month, whether they pay monthly, quarterly or yearly. A trial counts nothing until it converts, and a suspended or cancelled shop drops out — this figure is money that is still arriving.",
  },
  collected: {
    formula: "Σ payments recorded this month",
    plain:
      "Rupees actually recorded against a shop this month, whatever period they bought. Monthly revenue is what was promised; this is what landed.",
  },
  shopsTrading: {
    plain:
      "Shops whose till still charges — on trial, active, or past due. Suspended and cancelled shops are counted as stopped, and a shop with no subscription behind it is not trading at all.",
  },
  needsCall: {
    plain:
      "Trading shops whose period ends inside seven days, plus every one already past its date. Nothing shuts a shop off on that date — somebody has to decide to suspend it, which is why this is a call list.",
  },
  soldThroughFlo: {
    formula: "Σ sale totals, every shop, this month",
    plain:
      "What the shops rang up, not what Flo earns. A refund is a negative sale and subtracts itself; the bill count is completed sales only, because the shop served that customer twice and did not un-serve them.",
  },

  /* ---- One shop's record ---- */

  lastBill: {
    plain:
      "When this shop last rang anything up, at any time — not only inside the thirty days beside it. A shop that sold nothing this month but sold in March reads as March.",
  },
  sold30: {
    formula: "Σ sale totals over the last 30 days, today included",
    plain:
      "Everything this shop billed in the last thirty days — their turnover, not what they pay Flo. A refund is a negative sale and comes off the money, while the bill count beside it stays completed sales only.",
  },
  onShelf: {
    plain:
      "How many products are in their catalog, switched on or off. It is the size of their item list and not a count of stock on the shelf.",
  },
  paidToDate: {
    formula: "Σ every payment recorded against this shop",
    plain:
      "Every rupee recorded since the shop was activated, across all methods. It is only as complete as what operators have entered — a bank transfer nobody recorded is not here.",
  },

  /* ---- The roster's columns ---- */

  standing: {
    plain:
      "Whether the till charges. Trial, active and past due all trade; suspended and cancelled do not, and neither does a shop with no subscription. It is set by an operator, never by a date arriving.",
  },
  period: {
    formula: "period end − today, in calendar days",
    plain:
      "Days until the period they have paid for runs out, negative once it has passed. Running out does not stop the till by itself — it is what puts them on the call list.",
  },
  monthly: {
    formula: "agreed price ÷ 1, 3 or 12",
    plain:
      "The agreed price as a monthly figure, so a yearly deal and a monthly one can be read down the same column. It is the invoice price, not the plan's list price.",
  },
} as const satisfies Record<string, { formula?: string; plain: string }>;

/* -------------------------------------------------------------------------- */
/* Reaching the shopkeeper                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A number in the shape `wa.me` wants: digits, country code, no plus.
 *
 * Pakistani numbers are stored and typed three ways — `0300…`, `92300…`,
 * `+92 300…` — and `wa.me/0300…` opens a chat with nobody.
 */
export function waNumber(phone: string): string {
  const bare = digits(phone);
  if (!bare) return "";
  if (bare.startsWith("0")) return `92${bare.slice(1)}`;
  if (bare.startsWith("92")) return bare;
  return bare;
}

export const waLink = (phone: string, message: string) => {
  const number = waNumber(phone);
  const text = encodeURIComponent(message);
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
};

/**
 * The message you paste into the chat you are already in.
 *
 * Urdu first and English under it, because the person reading it on a counter
 * in Faisalabad reads the first line and the person forwarding it to their
 * accountant reads the second. It carries the link and nothing else that could
 * go stale — no price, no plan name — since the whole point is that it is sent
 * once and the console is where those live.
 */
export function inviteMessage(shopName: string, link: string): string {
  return [
    `Assalam-o-Alaikum! ${shopName} ka Flo account taiyar hai.`,
    "",
    "Neeche diye gaye link par apna password bana lein — yeh link sirf ek baar chalega:",
    link,
    "",
    `Your Flo account for ${shopName} is ready. Open the link above to set your password. It works once and expires in ${INVITE_DAYS} days.`,
    "",
    "Koi masla ho to isi number par message kar dein. Shukriya!",
  ].join("\n");
}


/* -------------------------------------------------------------------------- */
/* Dates, the way this console writes them                                    */
/* -------------------------------------------------------------------------- */

const DAY = 86_400_000;

/** "12 Oct 2026" — long enough to be unambiguous on a phone call. */
export function writeDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "22 Sep" — a business day on a chart axis.
 *
 * Takes the `YYYY-MM-DD` string apart by hand rather than going through `Date`.
 * `new Date("2026-09-22")` is parsed as UTC midnight, so an operator whose
 * laptop is set to a timezone west of Greenwich would see every point on the
 * trend labelled with the day before — the browser's locale gets no vote here,
 * the same rule `dateInput` follows one function down.
 */
export function writeAxisDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return `${date} ${MONTHS[month - 1] ?? ""}`.trim();
}

/** "2 days ago", "in 6 days" — for anything a human is deciding off. */
export function writeWhen(iso: string | null): string {
  if (!iso) return "Never";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "Never";

  const days = Math.round((at - Date.now()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/** How a period's remaining days read on a badge. */
export function writeExpiry(days: number): string {
  if (days < 0) return `${-days} days over`;
  if (days === 0) return "Ends today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/** `<input type="date">` wants exactly this, and the browser's locale must not
 *  get a vote. */
export const dateInput = (date: Date) => date.toISOString().slice(0, 10);
