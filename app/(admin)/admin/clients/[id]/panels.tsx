"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { InviteCard } from "@/components/admin/invite-card";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconTrash } from "@/components/pos/icons";
import { InfoTip } from "@/components/pos/info-tip";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  BILLING_CYCLES,
  HELP,
  PAYMENT_METHODS,
  SUB_STATUSES,
  type SubscriptionStatus,
  dateInput,
  methodLabel,
  monthlyValue,
  standingOf,
  writeDay,
  writeExpiry,
  writeWhen,
} from "@/lib/platform/admin";
import type {
  Client,
  Invite,
  Note,
  Payment,
  Plan,
  ShopDetails,
  ShopUser,
} from "@/lib/platform/console";

import {
  addNote,
  deleteNote,
  extendPeriod,
  regenerateInvite,
  revokeInvite,
  setPeriodEnd,
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
  const [price, setPrice] = useState(String(client.agreedPrice));

  return (
    <form action={action}>
      <input type="hidden" name="tenant_id" value={client.tenantId} />

      <ChartCard
        title="Plan and what it buys"
        caption={`${rupees(monthlyValue(Number(price) || 0, cycle))} a month at this price and cycle. Standing and the renewal date are on the Standing card.`}
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
              {/* Stored and read by nothing — the same honest label
                  `max_branches` carries. Nothing expires a period or suspends a
                  shop on a date: `getEntitlements` decides what a shop may do
                  from its standing alone, and standing is something an operator
                  sets. Saying "how long past due is tolerated" promised a
                  tolerance the product does not implement. */}
              <span className="pos-hint">Nothing reads this yet.</span>
            </label>
          </div>
        </fieldset>
      </ChartCard>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The lifecycle, in one tap                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What you press with the shopkeeper on the phone — and the one owner of both
 * the standing and the period.
 *
 * Deliberately not the plan form beside it: at that moment nobody wants nine
 * fields and a Save button. One form, one action, and the button carries the
 * standing it moves to — which is also why there is no confirmation dialog on
 * Suspend. It is reversible in one tap from the same row, and every one of them
 * is in the audit trail under the operator's name.
 *
 * Standing and `current_period_end` both used to be fields on the plan form as
 * well. Two controls over one column is a lost update waiting to happen, and it
 * happened here: recording a payment moved the period and set the shop active,
 * and the plan form beside it — still holding the values it had rendered with —
 * put both back the moment anybody pressed Save. Everything that moves the
 * period now lives on this card or in Payments, and the plan form writes
 * neither.
 */

export function LifecycleCard({
  client,
  readOnly,
}: {
  client: Client;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(setSubscriptionStatus, IDLE);
  const [extendState, extendAction, extending] = useActionState(extendPeriod, IDLE);
  const [dateState, dateAction, dating] = useActionState(setPeriodEnd, IDLE);

  useActionToast(state, {
    saved: state.saved?.label ?? "Changed",
    failed: "That change did not save",
  });
  useActionToast(extendState, {
    saved: extendState.saved?.label ?? "Days added",
    failed: "Those days did not go on",
  });
  useActionToast(dateState, {
    saved: dateState.saved?.label ?? "Renewal date corrected",
    failed: "That date did not save",
  });

  const now = standingOf(client.status);
  const stored = client.currentPeriodEnd
    ? dateInput(new Date(client.currentPeriodEnd))
    : "";

  /**
   * The date box follows the server.
   *
   * Three things move this period — a payment, a goodwill extension and this
   * box — and the first is a card away. An uncontrolled input keeps the value
   * it mounted with, so after recording a payment the box still showed last
   * month's date and saving it wound the payment back. Resetting during render
   * when the stored date changes is React's own answer to state that has to
   * follow a prop; a `key` on the card would do it too, but it would remount
   * and swallow the toast that says what just happened.
   */
  const [periodEnd, setPeriodEndValue] = useState(stored);
  const [seen, setSeen] = useState(stored);

  if (seen !== stored) {
    setSeen(stored);
    setPeriodEndValue(stored);
  }

  return (
    <ChartCard
      title="Standing"
      caption={
        now.operable
          ? "The till is charging."
          : "The till will not charge. Reading and export stay open."
      }
      actions={<InfoTip label="Standing" explain={HELP.standing} align="end" />}
    >
      <div className="space-y-4">
        <p className={`pos-note ${now.operable ? "pos-note-good" : "pos-note-bad"}`}>
          <span className="font-semibold">{now.label}.</span> {now.description}
          {client.suspendedAt
            ? ` Suspended ${writeWhen(client.suspendedAt).toLowerCase()}.`
            : ""}
        </p>

        {client.status === null ? (
          // Nothing below can act on a tenant with no subscription row: every
          // one of these actions updates `subscriptions` by `tenant_id` and
          // would match nothing. Saying so beats three buttons that fail.
          <p className="text-[0.8125rem] text-graphite-500">
            There is no subscription behind this shop, so there is no standing to
            change and no period to move. It has to be given a plan before the
            till will charge.
          </p>
        ) : readOnly ? (
          <p className="text-[0.75rem] text-graphite-500">
            A support account can read this and change nothing on it.
          </p>
        ) : (
          <>
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
                  {STANDING_BUTTON[entry.id]}
                </button>
              ))}
            </form>

            {/* One section over one column, rather than two forms with a
                paragraph of prose under each.

                Giving days and correcting the date both write
                `current_period_end` and mean two different things, so they stay
                two actions with two audit rows — but they were drawn as two
                unrelated blocks, each explaining itself in grey text, and the
                buttons that matter ended up below the fold. The heading says
                what the date is, the tips say what each control does, and the
                only sentence left on the card is the one that is conditional
                and actionable. */}
            <section className="space-y-3 border-t border-orchid-100 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="pos-label mb-0 flex items-center gap-1">
                  Renewal date
                  <InfoTip label="Renewal date" explain={HELP.renewalDate} />
                </h3>

                <p className="text-[0.75rem] tabular-nums text-graphite-500">
                  {writeDay(client.currentPeriodEnd)} ·{" "}
                  {writeExpiry(client.daysUntilExpiry)}
                </p>
              </div>

              {/* Days on the period do not reopen a shut till: `getEntitlements`
                  reads the standing and never the date. An operator promising a
                  week to a suspended shopkeeper has to put them back in business
                  too, and would otherwise hear about it from the shopkeeper. */}
              {!now.operable ? (
                <p className="pos-note pos-note-warn">
                  Days on their own will not start the till again — this shop is{" "}
                  {now.label.toLowerCase()}. Put them back in business as well.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <form action={extendAction} className="flex items-center gap-2">
                  <input type="hidden" name="tenant_id" value={client.tenantId} />

                  <input
                    name="days"
                    className="pos-field w-16 text-center"
                    defaultValue="7"
                    inputMode="numeric"
                    aria-label="Days to give"
                  />

                  <button
                    type="submit"
                    className="pos-btn pos-btn-soft pos-btn-sm"
                    disabled={extending}
                  >
                    {extending ? "Adding…" : "Give days"}
                  </button>

                  <InfoTip label="Give days" explain={HELP.giveDays} />
                </form>

                <form action={dateAction} className="flex items-center gap-2">
                  <input type="hidden" name="tenant_id" value={client.tenantId} />

                  <input
                    type="date"
                    name="current_period_end"
                    className="pos-field"
                    value={periodEnd}
                    onChange={(event) => setPeriodEndValue(event.target.value)}
                    aria-label="Paid up to"
                  />

                  <button
                    type="submit"
                    className="pos-btn pos-btn-quiet pos-btn-sm"
                    disabled={dating || periodEnd === stored || !periodEnd}
                  >
                    {dating ? "Saving…" : "Correct"}
                  </button>
                </form>
              </div>
            </section>
          </>
        )}
      </div>
    </ChartCard>
  );
}

/** The lifecycle buttons say what pressing them does, not what the row will
 *  then be called: "Suspend", never "Suspended". Out here as a lookup so the
 *  card is not a five-deep ternary in the middle of a form. */
const STANDING_BUTTON: Record<SubscriptionStatus, string> = {
  active: "Put back in business",
  suspended: "Suspend",
  cancelled: "Cancel",
  past_due: "Mark past due",
  trialing: "Back to trial",
};

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
  users,
  readOnly,
}: {
  client: Client;
  invites: Invite[];
  /** Who can actually sign in. This card used to sit beside a second one that
   *  listed them, and both captions read "N accounts on this shop" — the same
   *  sentence, from the same number, twice down one column. They are one
   *  question: can anybody get in, and who. */
  users: ShopUser[];
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

  const signedIn = users.length;

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
        actions={<InfoTip label="Signing in" explain={HELP.signIn} align="end" />}
      >
        <div className="space-y-3">
          {signedIn === 0 && !live ? (
            <p className="pos-note pos-note-warn">
              This shop has been activated and has no live link. Nobody can sign
              in until you make one.
            </p>
          ) : null}

          {live ? (
            // What happens to it — shown once, killed by the next one — is in
            // the tip on the header now. Here it only has to say there is one.
            <p className="pos-note">
              A link is live and expires {writeWhen(live.expiresAt).toLowerCase()}.
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

          {/* No email column: `profiles` does not carry one, and reading
              `auth.users` for it would be this console holding a password reset
              over somebody's own account. */}
          {signedIn > 0 ? (
            <ul className="space-y-2 border-t border-orchid-100 pt-3">
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[0.8125rem] text-graphite-900">
                    {user.fullName}
                    <span className="block text-[0.6875rem] text-graphite-500">
                      {user.tenantRole} · joined {writeDay(user.createdAt)}
                    </span>
                  </span>
                  {user.isActive ? null : (
                    <span className="pos-badge pos-badge-warn">Suspended</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

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
