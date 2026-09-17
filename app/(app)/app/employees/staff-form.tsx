"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconCheck, IconKey, IconTrash, IconUser } from "@/components/pos/icons";
import { SelectField } from "@/components/pos/select-field";
import type { Counter } from "@/lib/pos/counter";
import type { StaffMember } from "@/lib/pos/staff";
import { STAFF_NAME_MAX, STAFF_ROLES } from "@/lib/pos/staff-options";
import { deleteStaff, resetStaffPassword, saveStaff } from "./actions";
import { NO_COUNTER, counterOptions } from "./counter-options";
import { IDLE } from "./state";
import { CredentialsCard } from "./credentials-card";

/**
 * One staff member.
 *
 * Three forms rather than one, because they are three different decisions and
 * two of them are not undoable. A Save that could also have reset a password
 * because a button was in the wrong place is a Save nobody presses confidently.
 *
 * The work email is shown and not editable. It is their login, they have it
 * written on a chit by the till, and there is nothing to gain from letting an
 * owner change it out from under somebody mid-shift.
 *
 * The switch is the only controlled field, for the reason the counter editor's
 * is: the sentence beside it reads back what it means, and a sentence that only
 * catches up after a save is a sentence nobody trusts. The re-seed below is
 * what keeps it honest when a save is refused — React puts the text fields back
 * to the stored row and cannot put `useState` back, so the card would claim
 * they were suspended when they are not.
 */
export function StaffForm({
  staff,
  counters,
}: {
  staff: StaffMember;
  counters: Counter[];
}) {
  const [state, action, pending] = useActionState(saveStaff, IDLE);
  const [active, setActive] = useState(staff.isActive);

  const [seed, setSeed] = useState(staff);
  if (seed !== staff) {
    setSeed(staff);
    setActive(staff.isActive);
  }

  return (
    <div className="space-y-4">
      <form action={action}>
        {/* Checked against the shop's own rows inside the action, which also
            refuses the owner's id — a crafted one must never reach the update. */}
        <input type="hidden" name="staff_id" value={staff.id} />

        <ChartCard
          title={staff.name}
          caption={staff.email ?? "No work email on this account."}
          footer={
            <>
              <p
                className="mr-auto flex items-center gap-1.5 text-[0.75rem]"
                aria-live="polite"
              >
                {state.error ? (
                  <>
                    <IconAlert className="h-3.5 w-3.5 flex-none text-signal-bad" />
                    <span className="text-signal-bad">{state.error}</span>
                  </>
                ) : state.savedAt ? (
                  <>
                    <IconCheck className="h-3.5 w-3.5 flex-none text-signal-good" />
                    <span className="text-graphite-700">Saved.</span>
                  </>
                ) : null}
              </p>

              <button
                type="submit"
                className="pos-btn pos-btn-primary"
                disabled={pending}
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </>
          }
        >
          <fieldset disabled={pending} className="space-y-5">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orchid-100 bg-orchid-50/60 p-3.5">
              <input
                type="checkbox"
                name="is_active"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
              />

              <span className="min-w-0">
                <span className="flex items-center gap-2 font-display text-[0.875rem] font-semibold text-graphite-900">
                  <IconUser className="h-4 w-4 text-orchid-700" />
                  Can sign in
                </span>

                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                  {active ? (
                    <>
                      They can sign in at flo-pos with their work email and
                      password, on as many devices as they stand at.
                    </>
                  ) : (
                    <>
                      Suspended. Their password still works nowhere — the account
                      is shut at the door, not just hidden here. Switch it back on
                      and they are in again with the same one.
                    </>
                  )}
                </span>
              </span>
            </label>

            <div>
              <label className="pos-label" htmlFor="edit-name">
                Full name
              </label>
              <input
                id="edit-name"
                name="full_name"
                className="pos-field"
                defaultValue={staff.name}
                maxLength={STAFF_NAME_MAX}
                autoComplete="off"
                required
              />
              <p className="pos-hint">
                Changing this does not change their work email — that stays{" "}
                <span className="font-mono">{staff.email ?? "unset"}</span>.
              </p>
            </div>

            <div>
              <label className="pos-label" htmlFor="edit-phone">
                Phone <span className="font-normal text-graphite-500">— optional</span>
              </label>
              <input
                id="edit-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                className="pos-field"
                defaultValue={staff.phone ?? ""}
                placeholder="03001234567"
                autoComplete="off"
              />
            </div>

            <SelectField
              name="tenant_role"
              label="What they may do"
              value={staff.role === "manager" ? "manager" : "cashier"}
              options={STAFF_ROLES}
              hint={
                <>
                  Takes effect the next time they sign in — the level is stamped
                  into their session, so somebody promoted mid-shift stays a
                  cashier until they sign out and back in.
                </>
              }
            />

            <SelectField
              name="counter_id"
              label="Their counter"
              value={staff.counterId ?? NO_COUNTER}
              options={counterOptions(counters)}
              hint={
                <>
                  The counter their register opens on. Unlike the role above, it
                  takes effect on their next page load — it is read from the row,
                  not from their session.
                </>
              }
            />
          </fieldset>
        </ChartCard>
      </form>

      <PasswordCard staff={staff} />
      <RemoveCard staff={staff} />
    </div>
  );
}

