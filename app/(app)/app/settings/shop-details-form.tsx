"use client";

import { useActionState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { SelectField } from "@/components/pos/select-field";
import { SHOP_TYPES } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { saveShopDetails } from "./actions";
import { IDLE, SaveBar } from "./save-bar";

/**
 * The `tenants` row, editable.
 *
 * `defaultValue` rather than controlled state: this is a form somebody fills in
 * once a year, and the server's copy is the truth after every save because the
 * action revalidates the route. Holding eight fields in React state would only
 * add a way for the screen and the database to disagree.
 *
 * NTN and STRN sit here now that there is no Tax card. They are not rates —
 * they are the shop's own registration, printed under its name on the receipt,
 * which is what the rest of this card is.
 */
export function ShopDetailsForm({
  shop,
  readOnly,
}: {
  shop: ShopProfile;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveShopDetails, IDLE);
  const locked = readOnly || pending;

  return (
    <form action={action}>
      <ChartCard
        title="Shop details"
        caption="What prints at the top of every receipt."
        footer={<SaveBar state={state} pending={pending} readOnly={readOnly} />}
      >
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="pos-label">Shop name</span>
            <input
              name="shop_name"
              className="pos-field"
              defaultValue={shop.shopName}
              required
            />
          </label>

          <label className="block">
            <span className="pos-label">Owner</span>
            <input
              name="owner_name"
              className="pos-field"
              defaultValue={shop.ownerName}
              required
            />
          </label>

          <label className="block">
            <span className="pos-label">Phone</span>
            <input
              name="phone"
              className="pos-field"
              defaultValue={shop.phone}
              inputMode="tel"
              required
            />
            <p className="pos-hint">
              The number khata reminders go out from on WhatsApp.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">Email</span>
            <input
              name="email"
              className="pos-field"
              type="email"
              defaultValue={shop.email ?? ""}
              placeholder="shop@example.com"
            />
          </label>

          <label className="block">
            <span className="pos-label">City</span>
            <input
              name="city"
              className="pos-field"
              defaultValue={shop.city}
              required
            />
          </label>

          <SelectField
            name="shop_type"
            label="Shop type"
            value={shop.shopType}
            options={SHOP_TYPES}
            disabled={locked}
            hint="Sets the register's default units — plates for a dhaba, kilos for a kiryana."
          />

          <label className="block">
            <span className="pos-label">NTN</span>
            <input
              name="ntn"
              className="pos-field"
              defaultValue={shop.ntn ?? ""}
              placeholder="0000000-0"
            />
          </label>

          <label className="block">
            <span className="pos-label">STRN</span>
            <input
              name="strn"
              className="pos-field"
              defaultValue={shop.strn ?? ""}
              placeholder="Leave empty if you have none"
            />
            <p className="pos-hint">
              Most kiryana shops are not sales-tax registered. An empty STRN
              simply keeps it off the receipt.
            </p>
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}
