import "server-only";

import { cookies } from "next/headers";

import { writeReadError } from "@/lib/pos/read-error";
import {
  isPlatformScreen,
  type AccountMethod,
  type BillingCycle,
  type FeatureFlags,
  type PlatformRole,
  type PlatformScreen,
  type SubscriptionStatus,
} from "@/lib/platform/admin";
import {
  AUDIT_PAGE_SIZE,
  areaPrefixes,
  auditWindow,
  type AuditFilters,
} from "@/lib/platform/audit";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

/**
 * Everything `/admin` reads.
 *
 * Through the operator's **own JWT**, never the service role — the same call
 * `lib/pos/items.ts` makes and for a stronger reason. Every platform table's
 * read policy already carries `or private.is_platform_admin()`, so RLS is the
 * gate here as well as in the console: if the access-token hook stops stamping
 * `platform_role`, this whole screen goes empty instead of quietly working with
 * a gate that is no longer being checked. A service-role read would hide the
 * one failure that breaks everything else in the product.
 *
 * None of these may be wrapped in React `cache()`, for the reason none of the
 * readers in `lib/pos/` may be: `cache()` is scoped to the request, and a
 * Server Action plus the re-render its `revalidatePath` triggers are one
 * request — so a memoised read hands that re-render the roster as it stood
 * before the activation, and the shop somebody just sold does not appear.
 *
 * Every read here fails soft, the way `dashboard.ts` does: an operator who
 * cannot open the console cannot fix whatever broke it, so a failed read logs
 * loudly through `writeReadError` and returns an empty shape that the screen
 * draws as "nothing yet".
 */

/* -------------------------------------------------------------------------- */
/* The strip across the top                                                   */
/* -------------------------------------------------------------------------- */

/** One day of the platform's own trading, gap-filled by `platform_overview`
 *  so a day nobody sold anything is a zero rather than a missing point. */
export type PlatformDay = {
  /** `YYYY-MM-DD`, the business day — never a timestamp. */
  day: string;
  sales: number;
  bills: number;
};

export type Overview = {
  clients: number;
  active: number;
  trialing: number;
  pastDue: number;
  suspended: number;
  cancelled: number;
  /** Active and past_due only. A trial is not revenue. */
  mrr: number;
  trialMrr: number;
  expiring7: number;
  expired: number;
  trialsEnding7: number;
  ordersWaiting: number;
  ordersToVerify: number;
  leadsNew: number;
  salesMonth: number;
  billsMonth: number;
  /**
   * The same figures over the same number of elapsed days of the previous
   * month — not the whole of it. `0038` builds the window that way, and
   * `elapsedDays` is how many days both halves cover, which the screen says
   * out loud: a percentage whose two windows are different lengths is the
   * commonest way a console misleads the person who runs the business off it.
   */
  salesPrev: number;
  billsPrev: number;
  /** What actually landed in the account, off `payments` — not what the shops
   *  are contracted to pay, which is `mrr`. */
  collectedMonth: number;
  collectedPrev: number;
  addedMonth: number;
  addedPrev: number;
  elapsedDays: number;
  /** Trading shops that have not rung anything up in three days. */
  dormant: number;
  neverSold: number;
  /** Thirty days to this morning. */
  trend: PlatformDay[];
};

const EMPTY_OVERVIEW: Overview = {
  clients: 0,
  active: 0,
  trialing: 0,
  pastDue: 0,
  suspended: 0,
  cancelled: 0,
  mrr: 0,
  trialMrr: 0,
  expiring7: 0,
  expired: 0,
  trialsEnding7: 0,
  ordersWaiting: 0,
  ordersToVerify: 0,
  leadsNew: 0,
  salesMonth: 0,
  billsMonth: 0,
  salesPrev: 0,
  billsPrev: 0,
  collectedMonth: 0,
  collectedPrev: 0,
  addedMonth: 0,
  addedPrev: 0,
  elapsedDays: 0,
  dormant: 0,
  neverSold: 0,
  trend: [],
};

const num = (value: unknown) => Number(value ?? 0) || 0;

/** The trend arrives as jsonb. It is parsed rather than cast, because a shape
 *  this screen charts is one the page must not be handed half of. */
