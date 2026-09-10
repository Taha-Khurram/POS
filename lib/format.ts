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
