"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { InviteCard } from "@/components/admin/invite-card";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconAlert, IconTrash } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  BILLING_CYCLES,
  PAYMENT_METHODS,
  PLAN_FEATURES,
  SUB_STATUSES,
  dateInput,
  methodLabel,
  monthlyValue,
  statusOf,
  writeDay,
  writeWhen,
} from "@/lib/platform/admin";
import type {
  Client,
  Invite,
  Note,
  Payment,
  Plan,
  ShopDetails,
} from "@/lib/platform/console";

import {
  addNote,
  deleteNote,
  extendPeriod,
  regenerateInvite,
  revokeInvite,
  setFeatureOverride,
  setSubscriptionStatus,
  updateClient,
  updateSubscription,
} from "../actions";
import { deletePayment, recordPayment } from "../../payments/actions";
import { IDLE } from "../../state";

/**
 * One client's record — the screens you need at 11 pm on a support call.
 *
 * Several cards in one file rather than six files of forty lines. They are one
 * screen, they share one client's props, and splitting them would mean six
 * imports of the same three helpers to make each file look tidier in a
 * directory listing.
 *
 * Every card is its own `<form>` with its own `useActionState`, so a failed
 * plan change does not clear the payment somebody had half typed beside it, and
 * each one says what it did through the toaster rather than by reloading.
 */

const cycleLabel = (cycle: string) =>
  cycle === "monthly" ? "month" : cycle === "quarterly" ? "quarter" : "year";

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

