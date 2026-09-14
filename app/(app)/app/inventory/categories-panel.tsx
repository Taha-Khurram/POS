import { ChartCard } from "@/components/pos/chart-card";
import {
  IconChevron,
  IconPlus,
  IconRegister,
  IconTag,
} from "@/components/pos/icons";
import { DEPARTMENTS, type Product } from "@/lib/pos/catalog";

/**
 * The inventory tree.
 *
 * A server component, and it stays one: the only interaction is opening a
 * branch, which `<details>` has done natively since before React existed. The
 * console ships no JavaScript for this screen at all.
 *
 * Three levels, ordered the way the register's touchscreen pages through them —
 * department tile, category tile, then items. That is also why a department
 * with no items still appears: an empty tile on the register is a signal to the
 * owner that something was set up and never filled, and hiding it only moves
 * the surprise to the counter.
 */
export function CategoriesPanel({ items }: { items: Product[] }) {
  const counts = items.reduce<Record<string, number>>((tally, item) => {
    tally[item.department] = (tally[item.department] ?? 0) + 1;
    tally[`${item.department}/${item.category}`] =
      (tally[`${item.department}/${item.category}`] ?? 0) + 1;
    return tally;
  }, {});

  const subtotal = DEPARTMENTS.reduce(
    (total, department) => total + department.categories.length,
    0,
  );

  return (
    <div className="space-y-4">
      <ChartCard
        title="Departments, categories, subcategories"
        caption={`${DEPARTMENTS.length} departments · ${subtotal} categories`}
        footer={
          <>
            <p className="mr-auto text-[0.75rem] text-graphite-500">
              Editing the tree lands with the <code>categories</code> table in
              Part 3.
            </p>
            <button type="button" className="pos-btn pos-btn-primary" disabled>
              <IconPlus className="h-4 w-4" />
              Add a department
            </button>
          </>
        }
      >
        <ul className="space-y-1.5">
          {DEPARTMENTS.map((department) => (
            <li key={department.id}>
              <details className="group rounded-xl border border-azure-100 open:bg-azure-50/40">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3">
                  <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500 transition-transform duration-200 group-open:rotate-0" />

                  <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-azure-100 text-azure-800">
                    <IconTag className="h-4 w-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[0.875rem] font-semibold text-graphite-900">
                      {department.name}
                    </span>
                    <span className="block truncate text-[0.75rem] text-graphite-500">
                      {department.categories.length} categories ·{" "}
                      {counts[department.name] ?? 0} items
                    </span>
                  </span>

                  <span className="pos-badge pos-badge-info">
                    {department.name.slice(0, 3).toUpperCase()}
                  </span>
                </summary>

                <ul className="space-y-1 border-t border-azure-100 px-3.5 py-3">
                  {department.categories.map((category) => (
                    <li
                      key={category.id}
                      className="rounded-lg bg-paper-50 px-3 py-2.5"
                    >
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[0.875rem] font-medium text-graphite-900">
                          {category.name}
                        </span>
                        <span className="text-[0.75rem] text-graphite-500">
                          {counts[`${department.name}/${category.name}`] ?? 0}{" "}
                          items
                        </span>
                      </p>

                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {category.sub.map((sub) => (
                          <span
                            key={sub}
                            className="rounded-full bg-azure-50 px-2 py-0.5 text-[0.6875rem] font-medium text-azure-800"
                          >
                            {sub}
                          </span>
                        ))}
                      </p>
                    </li>
                  ))}

                  <li>
                    <button
                      type="button"
                      className="pos-btn pos-btn-quiet pos-btn-sm"
                      disabled
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      Add a category to {department.name}
                    </button>
                  </li>
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard
        title="How this looks at the counter"
        caption="Two taps from the register's home grid to any item."
      >
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {DEPARTMENTS.map((department) => (
            <div
              key={department.id}
              className="rounded-xl border border-azure-100 bg-azure-50/60 px-3 py-4 text-center"
            >
              <span className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-paper-50 text-azure-700">
                <IconRegister className="h-[18px] w-[18px]" />
              </span>
              <p className="mt-2 font-display text-[0.8125rem] leading-tight font-semibold text-graphite-900">
                {department.name}
              </p>
              <p className="text-[0.6875rem] text-graphite-500">
                {counts[department.name] ?? 0} items
              </p>
            </div>
          ))}
        </div>

        <p className="pos-hint mt-3">
          Keep departments to what fits on one screen without scrolling — six to
          nine on a 10-inch tablet. A cashier who has to scroll the top level
          during a rush stops using the grid and types the name instead, and
          then the tree was work for nothing.
        </p>
      </ChartCard>
    </div>
  );
}
