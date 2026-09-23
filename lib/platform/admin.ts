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
  | "paused"
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
 * `past_due` is still operable, but only for the grace days after the period
 * ends. When those run out the shop is suspended by the date, not by a person —
 * `lapseOf` below says exactly when, and the hourly sweep in `0042` writes it.
 *
 * `paused` is the other stop, and the kind one: the till is shut because the
 * shop is, and the days it was paused go back on the end of its period.
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
    description: "The period has ended. The till works until the grace days run out.",
    tone: "warn",
    operable: true,
  },
  {
    id: "paused",
    label: "Paused",
    description: "Shut for now. The clock is stopped and the days come back on resume.",
    tone: "info",
    operable: false,
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
 * tenant with no subscription — which, since `0042`, is every client an order
 * was accepted into and nobody has activated yet. It is a real state, the one
 * an operator has to finish, and it gets drawn as one rather than as a green
 * **Active** badge over a shop with no plan, no price and no period.
 *
 * `operable` is false for it, which is also the truth: `getEntitlements`
 * returns null with no subscription row, so the till refuses the sale.
 */
export const NO_SUBSCRIPTION = {
  id: "none",
  label: "Not activated",
  description: "No plan yet. Activate it from this client's record.",
  tone: "warn",
  operable: false,
} as const satisfies Option<"none"> & { tone: StatusTone; operable: boolean };

export const standingOf = (status: SubscriptionStatus | null) =>
  status === null
    ? NO_SUBSCRIPTION
    : (SUB_STATUSES.find((entry) => entry.id === status) ?? NO_SUBSCRIPTION);

/**
 * Where a shop stands once the date has had its say.
 *
 * The stored status is what an operator or the sweep last wrote; this is what
 * it is *now*. A trading shop whose period has ended is past due, and one whose
 * grace days after that have run out as well is suspended — whether or not the
 * hourly `private.sweep_subscriptions` has got round to writing it yet. That is
 * what lets the till stop on the hour the grace ends rather than at five past.
 *
 * The same two rules as the sweep in `0042`, and the two have to stay
 * identical: a till that stops before the console says so, or after, is a
 * shopkeeper on the phone asking which of them is lying. A stored `paused`,
 * `suspended` or `cancelled` is left exactly as it is — those are decisions,
 * and the date does not get to overrule one.
 */
export function lapseOf(
  status: SubscriptionStatus,
  periodEnd: string,
  graceDays: number,
  now = Date.now(),
): { status: SubscriptionStatus; graceEndsAt: string } {
  const end = new Date(periodEnd).getTime();
  const graceEnds = end + Math.max(graceDays, 0) * DAY;
  const graceEndsAt = new Date(graceEnds).toISOString();

  if (status !== "trialing" && status !== "active" && status !== "past_due") {
    return { status, graceEndsAt };
  }

  if (now > graceEnds) return { status: "suspended", graceEndsAt };
  if (now > end) return { status: "past_due", graceEndsAt };

  return { status, graceEndsAt };
}

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
    description: "Match it against the bank statement and record the payment.",
  },
  // Stored as `verified` since `0001`. Since `0042` it means the order was
  // accepted into a client — which is not yet an activated shop.
  { id: "verified", label: "Accepted", tone: "good", description: "A client now." },
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
 * JSON textarea — and, since `0045`, the list `/pricing` is drawn from. A flag
 * that is on prints its `line` on the plan's card; one that is off prints
 * nothing. That is what makes a flag a promise: ticking a box puts a sentence
 * in front of a buyer the same minute.
 *
 * Three kinds of entry, and the difference matters more than it looks. A
 * `wired` flag names something `/app` actually does, and `0020`'s rule applies
 * to it: flip it in the same migration that lands the feature. A `service` flag
 * is a promise made by people, not software — support on WhatsApp, a place in
 * the queue — so it is true the day somebody keeps it. A `copy` flag names
 * something that is **not built**: ticking one puts a feature on `/pricing` that
 * no shop can open, and the editor marks every one of them so nobody does it by
 * accident.
 *
 * None of them gates a screen. Nothing in `/app` calls `hasFeature`, so
 * unticking Reports takes the line off the sales page and not the module off a
 * shop. What bites is the ceilings below.
 */
export type FeatureKind = "wired" | "service" | "copy";

