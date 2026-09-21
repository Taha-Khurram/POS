/**
 * What the shop owes its suppliers, and how old it is.
 *
 * No `server-only`, the same exception `purchase.ts` and `customer.ts` carry:
 * the payment sheet is a client component and the Server Action behind it has
 * to reach the same verdict. `lib/pos/ledgers.ts` is the reader.
 *
 * **This is the other direction from a khata.** `0018` removed every trace of
 * customer credit and nothing here brings it back — a supplier balance is money
 * the shop owes out, which is a page a shop already keeps at the back of its
 * register book. Nothing in this file can be pointed at a customer.
 *
 * Two things live here and nowhere else:
 *
 *   - **The balance is defined once.** Opening balance, plus everything
 *     invoiced, less everything paid. Three screens quote it — the supplier
 *     list, the supplier's record, and the tiles above them — and a balance
 *     that came out differently on any one of them is a figure nobody would
 *     trust again.
 *   - **Ageing is a walk, not a table.** See `ageOf`.
 */

import { round2 } from "@/lib/pos/counter";

/* ---------------- What a payment is ---------------- */

/**
 * How the money left. A note about what happened, typed by whoever paid — not
 * an integration with any of them. Nothing in Flo talks to a bank or a wallet,
 * and the day something does, it writes this same column.
 */
