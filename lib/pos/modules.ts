import type { TenantRole } from "@/lib/auth";
import type { RolePermission } from "@/lib/pos/settings-options";

/**
 * Which modules a person can reach.
 *
 * No `server-only`, for the reason `settings-options.ts` carries none: the rail
 * is a client component and has to type against the same keys the server
 * decided with. The decision itself is this one pure function, called on the
 * server — what crosses to the browser is the answer, never the permissions
 * that produced it.
 *
 * Two different things govern, and it is worth being honest that they are two:
 *
 *   - **Permissions** govern the working modules. Stock, customers and reports
 *     are switches an owner sets per access level on Settings → Roles &
 *     permissions, so the rail reads the same row the register does. A cashier
 *     who may not edit items has no reason to be shown the screen for it.
 *   - **Role** governs the two administration screens. Staff and Settings have
 *     no switch of their own and never should: a permission that could hide
 *     Settings is a permission an owner can hide Settings from themselves with.
 *
 * Hiding a link is presentation. Every gate below is re-checked on the server by
 * `requireModule` in `lib/pos/access.ts`, because a rail that does not draw a
 * link is not a rail that stops anybody typing the path.
 */

export const MODULES = [
  "dashboard",
  "register",
  "sales",
  "inventory",
  "customers",
  "staff",
  "reports",
  "settings",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export type ModuleAccess = Record<ModuleKey, boolean>;

/** Everything, for the owner and for anything that has to fail open. */
const ALL: ModuleAccess = {
  dashboard: true,
  register: true,
  sales: true,
  inventory: true,
  customers: true,
  staff: true,
  reports: true,
  settings: true,
};

export function moduleAccess(
  role: TenantRole | null,
  /** The stored row for this person's access level, or null to read defaults. */
  permission: RolePermission | null,
): ModuleAccess {
  // The owner is allowed everything by definition — the same reason `admin` is
  // not one of the `ACCESS_LEVELS` that can be switched off.
  if (role === "owner") return ALL;

  // No role claim at all is an account that is not attached to a shop yet. It
  // still reaches the dashboard, which says so; everything else would be a
  // screen with nothing in it.
  if (!role) {
    return { ...ALL, inventory: false, customers: false, staff: false, reports: false, settings: false };
  }

  const manager = role === "manager";

  return {
    // The landing page, and the job. Gating either would be a console that
    // signs somebody in and shows them nowhere to go.
    dashboard: true,
    register: true,
    // "Today's sales total is visible to everyone" is what the permissions
    // screen promises beside `can_view_reports`, and this screen is that total.
    // The profit and margin behind it live under Reports.
    sales: true,
    inventory: permission?.canEditItems ?? false,
    customers: permission?.canManageCustomers ?? false,
    reports: permission?.canViewReports ?? false,
    // Read-only for a manager on both screens, and the actions refuse them
    // regardless. A manager who cannot see Settings assumes the discount
    // ceiling moved; one who can see it greyed out asks the owner.
    staff: manager,
    settings: manager,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * What this session may do *at the counter*, as opposed to which screens it may
 * reach.
 *
 * A second shape rather than more keys on `ModuleAccess`, because they answer
 * different questions and are enforced in different places. A module is a
 * screen, checked once by `requireModule` before anything renders. These are
 * powers inside a screen everybody is allowed on — the register — and each one
 * is re-checked by the Server Action that acts on it.
 *
 * It crosses to the browser as this resolved object and never as the
 * permissions row it came from. The till needs to know it may give 5% away; it
 * has no business knowing what the manager's ceiling is.
 *
 * The owner is allowed everything and has no ceiling, the same way
 * `moduleAccess` hands them `ALL`. A ceiling an owner could hit is a ceiling an
 * owner can lock themselves out with, and the shop is theirs.
 */
export type TillAccess = {
  canDiscount: boolean;
  /** The most that may come off one bill, as a percentage of its subtotal. */
  discountCeilingPct: number;
  canRefund: boolean;
  canCloseShift: boolean;
  canOpenDrawer: boolean;
};

const NO_TILL: TillAccess = {
  canDiscount: false,
  discountCeilingPct: 0,
  canRefund: false,
  canCloseShift: false,
  canOpenDrawer: false,
};

export function tillAccess(
  role: TenantRole | null,
  permission: RolePermission | null,
): TillAccess {
  if (role === "owner") {
    return {
      canDiscount: true,
      discountCeilingPct: 100,
      canRefund: true,
      canCloseShift: true,
      canOpenDrawer: true,
    };
  }

  // No role claim is an account not attached to a shop. It reaches the
  // dashboard to be told so and can do nothing at a counter it does not have.
  if (!role || !permission) return NO_TILL;

  return {
    canDiscount: permission.canDiscount,
    // Meaningless without the switch above, and zeroed rather than left
    // standing so nothing downstream has to remember to check both.
    discountCeilingPct: permission.canDiscount ? permission.discountCeilingPct : 0,
    canRefund: permission.canRefund,
    canCloseShift: permission.canCloseShift,
    canOpenDrawer: permission.canOpenDrawer,
  };
}
