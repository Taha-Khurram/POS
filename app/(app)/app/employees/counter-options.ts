import type { Counter } from "@/lib/pos/counter";
import type { SelectOption } from "@/components/pos/select-field";

/** The "no assignment" row. Its id is the empty string, which is what the
 *  action reads back as null. */
export const NO_COUNTER = "";

/**
 * The counter list as the staff forms offer it.
 *
 * Shut counters are on it. An owner who closes a till for the afternoon should
 * not come back to find everybody who stands at it quietly unassigned — the
 * register is what refuses to bill from a shut counter, and it already does.
 * They are labelled, so the choice is informed rather than silent.
 */
export function counterOptions(counters: Counter[]): SelectOption[] {
  return [
    {
      id: NO_COUNTER,
      label: "Whatever the device is set to",
      description: "The tablet's own counter, the way it worked before.",
    },
    ...counters.map((counter) => ({
      id: counter.id,
      label: counter.name,
      description: counter.isActive
        ? `${counter.receiptPrefix} · open`
        : `${counter.receiptPrefix} · shut, so the device's counter is used`,
    })),
  ];
}