function toTrend(value: unknown): PlatformDay[] {
  if (!Array.isArray(value)) return [];

  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      day: typeof row.day === "string" ? row.day : "",
      sales: num(row.sales),
      bills: num(row.bills),
    };
  });
}

export async function getOverview(): Promise<Overview> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("platform_overview");

  if (error || !data) {
    console.error("[admin] overview read failed: %s", writeReadError(error));
    return EMPTY_OVERVIEW;
  }

  const row = data as Record<string, unknown>;

  return {
    clients: num(row.clients),
    active: num(row.active),
    trialing: num(row.trialing),
    pastDue: num(row.past_due),
    suspended: num(row.suspended),
    cancelled: num(row.cancelled),
    mrr: num(row.mrr),
    trialMrr: num(row.trial_mrr),
    expiring7: num(row.expiring_7),
    expired: num(row.expired),
    trialsEnding7: num(row.trials_ending_7),
    ordersWaiting: num(row.orders_waiting),
    ordersToVerify: num(row.orders_to_verify),
    leadsNew: num(row.leads_new),
    salesMonth: num(row.sales_month),
    billsMonth: num(row.bills_month),
    salesPrev: num(row.sales_prev),
    billsPrev: num(row.bills_prev),
    collectedMonth: num(row.collected_month),
    collectedPrev: num(row.collected_prev),
    addedMonth: num(row.added_month),
    addedPrev: num(row.added_prev),
    elapsedDays: num(row.elapsed_days),
    dormant: num(row.dormant),
    neverSold: num(row.never_sold),
    trend: toTrend(row.trend),
  };
}

/* -------------------------------------------------------------------------- */
/* The roster                                                                 */
/* -------------------------------------------------------------------------- */

