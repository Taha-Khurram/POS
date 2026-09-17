"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { SelectField } from "@/components/pos/select-field";
import { IconAlert, IconPlus } from "@/components/pos/icons";
import {
  STAFF_NAME_MAX,
  STAFF_ROLES,
  workEmail,
} from "@/lib/pos/staff-options";
import { addStaff } from "./actions";
import { IDLE } from "./state";
import { CredentialsCard } from "./credentials-card";

/**
 * Hiring somebody.
 *
 * Three fields, and none of them is the login. The owner types a name and picks
 * a role; Flo works out the address and the password, because an owner asked to
 * invent both will reuse the shop's WhatsApp password for eight people and the
 * cashier who leaves in March still knows it.
 *
 * The name is controlled purely so the preview under it can keep up — that line
 * is the only thing that tells the owner, before they commit, that "Bilal" is
 * about to become `bilal@almadina.flopos.pk`. It is a preview and not a
 * promise: the action re-derives the address on the server and adds a digit if
 * the first one is taken, which is the only place the answer can actually be
 * settled.
 */
export function NewStaffForm({ shopName }: { shopName: string }) {
  const [state, action, pending] = useActionState(addStaff, IDLE);
  const [name, setName] = useState("");

  // Which result the owner has finished with. `useActionState` has no reset, and
  // navigating to the URL this form already sits at would not remount it — so
  // "Add another" is a value, not a route, and comparing it to `savedAt` is what
  // makes the next hire show its own password rather than stay dismissed.
  const [dismissed, setDismissed] = useState<number | null>(null);

  if (state.credentials && state.savedAt !== dismissed) {
    return (
      <div className="space-y-4">
        <CredentialsCard {...state.credentials} />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="pos-btn pos-btn-soft"
            onClick={() => {
              setDismissed(state.savedAt);
              setName("");
            }}
          >
            <IconPlus className="h-4 w-4" />
            Add another
          </button>

          <Link href="/app/employees" className="pos-btn pos-btn-quiet" scroll={false}>
            Back to staff
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action}>
      <ChartCard
        title="Add staff"
        caption="Flo makes the work email and the password. You hand them over."
        footer={
          <>
            <p className="mr-auto flex items-center gap-1.5 text-[0.75rem]" aria-live="polite">
              {state.error ? (
                <>
                  <IconAlert className="h-3.5 w-3.5 flex-none text-signal-bad" />
                  <span className="text-signal-bad">{state.error}</span>
                </>
              ) : null}
            </p>

            <Link href="/app/employees" className="pos-btn pos-btn-quiet" scroll={false}>
              Cancel
            </Link>

            <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create account"}
            </button>
          </>
        }
      >
        <fieldset disabled={pending} className="space-y-4">
          <div>
            <label className="pos-label" htmlFor="staff-name">
              Full name
            </label>
            <input
              id="staff-name"
              name="full_name"
              className="pos-field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={STAFF_NAME_MAX}
              placeholder="Bilal Ahmed"
              autoComplete="off"
              required
            />
            <p className="pos-hint">
              {name.trim() ? (
                <>
                  Their work email will be{" "}
                  <span className="font-mono text-graphite-900">
                    {workEmail(name, shopName)}
                  </span>
                  . If somebody already has it, we add a digit.
                </>
              ) : (
                <>
                  The name on the receipt and in the day&apos;s takings. Their work
                  email is made from it.
                </>
              )}
            </p>
          </div>

          <div>
            <label className="pos-label" htmlFor="staff-phone">
              Phone <span className="font-normal text-graphite-500">— optional</span>
            </label>
            <input
              id="staff-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              className="pos-field"
              placeholder="03001234567"
              autoComplete="off"
            />
            <p className="pos-hint">
              So you can send them the password without going looking for it.
            </p>
          </div>

          <SelectField
            name="tenant_role"
            label="What they may do"
            value="cashier"
            options={STAFF_ROLES}
            hint={
              <>
                Exactly what each one can do is on{" "}
                <Link
                  href="/app/settings?tab=roles"
                  className="font-medium text-orchid-800 underline underline-offset-2"
                >
                  Roles &amp; permissions
                </Link>
                , and applies to everybody at that level.
              </>
            }
          />
        </fieldset>
      </ChartCard>
    </form>
  );
}
