"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/(app)/app/actions";
import {
  IconClose,
  IconCustomers,
  IconDashboard,
  IconEmployees,
  IconInventory,
  IconRegister,
  IconReports,
  IconSales,
  IconSettings,
  IconSignOut,
  type IconProps,
} from "./icons";

type Item = {
  href: string;
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  /** Modules that have not shipped yet still appear — see the note below. */
  soon?: boolean;
};

/**
 * The rail is grouped by what the person at the counter is doing, not by the
 * schema: ringing up, looking after the shop, or running the business. A
 * cashier lives in the first group and never scrolls past it.
 *
 * Unbuilt modules are listed rather than hidden, and marked. A shopkeeper who
 * was sold "stock and khata" should be able to see where they will be; a rail
 * that grows new items every fortnight teaches people to re-read it every time.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Counter",
    items: [
      { href: "/app", label: "Dashboard", icon: IconDashboard },
      { href: "/app/register", label: "Register", icon: IconRegister },
      { href: "/app/sales", label: "Sales history", icon: IconSales, soon: true },
    ],
  },
  {
    label: "Shop",
    items: [
      { href: "/app/inventory", label: "Products & stock", icon: IconInventory },
      { href: "/app/customers", label: "Customers & khata", icon: IconCustomers, soon: true },
      { href: "/app/employees", label: "Staff", icon: IconEmployees, soon: true },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/app/reports", label: "Reports", icon: IconReports, soon: true },
      { href: "/app/settings", label: "Settings", icon: IconSettings },
    ],
  },
];

export function ConsoleSidebar({
  open,
  tight,
  shopName,
  email,
  onNavigate,
  onClose,
}: {
  /** Drawer state. Only meaningful below the lg breakpoint. */
  open: boolean;
  /** Icons-only. Only meaningful at lg and up. */
  tight: boolean;
  shopName: string;
  email: string | null;
  onNavigate: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const initial = (shopName.trim()[0] ?? "F").toUpperCase();

  return (
    <aside
      id="pos-rail"
      className="pos-rail"
      data-open={open}
      data-tight={tight}
      aria-label={`${shopName} navigation`}
    >
      {/* Only the drawer needs a header. At lg the wordmark is in the topbar
          and the rail can start straight in on the navigation. */}
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
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            <p className="pos-rail-section">{group.label}</p>

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/app"
                    ? pathname === "/app"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      // The label is visually hidden when collapsed, so the
                      // native tooltip is the only thing naming the icon.
                      title={tight ? item.label : undefined}
                      className="pos-rail-link"
                    >
                      <Icon className="h-[18px] w-[18px] flex-none" />
                      <span className="pos-rail-text flex-1">{item.label}</span>
                      {item.soon && !tight ? (
                        <span className="pos-rail-text rounded-full bg-orchid-50 px-1.5 py-0.5 text-[0.5625rem] font-semibold tracking-wide text-graphite-500">
                          SOON
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Who is signed in, at the foot of the rail — and the only place the
          console says it. The topbar used to carry a second copy; this one is
          readable without a click, which is what a shared counter tablet
          actually needs.

          There is no sync indicator here. It was a hard-coded "Counter online /
          Synced" that would have gone on saying so with the shop's internet
          down, which is worse than saying nothing. It comes back when
          `sync_outbox` is what answers it. */}
      <div className="flex-none border-t border-orchid-100 p-2.5">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="pos-stamp h-8 w-8 rounded-full text-[0.75rem]">
            {initial}
          </span>

          <div className="pos-rail-text min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-semibold text-graphite-900">
              {shopName}
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

        {/* Collapsed, the account block is an avatar with nothing to act on, so
            sign-out comes back as a full-width row of its own. */}
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
