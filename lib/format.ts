const GROUPED = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/**
 * "Rs 8,500" — the site writes prices this way, not "PKR 8,500.00", so the
 * console and the register write them that way too.
 */
export const rupees = (amount: number) => `Rs ${GROUPED.format(amount)}`;

const CYCLE_LABEL: Record<string, string> = {
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

export const perCycle = (cycle: string) => CYCLE_LABEL[cycle] ?? cycle;

/** Monthly equivalent of a cycle price, so MRR is one comparable number. */
export const monthlyEquivalent = (amount: number, cycle: string) => {
  if (cycle === "quarterly") return amount / 3;
  if (cycle === "yearly") return amount / 12;
  return amount;
};

/**
 * Axis- and chip-sized money: "Rs 2.4M", "Rs 186k". The site already writes
 * large sums this way (see the callout in `components/site/sales-chart.tsx`),
 * so the console does too rather than introducing lakh/crore in one place and
 * millions in another.
 */
export const compactRupees = (amount: number) => {
  const size = Math.abs(amount);
  if (size >= 1_000_000) return `Rs ${(amount / 1_000_000).toFixed(size >= 10_000_000 ? 0 : 1)}M`;
  if (size >= 1_000) return `Rs ${Math.round(amount / 1_000)}k`;
  return `Rs ${Math.round(amount)}`;
};

/** "18.4%" — one decimal, because margin moves in fractions of a point. */
export const percent = (value: number, decimals = 1) =>
  `${value.toFixed(decimals)}%`;
