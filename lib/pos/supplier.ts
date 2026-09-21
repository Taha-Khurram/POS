/**
 * The supplier's shape, the limits on it, and the questions asked of one.
 *
 * No `server-only`, the same exception `customer.ts`, `catalog.ts` and
 * `counter.ts` carry: the supplier list is read by the browser — the Suppliers
 * panel searches it, the order and receiving screens pick off it — as well as
 * by the server that renders the first paint and the Server Actions that
 * validate what comes back.
 *
 * It does import `customer.ts`, which those modules do not, and only for the
 * phone number. `normalisePhone` is thirty lines of Pakistani dialling
 * conventions that took a shop's rotted customer list to get right, and a
 * second copy of it here is a second copy that will fall behind the first. The
 * import is pure either way — no `server-only` on either side.
 *
 * The rows live in `public.suppliers` and are read by `lib/pos/suppliers.ts`.
 *
 * **The name is the identity, not the phone.** That is the opposite of the
 * customer list and it is deliberate: two customers are called Bilal, but you
 * know a distributor by the name on his invoice, and the man who answers his
 * phone changes twice a year. The unique index in `0027_suppliers.sql` is on
 * the folded name for exactly that reason, and `foldName` below is the same
 * folding written for the browser so the sheet can warn before the action
 * refuses.
 */

import { normalisePhone, isPhone } from "@/lib/pos/customer";