export type Client = {
  tenantId: string;
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  createdAt: string;
  /** Null only for a tenant whose subscription was deleted by hand — which
   *  should not happen, and which the roster draws rather than hides. */
  subscriptionId: string | null;
  planId: string | null;
  planCode: string;
  planName: string;
  status: SubscriptionStatus | null;
  billingCycle: BillingCycle;
  agreedPrice: number;
  maxBranches: number;
  maxRegisters: number;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceDays: number;
  suspendedAt: string | null;
  cancelledAt: string | null;
  /** When it was paused, while it is. Its days are frozen from here. */
  pausedAt: string | null;
  monthlyValue: number;
  daysUntilExpiry: number;
  /** What tells a renewal call from a rescue call. */
  lastSaleAt: string | null;
  sales30d: number;
  bills30d: number;
  itemCount: number;
  userCount: number;
  counterCount: number;
  paidTotal: number;
  lastPaidAt: string | null;
  /** Whether the owner has a login yet. Minted at activation, so false means
   *  accepted and never activated — or a login somebody removed by hand. */
  hasOwner: boolean;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

function toClient(row: Record<string, unknown>): Client {
  return {
    tenantId: String(row.tenant_id),
    shopName: text(row.shop_name),
    ownerName: text(row.owner_name),
    phone: text(row.phone),
    email: text(row.email),
    city: text(row.city),
    createdAt: text(row.created_at),
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    planId: row.plan_id ? String(row.plan_id) : null,
    planCode: text(row.plan_code),
    planName: text(row.plan_name) || "No plan",
    status: (row.status as SubscriptionStatus | null) ?? null,
    billingCycle: (text(row.billing_cycle) || "monthly") as BillingCycle,
    agreedPrice: num(row.agreed_price),
    maxBranches: num(row.max_branches),
    maxRegisters: num(row.max_registers),
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
    currentPeriodStart: (row.current_period_start as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    graceDays: num(row.grace_days),
    suspendedAt: (row.suspended_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    pausedAt: (row.paused_at as string | null) ?? null,
    monthlyValue: num(row.monthly_value),
    daysUntilExpiry: num(row.days_until_expiry),
    lastSaleAt: (row.last_sale_at as string | null) ?? null,
    sales30d: num(row.sales_30d),
    bills30d: num(row.bills_30d),
    itemCount: num(row.item_count),
    userCount: num(row.user_count),
    counterCount: num(row.counter_count),
    paidTotal: num(row.paid_total),
    lastPaidAt: (row.last_paid_at as string | null) ?? null,
    hasOwner: row.has_owner === true,
  };
}

/**
 * Every shop, in one call.
 *
 * The whole list, not a page of it: the roster is searched, filtered and sorted
 * in the browser — the bargain `/app/sales` and the item list strike, for the
 * same reason. A hundred clients is a few kilobytes and filters in a frame; a
 * round trip per keystroke over a phone tether is a search box nobody uses.
 * When this is thousands of shops it will want the window in the URL, and that
 * will be a good problem.
 */
export async function listClients(): Promise<Client[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("platform_clients");

  if (error || !data) {
    console.error("[admin] client roster read failed: %s", writeReadError(error));
    return [];
  }

  return (data as Record<string, unknown>[]).map(toClient);
}

/** One shop, off the same call. A second function grouping the same aggregates
 *  for a single tenant would be a second definition of "last sale". */
export async function getClient(tenantId: string): Promise<Client | null> {
  const clients = await listClients();
  return clients.find((client) => client.tenantId === tenantId) ?? null;
}

export type ShopDetails = {
  ntn: string;
  strn: string;
  notes: string;
};

/**
 * The paperwork the roster deliberately leaves out.
 *
 * `platform_clients` is a table of a hundred shops and has no business carrying
 * three text fields nobody scans a column of. They are read here, for the one
 * shop whose record is open — and they have to be read, not left blank: the
 * details form posts every field it draws, so a form that did not know the
 * stored NTN would quietly erase it on the next save.
 */
export async function getShopDetails(tenantId: string): Promise<ShopDetails> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("tenants")
    .select("ntn, strn, notes")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[admin] shop details read failed: %s", writeReadError(error));
    return { ntn: "", strn: "", notes: "" };
  }

  return {
    ntn: text(data.ntn),
    strn: text(data.strn),
    notes: text(data.notes),
  };
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export type Plan = {
  id: string;
  code: string;
  name: string;
  pitch: string;
  listPrice: number;
  features: FeatureFlags;
  /** Extra lines on `/pricing` for promises no flag can make (`0045`). */
  highlights: string[];
  sortOrder: number;
  isActive: boolean;
};

export async function listPlans(): Promise<Plan[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("plans")
    .select("id, code, name, pitch, list_price, features, highlights, sort_order, is_active")
    .order("sort_order");

  if (error) {
    console.error("[admin] plans read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    code: text(row.code),
    name: text(row.name),
    pitch: text(row.pitch),
    listPrice: num(row.list_price),
    features: (row.features as FeatureFlags | null) ?? {},
    highlights: Array.isArray(row.highlights) ? row.highlights.map(String) : [],
    sortOrder: num(row.sort_order),
    isActive: row.is_active === true,
  }));
}

/* -------------------------------------------------------------------------- */
/* Money in                                                                   */
/* -------------------------------------------------------------------------- */

export type Payment = {
  id: string;
  /** Null while it sits against an order nobody has accepted yet. */
  tenantId: string | null;
  orderId: string | null;
  /** `FLO-XXXXXX`, when it came in against a self-serve order. */
  orderReference: string;
  shopName: string;
  amount: number;
  method: string;
  reference: string;
  paidAt: string;
  coversFrom: string | null;
  coversTo: string | null;
  notes: string;
  recordedBy: string | null;
};

type PaymentRow = {
  id: string;
  tenant_id: string | null;
  order_id: string | null;
  amount: number | string;
  method: string;
  reference: string | null;
  paid_at: string;
  covers_period_start: string | null;
  covers_period_end: string | null;
  notes: string | null;
  recorded_by: string | null;
  tenants: { shop_name: string } | { shop_name: string }[] | null;
  orders:
    | { reference: string; shop_name: string }
    | { reference: string; shop_name: string }[]
    | null;
};

/** With no generated database types, supabase-js infers an array for a
 *  many-to-one embed where PostgREST returns an object — the same normalisation
 *  `lib/pos/items.ts` does for a supplier. */
const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    orderReference: embedded(row.orders)?.reference ?? "",
    // Before acceptance there is no tenant, and the order's own name is the
    // only one the shop has.
    shopName:
      embedded(row.tenants)?.shop_name ?? embedded(row.orders)?.shop_name ?? "—",
    amount: num(row.amount),
    method: row.method,
    reference: row.reference ?? "",
    paidAt: row.paid_at,
    coversFrom: row.covers_period_start,
    coversTo: row.covers_period_end,
    notes: row.notes ?? "",
    recordedBy: row.recorded_by,
  };
}

