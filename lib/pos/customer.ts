/**
 * The customer's shape, the limits on it, and the arithmetic done on top.
 *
 * No `server-only` and no imports, the same exception `counter.ts`,
 * `catalog.ts` and `timeframe-options.ts` carry. The customer list is read by
 * the browser — the Customers screen searches it, the till picks off it — as
 * well as by the server that renders the first paint and the Server Actions
 * that validate what comes back. A module only one side could import would
 * force these constants to exist twice, and the copy that drifts is the one
 * that lets a bad phone number through.
 *
 * The rows themselves live in `public.customers` and are read by
 * `lib/pos/customers.ts`.
 *
 * There is no balance on this type, and there is not going to be one. The
 * udhaar khata — a ledger of debits and credits, a per-customer limit enforced
 * at the register, ageing buckets — was specified and is not being built, so
 * nothing here pretends to be halfway to it. What a customer is, is a name, a
 * number to reach them on, and the bills they are attached to.
 */

export type Customer = {
  id: string;
  name: string;
  /** Normalised by `normalisePhone` before it is stored. Empty when the
   *  customer would not give one, which is a real and common answer. */
  phone: string;
  email: string;
  /** One line as the shop would write it. "Shop 4, Anarkali, near the masjid". */
  address: string;
  /** What would otherwise go in the margin of the register book. */
  notes: string;
  /** Off takes them out of the till's picker and keeps every bill they are on. */
  isActive: boolean;
  /** ISO, as `created_at` comes back. Used for "added this month" and nothing
   *  that has to be to the minute. */
  createdAt: string;
};

/**
 * One customer's dealings with the shop, counted off `sales`.
 *
 * Only ever read for one customer at a time, on their own screen, because
 * that is the only shape the index on `(tenant_id, customer_id, business_day)`
 * answers cheaply. The list screen deliberately shows none of this: totalling
 * every customer's spending means reading every sale the shop has ever made,
 * and a figure capped to keep that query honest is a figure that is quietly
 * wrong.
 */
export type CustomerHistory = {
  bills: number;
  spent: number;
  /** The trading day of their last bill, `YYYY-MM-DD`. Null if they have never
   *  been rung up under their own name. */
  lastBillOn: string | null;
  /** Newest first, capped — this is a customer's record, not a search. */
  receipts: {
    id: string;
    receiptNo: string;
    businessDay: string;
    total: number;
  }[];
};

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0018_customers.sql`. Both
   sides, because a value that slips past this file still cannot reach the
   table — and a value the table would take but the form refuses is a refusal
   the owner can read instead of a 500. */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const EMAIL_MAX = 160;
export const ADDRESS_MAX = 200;
export const NOTES_MAX = 500;

/* ---------------- The phone number ---------------- */

/**
 * One customer's number, written one way.
 *
 * A shopkeeper types "0300-1234567" on Monday and "+92 300 1234567" on Friday,
 * and those are one person. Storing them as typed makes the unique index on
 * `(tenant_id, phone)` mean nothing, and a shop ends up with the same customer
 * three times over — which is the single way a customer list rots.
 *
 * So everything is folded to the local form a Pakistani shop actually says out
 * loud: `+92 300 …`, `0092 300 …` and a bare `92 300 …` all become
 * `03001234567`. Anything else keeps its digits and its leading `+`, because a
 * shop near the airport does have customers on a Gulf number and mangling one
 * into a Pakistani shape would be worse than leaving it alone.
 *
 * Returns "" for a blank box, which is what the column stores as null.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const international = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // 00 is the old way of dialling out, and plenty of saved contacts still carry
  // it. Read it as the + it stands for.
  const bare = digits.startsWith("00") ? digits.slice(2) : digits;

  // A Pakistani number in any of its three spellings is eleven digits starting
  // 0, or twelve starting 92. Fold to the first.
  if (bare.startsWith("92") && bare.length === 12) return `0${bare.slice(2)}`;
  if (bare.startsWith("0") && bare.length >= 10 && bare.length <= 11) return bare;

  // Somebody else's country. Keep the + so the number is still dialable.
  return international || digits.startsWith("00") ? `+${bare}` : bare;
}

/** The shape `customers.phone` will take: 7 to 15 digits, optionally a +. */
export const isPhone = (value: string) => /^\+?[0-9]{7,15}$/.test(value);

/**
 * The same number, spaced for reading off a screen at arm's length.
 *
 * `03001234567` is eleven digits a cashier has to count through to check
 * against the customer's phone; `0300 1234567` is two things to compare. The
 * stored value is never this — display only.
 */
export function writePhone(phone: string): string {
  if (!phone) return "";
  if (/^03\d{9}$/.test(phone)) return `${phone.slice(0, 4)} ${phone.slice(4)}`;
  return phone;
}

/* ---------------- Finding somebody ---------------- */

/**
 * Does this customer match what was typed?
 *
 * Shared by the Customers screen and the till's picker, for the reason
 * `matchesProduct` is shared by the catalog and the register: a customer the
 * owner can find and the cashier cannot is a customer the cashier adds a second
 * time.
 *
 * The phone is matched on its digits alone, so typing "0300 1234" finds
 * `03001234567` — a cashier reading a number off a customer's own screen types
 * the spaces that are on it.
 */
export function matchesCustomer(customer: Customer, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const digits = needle.replace(/\D/g, "");

  if (digits.length >= 3 && customer.phone.includes(digits)) return true;

  return [customer.name, customer.email, customer.address, customer.notes].some(
    (field) => field.toLowerCase().includes(needle),
  );
}

/**
 * The letters in the round mark beside a name.
 *
 * First and last word, because "Muhammad Bilal Ahmed" is told from "Muhammad
 * Bilal Khan" by the end of it and never by the start.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";

  return `${first}${last}`.toUpperCase();
}

/* ---------------- Validation ----------------
   One function, called by the sheet to grey out its own save button and by the
   Server Action to refuse. Returning the sentence rather than a boolean is what
   keeps the two saying the same thing — the action's refusal and the form's
   warning are the same string from the same place. */

export type CustomerDraft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

/** The complaint, or null when there is nothing to complain about. */
export function checkCustomer(draft: CustomerDraft): string | null {
  const name = draft.name.trim();

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return `Give the customer a name — between ${NAME_MIN} and ${NAME_MAX} characters.`;
  }

  const phone = normalisePhone(draft.phone);
  if (phone && !isPhone(phone)) {
    return "That does not look like a phone number. A mobile is 11 digits — 0300 1234567.";
  }

  const email = draft.email.trim();
  if (email) {
    if (email.length > EMAIL_MAX) return "That email address is too long.";
    // Deliberately loose. The only address this refuses is one that cannot be
    // an address at all; anything stricter refuses somebody's real mailbox, and
    // nothing here sends mail to find out.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "That email address is missing its @ or its domain.";
    }
  }

  if (draft.address.trim().length > ADDRESS_MAX) {
    return `Keep the address under ${ADDRESS_MAX} characters — it is one line on a delivery slip.`;
  }

  if (draft.notes.trim().length > NOTES_MAX) {
    return `That note is too long. ${NOTES_MAX} characters is the margin of the register book.`;
  }

  return null;
}
