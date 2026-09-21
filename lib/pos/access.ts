import "server-only";

import { notFound } from "next/navigation";

import { requireSession, type SessionContext } from "@/lib/auth";
import {
  moduleAccess,
  tillAccess,
  type ModuleAccess,
  type ModuleKey,
  type TillAccess,
} from "@/lib/pos/modules";
import { getRolePermissions, getShopSettings } from "@/lib/pos/shop";

/**
 * What this session may reach, resolved once from the stored permissions.
 *
 * Deliberately NOT wrapped in React `cache()`, like the readers in `shop.ts`
 * that it leans on: `cache()` is scoped to the request, and a Server Action
 * plus the re-render its `revalidatePath` triggers are one request — so an
 * owner who just switched `can_view_reports` off would watch the rail go on
 * drawing Reports until they navigated away and came back.
 *
 * That costs one extra read of `role_permissions` on a request that renders
 * both the layout and a gated page. The owner — the common case — costs none at
 * all, because the answer does not depend on the table for them.
 */
export async function getModuleAccess(
  session: SessionContext,
): Promise<ModuleAccess> {
  // Whether this shop seats people. Not a permission — see `moduleAccess` — and
  // read for everybody including the owner, which is the one thing that costs a
  // query on a path that otherwise costs the owner none. It is one row of one
  // shop's settings, already read on most pages, and the alternative is a rail
  // that draws a floor map for a kiryana.
  const shop = session.tenantId
    ? { restaurantMode: (await getShopSettings(session.tenantId)).restaurantMode }
    : { restaurantMode: false };

  if (session.tenantRole === "owner" || !session.tenantId || !session.tenantRole) {
    return moduleAccess(session.tenantRole, null, shop);
  }

  const permissions = await getRolePermissions(session.tenantId);

  // `tenant_role` and `access_level` are the same two words below owner, which
  // is what lets the rail read the row the register enforces rather than a
  // second list that can drift away from it.
  return moduleAccess(session.tenantRole, permissions[session.tenantRole], shop);
}

/**
 * The gate a module's page calls for itself.
 *
 * `notFound()` rather than a refusal, for the reason the platform console
 * returned 404 to non-admins: a screen that says "you are not allowed here" has
 * confirmed the screen exists, and the first thing a cashier does with that is
 * ask the owner why. A module they may not use is a module that is not there.
 *
 * This is the control. The rail not drawing the link is the courtesy.
 */
export async function requireModule(
  module: ModuleKey,
): Promise<SessionContext> {
  const session = await requireSession();
  const access = await getModuleAccess(session);

  if (!access[module]) notFound();

  return session;
}

/**
 * What this session may do at the counter.
 *
 * The same read `getModuleAccess` makes, resolved into the other shape — and
 * deliberately not memoised either, for the same reason: a Server Action plus
 * the re-render its `revalidatePath` triggers are one request, and an owner who
 * just switched a cashier's discount off would watch the control go on being
 * offered until they navigated away.
 *
 * The owner costs no read at all, because the answer does not depend on the
 * table for them.
 */
export async function getTillAccess(
  session: SessionContext,
): Promise<TillAccess> {
  if (session.tenantRole === "owner" || !session.tenantId || !session.tenantRole) {
    return tillAccess(session.tenantRole, null);
  }

  const permissions = await getRolePermissions(session.tenantId);

  return tillAccess(session.tenantRole, permissions[session.tenantRole]);
}
