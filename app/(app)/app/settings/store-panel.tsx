import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { CurrencyClockForm } from "./currency-clock-form";
import { ShopDetailsForm } from "./shop-details-form";

/**
 * Store and location setup.
 *
 * A server component that composes two client forms, so the only JavaScript on
 * this tab is the forms themselves. Both read from the database — `tenants` for
 * the details, `tenant_settings` for the currency and the clock.
 */
export function StorePanel({
  shop,
  settings,
  readOnly,
}: {
  shop: ShopProfile;
  settings: ShopSettings;
  /** A manager sees the screen and cannot write to it. */
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      <ShopDetailsForm shop={shop} readOnly={readOnly} />
      <CurrencyClockForm settings={settings} readOnly={readOnly} />
    </div>
  );
}
