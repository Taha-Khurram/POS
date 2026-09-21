"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconPlus } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import { PLAN_FEATURES, PLAN_LIMITS, flagOn } from "@/lib/platform/admin";
import type { Plan } from "@/lib/platform/console";

import { createPlan, savePlan, togglePlan } from "./actions";
import { IDLE } from "../state";

/**
 * What each plan costs and what it says it includes.
 *
 * The honest caveat is at the top of the screen rather than buried: the flags
 * below are what `/pricing` tells a shopkeeper they are buying, and nothing in
 * `/app` gates a screen on any of them yet. The one entitlement the console
 * enforces is the counter limit, and that lives on each shop's own subscription
 * because it is what gets haggled.
 *
 * Saying that out loud costs nothing and is the difference between an operator
 * who knows unticking a box changes the sales page, and one who believes it
 * takes Reports away from a shop and is surprised on a support call.
 */
export function PlansPanel({
  plans,
  counts,
  readOnly,
}: {
  plans: Plan[];
  /** How many shops are on each plan. A tier with clients on it cannot be
   *  deleted — `subscriptions.plan_id` is `on delete restrict` — and switching
   *  it off does not touch them. */
  counts: Record<string, number>;
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <p className="pos-note pos-note-warn">
        <span className="font-semibold">What these flags do.</span> They describe
        the plan on <code>/pricing</code>. No screen in the console is gated on
        one yet, so unticking a box changes the sales page and not what a shop
        can open. The real ceiling is <em>Counters</em> on each client&rsquo;s own
        plan card. Mark a flag on only when the product actually does it.
      </p>

      {plans.map((plan) => (
        <PlanForm
          key={plan.id}
          plan={plan}
          clients={counts[plan.id] ?? 0}
          readOnly={readOnly}
        />
      ))}

      {readOnly ? null : adding ? (
        <NewPlanForm onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="pos-btn pos-btn-soft"
        >
          <IconPlus className="h-4 w-4" />
          Add a plan
        </button>
      )}
    </div>
  );
}

function PlanForm({
  plan,
  clients,
  readOnly,
}: {
  plan: Plan;
  clients: number;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(savePlan, IDLE);
  const [toggleState, toggleAction] = useActionState(togglePlan, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Plan saved",
    failed: "That plan did not save",
  });
  useActionToast(toggleState, {
    saved: toggleState.saved?.label ?? "Saved",
    failed: "That did not save",
  });

  return (
    <>
      {/* A sibling, never a child: a form inside a form is invalid HTML and the
          browser drops the inner one, so the toggle would silently submit the
          editor instead. The button reaches it by id from inside the card. */}
      {readOnly ? null : (
        <form action={toggleAction} id={`toggle-${plan.id}`} className="hidden">
          <input type="hidden" name="plan_id" value={plan.id} />
          {plan.isActive ? null : <input type="hidden" name="is_active" value="on" />}
        </form>
      )}

      <form action={action}>
        <input type="hidden" name="plan_id" value={plan.id} />

        <ChartCard
          title={plan.name}
          caption={`${plan.code} · ${clients} ${clients === 1 ? "shop" : "shops"} on it${plan.isActive ? "" : " · off sale"}`}
          actions={
            readOnly ? null : (
              <button
                type="submit"
                form={`toggle-${plan.id}`}
                className="pos-btn pos-btn-quiet pos-btn-sm"
              >
                {plan.isActive ? "Take off sale" : "Put on sale"}
              </button>
            )
          }
          footer={
            readOnly ? null : (
              <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
                {pending ? "Saving…" : `Save ${plan.name}`}
              </button>
            )
          }
        >
          <fieldset disabled={readOnly || pending} className="space-y-5">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="pos-label">Name</span>
                <input name="name" className="pos-field" defaultValue={plan.name} />
              </label>

              <label className="block">
                <span className="pos-label">List price a month</span>
                <input
                  name="list_price"
                  className="pos-field"
                  defaultValue={plan.listPrice}
                  inputMode="decimal"
                />
                <span className="pos-hint">{rupees(plan.listPrice)} on /pricing.</span>
              </label>

              <label className="block">
                <span className="pos-label">Order</span>
                <input
                  name="sort_order"
                  className="pos-field"
                  defaultValue={plan.sortOrder}
                  inputMode="numeric"
                />
              </label>

              <label className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={plan.isActive}
                  className="h-4 w-4 accent-orchid-700"
                />
                <span className="text-[0.8125rem] text-graphite-900">On sale</span>
              </label>
            </div>

            <label className="block">
              <span className="pos-label">One line about it</span>
              <input
                name="pitch"
                className="pos-field"
                defaultValue={plan.pitch}
                placeholder="For a single counter that wants its stock and its profit."
              />
            </label>

            <div>
              <p className="pos-label">Ceilings</p>
              <div className="mt-1 grid gap-4 sm:grid-cols-3">
                {PLAN_LIMITS.map((limit) => {
                  const value = plan.features[limit.key];
                  return (
                    <label key={limit.key} className="block">
                      <span className="pos-label">{limit.label}</span>
                      <input
                        name={`limit:${limit.key}`}
                        className="pos-field"
                        defaultValue={typeof value === "number" ? value : ""}
                        inputMode="numeric"
                        placeholder="No limit"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="pos-label">What it says it includes</p>

              <div className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {PLAN_FEATURES.map((feature) => (
                  <label key={feature.key} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      name={`feature:${feature.key}`}
                      defaultChecked={flagOn(plan.features, feature.key)}
                      className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
                    />
                    <span className="min-w-0 text-[0.8125rem] text-graphite-900">
                      {feature.label}
                      {feature.kind === "copy" ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-graphite-500">
                          <IconAlert className="h-3 w-3 flex-none text-signal-warn" />
                          Not built
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
          </ChartCard>
      </form>
    </>
  );
}

function NewPlanForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(createPlan, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Plan created",
    failed: "That plan was not created",
  });

  return (
    <form action={action}>
      <ChartCard
        title="A new plan"
        caption="It starts off sale with nothing switched on. Set what it includes, then put it on sale."
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={onDone} className="pos-btn pos-btn-quiet">
              Cancel
            </button>
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create it"}
            </button>
          </div>
        }
      >
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-3">
          {state.error ? (
            <p className="pos-note pos-note-bad sm:col-span-3">{state.error}</p>
          ) : null}

          <label className="block">
            <span className="pos-label">Code</span>
            <input name="code" className="pos-field" placeholder="starter" />
            <span className="pos-hint">
              Lower case, no spaces. It never changes — /checkout matches on it.
            </span>
          </label>

          <label className="block">
            <span className="pos-label">Name</span>
            <input name="name" className="pos-field" placeholder="Starter" />
          </label>

          <label className="block">
            <span className="pos-label">List price a month</span>
            <input name="list_price" className="pos-field" inputMode="decimal" />
          </label>

          <label className="block sm:col-span-3">
            <span className="pos-label">One line about it</span>
            <input name="pitch" className="pos-field" />
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}