export const PLAN_FEATURES = [
  { key: "sales_history", label: "Sales history", kind: "wired", line: "Every bill findable by number, customer or counter" },
  { key: "receipt_reprint", label: "Reprint a receipt", kind: "wired", line: "Any receipt reprinted, marked DUPLICATE" },
  { key: "day_close_report", label: "Day close", kind: "wired", line: "Day close per counter — what should be in each drawer" },
  { key: "shift_close", label: "Shift close and variance", kind: "wired", line: "Shifts opened and counted, with who was over or short and by how much" },
  { key: "stock_ledger", label: "Stock ledger", kind: "wired", line: "Stock that moves with every sale, delivery and count — each change with its reason" },
  { key: "purchase_orders", label: "Buying — orders and deliveries", kind: "wired", line: "Buying: suppliers, orders, deliveries with the carriage in the cost, and what you owe each distributor" },
  { key: "customer_directory", label: "Customer list", kind: "wired", line: "Customer list, searchable by name or phone" },
  { key: "profit_reporting", label: "Profit and margin", kind: "wired", line: "Dashboard: sales, profit, cost of goods, margin" },
  { key: "advanced_reports", label: "Reports", kind: "wired", line: "Reports: profit by item, by department, by counter and by cashier — for any period, exported with the same words on screen" },
  { key: "role_permissions", label: "Roles and permissions", kind: "wired", line: "Roles and permissions — who may discount, refund or see the reports" },
  { key: "staff_accounts", label: "Staff accounts", kind: "wired", line: "Staff accounts, each with their own sign-in" },
  { key: "bulk_import", label: "CSV import", kind: "wired", line: "Your item list in from a spreadsheet — cost, price, barcode, Urdu name" },
  { key: "csv_export", label: "CSV export", kind: "wired", line: "Sales, items and reports out to CSV" },
  { key: "catalog_roman_urdu_search", label: "Roman Urdu search", kind: "wired", line: "Items found by their English or their Urdu name" },
  { key: "thermal_printing", label: "Thermal printing", kind: "wired", line: "Receipts to any thermal printer your device can already reach" },
  { key: "whatsapp_support", label: "WhatsApp support", kind: "service", line: "WhatsApp support in Urdu and English" },
  { key: "priority_support", label: "Priority support", kind: "service", line: "Priority on the queue when something breaks" },
  { key: "staff_pins", label: "Staff PINs", kind: "copy", line: "Staff PINs at the till" },
  { key: "offline_register", label: "Offline register", kind: "copy", line: "Billing while the internet is down" },
  { key: "fbr_invoicing", label: "FBR digital invoicing", kind: "copy", line: "FBR digital invoicing" },
  { key: "provincial_tax_filing", label: "Provincial tax filing", kind: "copy", line: "Provincial tax filing" },
  { key: "loyalty_campaigns", label: "Loyalty campaigns", kind: "copy", line: "Loyalty campaigns" },
  { key: "recipe_depletion", label: "Recipe depletion", kind: "copy", line: "Recipe depletion" },
  { key: "delivery_reconciliation", label: "Delivery reconciliation", kind: "copy", line: "Delivery reconciliation" },
  { key: "central_catalog", label: "Central catalog", kind: "copy", line: "One catalog across branches" },
  { key: "cross_branch_reports", label: "Cross-branch reports", kind: "copy", line: "Reports across branches" },
  { key: "multi_branch_dashboard", label: "Multi-branch dashboard", kind: "copy", line: "A dashboard across branches" },
  { key: "payroll_export", label: "Payroll export", kind: "copy", line: "Payroll export" },
  { key: "api_access", label: "API access", kind: "copy", line: "API access" },
] as const satisfies readonly { key: string; label: string; kind: FeatureKind; line: string }[];

/**
 * The numeric entries in the same JSON. Ceilings, not switches, and unlike the
 * flags each one does something:
 *
 * - Counters is what a new shop on the plan is activated with — the figure
 *   `subscriptions.max_registers` starts from, which Settings enforces and a
 *   haggle then moves one shop at a time. `/checkout` refuses an order for
 *   more, and `/pricing` prints it.
 * - Staff is enforced when an owner adds somebody on Staff, read live off the
 *   plan, so lowering it stops new hires and never removes anybody.
 * - Branches is only carried into the subscription. Flo runs one branch.
 *
 * The key is still `max_staff_pins` from `0002`; it counts staff accounts.
 */