const PAYMENT_COLUMNS =
  "id, tenant_id, order_id, amount, method, reference, paid_at, covers_period_start, covers_period_end, notes, recorded_by, tenants ( shop_name ), orders ( reference, shop_name )";

/** The last of everything taken, newest first. Capped, and the screen says so
 *  — a total quietly added up from a truncated list is worse than a caption. */
export const PAYMENTS_MAX = 500;

export async function listPayments(): Promise<Payment[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .order("paid_at", { ascending: false })
    .limit(PAYMENTS_MAX);

  if (error) {
    console.error("[admin] payments read failed: %s", writeReadError(error));
    return [];
  }

  return ((data ?? []) as unknown as PaymentRow[]).map(toPayment);
}

export async function listClientPayments(tenantId: string): Promise<Payment[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("paid_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[admin] client payments read failed: %s", writeReadError(error));
    return [];
  }

  return ((data ?? []) as unknown as PaymentRow[]).map(toPayment);
}

/* -------------------------------------------------------------------------- */
/* The self-serve queue                                                       */
/* -------------------------------------------------------------------------- */

export type Order = {
  id: string;
  reference: string;
  status: string;
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  shopType: string;
  planId: string | null;
  planName: string;
  billingCycle: BillingCycle;
  branches: number;
  registers: number;
  quotedPrice: number;
  proofPath: string | null;
  /** How the sheet draws it: a PDF cannot go in an `<img>`. Off the path's
   *  extension, which the upload action writes from an allow-listed type. */
  proofKind: "image" | "pdf" | null;
  proofUploadedAt: string | null;
  tenantId: string | null;
  rejectionReason: string;
  createdAt: string;
  verifiedAt: string | null;
  /** Σ payments recorded against this order. Accepting it needs more than
   *  nothing here — `create_client` refuses otherwise. */
  paid: number;
};

const ORDER_COLUMNS = `id, reference, status, shop_name, owner_name, phone, email, city, shop_type,
       plan_id, billing_cycle, branches, registers, quoted_price, proof_path,
       proof_uploaded_at, tenant_id, rejection_reason, created_at, verified_at,
       plans ( name )`;

function toOrder(row: Record<string, unknown>, paid: number): Order {
  return {
    id: String(row.id),
    reference: text(row.reference),
    status: text(row.status),
    shopName: text(row.shop_name),
    ownerName: text(row.owner_name),
    phone: text(row.phone),
    email: text(row.email),
    city: text(row.city),
    shopType: text(row.shop_type),
    planId: row.plan_id ? String(row.plan_id) : null,
    planName:
      embedded(row.plans as { name: string } | { name: string }[] | null)?.name ??
      "—",
    billingCycle: (text(row.billing_cycle) || "monthly") as BillingCycle,
    branches: num(row.branches),
    registers: num(row.registers),
    quotedPrice: num(row.quoted_price),
    proofPath: (row.proof_path as string | null) ?? null,
    proofKind: row.proof_path
      ? /\.pdf$/i.test(String(row.proof_path))
        ? "pdf"
        : "image"
      : null,
    proofUploadedAt: (row.proof_uploaded_at as string | null) ?? null,
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    rejectionReason: text(row.rejection_reason),
    createdAt: text(row.created_at),
    verifiedAt: (row.verified_at as string | null) ?? null,
    paid,
  };
}

export async function listOrders(): Promise<Order[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin] orders read failed: %s", writeReadError(error));
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = rows.map((row) => String(row.id));

  // A second read rather than an aggregate embed: what has been paid against
  // each order is the one figure that decides whether Accept is live.
  const { data: paid } = ids.length
    ? await supabase.from("payments").select("order_id, amount").in("order_id", ids)
    : { data: [] };

  const totals = new Map<string, number>();
  for (const payment of paid ?? []) {
    const key = String(payment.order_id);
    totals.set(key, (totals.get(key) ?? 0) + num(payment.amount));
  }

  return rows.map((row) => toOrder(row, totals.get(String(row.id)) ?? 0));
}

