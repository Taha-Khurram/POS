"use client";

import { useActionState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
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
 */
export function CurrencyClockForm({
  settings,
  readOnly,
}: {
  settings: ShopSettings;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveCurrencyClock, IDLE);

  return (
    <form action={action}>
      <ChartCard
        title="Currency and clock"
        caption="How money is written, and where the day is cut."
        footer={<SaveBar state={state} pending={pending} readOnly={readOnly} />}
      >
        <fieldset
          disabled={readOnly || pending}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="block">
            <span className="pos-label">Currency</span>
            <select
              name="currency"
              className="pos-field"
              defaultValue={settings.currency}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="pos-label">Written as</span>
            <select
              name="currency_format"
              className="pos-field"
              defaultValue={settings.currencyFormat}
            >
              {CURRENCY_FORMATS.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              Most 80 mm thermal printers cannot draw ₨. Rs is safe everywhere.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">Timezone</span>
            <select
              name="timezone"
              className="pos-field"
              defaultValue={settings.timezone}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              Pakistan has not observed daylight saving since 2009, so the
              offset never moves.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">The sales day ends at</span>
            <select
              name="day_ends_at"
              className="pos-field"
              defaultValue={settings.dayEndsAt}
            >
              {DAY_ENDS.map((end) => (
                <option key={end.id} value={end.id}>
                  {end.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              A dhaba that shuts at 1 am wants that sale on the day it opened.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">The week starts on</span>
            <select
              name="week_starts_on"
              className="pos-field"
              defaultValue={settings.weekStartsOn}
            >
              {WEEK_STARTS.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="pos-label">Financial year starts</span>
            <select
              name="fiscal_year_starts"
              className="pos-field"
              defaultValue={settings.fiscalYearStarts}
            >
              {FISCAL_YEAR_STARTS.map((start) => (
                <option key={start.id} value={start.id}>
                  {start.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}