export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", note: "Notes, out of the drawer or the safe" },
  { id: "bank", label: "Bank transfer", note: "Online, IBFT or a deposit slip" },
  { id: "cheque", label: "Cheque", note: "Put the number in the reference" },
  { id: "card", label: "Card", note: "On the shop's own card" },
  { id: "wallet", label: "Easypaisa / JazzCash", note: "Put the TID in the reference" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["id"];

export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  PAYMENT_METHODS.some((method) => method.id === value);

export const paymentMethod = (id: PaymentMethod) =>
  PAYMENT_METHODS.find((method) => method.id === id) ?? PAYMENT_METHODS[0];

export type SupplierPayment = {
  id: string;
  supplierId: string;
  supplierName: string;
  /** `YYYY-MM-DD`. The day the money left. */
  paidOn: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  note: string;
  createdAt: string;
};

/* ---------------- What a balance is ---------------- */

export type SupplierBalance = {
  supplierId: string;
  /** What was owed before Flo, and the day it was owed as at. */
  opening: number;
  openingOn: string | null;
  /** Everything ever delivered, at its receipt total — carriage included. */
  invoiced: number;
  paid: number;
  /** Positive: the shop owes them. Negative: the shop is in advance. */
  balance: number;
  deliveries: number;
  payments: number;
  lastInvoicedOn: string | null;
  lastPaidOn: string | null;
};

/**
 * The balance, defined once.
 *
 * Opening plus invoiced less paid. Rounded at the end rather than at each step,
 * because three roundings of a two-decimal column is how a statement ends up a
 * paisa away from the sum of its own rows.
 */
export const balanceOf = (parts: {
  opening: number;
  invoiced: number;
  paid: number;
}) => round2(parts.opening + parts.invoiced - parts.paid);

/** Owed, in a word, so no screen has to decide what a negative balance means.
 *  A shop in advance with a distributor is a real and good position to be in,
 *  and "owed" in red would be wrong about it. */
export const balanceState = (balance: number): "owed" | "advance" | "clear" =>
  balance > 0.005 ? "owed" : balance < -0.005 ? "advance" : "clear";

/**
 * How each figure on the account is worked out, in one place.
 *
 * The same discipline `EXPLAIN` keeps on Reports, and for the same reason: a
 * balance is only worth anything if the owner believes it, and the fastest way
 * to lose that is for the screen and the statement under it to explain the same
 * figure differently. One sentence per figure, in the shop's words.
 */
export const LEDGER_EXPLAIN = {
  balance: {
    formula: "opening balance + everything delivered − everything paid",
    plain:
      "What you owed them before Flo, plus every delivery since at its full total with carriage in it, less every payment you have recorded.",
  },
  ageing: {
    plain:
      "Payments here go against the account rather than against one delivery, so this settles the oldest delivery first — which is how the same page in a register book reads.",
  },
  invoiced: {
    plain:
      "Every delivery taken in from them, at the total on the goods-received note. That includes freight, because freight is part of what you owe.",
  },
} as const satisfies Record<string, { formula?: string; plain: string }>;

/* ---------------- The statement ---------------- */

/** One line of a supplier's account: a delivery that put the balance up, or a
 *  payment that brought it down. */
export type LedgerEntry = {
  id: string;
  /** `YYYY-MM-DD`. */
  on: string;
  kind: "opening" | "delivery" | "payment";
  /** The GRN number, the payment reference, or "" for the opening line. */
  ref: string;
  detail: string;
  /** Signed the way the balance runs: a delivery is positive, a payment is
   *  negative. One column, for the reason `stock_movements.quantity` is one
   *  signed column — every question of the list is a running sum. */
  amount: number;
  /** What the account stood at after this line. Filled by `runningBalance`. */
  after: number;
};

/**
 * The statement in date order, with the balance carried down.
 *
 * Oldest first, which is the only order a running balance can be read in —
 * the opposite of every other list in the console, and deliberately so. A
 * statement newest-first would have its own total at the top and the workings
 * underneath.
 *
 * Ties are broken delivery-before-payment on the same day, because that is the
 * order they happen in: the van arrives and then the man is paid.
 */
export function runningBalance(
  opening: number,
  openingOn: string | null,
  entries: Omit<LedgerEntry, "after">[],
): LedgerEntry[] {
  const rank = { opening: 0, delivery: 1, payment: 2 } as const;

  const sorted = [...entries].sort(
    (a, b) => a.on.localeCompare(b.on) || rank[a.kind] - rank[b.kind],
  );

  // The opening line is drawn even when it is nought, because "we started from
  // zero on the 1st of July" is itself worth saying — a statement that begins
  // mid-air is one nobody can tie back to their own book.
  const head: Omit<LedgerEntry, "after">[] = [
    {
      id: "opening",
      on: openingOn ?? sorted[0]?.on ?? "",
      kind: "opening",
      ref: "",
      detail: openingOn ? "Owed before Flo" : "Nothing owed at the start",
      amount: opening,
    },
  ];

  let running = 0;

  return [...head, ...sorted].map((entry) => {
    running = round2(running + entry.amount);
    return { ...entry, after: running };
  });
}

/* ---------------- How old the money is ---------------- */

export type AgeBucket = {
  label: string;
  /** Days old, inclusive lower bound. */
  from: number;
  /** Exclusive upper bound, or null for "and older". */
  to: number | null;
  amount: number;
};

/**
 * How old the unpaid money is, worked out rather than stored.
 *
 * **There is no allocation table and there is not going to be one.** A payment
 * here is against the account, not against invoice 4821, because that is how
 * shops actually settle — Ravi Trading's man takes fifty thousand on a Thursday
 * and nobody itemises it. So ageing walks the deliveries oldest first and
 * spends the payments against them until the payments run out; whatever is
 * still unpaid is aged by the day its delivery arrived.
 *
 * That is exactly how a shopkeeper reads the same page of their own book, it
 * needs no second table, and — because nothing is stored — it cannot drift away
 * from the payments it was derived from. The cost is that it is only as right
 * as the assumption behind it, which is that the oldest bill gets paid first.
 * For a running account with one supplier, that assumption is not a guess; it
 * is what both sides mean.
 *
 * The opening balance is treated as the oldest delivery of all, dated
 * `openingOn` — because it is.
 */
export function ageOf(
  deliveries: { on: string; amount: number }[],
  paidTotal: number,
  opening: { on: string | null; amount: number },
  /** The shop's own today, `YYYY-MM-DD`. Never the browser's. */
  today: string,
): { buckets: AgeBucket[]; oldestUnpaidOn: string | null } {
  const buckets: AgeBucket[] = [
    { label: "Not yet 30 days", from: 0, to: 30, amount: 0 },
    { label: "30 to 60 days", from: 30, to: 60, amount: 0 },
    { label: "60 to 90 days", from: 60, to: 90, amount: 0 },
    { label: "Over 90 days", from: 90, to: null, amount: 0 },
  ];

  const debits = [
    // An advance — a negative opening — is not a debt and has no age. It nets
    // out of the balance and is left out of the walk entirely.
    ...(opening.amount > 0 && opening.on
      ? [{ on: opening.on, amount: opening.amount }]
      : []),
    ...deliveries,
  ].sort((a, b) => a.on.localeCompare(b.on));

  let left = Math.max(0, paidTotal);
  let oldestUnpaidOn: string | null = null;

  for (const debit of debits) {
    const unpaid = debit.amount - left;
    left = Math.max(0, left - debit.amount);

    if (unpaid <= 0.005) continue;

    if (!oldestUnpaidOn) oldestUnpaidOn = debit.on;

    const days = daysBetween(debit.on, today);
    const bucket =
      buckets.find((entry) => days >= entry.from && (entry.to === null || days < entry.to)) ??
      buckets[buckets.length - 1];

    bucket.amount = round2(bucket.amount + unpaid);
  }

  return { buckets, oldestUnpaidOn };
}

const DAY_MS = 86_400_000;

/** Whole days between two trading days, through `Date.UTC` rather than local
 *  getters — the same care `history.ts` takes, because the accountant opening
 *  this from Dubai is not on the shop's clock. */
export const daysBetween = (from: string, to: string) =>
  Math.max(
    0,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS),
  );

