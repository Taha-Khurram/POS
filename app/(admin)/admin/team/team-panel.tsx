"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { CredentialsCard } from "@/components/pos/credentials-card";
import { IconKey, IconTrash } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { PLATFORM_ROLES, writeDay } from "@/lib/platform/admin";
import type { Operator } from "@/lib/platform/console";
import { STAFF_NAME_MAX } from "@/lib/pos/staff-options";

import {
  addOperator,
  removeOperator,
  resetOperatorPassword,
  setOperatorActive,
  setOperatorRole,
} from "./actions";
import { IDLE } from "../state";

/**
 * Who may work this console.
 *
 * Two levels and no more. Full access does everything; support reads every
 * screen, works the leads and writes notes, and cannot touch a plan, a payment
 * or a shop's standing. The split is money, which is the only split worth
 * having at this size — and every action checks it for itself rather than
 * trusting this screen not to draw a button.
 *
 * The console makes the account: an email, a name, a level, and Flo mints the
 * password, shown once on the same card `/app/employees` hands a cashier's over
 * with. Nothing on this screen can read it back afterwards.
 */
export function TeamPanel({
  operators,
  selfId,
}: {
  operators: Operator[];
  selfId: string;
}) {
  const [state, action, pending] = useActionState(addOperator, IDLE);
  const [role, setRole] = useState("support");
  const [dismissed, setDismissed] = useState<number | null>(null);

  useActionToast(state, {
    saved: state.saved?.label ?? "Account created",
    failed: "That account was not created",
  });

  const active = operators.filter((operator) => operator.isActive).length;
  const off = operators.length - active;

  return (
    <div className="space-y-4">
      <ChartCard
        title="Who works the console"
        caption={`${operators.length} ${operators.length === 1 ? "person" : "people"}${
          off ? `, ${off} switched off` : ""
        }.`}
      >
        <ul className="space-y-2">
          {operators.map((operator) => (
            <OperatorRow
              key={operator.userId}
              operator={operator}
              self={operator.userId === selfId}
            />
          ))}
        </ul>
      </ChartCard>

      {state.credentials && state.savedAt !== dismissed ? (
        <div className="space-y-2">
          <CredentialsCard {...state.credentials} emailLabel="Email" />
          <button
            type="button"
            className="pos-btn pos-btn-quiet pos-btn-sm"
            onClick={() => setDismissed(state.savedAt)}
          >
            I have sent it — hide this
          </button>
        </div>
      ) : null}

      <form action={action}>
        <ChartCard
          title="Add somebody"
          caption="Flo makes the account and the password. You hand them over."
          footer={
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create account"}
            </button>
          }
        >
          <fieldset disabled={pending} className="space-y-4">
            {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="pos-label">Email they sign in with</span>
                <input
                  name="email"
                  type="email"
                  required
                  className="pos-field"
                  autoComplete="off"
                />
              </label>

              <label className="block">
                <span className="pos-label">Name</span>
                <input
                  name="full_name"
                  required
                  maxLength={STAFF_NAME_MAX}
                  className="pos-field"
                  autoComplete="off"
                />
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

            {/* One child: `.pos-note` is a flex row, and bare text beside an
                <em> becomes three columns. */}
            <p className="pos-note">
              <span>
                Nothing is emailed — the password is shown once, here, for you to
                send. If the address already signs in to a shop, it is given the
                console and keeps its own password. Switching somebody off or
                removing them takes effect from their next click.
              </span>
            </p>
          </fieldset>
        </ChartCard>
      </form>
    </div>
  );
}

/**
 * One operator: their level, and the three things that can happen to them.
 *
 * Switching off comes before deleting on purpose — it is undoable, it keeps
 * their name on the roster and the trail, and it is the answer for anybody who
 * might be back. Delete asks twice and says what it does to *this* account,
 * because the answer differs for a login that also runs a shop.
 */
function OperatorRow({ operator, self }: { operator: Operator; self: boolean }) {
  const [roleState, roleAction] = useActionState(setOperatorRole, IDLE);
  const [standing, standingAction, standingPending] = useActionState(setOperatorActive, IDLE);
  const [reset, resetAction, resetPending] = useActionState(resetOperatorPassword, IDLE);
  const [removal, removeAction, removePending] = useActionState(removeOperator, IDLE);
  const [confirming, setConfirming] = useState(false);
  const [hidden, setHidden] = useState<number | null>(null);

  useActionToast(roleState, {
    saved: roleState.saved?.label ?? "Access changed",
    failed: "That did not save",
  });
  useActionToast(standing, {
    saved: standing.saved?.label ?? "Saved",
    failed: "That did not save",
  });
  useActionToast(reset, {
    saved: reset.saved?.label ?? "New password made",
    failed: "No new password",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Removed",
    failed: "That account was not removed",
  });

  return (
    <li
      className={`rounded-xl border border-orchid-100 px-3 py-2 ${
        operator.isActive ? "" : "bg-paper-200/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[0.8125rem] text-graphite-900">
          <span className={operator.isActive ? "" : "text-graphite-500"}>
            {operator.fullName}
          </span>
          {self ? <span className="pos-badge pos-badge-info ml-2">You</span> : null}
          {operator.isActive ? null : (
            <span className="pos-badge pos-badge-warn ml-2">Switched off</span>
          )}
          {operator.hasShop ? (
            <span
              className="pos-badge ml-2"
              title="This login also runs a shop. Its password and its till are left alone."
            >
              Runs a shop
            </span>
          ) : null}
          <span className="block truncate text-[0.6875rem] text-graphite-500">
            {operator.email ? `${operator.email} · ` : ""}Since {writeDay(operator.createdAt)}
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
                operator.platformRole === entry.id ? "pos-btn-primary" : "pos-btn-quiet"
              }`}
              title={entry.description}
            >
              {entry.label}
            </button>
          ))}
        </form>

        {self ? null : (
          <div className="flex items-center gap-1.5">
            <form action={standingAction}>
              <input type="hidden" name="user_id" value={operator.userId} />
              <input
                type="hidden"
                name="is_active"
                value={operator.isActive ? "false" : "true"}
              />
              <button
                type="submit"
                className="pos-btn pos-btn-soft pos-btn-sm"
                disabled={standingPending}
              >
                {operator.isActive ? "Switch off" : "Switch on"}
              </button>
            </form>

            {operator.hasShop ? null : (
              <form action={resetAction}>
                <input type="hidden" name="user_id" value={operator.userId} />
                <button
                  type="submit"
                  className="pos-icon-btn h-7 w-7"
                  title="New password"
                  disabled={resetPending}
                >
                  <IconKey className="h-3.5 w-3.5" />
                  <span className="sr-only">New password for {operator.fullName}</span>
                </button>
              </form>
            )}

            <button
              type="button"
              className="pos-icon-btn h-7 w-7 text-signal-bad"
              title="Delete"
              onClick={() => setConfirming(true)}
            >
              <IconTrash className="h-3.5 w-3.5" />
              <span className="sr-only">Delete {operator.fullName}</span>
            </button>
          </div>
        )}
      </div>

      {confirming ? (
        <form
          action={removeAction}
          className="mt-2 flex flex-wrap items-center gap-2 border-t border-orchid-100 pt-2"
        >
          <input type="hidden" name="user_id" value={operator.userId} />
          <p className="min-w-0 flex-1 text-[0.75rem] leading-relaxed text-graphite-700">
            {operator.hasShop
              ? "Their console access goes. Their login and their shop are left exactly as they are."
              : "The account is deleted for good — that email and password will open nothing. What they did stays in the trail. If they might be back, switch them off instead."}
          </p>
          <button
            type="submit"
            className="pos-btn pos-btn-soft pos-btn-sm text-signal-bad"
            disabled={removePending}
          >
            {removePending ? "Deleting…" : operator.hasShop ? "Yes, remove access" : "Yes, delete"}
          </button>
          <button
            type="button"
            className="pos-btn pos-btn-quiet pos-btn-sm"
            onClick={() => setConfirming(false)}
          >
            Keep them
          </button>
        </form>
      ) : null}

      {reset.credentials && reset.savedAt !== hidden ? (
        <div className="mt-2 space-y-2">
          <CredentialsCard {...reset.credentials} emailLabel="Email" />
          <button
            type="button"
            className="pos-btn pos-btn-quiet pos-btn-sm"
            onClick={() => setHidden(reset.savedAt)}
          >
            I have sent it — hide this
          </button>
        </div>
      ) : null}
    </li>
  );
}
