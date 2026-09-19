import type { Explainer } from "@/lib/pos/report";

import { ColumnHead } from "./info-tip";

export type ReportColumn<Row> = {
  key: string;
  header: string;
  /** The hover tip on the heading. Left off for a column that needs no
   *  explaining — an item's name is an item's name. */
  explain?: Explainer;
  /** Money and counts go right, so a column can be scanned down. */
  align?: "start" | "end";
  /** Columns that can be dropped first on a narrow screen. */
  hideBelow?: "sm" | "md" | "lg";
  cell: (row: Row, index: number) => React.ReactNode;
  /** This column's cell in the totals row. Leaving it off leaves the cell
   *  blank, which is the right answer for a column that cannot be added up —
   *  a margin is not the sum of margins. */
  total?: React.ReactNode;
};

const HIDE: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

/**
 * The table every report is drawn with.
 *
 * `DataTable` next door is the console's general one and stays that. This is
 * its report-shaped sibling and it differs in exactly two ways, both of which
 * are the point of the screen:
 *
 * - **Every heading can carry its own explanation**, so "Margin" is one hover
 *   away from "profit ÷ sales × 100, out of the selling price and not the
 *   cost". The words come from `EXPLAIN` in `lib/pos/report.ts`, and nothing
 *   here invents its own.
 * - **It has a totals row**, because a column of figures whose total is
 *   somewhere else is a column somebody adds up by hand and then trusts their
 *   own arithmetic over the screen's.
 *
 * A server component, like the tables it replaces — a report is a page
 * somebody reads, prints and sends on, not an app they drive.
 */
export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  empty = "Nothing sold in this period.",
  totalLabel,
}: {
  columns: ReportColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: string;
  /** Draws the totals row and names it. Off when the rows cannot be summed. */
  totalLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-[0.875rem] text-graphite-500">
        {empty}
      </p>
    );
  }

  const totals = columns.some((column) => column.total !== undefined);

  return (
    <div className="pos-table-wrap">
      <table className="pos-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  column.align === "end" ? "text-right" : "",
                  column.hideBelow ? HIDE[column.hideBelow] : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <ColumnHead
                  label={column.header}
                  explain={column.explain}
                  align={column.align === "end" ? "end" : "start"}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={[
                    column.align === "end" ? "pos-num" : "",
                    column.hideBelow ? HIDE[column.hideBelow] : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        {totals && totalLabel ? (
          <tfoot>
            <tr>
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={[
                    column.align === "end" ? "pos-num" : "",
                    column.hideBelow ? HIDE[column.hideBelow] : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {/* The first column names the row rather than repeating a
                      heading — "All 14 days" says what was added up, which is
                      the one thing a totals row can get wrong. */}
                  {index === 0 ? totalLabel : column.total}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