/**
 * Whether a supplier is past the terms they gave.
 *
 * `payment_terms_days` is a note the owner typed, not a rule Flo enforces — so
 * this is a flag on a screen and never a refusal. Cash-on-delivery suppliers
 * (nought days) are deliberately excluded: every balance with them would read
 * as overdue the moment a van arrived, which is noise rather than a signal.
 */
export const isOverdue = (
  oldestUnpaidOn: string | null,
  termsDays: number,
  today: string,
) => Boolean(oldestUnpaidOn) && termsDays > 0 &&
  daysBetween(oldestUnpaidOn as string, today) > termsDays;

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0029_supplier_ledger.sql`. */

export const REFERENCE_MAX = 60;
export const NOTE_MAX = 500;
/** Well above any single settlement a shop of this size makes, low enough that
 *  a mis-keyed row is refused rather than booked. */
export const PAYMENT_MAX = 99_999_999;

/** How many statement lines one supplier's record loads. Stated on the screen
 *  rather than papered over, the same bargain the customer record strikes at a
 *  hundred bills: the figures above a capped list are the figures *of that
 *  list*, and a total that quietly stops counting is worse than one that says
 *  where it stops. */
export const STATEMENT_MAX = 200;

/* ---------------- Validation ---------------- */

export type PaymentDraft = {
  supplierId: string;
  paidOn: string;
  amount: number;
  method: string;
  reference: string;
  note: string;
};

/** The complaint, or null. One function, called by the sheet to grey out its
 *  own save button and by the Server Action to refuse — so the two say the same
 *  thing in the same words. */
export function checkPayment(draft: PaymentDraft): string | null {
  if (!draft.supplierId) return "Pick who you paid.";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn)) {
    return "Say which day the money left.";
  }

  if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
    return "How much did you pay? It has to be more than nothing.";
  }

  if (draft.amount > PAYMENT_MAX) {
    return "That amount is too large. Check for a stray digit.";
  }

  if (!isPaymentMethod(draft.method)) return "Say how you paid.";

  if (draft.reference.trim().length > REFERENCE_MAX) {
    return "That reference is too long.";
  }

  if (draft.note.trim().length > NOTE_MAX) {
    return `That note is too long. ${NOTE_MAX} characters is the margin of the register book.`;
  }

  return null;
}

/* ---------------- Finding one ---------------- */

export function matchesPayment(payment: SupplierPayment, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    payment.supplierName.toLowerCase().includes(needle) ||
    payment.reference.toLowerCase().includes(needle) ||
    payment.note.toLowerCase().includes(needle) ||
    paymentMethod(payment.method).label.toLowerCase().includes(needle) ||
    String(payment.amount).startsWith(needle.replace(/[^\d.]/g, ""))
  );
}