export const PLAN_LIMITS = [
  {
    key: "max_branches",
    label: "Branches",
    effect: "Copied onto each new shop. Nothing reads it — Flo runs one branch.",
  },
  {
    key: "max_registers",
    label: "Counters",
    effect: "New shops start with this many. /checkout refuses more; /pricing prints it.",
  },
  {
    key: "max_staff_pins",
    label: "Staff",
    effect: "Accounts besides the owner. Checked when an owner adds one.",
  },
] as const;

export type FeatureFlags = Record<string, unknown>;

export const flagOn = (features: FeatureFlags, key: string) => features[key] === true;

/** A ceiling out of the JSON, or null for none. `featureLimit` in
 *  `lib/entitlements.ts` is the same reading of a shop's entitlements. */
export const limitOf = (features: FeatureFlags, key: string): number | null => {
  const value = features[key];
  return typeof value === "number" ? value : null;
};

/** The extra lines `/pricing` prints for promises no flag can make. */
export const HIGHLIGHTS_MAX = 12;
export const HIGHLIGHT_MAX = 160;

type PricedFeature = (typeof PLAN_FEATURES)[number];

/**
 * One plan's card on `/pricing`, as lines of copy.
 *
 * A tier after the first is sold as "Everything in Standard" plus what it adds
 * — but only when that is true, which is worked out from the flags rather than
 * written: a Premium that lost a flag Standard has gets its whole list printed
 * instead, because "everything in" is a promise too.
 */
export function pricingLines(
  plan: { features: FeatureFlags; highlights: readonly string[] },
  previous: { name: string; features: FeatureFlags } | null,
): string[] {
  const on = (features: FeatureFlags) =>
    PLAN_FEATURES.filter((feature) => flagOn(features, feature.key));

  const counters = limitOf(plan.features, "max_registers");
  const staff = limitOf(plan.features, "max_staff_pins");

  const countersLine =
    counters === null
      ? "As many counters as the shop needs, each with its own receipt series"
      : `Up to ${counters} ${counters === 1 ? "counter" : "counters"}, each with its own receipt series`;

  // The staff flag's sentence carries the ceiling, so the two never disagree.
  const lineOf = (feature: PricedFeature): string =>
    feature.key !== "staff_accounts"
      ? feature.line
      : staff === null
        ? "Unlimited staff accounts, each with their own sign-in"
        : `Up to ${staff} staff ${staff === 1 ? "account" : "accounts"}, each with their own sign-in`;

  const mine = on(plan.features);
  const inherits =
    previous !== null &&
    on(previous.features).every((feature) => flagOn(plan.features, feature.key));

  if (!previous || !inherits) {
    return [countersLine, ...mine.map(lineOf), ...plan.highlights];
  }

  // What this tier adds: flags the previous one lacks, and the staff line
  // again when only its ceiling moved.
  const added = mine.filter(
    (feature) =>
      !flagOn(previous.features, feature.key) ||
      (feature.key === "staff_accounts" &&
        limitOf(previous.features, "max_staff_pins") !== staff),
  );
  const sameCounters = limitOf(previous.features, "max_registers") === counters;

  return [
    `Everything in ${previous.name}`,
    ...(sameCounters ? [] : [countersLine]),
    ...added.map(lineOf),
    ...plan.highlights,
  ];
}

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
/** How long a shop keeps trading after its period ends, unless told otherwise. */
export const GRACE_DAYS = 7;
export const GRACE_DAYS_MAX = 60;

/** Who the client is. Accepting an order needs this and nothing else. */
export type ShopDraft = {
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  notes: string;
};

/** What they are on. Activation needs this and nothing else. */
export type PlanDraft = {
  planId: string;
  billingCycle: string;
  agreedPrice: string;
  branches: string;
  registers: string;
  trialDays: string;
  graceDays: string;
};

export type ClientDraft = ShopDraft & PlanDraft;

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * The complaint about a new client and its plan, or null.
 *
 * Called by the form as it is typed and again by the Server Action before
 * anything is written, so the sentence the operator reads under the field is
 * the sentence that comes back from the server. One function, two callers —
 * the same bargain `checkCustomer` strikes. It is the two halves below, which
 * the accept and activate steps each call alone.
 */
export function checkClient(draft: ClientDraft): string | null {
  return checkShop(draft) ?? checkPlan(draft);
}

