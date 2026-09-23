"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { OwnerLoginCard } from "@/components/admin/owner-login-card";
import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconCheck } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  BILLING_CYCLES,
  CITY_MAX,
  GRACE_DAYS,
  NOTES_MAX,
  PERSON_MAX,
  SHOP_NAME_MAX,
  checkClient,
  cycleMonths,
  dateInput,
  limitOf,
  monthlyValue,
} from "@/lib/platform/admin";
import type { Plan } from "@/lib/platform/console";

import { activateClient } from "../actions";
import { IDLE } from "../../state";

/**
 * Sixty seconds from a closed deal to a working shop.
 *
 * The order of the fields is the order of the conversation you have just had on
 * WhatsApp: who they are, what they agreed to pay, when it starts. Everything
 * that can be guessed is guessed — the price fills itself in from the plan and
 * the cycle, the start date is today — so the operator types a name, a number
 * and a city and presses one button.
 *
 * The price stays editable after it is guessed, and that is the field this
 * whole screen exists for. Pakistani B2B sales involve haggling, and a console
 * that could only charge the list price would force you to lose the deal or lie
 * to your own records. The plan sets what they get; the price sets the invoice.
 *
 * `checkClient` is the same function the Server Action refuses with, so the
 * sentence under the form is the sentence that comes back from the server.
 */
