import { ChartCard } from "@/components/pos/chart-card";
import {
  IconEmployees,
  IconRegister,
  IconSettings,
  type IconProps,
} from "@/components/pos/icons";
import type { AccessLevel, RolePermission } from "@/lib/pos/settings-options";
import { PermissionsForm } from "./permissions-form";

/**
 * User roles and permissions.
 *
 * Three access levels, and every one of them signs in the same way: a `profiles`
 * row against a real auth user, with an email and a password. The two switchable
 * levels are cashier and store manager; admin is the owner, is allowed
 * everything by definition, and has no stored row that could be switched off.
 *
 * This screen used to say a cashier was a 4-digit PIN checked on the tablet,
 * which would work with no signal and cost nothing in monthly active users.
 * None of that was built — `staff.ts` mints a work email and a password, and
 * `/app/employees` reads it out. A screen describing a sign-in the product does
 * not have is worse than no screen: an owner plans a shift around it.
 */

const LEVELS: {
  id: AccessLevel | "admin";
  name: string;
  icon: (props: IconProps) => React.ReactElement;
  signIn: string;
  summary: string;
}[] = [
  {
    id: "cashier",
    name: "Cashier",
    icon: IconRegister,
    signIn: "Email and password",
    summary:
      "Sells, takes payment, prints. Everything beyond that is a switch below, and off by default.",
  },
  {
    id: "manager",
    name: "Store manager",
    icon: IconEmployees,
    signIn: "Email and password",
    summary:
      "Everything a cashier does, plus whatever you tick for them — usually returns, the drawer, and the count at close.",
  },
  {
    id: "admin",
    name: "Admin",
    icon: IconSettings,
    signIn: "Email and password",
    summary:
      "The owner. Prices, staff, the plan, and every report. Nothing is hidden from this level, and nothing about it can be switched off.",
  },
];

export function RolesPanel({
  permissions,
  readOnly,
}: {
  permissions: Record<AccessLevel, RolePermission>;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      <ChartCard
        title="Access levels"
        caption="Three of them. Two you can change; the owner's is fixed."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level.id}
              className="rounded-xl border border-orchid-100 p-3.5"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-orchid-50 text-orchid-700">
                <level.icon className="h-[18px] w-[18px]" />
              </span>

              <h3 className="mt-2.5 font-display text-[0.875rem] font-bold text-graphite-900">
                {level.name}
              </h3>
              <p className="mt-0.5 text-[0.75rem] font-medium text-orchid-700">
                {level.signIn}
              </p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-graphite-700">
                {level.summary}
              </p>
            </div>
          ))}
        </div>

        <p className="pos-hint mt-3.5">
          Staff accounts are unlimited and cost nothing extra, so add one for
          everybody who stands at the counter rather than sharing a sign-in —
          every bill records who rang it up, and that is only worth anything if
          the name on it is right.
        </p>
      </ChartCard>

      <PermissionsForm permissions={permissions} readOnly={readOnly} />
    </div>
  );
}