/**
 * A new password.
 *
 * Its own form and its own state, so the password that comes back is not
 * competing with the Save above it for one status line — and so pressing Save
 * on the details never mints one by accident.
 */
function PasswordCard({ staff }: { staff: StaffMember }) {
  const [state, action, pending] = useActionState(resetStaffPassword, IDLE);

  if (state.credentials) return <CredentialsCard {...state.credentials} />;

  return (
    <form action={action}>
      <input type="hidden" name="staff_id" value={staff.id} />

      <section className="pos-card p-4">
        <h2 className="flex items-center gap-2 font-display text-[0.9375rem] leading-tight font-semibold">
          <IconKey className="h-4 w-4 text-orchid-700" />
          Password
        </h2>

        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-graphite-700">
          We cannot read their password back — we only keep a scrambled copy. If
          they have forgotten it, make a new one and send it over; the old one
          stops working the moment you do.
        </p>

        {state.error ? (
          <p className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-signal-bad">
            <IconAlert className="h-3.5 w-3.5 flex-none" />
            {state.error}
          </p>
        ) : null}

        <button type="submit" className="pos-btn pos-btn-soft mt-3" disabled={pending}>
          {pending ? "Making one…" : "New password"}
        </button>
      </section>
    </form>
  );
}

/**
 * Removing somebody.
 *
 * Two taps, because it cannot be undone and because the answer is usually the
 * switch at the top of the page instead. The confirmation says what actually
 * happens to their sales rather than asking "are you sure?", which is a question
 * nobody has ever read.
 */
function RemoveCard({ staff }: { staff: StaffMember }) {
  const [state, action, pending] = useActionState(deleteStaff, IDLE);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action}>
      <input type="hidden" name="staff_id" value={staff.id} />

      <section className="pos-card p-4">
        <h2 className="flex items-center gap-2 font-display text-[0.9375rem] leading-tight font-semibold">
          <IconTrash className="h-4 w-4 text-signal-bad" />
          Remove {staff.name}
        </h2>

        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-graphite-700">
          {confirming ? (
            <>
              Their account goes for good and cannot be brought back — a new one
              would be a new work email. The sales they rang up stay in your
              takings; they simply stop saying who rang them up. If they might
              come back next season, suspend them instead.
            </>
          ) : (
            <>
              For somebody who has left the shop. If they are only away — Eid,
              exams, a month at home — switch{" "}
              <strong className="font-semibold">Can sign in</strong> off instead
              and their account waits for them.
            </>
          )}
        </p>

        {state.error ? (
          <p className="mt-2 flex items-center gap-1.5 text-[0.75rem] text-signal-bad">
            <IconAlert className="h-3.5 w-3.5 flex-none" />
            {state.error}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {confirming ? (
            <>
              <button
                type="submit"
                className="pos-btn pos-btn-soft text-signal-bad"
                disabled={pending}
              >
                <IconTrash className="h-4 w-4" />
                {pending ? "Removing…" : "Yes, remove them"}
              </button>

              <button
                type="button"
                className="pos-btn pos-btn-quiet"
                onClick={() => setConfirming(false)}
              >
                Keep them
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pos-btn pos-btn-soft text-signal-bad"
              onClick={() => setConfirming(true)}
            >
              <IconTrash className="h-4 w-4" />
              Remove from shop
            </button>
          )}
        </div>
      </section>
    </form>
  );
}
