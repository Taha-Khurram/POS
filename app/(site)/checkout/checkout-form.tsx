"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { createCheckoutOrder } from "@/app/(site)/checkout/actions";
import { PayFact } from "@/components/site/pay-accounts";
import { SiteSelectField } from "@/components/site/select-field";
import { rupees } from "@/lib/format";
import { BILLING_CYCLES, cycleMonths } from "@/lib/platform/admin";

export type CheckoutPlan = {
  code: string;
  name: string;
  listPrice: number;
  pitch: string | null;
  counters: number | null;
};

/**
 * The whole purchase on one page: who you are, what you want, where to send it.
 *
 * It used to stop after the first half and hand the buyer a second page for the
 * money. The price is fixed by the plan and the cycle, so the amount can be
 * shown — and paid — before anything is submitted, and a buyer with the banking
 * app already open sends the screenshot on the same press.
 *
 * A client component only for the total, which follows the two dropdowns. The
 * figure that counts is the action's own `quoted_price`; this is the same
 * `list_price × months` written for the browser. The accounts are rendered by
 * the page and handed in, so none of that markup is shipped twice.
 *
 * The transfer note is the buyer's phone number, not an order reference: the
 * reference does not exist until the order does, and the phone is on the order
 * anyway, so it is what the operator matches the statement against.
 */
export function CheckoutForm({
  plans,
  chosen,
  error,
  accounts,
}: {
  plans: CheckoutPlan[];
  chosen: string;
  error: string | null;
  accounts: ReactNode;
}) {
  const [planCode, setPlanCode] = useState(chosen);
  const [cycle, setCycle] = useState("monthly");
  const [phone, setPhone] = useState("");

  const plan = plans.find((entry) => entry.code === planCode);
  const amount = plan ? plan.listPrice * cycleMonths(cycle) : 0;

  return (
    <form action={createCheckoutOrder} className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
      {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}

      <h2 className="text-lg font-bold text-mist-50">1 · Your shop</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div><label htmlFor="shop_name" className="label">Shop name</label><input id="shop_name" name="shop_name" className="field" required /></div>
        <div><label htmlFor="owner_name" className="label">Owner name</label><input id="owner_name" name="owner_name" className="field" required /></div>
        <div>
          <label htmlFor="phone" className="label">WhatsApp number</label>
          <input id="phone" name="phone" type="tel" className="field" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0300 1234567" />
        </div>
        <div><label htmlFor="city" className="label">City</label><input id="city" name="city" className="field" required /></div>
        <div className="md:col-span-2">
          <label htmlFor="email" className="label">Email <span className="text-mist-400">(optional)</span></label>
          <input id="email" name="email" type="email" className="field" />
        </div>
      </div>

      <h2 className="mt-8 border-t border-ink-700 pt-6 text-lg font-bold text-mist-50">2 · Your plan</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <SiteSelectField
          name="plan_code"
          label="Plan"
          defaultValue={chosen}
          onChange={setPlanCode}
          placeholder="No plan on sale right now"
          options={plans.map((entry) => ({
            id: entry.code,
            label: entry.name,
            description:
              [
                entry.pitch,
                entry.counters ? `Up to ${entry.counters} ${entry.counters === 1 ? "counter" : "counters"}.` : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
            meta: `${rupees(entry.listPrice)}/mo`,
          }))}
        />
        <SiteSelectField
          name="billing_cycle"
          label="Pay every"
          defaultValue="monthly"
          onChange={setCycle}
          options={BILLING_CYCLES.map((entry) => ({
            id: entry.id,
            label: entry.label,
            description: entry.description,
          }))}
        />
      </div>

      <h2 className="mt-8 border-t border-ink-700 pt-6 text-lg font-bold text-mist-50">3 · Pay</h2>
      <p className="mt-3 text-[0.875rem] leading-relaxed text-mist-300">
        Send the exact amount to any one account below, with your WhatsApp number in the transfer note. Paying later is fine too — you get a link to send the screenshot from.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <PayFact label="Send exactly" value={rupees(amount)} copy={String(amount)} />
        <PayFact label="Transfer note" value={phone.trim() || "Your WhatsApp number"} copy={phone.trim()} />
      </div>

      <div className="mt-5">{accounts}</div>

      <div className="mt-6">
        <label htmlFor="proof" className="label">Payment screenshot <span className="text-mist-400">(if you have paid)</span></label>
        <input id="proof" name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="field file:mr-3 file:rounded-lg file:border-0 file:bg-iris-500 file:px-3 file:py-2 file:text-white" />
      </div>

      <PlaceOrder disabled={!plan} />
      <p className="mt-3 text-[0.8125rem] text-mist-400">
        We match the transfer against our statement and send your login on WhatsApp.
      </p>
    </form>
  );
}

/** Its own component because `useFormStatus` reads the form it sits inside.
 *  A pending flag in the form's state would stay set when the action redirects
 *  back here with an error, since the form does not remount. */
function PlaceOrder({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary mt-7" disabled={disabled || pending}>
      {pending ? "Sending…" : "Place order"}
    </button>
  );
}