export type Supplier = {
  id: string;
  name: string;
  /** The person you ring, who is not the business. "Asif bhai". */
  contactName: string;
  /** Normalised by `normalisePhone` before it is stored. Empty is common —
   *  plenty of buying is done with a man who comes past on a Thursday. */
  phone: string;
  email: string;
  /** One line as the shop would write it. "Godown 12, Akbari Mandi". */
  address: string;
  /** NTN or STRN. Blank until the shop starts claiming input tax. */
  taxNumber: string;
  /** Days to pay. Zero is cash on delivery, which is most kiryana buying. */
  paymentTermsDays: number;
  notes: string;
  /** What the shop already owed them before Flo, and the day it was owed as at
   *  (`0029`). A balance with no date on it is a figure nobody can check
   *  against their own book. Zero and null is the honest start for a supplier
   *  `0027` lifted out of the item list. */
  opening: number;
  openingOn: string | null;
  /** Off takes them out of every picker and keeps every order they are on. */
  isActive: boolean;
  createdAt: string;
  /** How many catalog items name them. Counted by the reader, not stored —
   *  the same bargain `Department.items` strikes. */
  items: number;
};

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0027_suppliers.sql`. Both
   sides, because a value that slips past this file still cannot reach the
   table — and a value the table would take but the form refuses is a refusal
   the owner can read instead of a 500. */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const CONTACT_MAX = 80;
export const EMAIL_MAX = 160;
export const ADDRESS_MAX = 200;
export const TAX_NUMBER_MAX = 40;
export const NOTES_MAX = 500;
export const TERMS_MAX_DAYS = 365;
/** The same ceiling `checkPayment` uses, for the same reason: well above any
 *  real account, low enough that a mis-keyed opening balance is refused rather
 *  than quietly becoming what the shop thinks it owes. */
export const OPENING_MAX = 99_999_999;

/**
 * A supplier name as the unique index compares it.
 *
 * Trimmed, single-spaced, lower-cased — the same three things
 * `suppliers_tenant_name_idx` does, written here so the sheet can tell an owner
 * "you already buy from Ravi Trading" before the save goes anywhere, rather
 * than turning a 23505 into a sentence afterwards. Both still happen: this is
 * the courtesy and the index is the control.
 */
export const foldName = (raw: string) =>
  raw.trim().replace(/\s+/g, " ").toLowerCase();

/* ---------------- Payment terms ---------------- */

/** The terms a Pakistani distributor actually offers, as a picker. Free text
 *  would give a column of "30 days", "1 month", "monthly" and "30din" that
 *  nothing can sort a due date out of. */
export const PAYMENT_TERMS = [
  { id: 0, label: "Cash on delivery", note: "Paid as it comes off the van" },
  { id: 7, label: "7 days", note: "A week" },
  { id: 15, label: "15 days", note: "Fortnightly settlement" },
  { id: 30, label: "30 days", note: "The usual distributor account" },
  { id: 45, label: "45 days" },
  { id: 60, label: "60 days" },
] as const;

/** Terms in words, for a card. A stored value off the list above still reads,
 *  because a shop that negotiated 21 days should not see a blank. */
export const writeTerms = (days: number) =>
  days === 0
    ? "Cash on delivery"
    : (PAYMENT_TERMS.find((term) => term.id === days)?.label ?? `${days} days`);

/* ---------------- Finding one ---------------- */

/**
 * Does this supplier match what was typed?
 *
 * Shared by the Suppliers panel and every picker that offers one, for the
 * reason `matchesProduct` and `matchesCustomer` are shared: a supplier the
 * owner can find and the manager cannot is a supplier the manager adds a second
 * time — which is the exact duplication `0027` existed to undo.
 *
 * The phone matches on digits alone, so "0300 1234" finds `03001234567`.
 */
export function matchesSupplier(supplier: Supplier, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const digits = needle.replace(/\D/g, "");
  if (digits.length >= 3 && supplier.phone.includes(digits)) return true;

  return [
    supplier.name,
    supplier.contactName,
    supplier.email,
    supplier.address,
    supplier.taxNumber,
    supplier.notes,
  ].some((field) => field.toLowerCase().includes(needle));
}

/* ---------------- Validation ----------------
   One function, called by the sheet to grey out its own save button and by the
   Server Action to refuse. It returns the sentence rather than a boolean, which
   is what keeps the two saying the same thing. */

export type SupplierDraft = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  paymentTermsDays: number;
  notes: string;
  /** Signed: positive is owed to them, negative is an advance the shop has
   *  already paid. Both happen. */
  opening: number;
  openingOn: string;
};

export const EMPTY_SUPPLIER: SupplierDraft = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  taxNumber: "",
  paymentTermsDays: 0,
  notes: "",
  opening: 0,
  openingOn: "",
};

/** The complaint, or null when there is nothing to complain about. */
export function checkSupplier(draft: SupplierDraft): string | null {
  const name = draft.name.trim();

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return `Give the supplier a name — between ${NAME_MIN} and ${NAME_MAX} characters.`;
  }

  if (draft.contactName.trim().length > CONTACT_MAX) {
    return `That contact name is too long — keep it under ${CONTACT_MAX} characters.`;
  }

  const phone = normalisePhone(draft.phone);
  if (phone && !isPhone(phone)) {
    return "That does not look like a phone number. A mobile is 11 digits — 0300 1234567.";
  }

  const email = draft.email.trim();
  if (email) {
    if (email.length > EMAIL_MAX) return "That email address is too long.";
    // Deliberately loose, for the reason `checkCustomer` is loose: the only
    // address this refuses is one that cannot be an address at all.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "That email address is missing its @ or its domain.";
    }
  }

  if (draft.address.trim().length > ADDRESS_MAX) {
    return `Keep the address under ${ADDRESS_MAX} characters — it is one line on an order.`;
  }

  if (draft.taxNumber.trim().length > TAX_NUMBER_MAX) {
    return "That NTN or STRN is too long.";
  }

  if (
    !Number.isInteger(draft.paymentTermsDays) ||
    draft.paymentTermsDays < 0 ||
    draft.paymentTermsDays > TERMS_MAX_DAYS
  ) {
    return `Payment terms are a whole number of days, up to ${TERMS_MAX_DAYS}.`;
  }

  if (draft.notes.trim().length > NOTES_MAX) {
    return `That note is too long. ${NOTES_MAX} characters is the margin of the order book.`;
  }

  if (!Number.isFinite(draft.opening) || Math.abs(draft.opening) > OPENING_MAX) {
    return "That opening balance is not an amount. Check for a stray digit.";
  }

  // The date is what makes the figure checkable, so a figure without one is
  // refused rather than filed against no day at all. Nought needs no date —
  // starting level is not a claim about any particular morning.
  if (draft.opening !== 0 && !/^\d{4}-\d{2}-\d{2}$/.test(draft.openingOn)) {
    return "Say which day that opening balance was as at — it is what makes it checkable against your own book.";
  }

  return null;
}