export function checkShop(draft: ShopDraft): string | null {
  if (!draft.shopName.trim()) return "The shop needs a name — it prints on every receipt.";
  if (draft.shopName.length > SHOP_NAME_MAX) return "That shop name is too long.";
  if (!draft.ownerName.trim()) return "Whose shop is it? A name to ask for on the phone.";
  if (draft.ownerName.length > PERSON_MAX) return "That name is too long.";

  const phone = digits(draft.phone);
  if (!phone) return "A phone number is how the login gets to them.";
  if (phone.length < 10) return "That does not look like a phone number. A mobile is 11 digits — 0300 1234567.";

  if (!draft.city.trim()) return "Which city? It is how you find them in the list later.";
  if (draft.city.length > CITY_MAX) return "That city name is too long.";

  const email = draft.email.trim();
  if (email && !email.includes("@")) return "That email address does not look right.";

  if (draft.notes.length > NOTES_MAX) return "That note is too long.";

  return null;
}

export function checkPlan(draft: PlanDraft): string | null {
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

  const grace = Number(draft.graceDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > GRACE_DAYS_MAX) {
    return `Grace is between 0 and ${GRACE_DAYS_MAX} days.`;
  }

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
      "Trading shops whose period ends inside seven days, plus every one already past its date. Past the date a shop keeps trading only for its grace days, then its till stops by itself — this is the list to ring before that happens.",
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
      "Whether the till charges. Trial, active and past due all trade; paused, suspended and cancelled do not, and neither does a client not yet activated. A period that ends makes a shop past due, and the grace days running out suspend it — both by the date. Everything else is set by an operator.",
  },
  period: {
    formula: "period end − today, in calendar days",
    plain:
      "Days until the period they have paid for runs out, negative once it has passed. After that the till keeps charging for the shop's grace days and then stops. A paused shop's count is frozen at the day it was paused.",
  },
  monthly: {
    formula: "agreed price ÷ 1, 3 or 12",
    plain:
      "The agreed price as a monthly figure, so a yearly deal and a monthly one can be read down the same column. It is the invoice price, not the plan's list price.",
  },
} as const satisfies Record<string, { formula?: string; plain: string }>;

/* -------------------------------------------------------------------------- */
/* What a control does, for the operator about to press it                    */
/* -------------------------------------------------------------------------- */

/**
 * The same bargain as `EXPLAIN`, one shape over: `EXPLAIN` says how a figure was
 * reached, and this says what happens when a button is pressed.
 *
 * It exists because the client record was explaining itself in prose — three
 * grey paragraphs stacked under three forms on one card, which is a wall
 * nobody reads at 11 pm with a shopkeeper on the phone, and which pushed the
 * buttons that matter below the fold. The sentences are the same sentences;
 * they now live behind `InfoTip`, where an operator can reach them on the one
 * occasion they need them.
 *
 * Only the controls whose effect is genuinely not obvious get an entry. A
 * button whose label is the whole truth ("Add the note") does not need one, and
 * a tip on every control is a screen with no tips at all.
 */
