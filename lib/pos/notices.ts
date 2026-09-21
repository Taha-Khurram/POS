import type { TenantRole } from "@/lib/auth";
import type { ModuleAccess, ModuleKey } from "@/lib/pos/modules";

/**
 * What the bell has to say.
 *
 * No `server-only`, for the reason `modules.ts` carries none: the topbar is a
 * client component and has to type against the same notices the server decided
 * on. The decision itself is the pure function below, called from the layout —
 * what crosses to the browser is the shortlist, never the subscription row or
 * the stock counts that produced it.
 *
 * Every notice names the module it belongs to, and `visibleNotices` drops the
 * ones this person could not act on anyway. That is not decoration: "4 items
 * are out of stock" tells a cashier who may not edit items a number they cannot
 * do anything about, and a renewal date tells them what the owner pays. A
 * notification is a small piece of whatever screen it points at, so it inherits
 * that screen's permission rather than getting one of its own.
 *
 * There is no notifications table. Everything here is derived at render time
 * from rows the console already keeps — the subscription, the shop's counters,
 * the catalog — so nothing has to be written, expired or swept up, and a notice
 * disappears the moment the thing it is about is dealt with. When a notice
 * needs to outlive its cause (a message from support, say), that is the point
 * at which it earns a table.
 */

export type NoticeTone = "info" | "warn" | "bad";

export type Notice = {
  id: string;
  title: string;
  detail: string;
  /** When, in words. Nothing here is precise to the minute, so nor is this. */
  at: string;
  tone: NoticeTone;
  /** Where pressing it goes, or null when there is nowhere useful to send. */
  href: string | null;
  /** The module a person must be able to reach to be told this at all. */
  module: ModuleKey;
  /** Money and plan limits are the owner's business and nobody else's — the
   *  `settings` module alone is too wide, since a manager can see that screen. */
  ownerOnly?: boolean;
};

