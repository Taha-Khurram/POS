/**
 * One person's time on one counter, from the float going in to the drawer
 * being counted.
 *
 * No `server-only` and no server imports, the same exception `counter.ts` and
 * `catalog.ts` carry: the strip at the top of the register draws this in the
 * browser and the Server Actions validate against the same bounds, so one
 * module is read from both sides.
 *
 * A shift is **required to charge anything**. `recordSale` and `recordReturn`
 * both refuse a counter with no open drawer, because a sale carrying a null
 * `shift_id` belongs to nobody's count — and a day half-filled with those is
 * the paperwork of a shift without any of its accountability. The cost lands
 * at the counter, so the shut state on the register says exactly what to do
 * and clears in one tap.
 */

export type Shift = {
  id: string;
  counterId: string | null;
  counterName: string;
  /** What went into the drawer at the start. The one figure that is true at
   *  the beginning and unknowable by 11 pm. */
  openingFloat: number;
  openedBy: string;
  openedAt: string;
  status: "open" | "closed";
  closedBy: string;
  closedAt: string | null;
  /** What was actually counted out. Null while the shift is open. */
  countedCash: number | null;
  /** What Flo said should be there — the float plus the shift's own cash
   *  takings, net of cash refunded. Stamped at closing and never re-derived. */
  expectedCash: number | null;
  /** Counted minus expected. Negative is short. Null while open, and shown
   *  only to somebody with `can_close_shift`. */
  overShort: number | null;
  /** The card machine's takings on this shift. Never in the drawer, recorded
   *  beside it because the first thing anybody asks a short drawer is whether
   *  something rung up as cash went on the card. */
  cardTotal: number;
  bills: number;
  note: string;
};

/** The biggest float or count the form will take. A drawer with more than a
 *  crore in it is a typo. */
export const CASH_MAX = 9_999_999;

export const SHIFT_NOTE_MAX = 200;

/**
 * A rupee figure typed into the float or count box.
 *
 * Blank reads as null and not as zero, the same reading `parseTendered` gives
 * an empty tendered box: an empty box is somebody who has not counted yet, not
 * a drawer with nothing in it. The difference matters at closing, where zero is
 * a real and alarming answer.
 */
export function parseCash(value: string): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, "").replace(/^Rs\.?/i, "");
  if (trimmed === "") return null;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > CASH_MAX) return null;

  return Math.round(amount * 100) / 100;
}

/**
 * How a variance is said out loud.
 *
 * "Short" and "over" rather than a signed number, because a minus sign in front
 * of a rupee figure is read as a negative amount of money rather than as a
 * direction — and the two are opposite kinds of problem. Exact gets its own
 * word, because it is the answer everybody is hoping for and deserves to look
 * different from "Rs 0 over".
 */
export function writeVariance(overShort: number): {
  word: "short" | "over" | "exact";
  amount: number;
} {
  const rounded = Math.round(overShort * 100) / 100;

  if (rounded === 0) return { word: "exact", amount: 0 };
  if (rounded < 0) return { word: "short", amount: -rounded };
  return { word: "over", amount: rounded };
}

/** "4:02 pm" — when a shift opened, in the shop's own timezone rather than the
 *  tablet's, for the reason `receiptStamp` takes one. */
export const shiftClock = (at: string, timezone: string) =>
  new Intl.DateTimeFormat("en-PK", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(at));

/** How long it has been open, in the words somebody would use at the counter. */
export function shiftLength(from: string, to: string | null, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 60_000),
  );

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
