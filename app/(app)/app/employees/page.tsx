import type { Metadata } from "next";

import { requireModule } from "@/lib/pos/access";
import { getShopProfile } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";
import { StaffPanel } from "./staff-panel";

export const metadata: Metadata = {
  title: "Staff",
  description: "Add a cashier or a manager, and hand them their sign-in.",
};

/**
 * Staff.
 *
 * The owner hires, edits and removes; nothing else on this screen exists. Which
 * of the three the page is showing lives in the URL rather than in React state,
 * so the page stays a server component and the roster it draws is read fresh on
 * every navigation.
 *
 * `readOnly` is a manager, and here it is more than presentation: the list is
 * drawn without links into an editor, because every control inside that editor
 * would be refused by the action anyway. The action checks the role again for
 * itself — a disabled input is a suggestion, and this is the screen where one
 * being taken for a control would let a manager make themselves an owner.
 */
export default async function EmployeesPage({
  searchParams,
}: PageProps<"/app/employees">) {
  const session = await requireModule("staff");

  if (!session.tenantId) return <NotAttached />;

  const query = await searchParams;

  const [shop, staff] = await Promise.all([
    getShopProfile(session.tenantId),
    listStaff(session.tenantId),
  ]);

  // The claim says there is a shop but RLS returned nothing — in practice the
  // access-token hook switched off, which is silent everywhere else.
  if (!shop) return <NotAttached unreadable />;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Staff</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {shop.shopName} · who can open the till, and what they sign in with
        </p>
      </header>

      <StaffPanel
        staff={staff}
        // A staff id in the URL that is not one of this shop's simply falls back
        // to the list, the same way an unknown counter does.
        selected={
          staff.find((member) => member.id === query.staff && !member.isOwner) ??
          null
        }
        adding={query.new === "1"}
        shopName={shop.shopName}
        viewerId={session.userId}
        readOnly={session.tenantRole !== "owner"}
      />
    </div>
  );
}

/** Same words as the register's and Settings' gate, because it is one problem. */
function NotAttached({ unreadable = false }: { unreadable?: boolean }) {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <h1 className="font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop. Message us on
        the same WhatsApp number you arranged Flo on and we will attach it.
      </p>

      {unreadable ? (
        <p className="pos-hint mt-3">
          Developer note: the session carries a tenant but the shop row came back
          empty, which almost always means the Customize Access Token hook is
          off. Run <code>npm run doctor</code> with your password.
        </p>
      ) : null}
    </div>
  );
}
