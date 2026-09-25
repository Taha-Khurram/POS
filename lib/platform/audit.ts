/**
 * The audit trail's filter vocabulary — shared by the page, which turns it into
 * a query, and the filter bar, which draws it. No `server-only` and no imports,
 * the same split as `lib/pos/history.ts`: a filter the browser offers and the
 * server does not understand is a filter that silently shows everything.
 *
 * Everything lives in the URL, so "every sign-in last week" can be sent to
 * somebody as a link and the back button undoes a filter.
 */

export const AUDIT_PAGE_SIZE = 20;

/** Longest search the server will take. Anything longer is a paste accident. */
const QUERY_MAX = 80;

/**
 * An area is a set of action prefixes — the part before the dot. Grouped the
 * way an operator thinks about the console, not the way the tables are named:
 * nobody goes looking for `payment_account`, they go looking for "where the
 * money is sent".
 */
export const AUDIT_AREAS = [
  { id: "team", label: "Console team", prefixes: ["platform_admin"] },
  { id: "clients", label: "Clients", prefixes: ["tenant", "owner"] },
  { id: "subscriptions", label: "Subscriptions", prefixes: ["subscription"] },
  { id: "orders", label: "Orders", prefixes: ["order"] },
  { id: "payments", label: "Payments", prefixes: ["payment"] },
  { id: "plans", label: "Plans", prefixes: ["plan"] },
  { id: "accounts", label: "Payment accounts", prefixes: ["payment_account"] },
  { id: "leads", label: "Leads", prefixes: ["lead"] },
  {
    id: "till",
    label: "Sales and shifts",
    prefixes: ["sale", "shift"],
  },
  {
    id: "stock",
    label: "Products and stock",
    prefixes: ["item", "items", "department", "category", "batch", "variant", "variants"],
  },
  {
    id: "buying",
    label: "Buying",
    prefixes: ["supplier", "supplier_payment", "goods_receipt", "purchase_order"],
  },
  {
    id: "shop",
    label: "Shop settings and staff",
    prefixes: ["shop", "counter", "staff", "customer"],
  },
] as const;

export type AuditAreaId = (typeof AUDIT_AREAS)[number]["id"];

/** `actor_kind` as stored, and what an operator calls it. */
export const AUDIT_ACTORS = [
  { id: "platform_admin", label: "Flo console", description: "Somebody working /admin" },
  { id: "tenant_user", label: "A shop", description: "An owner or cashier in /app" },
  { id: "system", label: "Automatic", description: "The hourly sweep and other jobs" },
] as const;

export type AuditActorId = (typeof AUDIT_ACTORS)[number]["id"];

export const AUDIT_RANGES = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "custom", label: "Pick dates" },
] as const;

export type AuditRangeId = (typeof AUDIT_RANGES)[number]["id"];

export type AuditFilters = {
  q: string;
  area: AuditAreaId | "";
  who: AuditActorId | "";
  range: AuditRangeId;
  /** `YYYY-MM-DD`, only read when `range` is `custom`. */
  from: string;
  to: string;
  /** One shop, by id — set from an entry's "Everything for this shop". */
  shop: string;
  /** 1-based. */
  page: number;
};