export const HELP = {
  standing: {
    plain:
      "Whether this shop's till charges. Trial, active and past due all trade; paused, suspended and cancelled do not. Stopping only stops new sales — the shop still signs in, still reads every bill it ever rang up, still exports it and still closes the drawer it opened this morning. When the period ends the shop goes past due by itself, and when its grace days run out too it is suspended by itself; recording a payment puts it back.",
  },
  pause: {
    plain:
      "For a shop that is shut for a while — renovation, a month away. The till stops like a suspension, but the clock stops with it: when you resume, every day it was paused goes back on the end of the period. A payment recorded while paused extends the period and leaves it paused; resuming is still yours to press.",
  },
  renewalDate: {
    plain:
      "The date this shop has paid up to. Three things move it: recording a payment in Payments, which is the usual one and moves it by itself; giving goodwill days here; and correcting a date that is simply wrong. When it passes, the shop trades for its grace days and then its till stops — so moving this date is also how a lapsed shop gets its till back.",
  },
  graceDays: {
    plain:
      "How many days past the renewal date this shop keeps trading. Past due for that long, then suspended by itself on the hour the last day ends. Zero stops the till the moment the period runs out.",
  },
  activate: {
    plain:
      "Starts the plan and makes the owner's login. The period runs from the start date for one billing cycle, or for the trial days if you give any. Money already recorded against this client is attached to that first period. The username and password are shown once, here — send them on WhatsApp.",
  },
  giveDays: {
    plain:
      "Days with no payment behind them — a week lost to a dead printer, or a trial you agreed to stretch on the phone. From today if the period has already run out, so a week means a week from now. Money taken goes in Payments instead, which moves the date itself and records what arrived.",
  },
  signIn: {
    plain:
      "The owner signs in with a username and password Flo made at activation. Nothing can show the password again — if it is lost, make a new one here, which stops the old one working. The owner then hires their own staff from the console.",
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
 * The owner's login, as the message you paste into the chat you are already in.
 *
 * Urdu first and English under it, because the person reading it on a counter
 * in Faisalabad reads the first line and the person forwarding it to their
 * accountant reads the second. It carries the login and nothing else that could
 * go stale — no price, no plan name — since it is sent once and the console is
 * where those live.
 */
export function loginMessage(
  shopName: string,
  signInUrl: string,
  email: string,
  password: string,
): string {
  return [
    `Assalam-o-Alaikum! ${shopName} ka Flo account taiyar hai.`,
    "",
    `Sign in: ${signInUrl}`,
    `Username: ${email}`,
    `Password: ${password}`,
    "",
    `Your Flo account for ${shopName} is ready. Sign in with the username and password above. Do not share them with anyone.`,
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

/* -------------------------------------------------------------------------- */
/* Where a buyer sends the money                                              */
/* -------------------------------------------------------------------------- */

/**
 * The three ways a buyer can send money from home. `payment_accounts.method`
 * is checked against exactly this list in `0044`; cash and card are how a
 * payment is *recorded*, not accounts a stranger can transfer into.
 */
export type AccountMethod = "bank_transfer" | "easypaisa" | "jazzcash";

export const ACCOUNT_METHODS = [
  { id: "bank_transfer", label: "Bank transfer", description: "Account number and IBAN" },
  { id: "easypaisa", label: "Easypaisa", description: "A mobile wallet" },
  { id: "jazzcash", label: "JazzCash", description: "A mobile wallet" },
] as const satisfies readonly Option<AccountMethod>[];

export const isAccountMethod = (value: string): value is AccountMethod =>
  ACCOUNT_METHODS.some((method) => method.id === value);

export const isWallet = (method: string) => method === "easypaisa" || method === "jazzcash";

export const ACCOUNT_TITLE_MAX = 80;
export const BANK_NAME_MAX = 60;

export type AccountDraft = {
  method: string;
  accountTitle: string;
  bankName: string;
  accountNumber: string;
  iban: string;
};

/** An IBAN as the bank prints it, with the spaces people type taken out. */
export const normaliseIban = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/**
 * A wallet number as `03001234567`, whatever was typed — `+92 300 1234567`,
 * `0300-1234567`. Null when it is not a Pakistani mobile number at all.
 */
export function normaliseWallet(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("92")) digits = `0${digits.slice(2)}`;
  if (digits.startsWith("3")) digits = `0${digits}`;
  return /^03\d{9}$/.test(digits) ? digits : null;
}

/** `0300 1234567`, the way it is read out over the phone. */
export const writeWallet = (value: string) =>
  /^03\d{9}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4)}` : value;

/** `PK36 SCBL 0000 0011 2345 6702`, in the fours a bank app shows. */
export const writeIban = (value: string) => value.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * The one validator, for the form and the Server Action alike — so the
 * sentence under the card is the sentence the server refuses with. `0044`'s
 * check constraints are the floor under it.
 */
export function checkAccount(draft: AccountDraft): string | null {
  if (!isAccountMethod(draft.method)) return "Pick how the money is sent.";

  const title = draft.accountTitle.trim();
  if (!title) return "An account needs its title — the name the buyer's app shows before they send.";
  if (title.length > ACCOUNT_TITLE_MAX) return "That account title is too long.";

  if (isWallet(draft.method)) {
    if (!normaliseWallet(draft.accountNumber)) return "A wallet number is a mobile number — 0300 1234567.";
    return null;
  }

  const bank = draft.bankName.trim();
  if (!bank) return "Name the bank — Meezan, HBL, Alfalah.";
  if (bank.length > BANK_NAME_MAX) return "That bank name is too long.";

  const number = draft.accountNumber.replace(/\s+/g, "");
  if (number.length < 4 || number.length > 34) return "That account number does not look right.";

  const iban = normaliseIban(draft.iban);
  if (iban && !/^PK\d{2}[A-Z]{4}\d{16}$/.test(iban)) {
    return "A Pakistani IBAN is 24 characters — PK, two digits, four letters, sixteen digits.";
  }

  return null;
}
