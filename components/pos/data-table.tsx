export type Column<Row> = {
  key: string;
  header: string;
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
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: string;
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
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
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