export type NoticeFacts = {
  subscription: {
    status: string;
    planName: string;
    /** Negative once the period has passed. */
    daysUntilExpiry: number;
    maxRegisters: number;
  } | null;
  counters: { id: string; name: string; isActive: boolean }[];
  /** How many catalog rows are at zero, and how many are under their own
   *  `lowAt`. Counted by the caller so this stays a pure function. */
  stock: { out: number; low: number };
  /** Batch-tracked items with stock past its date or nearly there. Counted by
   *  `expiryCounts`, which decides "going off" with the same `expiryState` the
   *  badges use — a second definition written as a date predicate in SQL is the
   *  copy that drifts from the one the shopkeeper is looking at. Zeroes for a
   *  shop that tracks nothing, which is most of them. */
  expiry: { expired: number; critical: number; expiredUnits: number };
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Worst first. A bell that lists the renewal above a shut till has sorted by
 *  the order the code happened to run in, which is not an order. */
const RANK: Record<NoticeTone, number> = { bad: 0, warn: 1, info: 2 };

export function buildNotices(facts: NoticeFacts): Notice[] {
  const notices: Notice[] = [];
  const { subscription, counters, stock, expiry } = facts;

  /* ---------------- The shop's standing with us ---------------- */

  if (subscription) {
    const days = subscription.daysUntilExpiry;

    if (subscription.status === "suspended" || subscription.status === "cancelled") {
      notices.push({
        id: "billing-stopped",
        title: "Billing is on hold",
        detail: `Your ${subscription.planName} plan is ${subscription.status}. Message us on WhatsApp and we will sort it out.`,
        at: "Now",
        tone: "bad",
        href: "/app/settings",
        module: "settings",
        ownerOnly: true,
      });
    } else if (subscription.status === "past_due") {
      notices.push({
        id: "billing-past-due",
        title: "Payment is past due",
        detail:
          "The till keeps working. We will send the invoice again on the same WhatsApp number.",
        at: days < 0 ? `${plural(-days, "day", "days")} ago` : "Today",
        tone: "warn",
        href: "/app/settings",
        module: "settings",
        ownerOnly: true,
      });
    } else if (days < 0) {
      notices.push({
        id: "plan-expired",
        title: "Plan period has ended",
        detail: `Your ${subscription.planName} plan ran out. Message us on WhatsApp to carry on.`,
        at: `${plural(-days, "day", "days")} ago`,
        tone: "warn",
        href: "/app/settings",
        module: "settings",
        ownerOnly: true,
      });
    } else if (days <= 14) {
      notices.push({
        id: "plan-renewal",
        title:
          days === 0
            ? "Plan renews today"
            : `Plan renews in ${plural(days, "day", "days")}`,
        detail: "We will send the invoice on WhatsApp.",
        at: days === 0 ? "Today" : `In ${plural(days, "day", "days")}`,
        tone: "info",
        href: "/app/settings",
        module: "settings",
        ownerOnly: true,
      });
    }
  }

  /* ---------------- The tills ---------------- */

  const open = counters.filter((counter) => counter.isActive);
  const shut = counters.filter((counter) => !counter.isActive);

  // Everyone hears this one. A cashier standing at a register that will refuse
  // every sale needs to know why before the queue tells them.
  if (counters.length > 0 && open.length === 0) {
    notices.push({
      id: "no-counter-open",
      title: "No counter is open",
      detail: "Nothing can be billed until one is opened again.",
      at: "Now",
      tone: "bad",
      href: "/app/settings?tab=counter",
      module: "register",
    });
  } else if (shut.length > 0) {
    notices.push({
      id: "counter-shut",
      title:
        shut.length === 1
          ? `${shut[0].name} is shut`
          : `${plural(shut.length, "counter is", "counters are")} shut`,
      detail: "Its takings stay in the days it took them. Open it when it is back.",
      at: "Now",
      tone: "info",
      href: "/app/settings?tab=counter",
      module: "settings",
      ownerOnly: true,
    });
  }

  if (subscription && counters.length >= subscription.maxRegisters) {
    notices.push({
      id: "counters-full",
      title: `All ${plural(subscription.maxRegisters, "counter", "counters")} on your plan are set up`,
      detail: "Message us on WhatsApp if the shop needs another till.",
      at: "Now",
      tone: "info",
      href: "/app/settings?tab=counter",
      module: "settings",
      ownerOnly: true,
    });
  }

  /* ---------------- The shelf ---------------- */

  // Above the stock notices, and deliberately: expired stock is the only one
  // of these the till has already refused to sell. It is not a reorder
  // decision, it is stock that has to come off the shelf today.
  if (expiry.expired > 0) {
    notices.push({
      id: "stock-expired",
      title: `${plural(expiry.expired, "item has", "items have")} expired stock`,
      detail: `${expiry.expiredUnits.toLocaleString("en-PK")} on the shelf the till will not sell. Write it off so the count and the stock value stop including it.`,
      at: "Now",
      tone: "bad",
      href: "/app/inventory",
      module: "inventory",
    });
  }

  if (expiry.critical > 0) {
    notices.push({
      id: "stock-going-off",
      title: `${plural(expiry.critical, "item is", "items are")} going off soon`,
      detail: "Within a fortnight. Front of the shelf, or marked down.",
      at: "Now",
      tone: "warn",
      href: "/app/inventory",
      module: "inventory",
    });
  }

  if (stock.out > 0) {
    notices.push({
      id: "stock-out",
      title: `${plural(stock.out, "item is", "items are")} out of stock`,
      detail: "They still ring up. Order them in before a customer asks.",
      at: "Now",
      tone: "warn",
      href: "/app/inventory",
      module: "inventory",
    });
  }

  if (stock.low > 0) {
    notices.push({
      id: "stock-low",
      title: `${plural(stock.low, "item is", "items are")} running low`,
      detail: "Under the level set for them.",
      at: "Now",
      tone: "info",
      href: "/app/inventory",
      module: "inventory",
    });
  }

  return notices.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

/**
 * The permission gate, and the whole of it.
 *
 * Unlike the rail, nothing here is re-checked further in: a notice is its own
 * payload rather than a link to one, so dropping it here is the control and not
 * the courtesy. That is why the filter takes the resolved `ModuleAccess` — the
 * same answer the rail draws itself from — rather than re-reading the
 * permissions table with its own idea of what counts.
 */
export function visibleNotices(
  notices: Notice[],
  access: ModuleAccess,
  role: TenantRole | null,
): Notice[] {
  return notices.filter((notice) => {
    if (notice.ownerOnly && role !== "owner") return false;
    return access[notice.module];
  });
}

/**
 * A short, stable stand-in for "this exact set of notices".
 *
 * The bell is read against a cookie holding the last signature the person
 * looked at, so the badge clears when they open it and comes back the moment
 * something actually changes — with no table, no read receipt per user, and no
 * notice that stays unread forever because nobody pressed anything.
 */
export function noticeSignature(notices: Notice[]): string {
  const source = notices.map((notice) => notice.id).join("|");

  // djb2. Nothing depends on this being a good hash — it only has to change
  // when the string does, and fit in a cookie beside the rail and theme prefs.
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(36);
}