/**
 * The order a client was accepted from, if it came in through `/checkout`.
 *
 * The activation card is filled from it — the plan, cycle, counters and price
 * the buyer chose — so accepting an order and then activating it is not the
 * operator retyping what the shop already told us.
 */
export async function getClientOrder(tenantId: string): Promise<Order | null> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[admin] client order read failed: %s", writeReadError(error));
    return null;
  }

  return toOrder(data as Record<string, unknown>, 0);
}

/**
 * A signed URL for one payment screenshot.
 *
 * The bucket is private (`0003_storage.sql`), so the proof cannot be linked to
 * directly — and it should not be: a payment screenshot carries an account
 * number and a name. Ten minutes is long enough to look at it and short enough
 * that a copied URL in a chat is a dead link by the time anybody else opens it.
 *
 * Service role, deliberately, and the one read in this file that is: storage
 * has no RLS policy for the platform role, and the alternative is a bucket
 * readable by every signed-in account in the country.
 */
export async function proofUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(path, 600);

  if (error || !data) {
    console.error("[admin] proof link failed: %s", writeReadError(error));
    return null;
  }

  return data.signedUrl;
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export type Lead = {
  id: string;
  contactName: string;
  phone: string;
  businessName: string;
  email: string;
  city: string;
  shopType: string;
  registers: string;
  message: string;
  source: string;
  status: string;
  notes: string;
  createdAt: string;
};

export async function listLeads(): Promise<Lead[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("leads")
    .select(
      `id, contact_name, phone, business_name, email, city, shop_type, registers,
       message, source, status, notes, created_at`,
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[admin] leads read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    contactName: text(row.contact_name),
    phone: text(row.phone),
    businessName: text(row.business_name),
    email: text(row.email),
    city: text(row.city),
    shopType: text(row.shop_type),
    registers: text(row.registers),
    message: text(row.message),
    source: text(row.source),
    status: text(row.status),
    notes: text(row.notes),
    createdAt: text(row.created_at),
  }));
}

/* -------------------------------------------------------------------------- */
/* The notes, the people                                                      */
/* -------------------------------------------------------------------------- */

export type Note = {
  id: string;
  body: string;
  createdAt: string;
};

export async function listNotes(tenantId: string): Promise<Note[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("tenant_notes")
    .select("id, body, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[admin] notes read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    body: text(row.body),
    createdAt: text(row.created_at),
  }));
}

export type ShopUser = {
  id: string;
  fullName: string;
  /** The login. Every account Flo mints carries it on `profiles`. */
  email: string;
  tenantRole: string;
  isActive: boolean;
  createdAt: string;
};

/** Who can actually sign in to this shop, and with what. The login is read off
 *  `profiles.email`, which every minted account carries — never `auth.users`,
 *  which would be a service-role read for a fact this row already holds. */
export async function listShopUsers(tenantId: string): Promise<ShopUser[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, tenant_role, is_active, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at");

  if (error) {
    console.error("[admin] shop users read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    fullName: text(row.full_name) || "Unnamed",
    email: text(row.email),
    tenantRole: text(row.tenant_role) || "—",
    isActive: row.is_active !== false,
    createdAt: text(row.created_at),
  }));
}

/* -------------------------------------------------------------------------- */
/* The operators, and what they have done                                     */
/* -------------------------------------------------------------------------- */

export type Operator = {
  userId: string;
  fullName: string;
  email: string;
  platformRole: PlatformRole;
  /** What `/admin/team` ticked. Empty for the owner, who has every screen. */
  screens: PlatformScreen[];
  isActive: boolean;
  /** The login also runs a shop. Such an account is never banned or deleted
   *  from here — switching off their console must not shut their till. */
  hasShop: boolean;
  createdAt: string;
};

