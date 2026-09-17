"use client";

import { useActionState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  ACCESS_LEVELS,
  PERMISSION_TOGGLES,
  TOGGLE_FIELD,
  type AccessLevel,
  type RolePermission,
} from "@/lib/pos/settings-options";
import { saveRolePermissions } from "./actions";
import { IDLE, SaveBar } from "./save-bar";

/**
 * What the cashier and the manager are allowed to do.
 *
 * Admin has no column. It is allowed everything by definition, and a checkbox
 * saying so is a checkbox the owner can eventually clear and lock themselves
 * out of their own shop with.
 *
 * One form for both levels rather than one per card: the two are read against
 * each other — a manager ceiling below a cashier's is the mistake this screen
 * exists to make visible — and a single Save means the pair can never
 * half-apply.
 *
 * Uncontrolled, like the other two cards. A checkbox that is off sends nothing
 * at all, which is why the action reads every toggle by name rather than
 * iterating what arrived.
 */
export function PermissionsForm({
  permissions,
  readOnly,
}: {
  permissions: Record<AccessLevel, RolePermission>;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveRolePermissions, IDLE);

  return (
    <form action={action}>
      <ChartCard
        title="Permissions and limits"
        caption="The register enforces this on the device; the server enforces it again."
        footer={
          <SaveBar
            state={state}
            pending={pending}
            readOnly={readOnly}
            saved="Permissions saved"
          />
        }
      >
        <fieldset disabled={readOnly || pending}>
          <div className="overflow-x-auto">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  {ACCESS_LEVELS.map((level) => (
                    <th key={level.id} className="text-center">
                      {level.label}
                    </th>
                  ))}
                  <th className="text-center">Admin</th>
                </tr>
              </thead>

              <tbody>
                {PERMISSION_TOGGLES.map((toggle) => (
                  <tr key={toggle.column}>
                    <td className="text-graphite-700">
                      <span className="block">{toggle.label}</span>
                      {toggle.hint ? (
                        <span className="block text-[0.75rem] text-graphite-500">
                          {toggle.hint}
                        </span>
                      ) : null}
                    </td>

                    {ACCESS_LEVELS.map((level) => (
                      <td key={level.id} className="text-center">
                        <input
                          type="checkbox"
                          name={`${level.id}.${toggle.column}`}
                          defaultChecked={Boolean(
                            permissions[level.id][TOGGLE_FIELD[toggle.column]],
                          )}
                          className="h-4 w-4 accent-orchid-700"
                          aria-label={`${level.label}: ${toggle.label}`}
                        />
                      </td>
                    ))}

                    {/* Not a control. An owner is allowed everything, and the
                        column is here so the row reads as a comparison rather
                        than as two levels floating on their own. */}
                    <td className="text-center text-graphite-500">Always</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {ACCESS_LEVELS.map((level) => (
              <div key={level.id} className="rounded-xl border border-orchid-100 p-3.5">
                <p className="font-display text-[0.875rem] font-bold text-graphite-900">
                  {level.label} limits
                </p>

                <label className="mt-3 block">
                  <span className="pos-label">Discount ceiling</span>
                  <input
                    name={`${level.id}.discount_ceiling_pct`}
                    className="pos-field"
                    defaultValue={permissions[level.id].discountCeilingPct}
                    inputMode="decimal"
                  />
                  <p className="pos-hint">
                    Per cent off one line, and off the bill.
                  </p>
                </label>

                <label className="mt-3 block">
                  <span className="pos-label">Khata ceiling</span>
                  <input
                    name={`${level.id}.khata_ceiling`}
                    className="pos-field"
                    defaultValue={permissions[level.id].khataCeiling}
                    inputMode="decimal"
                  />
                  <p className="pos-hint">
                    Rupees this level may put on a customer&apos;s book unasked.
                    Zero means the customer&apos;s own limit is the only one.
                  </p>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      </ChartCard>
    </form>
  );
}
