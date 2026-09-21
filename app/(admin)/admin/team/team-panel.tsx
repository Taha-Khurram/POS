"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconTrash } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { PLATFORM_ROLES, writeDay } from "@/lib/platform/admin";
import type { Operator } from "@/lib/platform/console";

import { addOperator, removeOperator, setOperatorRole } from "./actions";
import { IDLE } from "../state";

/**
 * Who may work this console.
 *
 * Two levels and no more. Full access does everything; support reads every
 * screen, works the leads and writes notes, and cannot touch a plan, a payment
 * or a shop's standing. The split is money, which is the only split worth
 * having at this size — and every action checks it for itself rather than
 * trusting this screen not to draw a button.
 */
export function TeamPanel({
  operators,
  selfId,
}: {
  operators: Operator[];
  selfId: string;
}) {
  const [state, action, pending] = useActionState(addOperator, IDLE);
  const [roleState, roleAction] = useActionState(setOperatorRole, IDLE);
  const [removal, removeAction] = useActionState(removeOperator, IDLE);
  const [role, setRole] = useState("support");

  useActionToast(state, {
    saved: state.saved?.label ?? "Access granted",
    failed: "That account was not granted access",
  });
  useActionToast(roleState, {
    saved: roleState.saved?.label ?? "Access changed",
    failed: "That did not save",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Access removed",
    failed: "That account was not removed",
  });

  return (
    <div className="space-y-4">
      <ChartCard
        title="Who works the console"
        caption={`${operators.length} ${operators.length === 1 ? "person" : "people"}.`}
      >
        <ul className="space-y-2">
          {operators.map((operator) => (
            <li
              key={operator.userId}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-orchid-100 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-[0.8125rem] text-graphite-900">
                {operator.fullName}
                {operator.userId === selfId ? (
                  <span className="pos-badge pos-badge-info ml-2">You</span>
                ) : null}
                <span className="block text-[0.6875rem] text-graphite-500">
                  Since {writeDay(operator.createdAt)}
                </span>
              </span>

              <form action={roleAction} className="flex items-center gap-1.5">
                <input type="hidden" name="user_id" value={operator.userId} />

                {PLATFORM_ROLES.map((entry) => (
                  <button
                    key={entry.id}
                    type="submit"
                    name="platform_role"
                    value={entry.id}
                    disabled={operator.platformRole === entry.id}
                    className={`pos-btn pos-btn-sm ${
                      operator.platformRole === entry.id
                        ? "pos-btn-primary"
                        : "pos-btn-quiet"
                    }`}
                    title={entry.description}
                  >
                    {entry.label}
                  </button>
                ))}
              </form>

              {operator.userId === selfId ? null : (
                <form action={removeAction}>
                  <input type="hidden" name="user_id" value={operator.userId} />
                  <button type="submit" className="pos-icon-btn h-7 w-7" title="Remove">
                    <IconTrash className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove {operator.fullName}</span>
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </ChartCard>

      <form action={action}>
        <ChartCard
          title="Give somebody access"
          caption="The account has to exist already — /signup is the only thing that creates one."
          footer={
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Granting…" : "Grant access"}
            </button>
          }
        >
          <fieldset disabled={pending} className="space-y-4">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="pos-label">Email they sign in with</span>
                <input name="email" className="pos-field" autoComplete="off" />
              </label>

              <label className="block">
                <span className="pos-label">Name — optional</span>
                <input name="full_name" className="pos-field" autoComplete="off" />
              </label>

              <SelectRow
                label="What they may do"
                value={role}
                onChange={setRole}
                options={PLATFORM_ROLES.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  description: entry.description,
                }))}
              />
            </div>
            <input type="hidden" name="platform_role" value={role} />

            <p className="pos-note">
              Access is a JWT claim, stamped when somebody signs in — so granting
              or changing it takes effect at their <em>next</em> sign-in, not
              immediately. Removing it is the same: to stop an account now, ban
              it in Supabase, which kills the refresh token outright.
            </p>
          </fieldset>
        </ChartCard>
      </form>
    </div>
  );
}
