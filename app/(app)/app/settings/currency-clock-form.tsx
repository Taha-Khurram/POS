"use client";

import { useActionState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { SelectField } from "@/components/pos/select-field";
import {
  CURRENCIES,
  CURRENCY_FORMATS,
  DAY_ENDS,
  FISCAL_YEAR_STARTS,
  TIMEZONES,
  WEEK_STARTS,
  type ShopSettings,
} from "@/lib/pos/settings-options";
import { saveCurrencyClock } from "./actions";
import { IDLE, SaveBar } from "./save-bar";

/**
 * Currency and clock — the `tenant_settings` row.
 *
 * Six closed lists and nothing free-text, because every one of them is also a
 * check constraint. The same arrays are what the Server Action validates
 * against, so there is no second list to fall out of step.
 *
 * The seventh field is the odd one and sits apart from them: every list above
 * changes how one figure is *written*, and `restaurant_mode` changes which
 * screens the shop has at all. It is here rather than on its own tab because
 * it is a fact about the shop, and the shop is what this card is.
 */
export function CurrencyClockForm({
  settings,
  readOnly,
}: {
  settings: ShopSettings;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveCurrencyClock, IDLE);
  const locked = readOnly || pending;

  return (
    <form action={action}>
      <ChartCard
        title="Currency and clock"
        caption="How money is written, and where the day is cut."
        footer={
          <SaveBar
            state={state}
            pending={pending}
            readOnly={readOnly}
            saved="Currency and clock saved"
          />
        }
      >
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="currency"
            label="Currency"
            value={settings.currency}
            options={CURRENCIES}
            disabled={locked}
          />

          <SelectField
            name="currency_format"
            label="Written as"
            value={settings.currencyFormat}
            options={CURRENCY_FORMATS}
            disabled={locked}
          />

          <SelectField
            name="timezone"
            label="Timezone"
            value={settings.timezone}
            options={TIMEZONES}
            disabled={locked}
            hint="Pakistan has not observed daylight saving since 2009, so the offset never moves."
          />

          <SelectField
            name="day_ends_at"
            label="The sales day ends at"
            value={settings.dayEndsAt}
            options={DAY_ENDS}
            disabled={locked}
            hint="A dhaba that shuts at 1 am wants that sale on the day it opened."
          />

          <SelectField
            name="week_starts_on"
            label="The week starts on"
            value={settings.weekStartsOn}
            options={WEEK_STARTS}
            disabled={locked}
          />

          <SelectField
            name="fiscal_year_starts"
            label="Financial year starts"
            value={settings.fiscalYearStarts}
            options={FISCAL_YEAR_STARTS}
            disabled={locked}
          />
        </fieldset>

        <fieldset disabled={locked} className="mt-4 border-t border-pale-lilac pt-4">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              name="restaurant_mode"
              defaultChecked={settings.restaurantMode}
              disabled={locked}
              className="mt-0.5 h-4 w-4 shrink-0 accent-orchid-700"
            />
            <span className="text-[0.8125rem] leading-relaxed">
              <span className="font-semibold text-graphite-900">
                This shop seats people
              </span>
              <span className="mt-0.5 block text-graphite-500">
                Adds Tables to the rail: a floor map, an order per table, and a
                ticket to the kitchen. Switching it off later hides those
                screens and keeps every meal ever served on them — nothing is
                deleted and the tables are still there if you switch it back on.
              </span>
            </span>
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}
