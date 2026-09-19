import type { Explainer } from "@/lib/pos/report";

import { IconInfo } from "./icons";

/**
 * The "how is this worked out?" marker beside a figure.
 *
 * A server component, and pure CSS underneath — `.pos-info` in `globals.css`
 * shows the bubble on `:hover` for a mouse and on `:focus-within` for a finger,
 * which is the whole interaction. A tooltip is the last thing worth shipping a
 * client bundle for, and Reports is otherwise HTML by the time it reaches the
 * tablet.
 *
 * **The explanation is the button's accessible name**, and the bubble itself is
 * hidden from the accessibility tree. That is what lets this work without a
 * `useId` to hang an `aria-describedby` off — and a component that needed one
 * would have to be a client component, which is the thing being avoided. It
 * also means the wording is read out in full on focus rather than being
 * announced as a nameless button somebody has to hover to understand.
 *
 * Every word it draws comes from `EXPLAIN` in `lib/pos/report.ts`. Nothing on
 * Reports writes its own explanation inline, because the same figure appears as
 * a headline, as a column and as a CSV heading, and three explanations of one
 * number is how an owner stops believing all three.
 */
export function InfoTip({
  label,
  explain,
  align = "start",
}: {
  /** The figure being explained, in the same words the heading beside it uses. */
  label: string;
  explain: Explainer;
  /** `end` for a tip on a right-aligned column, so the bubble opens inward
   *  instead of off the edge of the table. */
  align?: "start" | "end";
}) {
  const spoken = explain.formula
    ? `${label}. ${explain.formula}. ${explain.plain}`
    : `${label}. ${explain.plain}`;

  return (
    <span className="pos-info">
      {/* Does nothing when pressed, and is a button anyway: a tap is what
          focuses it, and focus is what opens the bubble on a touchscreen. */}
      <button type="button" className="pos-info-hit" aria-label={spoken}>
        <IconInfo className="h-[15px] w-[15px]" />
      </button>

      <span className="pos-info-bubble" data-align={align} aria-hidden>
        <span className="pos-info-title">{label}</span>
        {explain.formula ? (
          <span className="pos-info-sum">{explain.formula}</span>
        ) : null}
        <span className="pos-info-plain">{explain.plain}</span>
      </span>
    </span>
  );
}

/**
 * A heading with its tip beside it, for a table column.
 *
 * `align` defaults to matching the column: a money column is right-aligned, so
 * its bubble opens leftward and stays inside the table.
 */
export function ColumnHead({
  label,
  explain,
  align = "start",
}: {
  label: string;
  explain?: Explainer;
  align?: "start" | "end";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${align === "end" ? "flex-row-reverse" : ""}`}
    >
      {label}
      {explain ? (
        <InfoTip label={label} explain={explain} align={align} />
      ) : null}
    </span>
  );
}
