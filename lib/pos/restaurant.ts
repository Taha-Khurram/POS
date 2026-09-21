/**
 * Tables, courses, the kitchen ticket, and a bill that stays open.
 *
 * No `server-only`, the same exception `counter.ts` carries: the floor map and
 * the order screen are client components and the Server Actions behind them
 * validate against the same lists. `lib/pos/tables.ts` is the reader.
 *
 * **A table order is not a sale until it is settled.** It claims no receipt
 * number and moves no stock — exactly like a held bill, and for the same
 * reason. `settle_table_order` calls `record_sale`, which is the one write that
 * claims a number and takes the stock, and marks the order settled against it
 * in the same transaction.
 *
 * **A modifier's price is folded into the line, never printed as a line.**
 * "Chicken karahi — extra cheese" is one thing the customer ordered and one
 * price they are paying; splitting it prints a bill nobody can check against a
 * menu. `lineTotalOf` below is that folding, and `settle_table_order` does the
 * identical sum in SQL.
 */

import { round2 } from "@/lib/pos/counter";

/* ---------------- How it is being served ---------------- */

/**
 * Dine-in, parcel, delivery.
 *
 * The distinction a kitchen and a cashier both need: a parcel is packed and
 * handed over, a dine-in is plated and carried. Priced the same, printed
 * differently — and only a dine-in has a table, which `0033` enforces with a
 * check constraint rather than leaving to the screens.
 */