export function ActivateForm({ plans }: { plans: Plan[] }) {
  const [state, action, pending] = useActionState(activateClient, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Shop activated",
    failed: "That shop was not activated",
  });

  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [agreedPrice, setAgreedPrice] = useState(
    plans[0] ? String(plans[0].listPrice) : "",
  );
  // A plan's ceilings are what a shop on it starts with (`PLAN_LIMITS`).
  const ceilings = (chosen: Plan | undefined) => ({
    branches: String(limitOf(chosen?.features ?? {}, "max_branches") ?? 1),
    registers: String(limitOf(chosen?.features ?? {}, "max_registers") ?? 1),
  });
  const [branches, setBranches] = useState(() => ceilings(plans[0]).branches);
  const [registers, setRegisters] = useState(() => ceilings(plans[0]).registers);
  const [trialDays, setTrialDays] = useState("0");
  const [graceDays, setGraceDays] = useState(String(GRACE_DAYS));
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);

  // Whether the operator has typed over the guess. Once they have, changing the
  // plan must not quietly rewrite the figure they agreed on the phone.
  const touched = useRef(false);
  // The same, for a counter count haggled up or down on the call.
  const touchedCeilings = useRef(false);

  const plan = plans.find((entry) => entry.id === planId);

  const suggest = (nextPlanId: string, nextCycle: string) => {
    const chosen = plans.find((entry) => entry.id === nextPlanId);
    if (!chosen) return;
    if (!touchedCeilings.current) {
      const next = ceilings(chosen);
      setBranches(next.branches);
      setRegisters(next.registers);
    }
    if (touched.current) return;
    setAgreedPrice(String(chosen.listPrice * cycleMonths(nextCycle)));
  };

  const draft = {
    shopName,
    ownerName,
    phone,
    email,
    city,
    planId,
    billingCycle,
    agreedPrice,
    branches,
    registers,
    trialDays,
    graceDays,
    notes,
  };

  const complaint = checkClient(draft);
  const price = Number(agreedPrice) || 0;
  const list = plan ? plan.listPrice * cycleMonths(billingCycle) : 0;
  const discount = list > 0 ? Math.round(((list - price) / list) * 100) : 0;

  // The login is shown once and the form is cleared behind it, so the next
  // activation starts empty rather than re-submitting the shop just created.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;

    setShopName("");
    setOwnerName("");
    setPhone("");
    setEmail("");
    setCity("");
    setNotes("");
    setTrialDays("0");
    setGraceDays(String(GRACE_DAYS));
    touched.current = false;
    touchedCeilings.current = false;
  }, [state.savedAt]);

  if (plans.length === 0) {
    return (
      <div className="pos-card p-6">
        <h2 className="font-display text-[1.125rem] font-bold">No plan to sell</h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-graphite-700">
          Every shop needs a plan behind it. Make one on{" "}
          <Link href="/admin/plans" className="text-orchid-700 underline">
            Plans
          </Link>{" "}
          and switch it on, then come back.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state.credentials ? <OwnerLoginCard credentials={state.credentials} /> : null}

      {/* A failure part way — the client made, the plan refused — leaves a
          client that exists. Say where it is rather than letting the operator
          press Activate again and make a second one. */}
      {state.error && state.tenantId ? (
        <p className="pos-note pos-note-warn">
          {state.error}{" "}
          <Link href={`/admin/clients/${state.tenantId}`} className="font-semibold underline">
            Open the client
          </Link>
        </p>
      ) : null}

      <form action={action}>
        <ChartCard
          title="Activate a shop"
          caption="For a deal closed off the site: creates the client, starts the plan and makes the owner's login."
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <p className="text-[0.75rem] text-graphite-500">
                {complaint ? (
                  <span className="flex items-center gap-1.5 text-signal-bad">
                    <IconAlert className="h-3.5 w-3.5" />
                    {complaint}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <IconCheck className="h-3.5 w-3.5 text-signal-good" />
                    {Number(trialDays) > 0
                      ? `${trialDays}-day trial, then ${rupees(price)} a ${billingCycle === "monthly" ? "month" : billingCycle === "quarterly" ? "quarter" : "year"}.`
                      : `${rupees(price)} a ${billingCycle === "monthly" ? "month" : billingCycle === "quarterly" ? "quarter" : "year"} — ${rupees(monthlyValue(price, billingCycle))} a month.`}
                  </span>
                )}
              </p>

              <button
                type="submit"
                className="pos-btn pos-btn-primary"
                disabled={pending || Boolean(complaint)}
              >
                {pending ? "Activating…" : "Activate and make the link"}
              </button>
            </div>
          }
        >
          <fieldset disabled={pending} className="space-y-5">
            {state.error ? (
              <p className="pos-note pos-note-bad">{state.error}</p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="pos-label">Shop name</span>
                <input
                  name="shop_name"
                  className="pos-field"
                  value={shopName}
                  maxLength={SHOP_NAME_MAX}
                  autoComplete="off"
                  placeholder="Al-Madina Kiryana Store"
                  onChange={(event) => setShopName(event.target.value)}
                />
                <span className="pos-hint">Prints at the top of every receipt.</span>
              </label>

              <label className="block">
                <span className="pos-label">Owner</span>
                <input
                  name="owner_name"
                  className="pos-field"
                  value={ownerName}
                  maxLength={PERSON_MAX}
                  autoComplete="off"
                  placeholder="Bilal Ahmed"
                  onChange={(event) => setOwnerName(event.target.value)}
                />
                <span className="pos-hint">Who to ask for on the phone.</span>
              </label>

              <label className="block">
                <span className="pos-label">Phone</span>
                <input
                  name="phone"
                  className="pos-field"
                  value={phone}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="0300 1234567"
                  onChange={(event) => setPhone(event.target.value)}
                />
                <span className="pos-hint">Where the sign-up link goes.</span>
              </label>

              <label className="block">
                <span className="pos-label">City</span>
                <input
                  name="city"
                  className="pos-field"
                  value={city}
                  maxLength={CITY_MAX}
                  autoComplete="off"
                  placeholder="Lahore"
                  onChange={(event) => setCity(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* `SelectRow` is a listbox the page owns, not an `<input>` —
                  so each one needs its own hidden field or the Server Action
                  gets a body with no plan in it and refuses a form that looked
                  complete. `SelectField` is the variant that carries its own;
                  these two are controlled because choosing either re-prices
                  the box below them. */}
              <SelectRow
                label="Plan"
                value={planId}
                onChange={(next) => {
                  setPlanId(next);
                  suggest(next, billingCycle);
                }}
                options={plans.map((entry) => ({
                  id: entry.id,
                  label: entry.name,
                  description: `${rupees(entry.listPrice)} a month list${entry.isActive ? "" : " · off sale"}`,
                }))}
              />
              <input type="hidden" name="plan_id" value={planId} />

              <SelectRow
                label="Billed"
                value={billingCycle}
                onChange={(next) => {
                  setBillingCycle(next);
                  suggest(planId, next);
                }}
                options={BILLING_CYCLES.map((cycle) => ({
                  id: cycle.id,
                  label: cycle.label,
                  description: cycle.description,
                }))}
              />
              <input type="hidden" name="billing_cycle" value={billingCycle} />

              <label className="block">
                <span className="pos-label">Price agreed</span>
                <input
                  name="agreed_price"
                  className="pos-field"
                  value={agreedPrice}
                  inputMode="decimal"
                  onChange={(event) => {
                    touched.current = true;
                    setAgreedPrice(event.target.value);
                  }}
                />
                <span className="pos-hint">
                  {/* The haggle, stated. An operator who can see that they have
                      just given away 20% is an operator who can decide to. */}
                  {discount > 0
                    ? `${discount}% under the list price of ${rupees(list)}.`
                    : discount < 0
                      ? `${-discount}% over the list price of ${rupees(list)}.`
                      : "The list price for this plan and cycle."}
                </span>
              </label>

              <label className="block">
                <span className="pos-label">Counters</span>
                <input
                  name="registers"
                  className="pos-field"
                  value={registers}
                  inputMode="numeric"
                  onChange={(event) => {
                    touchedCeilings.current = true;
                    setRegisters(event.target.value);
                  }}
                />
                <span className="pos-hint">
                  From the plan. The real ceiling — Settings refuses a shop the
                  counter above it.
                </span>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="pos-label">Trial days</span>
                <input
                  name="trial_days"
                  className="pos-field"
                  value={trialDays}
                  inputMode="numeric"
                  onChange={(event) => setTrialDays(event.target.value)}
                />
                <span className="pos-hint">0 for a shop that has already paid.</span>
              </label>

              <label className="block">
                <span className="pos-label">Starts</span>
                <input
                  type="date"
                  name="starts_at"
                  className="pos-field"
                  defaultValue={dateInput(new Date())}
                />
              </label>

              <label className="block">
                <span className="pos-label">Branches</span>
                <input
                  name="branches"
                  className="pos-field"
                  value={branches}
                  inputMode="numeric"
                  onChange={(event) => {
                    touchedCeilings.current = true;
                    setBranches(event.target.value);
                  }}
                />
                <span className="pos-hint">Nothing reads this yet. One is right.</span>
              </label>

              <label className="block">
                <span className="pos-label">Grace days</span>
                <input
                  name="grace_days"
                  className="pos-field"
                  value={graceDays}
                  inputMode="numeric"
                  onChange={(event) => setGraceDays(event.target.value)}
                />
                <span className="pos-hint">Past the renewal date before the till stops.</span>
              </label>
            </div>

            {/* The rest is paperwork nobody has on the phone. Folded away, so
                the form above stays the ninety seconds it promises. */}
            <div className="border-t border-orchid-100 pt-4">
              <button
                type="button"
                onClick={() => setMore(!more)}
                className="pos-btn pos-btn-quiet pos-btn-sm"
                aria-expanded={more}
              >
                {more ? "Hide" : "Email, tax numbers and a note"}
              </button>

              {more ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="pos-label">Email — optional</span>
                    <input
                      name="email"
                      className="pos-field"
                      value={email}
                      autoComplete="off"
                      placeholder="bilal@example.com"
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>

                  <label className="block">
                    <span className="pos-label">NTN — optional</span>
                    <input name="ntn" className="pos-field" autoComplete="off" />
                  </label>

                  <label className="block">
                    <span className="pos-label">STRN — optional</span>
                    <input name="strn" className="pos-field" autoComplete="off" />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="pos-label">Note — optional</span>
                    <textarea
                      name="notes"
                      className="pos-field min-h-20"
                      value={notes}
                      maxLength={NOTES_MAX}
                      placeholder="Introduced by Kamran at the cash-and-carry. Haggled from 5,000."
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </fieldset>
        </ChartCard>
      </form>
    </div>
  );
}