export function PlanCard({
  client,
  plans,
  readOnly,
}: {
  client: Client;
  plans: Plan[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(updateSubscription, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Plan saved",
    failed: "That plan change did not save",
  });

  const [planId, setPlanId] = useState(client.planId ?? plans[0]?.id ?? "");
  const [cycle, setCycle] = useState(client.billingCycle);
  const [status, setStatus] = useState(client.status ?? "active");
  const [price, setPrice] = useState(String(client.agreedPrice));

  const chosen = SUB_STATUSES.find((entry) => entry.id === status);

  return (
    <form action={action}>
      <input type="hidden" name="tenant_id" value={client.tenantId} />

      <ChartCard
        title="Plan and what it buys"
        caption={`${rupees(monthlyValue(Number(price) || 0, cycle))} a month at this price and cycle.`}
        footer={
          readOnly ? (
            <p className="text-[0.75rem] text-graphite-500">
              A support account can read this and change nothing on it.
            </p>
          ) : (
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save the plan"}
            </button>
          )
        }
      >
        <fieldset disabled={readOnly || pending} className="space-y-5">
          {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectRow
              label="Plan"
              value={planId}
              onChange={setPlanId}
              options={plans.map((plan) => ({
                id: plan.id,
                label: plan.name,
                description: `${rupees(plan.listPrice)} a month list${plan.isActive ? "" : " · off sale"}`,
              }))}
            />
            <input type="hidden" name="plan_id" value={planId} />

            <SelectRow
              label="Billed"
              value={cycle}
              onChange={(next) => setCycle(next as typeof cycle)}
              options={BILLING_CYCLES.map((entry) => ({
                id: entry.id,
                label: entry.label,
                description: entry.description,
              }))}
            />
            <input type="hidden" name="billing_cycle" value={cycle} />

            <label className="block">
              <span className="pos-label">Price agreed</span>
              <input
                name="agreed_price"
                className="pos-field"
                value={price}
                inputMode="decimal"
                onChange={(event) => setPrice(event.target.value)}
              />
              <span className="pos-hint">Per {cycleLabel(cycle)}. The invoice, not the list price.</span>
            </label>

            <SelectRow
              label="Standing"
              value={status}
              onChange={(next) => setStatus(next as typeof status)}
              options={SUB_STATUSES.map((entry) => ({
                id: entry.id,
                label: entry.label,
                description: entry.description,
              }))}
              hint={
                chosen && !chosen.operable
                  ? "The register will refuse new sales. Reading, exporting and closing the drawer stay open."
                  : undefined
              }
            />
            <input type="hidden" name="status" value={status} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="pos-label">Counters</span>
              <input
                name="max_registers"
                className="pos-field"
                defaultValue={client.maxRegisters}
                inputMode="numeric"
              />
              <span className="pos-hint">
                The one ceiling the console enforces — Settings refuses the counter above it.
              </span>
            </label>

            <label className="block">
              <span className="pos-label">Branches</span>
              <input
                name="max_branches"
                className="pos-field"
                defaultValue={client.maxBranches}
                inputMode="numeric"
              />
              <span className="pos-hint">Nothing reads this yet.</span>
            </label>

            <label className="block">
              <span className="pos-label">Grace days</span>
              <input
                name="grace_days"
                className="pos-field"
                defaultValue={client.graceDays}
                inputMode="numeric"
              />
              <span className="pos-hint">How long past due is tolerated.</span>
            </label>
          </div>

          <label className="block sm:max-w-xs">
            <span className="pos-label">Paid up to</span>
            <input
              type="date"
              name="current_period_end"
              className="pos-field"
              defaultValue={
                client.currentPeriodEnd
                  ? dateInput(new Date(client.currentPeriodEnd))
                  : ""
              }
            />
            <span className="pos-hint">
              Recording a payment moves this by itself. Edit it only to correct a date.
            </span>
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The lifecycle, in one tap                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What you press with the shopkeeper on the phone.
 *
 * Deliberately not the form above: at that moment nobody wants nine fields and
 * a Save button. One form, one action, and the button carries the standing it
 * moves to — which is also why there is no confirmation dialog on Suspend. It
 * is reversible in one tap from the same row, and every one of them is in the
 * audit trail under the operator's name.
 */
export function LifecycleCard({ client }: { client: Client }) {
  const [state, action, pending] = useActionState(setSubscriptionStatus, IDLE);
  const [extendState, extendAction, extending] = useActionState(extendPeriod, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Changed",
    failed: "That change did not save",
  });
  useActionToast(extendState, {
    saved: extendState.saved?.label ?? "Days added",
    failed: "Those days did not go on",
  });

  const now = statusOf(client.status ?? "active");

  return (
    <ChartCard
      title="Standing"
      caption={
        now.operable
          ? "The till is charging."
          : "The till will not charge. Reading and export stay open."
      }
    >
      <div className="space-y-4">
        <p className={`pos-note ${now.operable ? "pos-note-good" : "pos-note-bad"}`}>
          <span className="font-semibold">{now.label}.</span> {now.description}
          {client.suspendedAt
            ? ` Suspended ${writeWhen(client.suspendedAt).toLowerCase()}.`
            : ""}
        </p>

        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="tenant_id" value={client.tenantId} />

          {SUB_STATUSES.filter((entry) => entry.id !== client.status).map((entry) => (
            <button
              key={entry.id}
              type="submit"
              name="status"
              value={entry.id}
              disabled={pending}
              className={`pos-btn pos-btn-sm ${entry.id === "active" ? "pos-btn-primary" : "pos-btn-soft"}`}
              title={entry.description}
            >
              {entry.id === "active"
                ? "Put back in business"
                : entry.id === "suspended"
                  ? "Suspend"
                  : entry.id === "cancelled"
                    ? "Cancel"
                    : entry.id === "past_due"
                      ? "Mark past due"
                      : "Back to trial"}
            </button>
          ))}
        </form>

        <form
          action={extendAction}
          className="flex flex-wrap items-end gap-2 border-t border-orchid-100 pt-4"
        >
          <input type="hidden" name="tenant_id" value={client.tenantId} />

          <label className="block">
            <span className="pos-label">Give days</span>
            <input
              name="days"
              className="pos-field w-24"
              defaultValue="7"
              inputMode="numeric"
            />
          </label>

          <button type="submit" className="pos-btn pos-btn-soft" disabled={extending}>
            {extending ? "Adding…" : "Add to the period"}
          </button>

          <p className="w-full text-[0.75rem] text-graphite-500">
            Goodwill, with no payment behind it — a week lost to a dead printer.
            Money taken goes in Payments below, which moves the date by itself.
          </p>
        </form>
      </div>
    </ChartCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Money in                                                                   */
/* -------------------------------------------------------------------------- */

export function PaymentsCard({
  client,
  payments,
  readOnly,
}: {
  client: Client;
  payments: Payment[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(recordPayment, IDLE);
  const [removal, removeAction] = useActionState(deletePayment, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Payment recorded",
    failed: "That payment did not record",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Payment removed",
    failed: "That payment did not come off",
  });

  const columns: Column<Payment>[] = [
    {
      key: "when",
      header: "Taken",
      cell: (payment) => (
        <span className="text-graphite-700">{writeDay(payment.paidAt)}</span>
      ),
    },
    {
      key: "how",
      header: "How",
      cell: (payment) => (
        <span className="text-graphite-700">
          {methodLabel(payment.method)}
          {payment.reference ? (
            <span className="block font-mono text-[0.6875rem] text-graphite-500">
              {payment.reference}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "covers",
      header: "Bought",
      hideBelow: "sm",
      cell: (payment) =>
        payment.coversTo ? (
          <span className="text-graphite-700">to {writeDay(payment.coversTo)}</span>
        ) : (
          <span className="text-graphite-500">no time</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (payment) => rupees(payment.amount),
    },
    ...(readOnly
      ? []
      : [
          {
            key: "remove",
            header: "",
            align: "end" as const,
            cell: (payment: Payment) => (
              <form action={removeAction} className="inline">
                <input type="hidden" name="payment_id" value={payment.id} />
                <button
                  type="submit"
                  className="pos-icon-btn h-7 w-7"
                  title="Remove this payment"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove</span>
                </button>
              </form>
            ),
          },
        ]),
  ];

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <ChartCard
      title="Payments"
      caption={
        payments.length === 0
          ? "Nothing taken from this shop yet."
          : `${rupees(total)} across ${payments.length} ${payments.length === 1 ? "payment" : "payments"}.`
      }
      bleed
    >
      {readOnly ? null : (
        <form action={action} className="border-b border-orchid-100 px-4 pt-1 pb-4">
          <input type="hidden" name="tenant_id" value={client.tenantId} />

          {state.error ? (
            <p className="pos-note pos-note-bad mb-3">{state.error}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="pos-label">Amount</span>
              <input
                name="amount"
                className="pos-field"
                defaultValue={client.agreedPrice}
                inputMode="decimal"
              />
            </label>

            <label className="block">
              <span className="pos-label">How it arrived</span>
              <select name="method" className="pos-field" defaultValue="bank_transfer">
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="pos-label">Cycles bought</span>
              <input
                name="cycles"
                className="pos-field"
                defaultValue="1"
                inputMode="numeric"
              />
              <span className="pos-hint">0 records a part payment and moves nothing.</span>
            </label>

            <label className="block">
              <span className="pos-label">Date</span>
              <input
                type="date"
                name="paid_on"
                className="pos-field"
                defaultValue={dateInput(new Date())}
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="pos-label">Reference — optional</span>
              <input
                name="reference"
                className="pos-field"
                placeholder="Meezan TID, Easypaisa number"
                autoComplete="off"
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="pos-label">Note — optional</span>
              <input name="notes" className="pos-field" autoComplete="off" />
            </label>
          </div>

          <div className="mt-3 flex justify-end">
            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Recording…" : "Record the payment"}
            </button>
          </div>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={payments}
        rowKey={(payment) => payment.id}
        empty="Nothing taken yet."
      />
    </ChartCard>
  );
}

/* -------------------------------------------------------------------------- */
/* The invite                                                                 */
/* -------------------------------------------------------------------------- */

export function InvitePanel({
  client,
  invites,
  signedIn,
  readOnly,
}: {
  client: Client;
  invites: Invite[];
  signedIn: number;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(regenerateInvite, IDLE);
  const [revocation, revokeAction] = useActionState(revokeInvite, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "New link ready",
    failed: "No new link was made",
  });
  useActionToast(revocation, {
    saved: revocation.saved?.label ?? "Link revoked",
    failed: "That link was not revoked",
  });

  const live = invites.find(
    (invite) =>
      !invite.usedAt && !invite.revokedAt && new Date(invite.expiresAt) > new Date(),
  );

  return (
    <div className="space-y-4">
      {state.invite ? <InviteCard invite={state.invite} /> : null}

      <ChartCard
        title="Signing in"
        caption={
          signedIn > 0
            ? `${signedIn} ${signedIn === 1 ? "account" : "accounts"} on this shop.`
            : "Nobody has made an account yet."
        }
      >
        <div className="space-y-3">
          {signedIn === 0 && !live ? (
            <p className="pos-note pos-note-warn">
              This shop has been activated and has no live link. Nobody can sign
              in until you make one.
            </p>
          ) : null}

          {live ? (
            <p className="pos-note">
              A link is live and expires {writeWhen(live.expiresAt).toLowerCase()}.
              Nothing can show it again — regenerating makes a new one and kills
              this.
            </p>
          ) : null}

          {readOnly ? (
            <p className="text-[0.75rem] text-graphite-500">
              A support account cannot mint sign-in links.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <form action={action}>
                <input type="hidden" name="tenant_id" value={client.tenantId} />
                <button type="submit" className="pos-btn pos-btn-soft" disabled={pending}>
                  {pending ? "Making…" : live ? "Make a new link" : "Make a link"}
                </button>
              </form>

              {live ? (
                <form action={revokeAction}>
                  <input type="hidden" name="tenant_id" value={client.tenantId} />
                  <input type="hidden" name="invite_id" value={live.id} />
                  <button type="submit" className="pos-btn pos-btn-quiet">
                    Revoke it
                  </button>
                </form>
              ) : null}
            </div>
          )}

          {invites.length > 0 ? (
            <ul className="space-y-1 border-t border-orchid-100 pt-3 text-[0.75rem] text-graphite-500">
              {invites.slice(0, 4).map((invite) => (
                <li key={invite.id}>
                  {invite.usedAt
                    ? `Used ${writeWhen(invite.usedAt).toLowerCase()}`
                    : invite.revokedAt
                      ? `Revoked ${writeWhen(invite.revokedAt).toLowerCase()}`
                      : new Date(invite.expiresAt) > new Date()
                        ? `Live until ${writeDay(invite.expiresAt)}`
                        : `Expired ${writeWhen(invite.expiresAt).toLowerCase()}`}
                  {" · made "}
                  {writeDay(invite.createdAt)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </ChartCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One-off deals                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A feature flipped for this shop alone.
 *
 * `feature_overrides` is merged over the plan's own JSON by `getEntitlements`,
 * so this is "Premium price, but throw in X" without inventing a plan per
 * customer. Only the overrides that exist are listed — a table of thirty rows,
 * twenty-nine of which say "same as the plan", is a table nobody reads.
 *
 * The card states the uncomfortable truth at the bottom: nothing in the console
 * reads these flags yet. They describe the plan on `/pricing`, and
 * `max_registers` on the card above is the one entitlement that actually bites.
 * Saying so is the difference between a console an operator trusts and one they
 * quietly stop believing.
 */
export function OverridesCard({
  client,
  planFeatures,
  readOnly,
}: {
  client: Client;
  planFeatures: Record<string, unknown>;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(setFeatureOverride, IDLE);
  const [feature, setFeature] = useState<string>(PLAN_FEATURES[0].key);

  useActionToast(state, {
    saved: state.saved?.label ?? "Override saved",
    failed: "That override did not save",
  });

  const overrides = Object.entries(client.featureOverrides);

  return (
    <ChartCard
      title="One-off deals"
      caption={
        overrides.length === 0
          ? "This shop gets exactly what its plan says."
          : `${overrides.length} ${overrides.length === 1 ? "feature differs" : "features differ"} from the plan.`
      }
    >
      <div className="space-y-4">
        {overrides.length > 0 ? (
          <ul className="space-y-2">
            {overrides.map(([key, value]) => {
              const known = PLAN_FEATURES.find((entry) => entry.key === key);
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-orchid-100 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 text-[0.8125rem] text-graphite-900">
                    {known?.label ?? key}
                    <span className="block text-[0.6875rem] text-graphite-500">
                      Plan says {planFeatures[key] === true ? "on" : "off"}
                    </span>
                  </span>

                  <span
                    className={`pos-badge ${value === true ? "pos-badge-good" : "pos-badge-bad"}`}
                  >
                    {value === true ? "On for them" : "Off for them"}
                  </span>

                  {readOnly ? null : (
                    <form action={action}>
                      <input type="hidden" name="tenant_id" value={client.tenantId} />
                      <input type="hidden" name="feature" value={key} />
                      <input type="hidden" name="value" value="clear" />
                      <button type="submit" className="pos-btn pos-btn-quiet pos-btn-sm">
                        Follow the plan
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {readOnly ? null : (
          <form action={action} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenant_id" value={client.tenantId} />

            <div className="min-w-48 flex-1">
              <SelectRow
                label="Feature"
                value={feature}
                onChange={setFeature}
                options={PLAN_FEATURES.map((entry) => ({
                  id: entry.key,
                  label: entry.label,
                  description: entry.kind === "wired" ? "The product honours this" : "Copy for /pricing",
                }))}
              />
            </div>
            <input type="hidden" name="feature" value={feature} />

            <button
              type="submit"
              name="value"
              value="on"
              className="pos-btn pos-btn-soft"
              disabled={pending}
            >
              Give it
            </button>
            <button
              type="submit"
              name="value"
              value="off"
              className="pos-btn pos-btn-quiet"
              disabled={pending}
            >
              Take it away
            </button>
          </form>
        )}

        <p className="flex items-start gap-2 text-[0.75rem] leading-snug text-graphite-500">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
          Nothing in the console gates a screen on these yet — they are what
          `/pricing` says a plan includes. The counter limit on the plan card is
          the one entitlement that is actually enforced.
        </p>
      </div>
    </ChartCard>
  );
}

/* -------------------------------------------------------------------------- */
/* The shop's own details                                                     */
/* -------------------------------------------------------------------------- */

export function DetailsCard({
  client,
  details,
  readOnly,
}: {
  client: Client;
  /** Read for this one shop — the form posts every field it draws, so a blank
   *  NTN box would erase a stored one on the next save. */
  details: ShopDetails;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(updateClient, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Details saved",
    failed: "Those details did not save",
  });

  return (
    <form action={action}>
      <input type="hidden" name="tenant_id" value={client.tenantId} />

      <ChartCard
        title="Shop details"
        caption="The name on the receipt and the number you ring."
        footer={
          readOnly ? null : (
            <button type="submit" className="pos-btn pos-btn-soft" disabled={pending}>
              {pending ? "Saving…" : "Save the details"}
            </button>
          )
        }
      >
        <fieldset disabled={readOnly || pending} className="space-y-4">
          {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="pos-label">Shop name</span>
              <input name="shop_name" className="pos-field" defaultValue={client.shopName} />
            </label>

            <label className="block">
              <span className="pos-label">Owner</span>
              <input name="owner_name" className="pos-field" defaultValue={client.ownerName} />
            </label>

            <label className="block">
              <span className="pos-label">Phone</span>
              <input name="phone" className="pos-field" defaultValue={client.phone} />
            </label>

            <label className="block">
              <span className="pos-label">City</span>
              <input name="city" className="pos-field" defaultValue={client.city} />
            </label>

            <label className="block">
              <span className="pos-label">Email</span>
              <input name="email" className="pos-field" defaultValue={client.email} />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="pos-label">NTN</span>
                <input name="ntn" className="pos-field" defaultValue={details.ntn} />
              </label>
              <label className="block">
                <span className="pos-label">STRN</span>
                <input name="strn" className="pos-field" defaultValue={details.strn} />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="pos-label">Notes on the shop</span>
            <textarea
              name="notes"
              className="pos-field min-h-16"
              defaultValue={details.notes}
            />
            <span className="pos-hint">
              Printed nowhere. The running commentary belongs in the notes below.
            </span>
          </label>
        </fieldset>
      </ChartCard>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

export function NotesCard({
  tenantId,
  notes,
}: {
  tenantId: string;
  notes: Note[];
}) {
  const [state, action, pending] = useActionState(addNote, IDLE);
  const [removal, removeAction] = useActionState(deleteNote, IDLE);
  const [body, setBody] = useState("");

  useActionToast(state, { saved: "Note added", failed: "That note did not save" });
  useActionToast(removal, { saved: "Note removed", failed: "That note did not come off" });

  /**
   * Empty the box once the note has actually landed, not on the press.
   *
   * Clearing it in the button's `onClick` looks equivalent and is not: React
   * runs the handler and re-renders the controlled textarea to "" *before* the
   * form is serialised, so the action received an empty body and refused every
   * note with "Write something first". Keyed off `savedAt` like everything else
   * in the console, so the `revalidatePath` re-render does not clear a note
   * somebody has already started typing.
   */
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;
    setBody("");
  }, [state.savedAt]);

  return (
    <ChartCard
      title="Notes"
      caption="Who introduced you, what they haggled to, which printer they bought."
    >
      <div className="space-y-4">
        <form action={action} className="space-y-2">
          <input type="hidden" name="tenant_id" value={tenantId} />

          <textarea
            name="body"
            className="pos-field min-h-16"
            value={body}
            placeholder="Said they will pay on the 5th, after the wholesale bill."
            onChange={(event) => setBody(event.target.value)}
          />

          <div className="flex justify-end">
            <button
              type="submit"
              className="pos-btn pos-btn-soft pos-btn-sm"
              disabled={pending || !body.trim()}
            >
              {pending ? "Saving…" : "Add the note"}
            </button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="text-[0.8125rem] text-graphite-500">Nothing written down yet.</p>
        ) : (
          <ul className="space-y-2 border-t border-orchid-100 pt-3">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] leading-relaxed whitespace-pre-line text-graphite-900">
                    {note.body}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-graphite-500">
                    {writeDay(note.createdAt)}
                  </p>
                </div>

                <form action={removeAction}>
                  <input type="hidden" name="tenant_id" value={tenantId} />
                  <input type="hidden" name="note_id" value={note.id} />
                  <button type="submit" className="pos-icon-btn h-7 w-7" title="Remove">
                    <IconTrash className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove this note</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ChartCard>
  );
}
