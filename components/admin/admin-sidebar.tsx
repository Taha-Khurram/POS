"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/(app)/app/actions";
import {
  IconCard,
  IconCart,
  IconCash,
  IconClose,
  IconCustomers,
  IconDashboard,
  IconEmployees,
  IconHistory,
  IconRegister,
  IconStore,
  IconSignOut,
  IconTag,
  type IconProps,
} from "@/components/pos/icons";
import type { PlatformRole } from "@/lib/platform/admin";

/**
 * The counts that sit on the rail as badges.
 *
 * Only the two queues that are somebody's job today. A badge on a screen that
 * is never "done" — clients, plans, audit — teaches people to ignore badges.
 */
export type RailCounts = {
  ordersToVerify: number;
  leadsNew: number;
  expiring: number;
};

type Item = {
  href: string;
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  /** Which count, if any, rides on this row. */
  count?: keyof RailCounts;
  /** Rows only the full-access account gets. */
  billing?: boolean;
};

/**
 * Grouped by the question being asked, the same way `/app`'s rail is.
 *
 * "Money" is the morning: who is paying, who has not, what landed overnight.
 * "The product" is the occasional afternoon when a plan changes. "Trust" is
 * what you open when something has gone wrong and you need to know who did it.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Money",
    items: [
      { href: "/admin", label: "Overview", icon: IconDashboard, count: "expiring" },
      { href: "/admin/clients", label: "Clients", icon: IconStore },
      { href: "/admin/orders", label: "Orders", icon: IconCart, count: "ordersToVerify" },
      { href: "/admin/payments", label: "Payments", icon: IconCash },
    ],
  },
  {
    label: "The product",
    items: [
      { href: "/admin/plans", label: "Plans", icon: IconTag },
      { href: "/admin/payment-accounts", label: "Payment accounts", icon: IconCard },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/admin/leads", label: "Leads", icon: IconCustomers, count: "leadsNew" },
    ],
  },
  {
    label: "Trust",
    items: [
      { href: "/admin/audit", label: "Audit trail", icon: IconHistory },
      { href: "/admin/team", label: "Team", icon: IconEmployees, billing: true },
    ],
  },
];

export function AdminSidebar({
  open,
  tight,
  email,
  role,
  counts,
  onNavigate,
  onClose,
}: {
  open: boolean;
  tight: boolean;
  email: string | null;
  role: PlatformRole;
  counts: RailCounts;
  onNavigate: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.billing || role === "super_admin"),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      id="admin-rail"
      className="pos-rail"
      data-open={open}
      data-tight={tight}
      aria-label="Platform navigation"
    >
      <div className="flex h-[var(--pos-header)] flex-none items-center justify-end border-b border-orchid-100 px-3 lg:hidden">
        <button
          type="button"
          onClick={onClose}
          className="pos-icon-btn"
          aria-label="Close navigation"
        >
          <IconClose />
        </button>
      </div>

      <nav className="hide-scrollbar flex-1 overflow-y-auto px-2.5 pt-4 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <p className="pos-rail-section">{group.label}</p>

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                const waiting = item.count ? counts[item.count] : 0;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={tight ? item.label : undefined}
                      className="pos-rail-link"
                    >
                      <Icon className="h-[18px] w-[18px] flex-none" />
                      <span className="pos-rail-text flex-1">{item.label}</span>
                      {waiting > 0 && !tight ? (
                        <span className="pos-count h-4 min-w-4 rounded-full px-1">
                          {waiting}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* The way back to the shop floor. An operator who also runs a shop is
            both accounts at once, and the two consoles are otherwise one
            address bar apart with no door between them. */}
        <div className="mt-6 border-t border-orchid-100 pt-3">
          <Link
            href="/app"
            onClick={onNavigate}
            className="pos-rail-link"
            title={tight ? "Your own shop" : undefined}
          >
            <IconRegister className="h-[18px] w-[18px] flex-none" />
            <span className="pos-rail-text flex-1">Your own shop</span>
          </Link>
        </div>
      </nav>

      <div className="flex-none border-t border-orchid-100 p-2.5">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="pos-stamp h-8 w-8 rounded-full text-[0.75rem]">F</span>

          <div className="pos-rail-text min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-semibold text-graphite-900">
              {role === "super_admin" ? "Full access" : "Support"}
            </p>
            <p className="truncate text-[0.6875rem] text-graphite-500">
              {email ?? "Signed in"}
            </p>
          </div>

          <form action={signOut} className="pos-rail-text flex-none">
            <button type="submit" className="pos-icon-btn" title="Sign out">
              <IconSignOut className="h-[18px] w-[18px]" />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>

        {tight ? (
          <form action={signOut} className="mt-1">
            <button type="submit" className="pos-rail-link w-full" title="Sign out">
              <IconSignOut className="h-[18px] w-[18px] flex-none" />
              <span className="pos-rail-text">Sign out</span>
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
