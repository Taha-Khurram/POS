import { compactRupees } from "@/lib/format";
import type { TopProduct } from "@/lib/pos/dashboard";

/** How a quantity is written for each unit the register sells in. */
const UNIT_LABEL: Record<string, string> = {
  piece: "pcs",
  kilo: "kg",
  carton: "cartons",
  plate: "plates",
};

/**
 * The window's best sellers, ranked.
 *
 * A list rather than a chart: the question this answers is "what should I
 * reorder", which is read top-down and needs the item name at full length. The
 * bar is a secondary read for how far ahead the leader is, and the quantity
 * rides at its end where the eye already is.
 *
 * No rank badge: the list is ordered, the bars are ordered, and a third number
 * in a chip on every row buys nothing.
 */
export function TopProducts({ products }: { products: TopProduct[] }) {
  return (
    <ol className="space-y-3">
      {products.map((product, index) => (
        <li key={product.name}>
          <p className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[0.8125rem] font-medium text-graphite-900">
              {product.name}
            </span>
            <span className="flex-none text-[0.8125rem] font-semibold text-graphite-900 tabular-nums">
              {compactRupees(product.sales)}
            </span>
          </p>

          <div className="mt-1.5 flex items-center gap-2">
            <div className="pos-meter min-w-0 flex-1">
              <span
                style={{
                  width: `${product.share * 100}%`,
                  animationDelay: `${index * 70}ms`,
                }}
              />
            </div>

            <span className="pos-pill" data-rank={index}>
              {product.quantity}
            </span>

            <span className="w-11 flex-none text-[0.6875rem] text-graphite-500">
              {UNIT_LABEL[product.unit] ?? product.unit}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
