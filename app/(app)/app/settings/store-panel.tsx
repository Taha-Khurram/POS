import { ChartCard } from "@/components/pos/chart-card";
import { IconStore } from "@/components/pos/icons";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { CurrencyClockForm } from "./currency-clock-form";
import { ShopDetailsForm } from "./shop-details-form";

/**
 * Store and location setup.
 *
 * A server component that composes two client forms and one read-only card, so
 * the only JavaScript on this tab is the two forms themselves. Everything on
 * screen now comes from the database — `tenants` for the details, `branches`
 * for the counters, `tenant_settings` for the currency and the clock.
 *
 * Adding a counter is still dead: branches are an entitlement, so the button
 * needs the plan ceiling enforced server-side before it can do anything.
 */
export function StorePanel({
  shop,
  settings,
  maxBranches,
  readOnly,
}: {
  shop: ShopProfile;
  settings: ShopSettings;
  maxBranches: number | null;
  /** A manager sees the screen and cannot write to it. */
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      <ShopDetailsForm shop={shop} readOnly={readOnly} />

      <ChartCard
        title="Counters and locations"
        caption="Every register belongs to one of these."
        footer={
          <>
            <p className="mr-auto text-[0.75rem] text-graphite-500">
              {maxBranches === null
                ? "Your plan does not cap branches."
                : `Your plan allows ${maxBranches} ${maxBranches === 1 ? "branch" : "branches"} — ${shop.branches.length} in use.`}
            </p>
            <button type="button" className="pos-btn pos-btn-soft" disabled>
              Add a counter
            </button>
          </>
        }
      >
        <ul className="space-y-2">
          {shop.branches.map((branch) => (
            <li
              key={branch.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-orchid-100 px-3.5 py-3"
            >
              <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-orchid-50 text-orchid-700">
                <IconStore className="h-4 w-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-semibold text-graphite-900">
                  {branch.name}
                </span>
                <span className="block truncate text-[0.75rem] text-graphite-500">
                  {[branch.address, branch.city, branch.phone]
                    .filter(Boolean)
                    .join(" · ") || "No address on file"}
                </span>
              </span>

              {branch.isPrimary ? (
                <span className="pos-badge pos-badge-info">Main counter</span>
              ) : null}
            </li>
          ))}
        </ul>
      </ChartCard>

      <CurrencyClockForm settings={settings} readOnly={readOnly} />
    </div>
  );
}
