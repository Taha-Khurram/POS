import type { Explainer } from "@/lib/pos/report";

import { ColumnHead } from "./info-tip";

export type Column<Row> = {
  key: string;
  header: string;
  /** The hover tip on the heading — how this column is worked out. Left off for
   *  a column that needs no explaining: a shop's name is a shop's name. The
   *  same field `ReportColumn` carries, so the two tables explain a figure the
   *  one way. */
  explain?: Explainer;
  /** Money and counts go right, so a column can be scanned down. */
  align?: "start" | "end";
  cell: (row: Row) => React.ReactNode;
  /** Columns that can be dropped first on a narrow screen. */
  hideBelow?: "sm" | "md" | "lg";
};

const HIDE: Record<"sm" | "md" | "lg", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

/**
 * The console's one table.
 *
 * Generic over the row type so a column's `cell` gets the real row rather than
 * a bag of strings — the point being that formatting decisions (a badge, a
 * rupee figure, a receipt number) live next to the data they describe instead
 * of in a shared renderer that has to guess.
 *
 * It scrolls horizontally rather than wrapping cells: a receipt line that wraps
 * to three rows is unreadable, and `hideBelow` lets the caller decide which
 * columns are worth losing before it comes to that.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  onRowClick,
  rowLabel,
  isCurrent,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: string;
  /**
   * Makes the whole row the control rather than one cell of it.
   *
   * A list somebody is scanning for one bill wants the target to be the row,
   * not a chevron eight columns away — so the row takes focus, answers Enter
   * and Space, and names itself to a screen reader through `rowLabel`. Callers
   * that pass this must be client components; leaving it off keeps the table
   * exactly as inert as it has always been, which is what the server-rendered
   * ones want.
   */
  onRowClick?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  /** The row a drawer or sheet is currently open on, so it stays marked while
   *  the eye is somewhere else. */
  isCurrent?: (row: Row) => boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[0.875rem] text-graphite-500">
        {empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
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
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      // Space scrolls the page otherwise, which on a tablet
                      // moves the list out from under the finger that just
                      // chose a row.
                      event.preventDefault();
                      onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
              aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
              aria-current={isCurrent?.(row) ? "true" : undefined}
              className={onRowClick ? "pos-row-hit" : undefined}
            >
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
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