export const NO_AUDIT_FILTERS: AuditFilters = {
  q: "",
  area: "",
  who: "",
  range: "all",
  from: "",
  to: "",
  shop: "",
  page: 1,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/** Whatever the URL says, made safe. A value it does not recognise is dropped
 *  rather than refused — a stale link should open the trail, not an error. */
export function parseAuditFilters(params: Params): AuditFilters {
  const area = one(params.area);
  const who = one(params.who);
  const range = one(params.range);
  const from = one(params.from);
  const to = one(params.to);
  const shop = one(params.shop);
  const page = Number.parseInt(one(params.page), 10);

  return {
    q: one(params.q).slice(0, QUERY_MAX),
    area: AUDIT_AREAS.some((entry) => entry.id === area) ? (area as AuditAreaId) : "",
    who: AUDIT_ACTORS.some((entry) => entry.id === who) ? (who as AuditActorId) : "",
    range: AUDIT_RANGES.some((entry) => entry.id === range) ? (range as AuditRangeId) : "all",
    from: DATE.test(from) ? from : "",
    to: DATE.test(to) ? to : "",
    shop: UUID.test(shop) ? shop : "",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The other direction: only what differs from the default goes in the URL,
 *  so an unfiltered trail is plain `/admin/audit`. */
export function auditSearch(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.area) params.set("area", filters.area);
  if (filters.who) params.set("who", filters.who);
  if (filters.range !== "all") params.set("range", filters.range);
  if (filters.range === "custom" && filters.from) params.set("from", filters.from);
  if (filters.range === "custom" && filters.to) params.set("to", filters.to);
  if (filters.shop) params.set("shop", filters.shop);
  if (filters.page > 1) params.set("page", String(filters.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** Anything narrowing the list other than the page it is on. */
export const isNarrowed = (filters: AuditFilters): boolean =>
  Boolean(
    filters.q ||
      filters.area ||
      filters.who ||
      filters.shop ||
      filters.range !== "all",
  );

const DAY = 86_400_000;

/** Pakistan has no daylight saving, so a PKT midnight is always `+05:00`. The
 *  console's operators are in Pakistan, and "today" is theirs, not UTC's. */
const PKT = "+05:00";

function todayInPkt(now: Date): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The instants a range covers, as ISO strings, half-open: `since <= t < until`.
 * Either end can be null for "no bound". A custom range whose ends were typed
 * backwards is read the right way round rather than coming back empty.
 */
export function auditWindow(
  filters: AuditFilters,
  now = new Date(),
): { since: string | null; until: string | null } {
  const midnight = (day: string) => new Date(`${day}T00:00:00${PKT}`);
  const today = midnight(todayInPkt(now));

  switch (filters.range) {
    case "today":
      return { since: today.toISOString(), until: null };
    case "7d":
    case "30d":
    case "90d": {
      // "Last 7 days" is today and the six before it, the definition the
      // dashboard and `platform_clients()` already use.
      const days = Number.parseInt(filters.range, 10);
      return { since: new Date(today.getTime() - (days - 1) * DAY).toISOString(), until: null };
    }
    case "custom": {
      let [from, to] = [filters.from, filters.to];
      if (from && to && from > to) [from, to] = [to, from];
      return {
        since: from ? midnight(from).toISOString() : null,
        until: to ? new Date(midnight(to).getTime() + DAY).toISOString() : null,
      };
    }
    default:
      return { since: null, until: null };
  }
}

/**
 * `tenant.note_removed` → "Note removed", with the area as the second half of
 * the label. The stored action is still printed beside it in mono: this is a
 * reading aid, and the code is what somebody searches for.
 */
export function describeAction(action: string): { verb: string; subject: string } {
  const dot = action.indexOf(".");
  const head = dot === -1 ? action : action.slice(0, dot);
  const tail = dot === -1 ? "" : action.slice(dot + 1);
  const words = (value: string) => value.replace(/_/g, " ").trim();
  const verb = words(tail || head);

  return {
    verb: verb.charAt(0).toUpperCase() + verb.slice(1),
    subject: SUBJECTS[head] ?? words(head),
  };
}

const SUBJECTS: Record<string, string> = {
  platform_admin: "Console team",
  tenant: "Client",
  owner: "Shop owner",
  subscription: "Subscription",
  order: "Order",
  payment: "Payment",
  payment_account: "Payment account",
  plan: "Plan",
  lead: "Lead",
  sale: "Sale",
  shift: "Shift",
  item: "Product",
  items: "Products",
  department: "Department",
  category: "Category",
  batch: "Batch",
  variant: "Variant",
  variants: "Variants",
  supplier: "Supplier",
  supplier_payment: "Supplier payment",
  goods_receipt: "Delivery",
  purchase_order: "Purchase order",
  shop: "Shop",
  counter: "Counter",
  staff: "Staff",
  customer: "Customer",
};

/** How the area filter reaches PostgREST: one `like` per prefix, ORed. */
export function areaPrefixes(area: AuditAreaId | ""): readonly string[] {
  return AUDIT_AREAS.find((entry) => entry.id === area)?.prefixes ?? [];
}

/* -------------------------------------------------------------------------- */
/* The sentence                                                               */
/* -------------------------------------------------------------------------- */

/** What `describeEntry` needs of a row — structurally `AuditRow`, restated so
 *  this file keeps importing nothing from a `server-only` module. */
export type AuditFacts = {
  action: string;
  actorEmail: string;
  actorName: string;
  actorKind: string;
  shopName: string;
  tenantId: string | null;
  subjectName: string;
  planName: string;
  before: unknown;
  after: unknown;
};

export type AuditSentence = {
  /** Who, drawn bold at the start of the line. */
  actor: string;
  /** Everything after the name, in the operator's words. */
  did: string;
  /** A second, quieter line — an amount, a reason, what changed. */
  detail: string;
};

const METHODS: Record<string, string> = {
  cash: "cash",
  card: "card",
  bank_transfer: "bank transfer",
  easypaisa: "Easypaisa",
  jazzcash: "JazzCash",
  raast: "Raast",
};

const STANDINGS: Record<string, string> = {
  active: "active",
  trialing: "on trial",
  past_due: "past due",
  suspended: "suspended",
  cancelled: "cancelled",
  paused: "paused",
};

const ROLES: Record<string, string> = {
  owner: "an owner",
  manager: "a manager",
  cashier: "a cashier",
};

const SCREENS: Record<string, string> = {
  overview: "Overview",
  clients: "Clients",
  orders: "Orders",
  payments: "Payments",
  leads: "Leads",
};

const rupees = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `Rs ${amount.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`
    : "";
};

const DAY_STAMP = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const day = (value: unknown): string => {
  const at = new Date(String(value ?? ""));
  return Number.isNaN(at.getTime()) ? "" : DAY_STAMP.format(at);
};

const list = (values: string[]): string =>
  values.length <= 1
    ? (values[0] ?? "")
    : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;

const join = (...parts: (string | false | null | undefined | 0)[]) =>
  parts.filter(Boolean).join(" · ");

/** Collapses the double space a missing value leaves in a template. */
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * One entry as a sentence: "**Taha Khurram** suspended Muhammad Ibrahim's
 * console login". Every figure in it is read off the row as stored — nothing
 * is looked up that could have changed since, bar the names, and a name that
 * has gone falls back to what the payload kept or to a plain noun.
 *
 * An action this list does not know still gets a readable line out of its own
 * spelling, so a new `recordAudit` call never draws a blank row. Add it here
 * when it lands anyway: "updated — item" is legible, not a sentence.
 */
export function describeEntry(row: AuditFacts): AuditSentence {
  const a = (row.after ?? {}) as Record<string, unknown>;
  const b = (row.before ?? {}) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const pick = (key: string) => str(a[key]) || str(b[key]);

  const actor =
    row.actorKind === "system" || row.actorEmail === "system"
      ? "Flo"
      : row.actorName || row.actorEmail;

  const shop =
    row.shopName || str(a.shop_name) || (row.tenantId ? "a deleted shop" : "a shop");
  const person = row.subjectName || pick("full_name") || pick("email") || "a team member";
  const staffer = row.subjectName || pick("full_name") || pick("email") || "a staff member";
  const method = (value: unknown) => METHODS[str(value)] ?? str(value).replace(/_/g, " ");
  const plan = row.planName || pick("name");
  const name = pick("name");
  const quoted = (value: string) => (value ? `“${value}”` : "");
  const count = (value: unknown) => Number(value) || 0;

  const say = (did: string, detail = ""): AuditSentence => ({
    actor,
    did: tidy(did),
    detail,
  });

  switch (row.action) {
    /* The console team ---------------------------------------------------- */
    case "platform_admin.signed_in":
      return say("signed in to the console");
    case "platform_admin.sign_in_failed":
      return say(
        "tried to sign in to the console and was refused",
        "Wrong password, or the login is switched off",
      );
    case "platform_admin.signed_out":
      return say("signed out of the console");
    case "platform_admin.created": {
      const screens = Array.isArray(a.screens) ? (a.screens as string[]) : [];
      return say(
        `added ${person} to the console team`,
        join(
          pick("email"),
          screens.length > 0 && `Can open ${list(screens.map((id) => SCREENS[id] ?? id))}`,
        ),
      );
    }
    case "platform_admin.screens_changed": {
      const was = Array.isArray(b.screens) ? (b.screens as string[]) : [];
      const now = Array.isArray(a.screens) ? (a.screens as string[]) : [];
      const label = (ids: string[]) => list(ids.map((id) => SCREENS[id] ?? id));
      const added = now.filter((id) => !was.includes(id));
      const removed = was.filter((id) => !now.includes(id));
      return say(
        `changed which screens ${person} can open`,
        join(
          added.length > 0 && `Added ${label(added)}`,
          removed.length > 0 && `Took away ${label(removed)}`,
        ) || (now.length > 0 ? `Now ${label(now)}` : "No screens"),
      );
    }
    case "platform_admin.suspended":
      return say(`suspended ${person}’s console login`);
    case "platform_admin.reinstated":
      return say(`reinstated ${person}’s console login`);
    case "platform_admin.password_reset":
      return say(`set a new password for ${person}`, pick("email"));
    case "platform_admin.login_revealed":
      return say(`looked at ${person}’s login details`, pick("email"));
    case "platform_admin.revoked":
      return say(`removed ${person} from the console team`, "Their shop login still works");
    case "platform_admin.deleted":
      return say(`deleted ${person}’s console account`, pick("email"));

    /* Orders and clients -------------------------------------------------- */
    case "order.accepted":
      return say(`accepted the order from ${shop} and made it a client`);
    case "order.rejected":
      return say(
        "turned down an order",
        str(a.rejection_reason) && `Reason: ${str(a.rejection_reason)}`,
      );
    case "tenant.created":
      return say(`added ${shop} as a client`);
    case "tenant.activated":
      return say(
        `activated ${shop}${plan ? ` on the ${plan} plan` : ""}`,
        join(
          rupees(a.agreed_price) && `${rupees(a.agreed_price)} ${str(a.billing_cycle) || "monthly"}`,
          Boolean(a.current_period_end) && `Paid up to ${day(a.current_period_end)}`,
        ),
      );
    case "tenant.updated":
      return say(`updated ${shop}’s details`, changedList(b, a));
    case "tenant.noted":
      return say(`added a note to ${shop}`);
    case "tenant.note_removed":
      return say(`removed a note from ${shop}`);
    case "owner.login_created":
      return say(`created the owner’s login for ${shop}`, pick("email"));
    case "owner.password_reset":
      return say(`set a new owner password for ${shop}`, pick("email"));

    /* Subscriptions ------------------------------------------------------- */
    case "subscription.updated":
      return say(`changed ${shop}’s plan terms`, changedList(b, a) || "Saved with no changes");
    case "subscription.period_corrected":
      return say(
        `corrected ${shop}’s renewal date`,
        a.current_period_end ? `Now ${day(a.current_period_end)}` : "",
      );
    case "subscription.extended":
      return say(
        `gave ${shop} ${count(a.days) || "some"} extra ${count(a.days) === 1 ? "day" : "days"}`,
        a.current_period_end ? `Now renews ${day(a.current_period_end)}` : "",
      );
    case "subscription.paused":
      return say(`paused ${shop}’s subscription`, "The till is stopped, and the clock with it");
    case "subscription.resumed":
      return say(`resumed ${shop}’s subscription`);

    /* Money --------------------------------------------------------------- */
    case "payment.recorded":
      return say(
        `recorded ${rupees(a.amount) || "a payment"} ${row.tenantId ? `from ${shop}` : "against an order"}`,
        join(
          str(a.method) && `By ${method(a.method)}`,
          str(a.reference) && `Ref ${str(a.reference)}`,
          Boolean(a.current_period_end) && `Paid up to ${day(a.current_period_end)}`,
        ),
      );
    case "payment.removed":
      return say(
        `removed a payment of ${rupees(b.amount) || "an unknown amount"}${row.tenantId ? ` from ${shop}` : ""}`,
        str(b.method) && `It was by ${method(b.method)}`,
      );
    case "payment_account.created":
      return say(
        `added a ${method(a.method)} account`,
        join(str(a.account_title), str(a.bank_name), str(a.account_number)),
      );
    case "payment_account.updated":
      return say(`edited the payment account ${quoted(pick("account_title"))}`, changedList(b, a));
    case "payment_account.enabled":
      return say(
        `switched on the payment account ${quoted(pick("account_title"))}`,
        "Buyers are shown it after checkout",
      );
    case "payment_account.disabled":
      return say(`switched off the payment account ${quoted(pick("account_title"))}`);
    case "payment_account.deleted":
      return say(
        `deleted the payment account ${quoted(pick("account_title"))}`,
        join(str(b.method) && method(b.method), str(b.account_number)),
      );

    /* Plans and leads ----------------------------------------------------- */
    case "plan.created":
      return say(`created the ${plan || "new"} plan`, rupees(a.list_price));
    case "plan.updated":
      return say(`edited the ${plan || "a"} plan`, changedList(b, a));
    case "plan.enabled":
      return say(`put the ${plan || "a"} plan on sale`);
    case "plan.disabled":
      return say(`took the ${plan || "a"} plan off sale`);
    case "lead.updated":
      return say(
        "updated a lead",
        join(
          str(a.status) && `Marked ${str(a.status).replace(/_/g, " ")}`,
          str(a.notes) && `“${str(a.notes)}”`,
        ),
      );

    /* The till ------------------------------------------------------------ */
    case "sale.recorded": {
      const parts = Array.isArray(a.tenders) ? (a.tenders as Record<string, unknown>[]) : [];
      const total = parts.reduce((sum, part) => sum + (Number(part.amount) || 0), 0);
      return say(
        `rang up bill ${str(a.receipt_number)}`,
        join(parts.length > 0 && rupees(total), list(parts.map((part) => method(part.method)))),
      );
    }
    case "sale.refunded":
      return say(
        `refunded ${rupees(a.refunded) || "part of"} on bill ${str(a.refunds_receipt)}`,
        join(
          str(a.receipt_number) && `Refund slip ${str(a.receipt_number)}`,
          a.restocked === true ? "Put back on the shelf" : "Not restocked",
        ),
      );
    case "shift.opened":
      return say("opened a shift", rupees(a.opening_float) && `Float ${rupees(a.opening_float)}`);
    case "shift.closed": {
      const over = Number(a.over_short);
      return say(
        "closed a shift",
        join(
          rupees(a.counted) && `Counted ${rupees(a.counted)}`,
          rupees(a.expected) && `Expected ${rupees(a.expected)}`,
          a.over_short !== null &&
            Number.isFinite(over) &&
            over !== 0 &&
            `${over > 0 ? "Over" : "Short"} by ${rupees(Math.abs(over))}`,
        ),
      );
    }

    /* Products and stock -------------------------------------------------- */
    case "item.added":
      return say(
        `added the product ${quoted(name)}`,
        rupees(a.selling_price) && `Sells at ${rupees(a.selling_price)}`,
      );
    case "item.updated":
      return say(`edited the product ${quoted(name)}`, changedList(b, a));
    case "item.deleted":
      return say(`deleted the product ${quoted(name)}`);
    case "items.imported":
      return say(
        `imported ${count(a.inserted)} products from a file`,
        join(
          count(a.skipped) > 0 && `${count(a.skipped)} rows skipped`,
          a.rows !== undefined && `${count(a.rows)} rows in the file`,
        ),
      );
    case "department.added":
      return say(`added the department ${quoted(name)}`);
    case "department.deleted":
      return say(`deleted the department ${quoted(name)}`);
    case "category.added":
      return say(`added the category ${quoted(name)}`, pick("department") && `Under ${pick("department")}`);
    case "category.deleted":
      return say(
        `deleted the category ${quoted(name)}`,
        pick("department") && `Was under ${pick("department")}`,
      );
    case "batch.opened":
      return say(
        `opened a batch of ${count(a.quantity)} × ${quoted(str(a.item_name)) || "an item"}`,
        join(
          str(a.batch_no) && `Batch ${str(a.batch_no)}`,
          Boolean(a.expires_on) && `Expires ${day(a.expires_on)}`,
        ),
      );
    case "batch.counted":
      return say(
        `counted batch ${str(a.batch_no) || "(no number)"}`,
        `${count(b.quantity)} → ${count(a.quantity)}`,
      );
    case "batch.written_off":
      return say(
        `wrote off expired batch ${str(a.batch_no) || "(no number)"}`,
        join(
          `${count(b.quantity)} thrown away`,
          Boolean(a.expires_on) && `Expired ${day(a.expires_on)}`,
        ),
      );
    case "variants.saved":
      return say(
        `saved ${count(a.rows)} sizes and colours for ${quoted(str(a.item_name)) || "a product"}`,
        count(a.switched_off) > 0 ? `${count(a.switched_off)} switched off` : "",
      );
    case "variant.counted":
      return say(
        `counted ${quoted(str(a.variant)) || "a variant"}`,
        `${count(b.quantity)} → ${count(a.quantity)}`,
      );

    /* Buying -------------------------------------------------------------- */
    case "supplier.added":
      return say(`added the supplier ${quoted(name)}`);
    case "supplier.updated":
      return say(`edited the supplier ${quoted(name)}`, changedList(b, a));
    case "supplier.deleted":
      return say(`deleted the supplier ${quoted(name)}`);
    case "supplier_payment.recorded":
      return say(
        `paid ${str(a.supplier_name) || "a supplier"} ${rupees(a.amount)}`,
        join(str(a.method) && `By ${method(a.method)}`, str(a.reference) && `Ref ${str(a.reference)}`),
      );
    case "supplier_payment.deleted":
      return say(`deleted a supplier payment of ${rupees(b.amount) || "an unknown amount"}`);
    case "goods_receipt.recorded":
      return say(
        `received delivery ${str(a.grn_number)}`,
        join(rupees(a.total), str(a.supplier_invoice_no) && `Invoice ${str(a.supplier_invoice_no)}`),
      );
    case "purchase_order.placed":
      return say(
        `placed purchase order ${str(a.order_number)}`,
        join(rupees(a.total), a.lines !== undefined && `${count(a.lines)} lines`),
      );
    case "purchase_order.saved":
      return say(`saved purchase order ${str(a.order_number)} as a draft`);
    case "purchase_order.status":
      return say(`marked purchase order ${str(a.order_number)} as ${str(a.status) || "changed"}`);

    /* The shop ------------------------------------------------------------ */
    case "staff.added":
      return say(`added ${staffer} as ${ROLES[str(a.tenant_role)] ?? "staff"}`, pick("email"));
    case "staff.updated":
      return say(`edited ${staffer}’s account`, changedList(b, a));
    case "staff.suspended":
      return say(`switched off ${staffer}’s login`);
    case "staff.reinstated":
      return say(`switched ${staffer}’s login back on`);
    case "staff.password_reset":
      return say(`set a new password for ${staffer}`, pick("email"));
    case "staff.deleted":
      return say(`deleted ${staffer}’s account`, pick("email"));
    case "shop.details_updated":
      return say("updated the shop’s details", changedList(b, a));
    case "shop.settings_updated":
      return say("changed the shop’s settings", changedList(b, a));
    case "shop.permissions_updated":
      return say("changed what each role is allowed to do");
    case "counter.added":
      return say(`added the counter ${quoted(name)}`);
    case "counter.opened":
      return say(`opened the counter ${quoted(name)}`);
    case "counter.closed":
      return say(`closed the counter ${quoted(name)}`);
    case "counter.deleted":
      return say(`deleted the counter ${quoted(name)}`);
    case "customer.added":
      return say(`added the customer ${quoted(name)}`, pick("phone"));
    case "customer.updated":
      return say(`edited the customer ${quoted(name)}`, changedList(b, a));
    case "customer.deleted":
      return say(`deleted the customer ${quoted(name)}`);
  }

  // `subscription.<standing>` is one call with the standing in the name.
  if (row.action.startsWith("subscription.")) {
    const standing = row.action.slice("subscription.".length);
    if (STANDINGS[standing]) return say(`marked ${shop} as ${STANDINGS[standing]}`);
  }

  const { verb, subject } = describeAction(row.action);
  return say(`${verb.toLowerCase()} — ${subject.toLowerCase()}`);
}

/** Field names that read as words, for "Changed price and counters". */
const FIELD_WORDS: Record<string, string> = {
  agreed_price: "price",
  billing_cycle: "billing cycle",
  max_registers: "counters",
  max_branches: "branches",
  grace_days: "grace days",
  plan_id: "plan",
  list_price: "price",
  selling_price: "price",
  cost_price: "cost",
  shop_name: "shop name",
  is_active: "on/off",
  account_title: "account title",
  account_number: "account number",
  tenant_role: "role",
  full_name: "name",
  opening_balance: "opening balance",
  payment_terms_days: "payment terms",
};

/** "Changed price and counters", or nothing when there was no before to
 *  compare with. Top-level keys only — this names where to look, and the
 *  sheet has the JSON. */
function changedList(before: Record<string, unknown>, after: Record<string, unknown>): string {
  if (Object.keys(before).length === 0) return "";
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) =>
      key !== "updated_at" &&
      key in after &&
      JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
  if (keys.length === 0) return "";
  const words = keys.map((key) => FIELD_WORDS[key] ?? key.replace(/_/g, " "));
  return `Changed ${list(words.length > 4 ? [...words.slice(0, 4), `${words.length - 4} more`] : words)}`;
}

/* -------------------------------------------------------------------------- */
/* The record, in words                                                       */
/* -------------------------------------------------------------------------- */

/** Where the actor was when they did it, for the sheet's "Where" line. */
export const AUDIT_WHERE: Record<string, string> = {
  platform_admin: "In the Flo console",
  tenant_user: "In a shop’s app",
  system: "Done automatically by Flo",
};

const SUBJECT_TYPES: Record<string, string> = {
  platform_admin: "A console team member",
  profile: "A person’s login",
  tenant: "A client",
  tenant_note: "A note on a client",
  tenant_settings: "The shop’s settings",
  role_permissions: "What each role may do",
  subscription: "A subscription",
  order: "An order",
  payment: "A payment",
  payment_account: "A payment account",
  plan: "A plan",
  lead: "A lead",
  sale: "A bill",
  shift: "A shift",
  item: "A product",
  department: "A department",
  category: "A category",
  supplier: "A supplier",
  supplier_payment: "A supplier payment",
  goods_receipt: "A delivery",
  purchase_order: "A purchase order",
  counter: "A counter",
  customer: "A customer",
};

/** "A payment account — Muhammad Taha Khurram". Never an id: the sheet has the
 *  sentence for what happened, and this only says what kind of thing it was. */
export function subjectLabel(row: AuditFacts & { subjectType: string }): string {
  const kind = SUBJECT_TYPES[row.subjectType] ?? "";
  if (!kind) return "";
  const a = (row.after ?? {}) as Record<string, unknown>;
  const b = (row.before ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name =
    row.subjectName ||
    text(a.full_name) || text(b.full_name) ||
    text(a.name) || text(b.name) ||
    text(a.account_title) || text(b.account_title) ||
    text(a.item_name) ||
    text(a.receipt_number) || text(a.order_number) || text(a.grn_number) ||
    text(a.shop_name) ||
    (row.subjectType === "plan" ? row.planName : "") ||
    (row.subjectType === "tenant" || row.subjectType === "subscription" ? row.shopName : "");
  return name ? `${kind} — ${name}` : kind;
}

/** Words for the keys the console stores. Anything missing reads as its own
 *  spelling with the underscores taken out, which is plain enough. */
const LABELS: Record<string, string> = {
  ...FIELD_WORDS,
  agreed_price: "Price",
  list_price: "Price",
  selling_price: "Selling price",
  cost_price: "Cost price",
  plan_id: "Plan",
  is_active: "Switched on",
  current_period_end: "Paid up to",
  paid_at: "Paid on",
  paid_on: "Paid on",
  received_on: "Received on",
  expires_on: "Expires on",
  opening_balance_on: "Opening balance date",
  trial_days: "Trial days",
  rejection_reason: "Reason",
  supplier_invoice_no: "Supplier’s invoice",
  grn_number: "Delivery number",
  order_number: "Order number",
  receipt_number: "Bill number",
  refunds_receipt: "Refunds bill",
  over_short: "Over / short",
  opening_float: "Opening float",
  other_cost: "Other costs",
  tax_number: "Tax number",
  contact_name: "Contact",
  bank_name: "Bank",
  iban: "IBAN",
  sku: "SKU",
  tenders: "Paid by",
  screens: "Screens",
  switched_off: "Switched off",
  item_name: "Product",
  batch_no: "Batch",
  shop_name: "Shop name",
  email: "Email",
  phone: "Phone",
  address: "Address",
  notes: "Notes",
  status: "Status",
  method: "Method",
  reference: "Reference",
  amount: "Amount",
  name: "Name",
  full_name: "Name",
  code: "Code",
  pitch: "Description",
  highlights: "Extra lines",
  features: "Features",
  cycles: "Periods paid for",
  days: "Days",
};

/** Keys that are plumbing rather than information — ids the reader cannot do
 *  anything with, and bookkeeping stamps. `plan_id` is the exception, because
 *  it can be read as the plan's name. */
const HIDDEN = (key: string) =>
  key !== "plan_id" &&
  (key === "id" ||
    key.endsWith("_id") ||
    key === "created_at" ||
    key === "updated_at" ||
    key === "sort_order" ||
    key === "created_by");

const MONEY = new Set([
  "amount", "agreed_price", "list_price", "selling_price", "cost_price", "total",
  "subtotal", "freight", "other_cost", "opening_float", "counted", "expected",
  "over_short", "card", "opening_balance", "refunded", "discount",
]);

const label = (key: string) => {
  const word = LABELS[key] ?? key.replace(/_/g, " ");
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** One value as a person would say it. */
function spoken(key: string, value: unknown, planName: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "plan_id") return planName || "Another plan";
  if (typeof value === "boolean") {
    if (key === "is_active") return value ? "On" : "Off";
    return value ? "Yes" : "No";
  }
  if (MONEY.has(key) && Number.isFinite(Number(value))) return rupees(value);
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  if (key === "method") return capital(METHODS[String(value)] ?? String(value).replace(/_/g, " "));
  if (key === "status") return capital(STANDINGS[String(value)] ?? String(value).replace(/_/g, " "));
  if (key === "tenant_role") return (ROLES[String(value)] ?? String(value)).replace(/^an? /, "");
  if (key === "billing_cycle") {
    const cycle = String(value);
    return cycle.charAt(0).toUpperCase() + cycle.slice(1);
  }
  if (key === "screens" && Array.isArray(value)) {
    return value.length ? list(value.map((id) => SCREENS[String(id)] ?? String(id))) : "None";
  }
  if (key === "tenders" && Array.isArray(value)) {
    return list(
      value.map((part) => {
        const p = (part ?? {}) as Record<string, unknown>;
        return `${METHODS[String(p.method)] ?? String(p.method ?? "")} ${rupees(p.amount)}`.trim();
      }),
    );
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return day(value) || value;
  if (typeof value === "number") return value.toLocaleString("en-PK");
  if (Array.isArray(value)) {
    return value.length
      ? list(value.map((part) => (typeof part === "object" ? summarise(part) : String(part))))
      : "None";
  }
  if (typeof value === "object") return summarise(value);
  return String(value);
}

/** A nested object on one line — "Name Lawn, Price Rs 1,200". */
function summarise(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "—");
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !HIDDEN(key))
    .map(([key, inner]) => `${label(key)} ${spoken(key, inner, "")}`)
    .join(", ");
}

export type AuditField = { label: string; before: string; after: string };

export type AuditRecord =
  /** Before and after both stored: the fields that differ. */
  | { kind: "changed"; fields: AuditField[] }
  /** Only an after: what was saved. */
  | { kind: "saved"; fields: AuditField[] }
  /** Only a before: what was there when it went. */
  | { kind: "removed"; fields: AuditField[] }
  /** A before and an after that are identical. */
  | { kind: "unchanged" }
  | { kind: "none" };

/**
 * The stored before-and-after, as rows a person can read. A nested object one
 * level down — a plan's feature flags — is opened out into a row per flag, so
 * "Features changed" becomes "CSV export: No → Yes", which is the part anybody
 * actually wanted to know.
 */
export function describeRecord(row: AuditFacts): AuditRecord {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const flatten = (source: unknown): Map<string, { key: string; label: string; value: unknown }> => {
    const out = new Map<string, { key: string; label: string; value: unknown }>();
    if (!isObject(source)) return out;
    for (const [key, value] of Object.entries(source)) {
      if (HIDDEN(key)) continue;
      if (isObject(value)) {
        for (const [inner, innerValue] of Object.entries(value)) {
          if (HIDDEN(inner)) continue;
          out.set(`${key}.${inner}`, {
            key: inner,
            label: `${label(key)}: ${label(inner).toLowerCase()}`,
            value: innerValue,
          });
        }
      } else {
        out.set(key, { key, label: label(key), value });
      }
    }
    return out;
  };

  const before = flatten(row.before);
  const after = flatten(row.after);
  const say = (entry: { key: string; value: unknown } | undefined) =>
    entry ? spoken(entry.key, entry.value, row.planName) : "—";

  if (before.size === 0 && after.size === 0) return { kind: "none" };

  // A new record lists what was filled in. Eight rows of "—" under a supplier
  // saved with only a name is noise between the reader and the name.
  const filled = (entry: { value: unknown }) =>
    entry.value !== null && entry.value !== undefined && entry.value !== "";

  if (before.size === 0) {
    return {
      kind: "saved",
      fields: [...after.values()].filter(filled).map((entry) => ({
        label: entry.label,
        before: "",
        after: say(entry),
      })),
    };
  }

  if (after.size === 0) {
    return {
      kind: "removed",
      fields: [...before.values()].filter(filled).map((entry) => ({
        label: entry.label,
        before: say(entry),
        after: "",
      })),
    };
  }

  // Only the keys the after side speaks about: a before that stored the whole
  // row beside an after that stored three fields did not blank the rest.
  const fields = [...after.entries()]
    .filter(([path, entry]) => JSON.stringify(before.get(path)?.value ?? null) !== JSON.stringify(entry.value ?? null))
    .map(([path, entry]) => ({
      label: entry.label,
      before: say(before.get(path)),
      after: say(entry),
    }));

  return fields.length > 0 ? { kind: "changed", fields } : { kind: "unchanged" };
}
