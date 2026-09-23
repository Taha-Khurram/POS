"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconPlus } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  HIGHLIGHTS_MAX,
  PLAN_FEATURES,
  PLAN_LIMITS,
  flagOn,
  limitOf,
} from "@/lib/platform/admin";
import type { Plan } from "@/lib/platform/console";

import { createPlan, savePlan, togglePlan } from "./actions";
import { IDLE } from "../state";

/**
 * What each plan costs and what it says it includes — and, since `0045`, the
 * source `/pricing` is drawn from, so a save here is a change on the sales page
 * the same minute.
 *
 * One tab per plan, with the shops on it as the count, so a tier is one tap
 * away rather than a scroll past the one above it. What each control does is
 * said beside it — the hint under each ceiling, the marker on each flag —
 * rather than in a banner nobody reads twice: a box gates no screen in `/app`,
 * and the ceilings are what bite.
 */
/** The tab that holds the new-plan form rather than a plan. */
const NEW = "new";

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
  const [selected, setSelected] = useState<string>(plans[0]?.id ?? NEW);
  // A plan that has gone (or a list that was empty) falls back to the first.
  const current =
    selected === NEW || plans.some((plan) => plan.id === selected)
      ? selected
      : (plans[0]?.id ?? NEW);

  return (
    <div className="space-y-4">
      <div className="pos-tabs" role="tablist" aria-label="Plans">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            role="tab"
            // `aria-selected` and not `aria-current`: the tabs move state in the
            // browser and navigate nowhere, and `.pos-tab` paints both.
            aria-selected={current === plan.id}
            onClick={() => setSelected(plan.id)}
            className="pos-tab"
            title={plan.isActive ? "On sale" : "Off sale"}
          >
            {plan.name}
            {plan.isActive ? null : (
              <span className="text-[0.6875rem] text-graphite-500">off sale</span>
            )}
            <span className="pos-tab-count">{counts[plan.id] ?? 0}</span>
          </button>
        ))}

        {readOnly ? null : (
          <button
            type="button"
            role="tab"
            aria-selected={current === NEW}
            onClick={() => setSelected(NEW)}
            className="pos-tab"
          >
            <IconPlus className="pos-tab-icon h-4 w-4" />
            Add a plan
          </button>
        )}
      </div>

      {/* Every plan stays mounted and only the chosen one is shown, so a
          half-edited price survives a look at the other tab. */}
      {plans.map((plan) => (
        <div key={plan.id} role="tabpanel" hidden={current !== plan.id}>
          <PlanForm plan={plan} clients={counts[plan.id] ?? 0} readOnly={readOnly} />
        </div>
      ))}

      {readOnly || current !== NEW ? null : (
        <NewPlanForm onDone={() => setSelected(plans[0]?.id ?? NEW)} />
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
          editor instead. The button reaches it by id from inside the card.
          It is the only writer of `is_active` — the editor below has no "On
          sale" box, because one rendered at page load would undo this. */}
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
          caption={`${plan.code} · ${clients} ${clients === 1 ? "shop" : "shops"} on it · ${plan.isActive ? "on /pricing" : "off sale, not on /pricing"}`}
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

            <div className="grid gap-4 sm:grid-cols-3">
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
                <span className="pos-hint">Left to right on /pricing.</span>
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
                {PLAN_LIMITS.map((limit) => (
                  <label key={limit.key} className="block">
                    <span className="pos-label">{limit.label}</span>
                    <input
                      name={`limit:${limit.key}`}
                      className="pos-field"
                      defaultValue={limitOf(plan.features, limit.key) ?? ""}
                      inputMode="numeric"
                      placeholder={limit.key === "max_staff_pins" ? "No limit" : "1"}
                    />
                    <span className="pos-hint">{limit.effect}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="pos-label">What it says it includes</p>

              <div className="mt-1 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {PLAN_FEATURES.map((feature) => (
                  <label
                    key={feature.key}
                    className="flex items-start gap-2"
                    title={`On /pricing: “${feature.line}”`}
                  >
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
                          Not built — ticking it still prints it
                        </span>
                      ) : feature.kind === "service" ? (
                        <span className="mt-0.5 block text-[0.6875rem] text-graphite-500">
                          Kept by people, not the software
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="pos-label">Extra lines on /pricing</span>
              <textarea
                name="highlights"
                className="pos-field h-auto py-2"
                defaultValue={plan.highlights.join("\n")}
                rows={Math.max(3, plan.highlights.length + 1)}
                placeholder={"Your rate list imported and checked for you\nNamed person for setup and support"}
              />
              <span className="pos-hint">
                One per line, up to {HIGHLIGHTS_MAX}, printed under the ticked
                boxes — for what no box can say. Only write what somebody will
                actually do.
              </span>
            </label>
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
        caption="It starts off sale with one counter and nothing switched on. Set what it includes, then put it on sale."
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