export const SERVICES = [
  {
    id: "dine_in",
    label: "Dine in",
    short: "Table",
    note: "At a table. Plated and carried.",
  },
  {
    id: "parcel",
    label: "Parcel",
    short: "Parcel",
    note: "Packed and handed over at the counter.",
  },
  {
    id: "delivery",
    label: "Delivery",
    short: "Delivery",
    note: "Packed and sent out. Flo does not track the rider.",
  },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

export const isService = (value: unknown): value is ServiceId =>
  SERVICES.some((service) => service.id === value);

export const service = (id: ServiceId) =>
  SERVICES.find((entry) => entry.id === id) ?? SERVICES[0];

/* ---------------- Courses ---------------- */

/**
 * What a kitchen sequences on.
 *
 * Starters go now, mains go when the starters are cleared. A ticket that cannot
 * say which is a ticket the cook ignores — so the KOT groups by this and the
 * order screen sorts by it.
 *
 * In serving order, which is also the order the ticket prints in. Drinks first
 * because they go out while the food is being cooked.
 */
export const COURSES = [
  { id: "drinks", label: "Drinks", note: "Goes out first" },
  { id: "starter", label: "Starters", note: "Before the mains" },
  { id: "main", label: "Mains", note: "The middle of the meal" },
  { id: "dessert", label: "Dessert", note: "After the plates are cleared" },
] as const;

export type CourseId = (typeof COURSES)[number]["id"];

export const isCourse = (value: unknown): value is CourseId =>
  COURSES.some((course) => course.id === value);

export const course = (id: CourseId) =>
  COURSES.find((entry) => entry.id === id) ?? COURSES[2];

/** Where a course sits in the meal, for sorting. */
export const courseRank = (id: CourseId) =>
  COURSES.findIndex((entry) => entry.id === id);

/* ---------------- The shapes ---------------- */

export type DiningTable = {
  id: string;
  name: string;
  /** "Terrace", "Family hall". Free text — every dhaba names its sections
   *  differently and a closed list is six rows to delete first. */
  area: string;
  seats: number;
  sortOrder: number;
  isActive: boolean;
  /** The bill sitting on it, or null. Derived from `table_orders`, never a
   *  stored status — a status column is the second copy that drifts the first
   *  time a settle fails halfway. */
  order: TableOrderSummary | null;
};

export type TableOrderSummary = {
  id: string;
  orderNumber: string;
  service: ServiceId;
  covers: number | null;
  /** How long the party has been sitting, ISO. The floor reads this to know
   *  which table to go and look at. */
  openedAt: string;
  openedBy: string;
  /** What is on it so far, modifiers folded in. */
  total: number;
  lines: number;
  /** Lines typed but not yet sent to the kitchen. The number the floor chases:
   *  food nobody is cooking. */
  unsent: number;
};

export type OrderModifier = {
  id: string | null;
  name: string;
  priceDelta: number;
};

export type OrderLine = {
  id: string;
  itemId: string | null;
  variantId: string | null;
  name: string;
  unit: string;
  quantity: number;
  /** What the menu said when it was ordered. Snapshotted, unlike a held bill
   *  which re-prices on resume: a restaurant quotes off a menu the customer is
   *  holding, and a rate that moved between the order and the bill is an
   *  argument at the table the shop loses. */
  unitPrice: number;
  course: CourseId;
  status: "new" | "sent" | "void";
  /** "No onions", "well done" — the unpriced half of a modifier, and the half
   *  every dhaba actually uses. */
  note: string;
  modifiers: OrderModifier[];
  /** Which ticket it went to the kitchen on. Empty while `new`. */
  kotNumber: string;
  voidedReason: string;
};

export type TableOrder = {
  id: string;
  orderNumber: string;
  tableId: string | null;
  tableName: string;
  service: ServiceId;
  status: "open" | "settled" | "cancelled";
  covers: number | null;
  customerId: string | null;
  customerName: string;
  note: string;
  openedAt: string;
  openedBy: string;
  lines: OrderLine[];
  /** Every ticket sent so far, oldest first, so one can be reprinted. */
  kots: { id: string; number: string; sentAt: string; lines: number }[];
};

/* ---------------- The arithmetic ---------------- */

/**
 * What one line comes to, with its modifiers folded into the unit price.
 *
 * The single definition. `settle_table_order` does the identical sum in SQL and
 * the bill the customer is handed is the SQL one — this is what the screen
 * shows while the meal is still going, and the two have to agree or a table
 * disputes a total it watched being built.
 */
export const lineTotalOf = (line: Pick<OrderLine, "quantity" | "unitPrice" | "modifiers">) =>
  round2(
    (line.unitPrice +
      line.modifiers.reduce((sum, mod) => sum + mod.priceDelta, 0)) *
      line.quantity,
  );

/** What one unit of a line costs once its modifiers are on it. */
export const unitPriceOf = (line: Pick<OrderLine, "unitPrice" | "modifiers">) =>
  round2(line.unitPrice + line.modifiers.reduce((sum, mod) => sum + mod.priceDelta, 0));

/**
 * What the table owes.
 *
 * Voided lines are left out: they were cooked and they are a cost the shop
 * carries, but nobody is charged for them. They stay on the screen greyed,
 * because "who cancelled the mutton after it was fired" is the question a
 * restaurant asks at the end of a bad night.
 */
export function orderTotal(lines: OrderLine[]): number {
  return round2(
    lines
      .filter((line) => line.status !== "void")
      .reduce((sum, line) => sum + lineTotalOf(line), 0),
  );
}

/** Lines typed but not yet on a ticket — food nobody is cooking. */
export const unsentLines = (lines: OrderLine[]) =>
  lines.filter((line) => line.status === "new");

/** The lines grouped the way a kitchen ticket prints them: by course, in
 *  serving order, and never the voided ones — a cook does not need to read
 *  what was cancelled. */
export function byCourse(lines: OrderLine[]): { course: CourseId; lines: OrderLine[] }[] {
  return COURSES.map((entry) => ({
    course: entry.id,
    lines: lines.filter(
      (line) => line.course === entry.id && line.status !== "void",
    ),
  })).filter((group) => group.lines.length > 0);
}

/** How long a party has been sitting, in words. The floor reads it to know
 *  which table to go and look at. */
export function sittingFor(openedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(openedAt)) / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0033_restaurant.sql`. */

export const TABLE_NAME_MAX = 24;
export const AREA_MAX = 40;
export const SEATS_MAX = 40;
export const COVERS_MAX = 60;
export const LINE_NOTE_MAX = 200;
export const ORDER_NOTE_MAX = 500;
export const MODIFIER_NAME_MAX = 60;
export const MODIFIER_GROUP_MAX = 40;

/* ---------------- Validation ---------------- */

export type TableDraft = {
  name: string;
  area: string;
  seats: number;
};

export function checkTable(draft: TableDraft): string | null {
  const name = draft.name.trim();

  if (!name || name.length > TABLE_NAME_MAX) {
    return `Give the table a name — something short a waiter can call out, up to ${TABLE_NAME_MAX} characters.`;
  }

  if (draft.area.trim().length > AREA_MAX) return "That area name is too long.";

  if (!Number.isInteger(draft.seats) || draft.seats < 1 || draft.seats > SEATS_MAX) {
    return `How many does it seat? Between 1 and ${SEATS_MAX}.`;
  }

  return null;
}

export function checkOrderOpen(draft: {
  service: string;
  tableId: string;
  covers: number | null;
}): string | null {
  if (!isService(draft.service)) return "Say how this is being served.";

  if (draft.service === "dine_in" && !draft.tableId) {
    return "Pick the table they are sitting at.";
  }

  if (
    draft.covers !== null &&
    (!Number.isInteger(draft.covers) || draft.covers < 1 || draft.covers > COVERS_MAX)
  ) {
    return `How many people? Between 1 and ${COVERS_MAX}, or leave it empty.`;
  }

  return null;
}

/* ---------------- Finding one ---------------- */

export function matchesTable(table: DiningTable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    table.name.toLowerCase().includes(needle) ||
    table.area.toLowerCase().includes(needle) ||
    (table.order?.orderNumber.toLowerCase().includes(needle) ?? false)
  );
}
