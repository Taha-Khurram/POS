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
 * Two kinds of people, on purpose, and the split is in the schema rather than
 * in this screen: `profiles` holds the owner and manager, who are real auth
 * users; cashiers get a PIN on the staff table and never touch auth at all.
 * That keeps a paid shop at one or two monthly active users instead of eight,
 * and it is also the only thing that lets a cashier switch mid-rush on a
 * tablet with no signal.
 *
 * So "create an account" means two different things here, and the screen says
 * which is which rather than pretending there is one kind of person.
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
    signIn: "4-digit PIN at the register",
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
        caption="Three of them, and only two need an email address."
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
          A cashier is not an account you pay for. The PIN is checked on the
          tablet itself, so switching cashiers mid-rush works with the internet
          down — and your bill stays at one or two signed-in users however many
          people stand at the counter.
        </p>
      </ChartCard>

      <PermissionsForm permissions={permissions} readOnly={readOnly} />
    </div>
  );
}