export async function listOperators(): Promise<Operator[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, full_name, email, platform_role, screens, is_active, created_at")
    .order("created_at");

  if (error) {
    console.error("[admin] operators read failed: %s", writeReadError(error));
    return [];
  }

  const ids = (data ?? []).map((row) => String(row.user_id));

  // A second read rather than an embed: `platform_admins` and `profiles` both
  // hang off `auth.users` and have no foreign key between them to embed on.
  const { data: shops } = ids.length
    ? await supabase.from("profiles").select("id, tenant_id").in("id", ids)
    : { data: [] };

  const withShop = new Set(
    (shops ?? []).filter((row) => row.tenant_id).map((row) => String(row.id)),
  );

  return (data ?? []).map((row) => ({
    userId: String(row.user_id),
    fullName: text(row.full_name) || "Unnamed",
    email: text(row.email),
    platformRole: text(row.platform_role) as PlatformRole,
    screens: ((row.screens as string[] | null) ?? []).filter(isPlatformScreen),
    isActive: row.is_active !== false,
    hasShop: withShop.has(String(row.user_id)),
    createdAt: text(row.created_at),
  }));
}

export type AuditRow = {
  id: string;
  action: string;
  actorEmail: string;
  actorKind: string;
  tenantId: string | null;
  shopName: string;
  /** The actor's own name off the team roster or the shop's staff list, or
   *  empty when the account has since gone. The email is still the identity. */
  actorName: string;
  subjectType: string;
  subjectId: string;
  /** The person an entry is about — a team member suspended, a cashier added —
   *  read live, because most entries store an id and not a name. */
  subjectName: string;
  /** The plan behind a `plan_id` in the payload, for "activated on Standard". */
  planName: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export const AUDIT_MAX = 500;

const AUDIT_COLUMNS = `id, action, actor_email, actor_kind, tenant_id, subject_type, subject_id,
       before, after, created_at`;

type Reader = ReturnType<typeof createClient>;

/**
 * The trail for one shop, newest first — a client's Activity tab.
 *
 * Capped and said out loud on the screen. `audit_log` is append-only by trigger
 * and grows for ever; a console that silently showed the last five hundred rows
 * as though they were all of them would be the one screen in the product that
 * lies about completeness — which is precisely the screen that must not.
 */
export async function listAudit(tenantId?: string): Promise<AuditRow[]> {
  const supabase = createClient(await cookies());

  let query = supabase
    .from("audit_log")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(AUDIT_MAX);

  if (tenantId) query = query.eq("tenant_id", tenantId);

  const { data, error } = await query;

  if (error) {
    console.error("[admin] audit read failed: %s", writeReadError(error));
    return [];
  }

  return withNames(supabase, data ?? []);
}

export type AuditPage = {
  rows: AuditRow[];
  /** Every entry the filters match, not just this page's. */
  total: number;
  /** The page actually read — a link to page 9 of a list that now has 3 is
   *  answered with page 3 rather than an empty table. */
  page: number;
  pages: number;
  /** The name behind `filters.shop`, for the chip that says it is on. */
  shopName: string;
};

/**
 * One page of the trail, filtered in Postgres.
 *
 * The whole-trail screen pages on the server rather than holding a window in
 * the browser the way `/app/sales` does: a shop's history is bounded by the
 * days somebody picks, and this table is every change anybody has ever made,
 * for ever. `count: "exact"` rides on the same query, so the pager and the
 * caption quote the real total rather than "500+".
 */
export async function searchAudit(filters: AuditFilters): Promise<AuditPage> {
  const supabase = createClient(await cookies());

  const shopName = filters.shop ? await shopNameOf(supabase, filters.shop) : "";

  // The search box matches the shop's name too, which the log does not hold —
  // so it is turned into the ids of the shops whose names match first.
  const pattern = searchPattern(filters.q);
  let shopIds: string[] = [];
  let emails: string[] = [];

  // The same goes for people: the sentence on screen says "Muhammad Ibrahim",
  // and the log only holds his email.
  if (pattern) {
    const [shops, team, staff] = await Promise.all([
      supabase.from("tenants").select("id").ilike("shop_name", pattern).limit(50),
      supabase.from("platform_admins").select("email").ilike("full_name", pattern).limit(50),
      supabase.from("profiles").select("email").ilike("full_name", pattern).limit(50),
    ]);
    shopIds = (shops.data ?? []).map((row) => String(row.id));
    emails = [...(team.data ?? []), ...(staff.data ?? [])]
      .map((row) => text(row.email))
      .filter((email) => /^[^\s",()]+$/.test(email));
  }

  const { since, until } = auditWindow(filters);
  const prefixes = areaPrefixes(filters.area);

  const read = (page: number) => {
    let query = supabase
      .from("audit_log")
      .select(AUDIT_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE - 1);

    if (filters.shop) query = query.eq("tenant_id", filters.shop);
    if (filters.who) query = query.eq("actor_kind", filters.who);
    if (since) query = query.gte("created_at", since);
    if (until) query = query.lt("created_at", until);

    if (prefixes.length > 0) {
      query = query.or(prefixes.map((prefix) => `action.like.${prefix}.*`).join(","));
    }

    if (pattern) {
      const like = pattern.replace(/%/g, "*");
      query = query.or(
        [
          `action.ilike.${like}`,
          `actor_email.ilike.${like}`,
          `subject_type.ilike.${like}`,
          `subject_id.ilike.${like}`,
          ...(shopIds.length > 0 ? [`tenant_id.in.(${shopIds.join(",")})`] : []),
          ...(emails.length > 0
            ? [`actor_email.in.(${emails.map((email) => `"${email}"`).join(",")})`]
            : []),
        ].join(","),
      );
    }

    return query;
  };

  let page = filters.page;
  let { data, error, count } = await read(page);

  // PostgREST answers a range past the end with 416 rather than an empty page.
  // Read the last page that exists instead.
  if (error?.code === "PGRST103" && page > 1) {
    const { count: total } = await read(1);
    page = Math.max(1, Math.ceil((total ?? 0) / AUDIT_PAGE_SIZE));
    ({ data, error, count } = await read(page));
  }

  if (error) {
    console.error("[admin] audit read failed: %s", writeReadError(error));
    return { rows: [], total: 0, page: 1, pages: 1, shopName };
  }

  const total = count ?? 0;

  return {
    rows: await withNames(supabase, data ?? []),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    shopName,
  };
}

/**
 * The search box's words as one `ilike` pattern, each word in order with
 * anything between: "note removed" finds `tenant.note_removed`, which is how
 * somebody who has never seen the stored spelling types it.
 *
 * Everything but letters, digits and the few characters an email or an action
 * holds is dropped — commas, brackets and quotes are PostgREST's own syntax
 * inside an `or()` filter, and a search box is not a way to write one.
 */
function searchPattern(q: string): string {
  const words = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
    .split(" ")
    .filter(Boolean);

  return words.length > 0 ? `%${words.join("%")}%` : "";
}

async function shopNameOf(supabase: Reader, id: string): Promise<string> {
  const { data } = await supabase
    .from("tenants")
    .select("shop_name")
    .eq("id", id)
    .maybeSingle();
  return data ? text(data.shop_name) : "";
}

/**
 * The names behind the ids, in follow-up reads rather than PostgREST embeds.
 *
 * `0014` dropped `audit_log`'s foreign keys to both `auth.users` and
 * `tenants` on purpose — the table is append-only by statement trigger, and
 * an `on delete set null` made Postgres try to rewrite the log whenever an
 * account or a shop was deleted, which the trigger refused and which took the
 * delete down with it. No constraint means no relationship for PostgREST to
 * embed through, so an `audit_log ( tenants ( shop_name ) )` select fails
 * outright with PGRST200.
 *
 * Which is also the right behaviour to preserve: an entry about a shop or a
 * person who has since been deleted keeps its ids and simply has no name to
 * show, rather than disappearing from the trail. Every lookup is one `in`
 * read over the ids on the page, so twenty rows cost the same as one.
 */
async function withNames(
  supabase: Reader,
  rows: Record<string, unknown>[],
): Promise<AuditRow[]> {
  const unique = (values: unknown[]) =>
    [...new Set(values.filter((value) => typeof value === "string" && value))] as string[];

  const field = (value: unknown, key: string): unknown =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

  const shopIds = unique(rows.map((row) => row.tenant_id));
  const actorEmails = unique(rows.map((row) => row.actor_email));
  const teamIds = unique(
    rows.filter((row) => row.subject_type === "platform_admin").map((row) => row.subject_id),
  );
  const profileIds = unique(
    rows.filter((row) => row.subject_type === "profile").map((row) => row.subject_id),
  );
  const planIds = unique(
    rows.flatMap((row) => [field(row.after, "plan_id"), field(row.before, "plan_id")]),
  );

  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [shops, teamByEmail, staffByEmail, team, staff, plans] = await Promise.all([
    shopIds.length
      ? supabase.from("tenants").select("id, shop_name").in("id", shopIds)
      : none,
    actorEmails.length
      ? supabase.from("platform_admins").select("email, full_name").in("email", actorEmails)
      : none,
    actorEmails.length
      ? supabase.from("profiles").select("email, full_name").in("email", actorEmails)
      : none,
    teamIds.length
      ? supabase.from("platform_admins").select("user_id, full_name").in("user_id", teamIds)
      : none,
    profileIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
      : none,
    planIds.length ? supabase.from("plans").select("id, name").in("id", planIds) : none,
  ]);

  const map = (list: Record<string, unknown>[] | null, key: string, value: string) =>
    new Map((list ?? []).map((row) => [String(row[key]), text(row[value])]));

  const shopName = map(shops.data, "id", "shop_name");
  // The roster first: a console operator who also has a shop is named as the
  // console knows them.
  const actorName = new Map([
    ...map(staffByEmail.data, "email", "full_name"),
    ...map(teamByEmail.data, "email", "full_name"),
  ]);
  const subjectName = new Map([
    ...map(staff.data, "id", "full_name"),
    ...map(team.data, "user_id", "full_name"),
  ]);
  const planName = map(plans.data, "id", "name");

  return rows.map((row) => {
    const tenantId = row.tenant_id ? String(row.tenant_id) : null;
    const planId = text(field(row.after, "plan_id")) || text(field(row.before, "plan_id"));

    return {
      id: String(row.id),
      action: text(row.action),
      actorEmail: text(row.actor_email) || "system",
      actorKind: text(row.actor_kind),
      tenantId,
      shopName: tenantId ? (shopName.get(tenantId) ?? "") : "",
      actorName: actorName.get(text(row.actor_email)) ?? "",
      subjectType: text(row.subject_type),
      subjectId: text(row.subject_id),
      subjectName: subjectName.get(text(row.subject_id)) ?? "",
      planName: planName.get(planId) ?? "",
      before: row.before ?? null,
      after: row.after ?? null,
      createdAt: text(row.created_at),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Where a buyer sends the money                                              */
/* -------------------------------------------------------------------------- */

export type PaymentAccount = {
  id: string;
  method: AccountMethod;
  accountTitle: string;
  bankName: string;
  accountNumber: string;
  iban: string;
  isActive: boolean;
  sortOrder: number;
};

const toAccount = (row: Record<string, unknown>): PaymentAccount => ({
  id: String(row.id),
  method: text(row.method) as AccountMethod,
  accountTitle: text(row.account_title),
  bankName: text(row.bank_name),
  accountNumber: text(row.account_number),
  iban: text(row.iban),
  isActive: row.is_active === true,
  sortOrder: num(row.sort_order),
});

const ACCOUNT_COLUMNS =
  "id, method, account_title, bank_name, account_number, iban, is_active, sort_order";

/** Every account, on or off, for `/admin/payment-accounts`. Operator's JWT. */
export async function listPaymentAccounts(): Promise<PaymentAccount[]> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("payment_accounts")
    .select(ACCOUNT_COLUMNS)
    .order("sort_order")
    .order("created_at");

  if (error) {
    console.error("[admin] payment accounts read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map(toAccount);
}

/**
 * The accounts switched on, for `/order/[reference]` — a buyer with no session
 * at all. On the service role, the way that page already reads the order, and
 * filtered to `is_active` here rather than trusted to the caller: an account
 * taken off because its wallet hit the monthly ceiling must never print.
 *
 * A failed read is an empty list, never a throw — the page falls back to
 * "support will send the details", which is worse than the accounts and much
 * better than an error page in front of somebody holding the money.
 */
export async function listPublicPaymentAccounts(): Promise<PaymentAccount[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("payment_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  if (error) {
    console.error("[order] payment accounts read failed: %s", writeReadError(error));
    return [];
  }

  return (data ?? []).map(toAccount);
}
