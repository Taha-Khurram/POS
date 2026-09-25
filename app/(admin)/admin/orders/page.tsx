import type { Metadata } from "next";

import { requireScreen } from "@/lib/platform/access";
import { listOrders } from "@/lib/platform/console";

import { OrdersPanel } from "./orders-panel";

export const metadata: Metadata = {
  title: "Orders",
  description: "Self-serve checkouts waiting to be matched against the bank.",
};

/** Nothing here is cached: a queue two operators are working has to be read
 *  fresh. The proofs are not signed here at all — each one is drawn through
 *  `/admin/orders/[id]/proof`, which signs a fresh link when it is opened. */
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await requireScreen("orders");

  const orders = await listOrders();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Orders</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Somebody checked out on the site and says they have paid. Match the
          transfer against the statement, then Verify &amp; activate — one press
          records it, starts their plan and makes the owner&rsquo;s login.
        </p>
      </header>

      <OrdersPanel
        orders={orders}
        readOnly={!session.screens.includes("orders")}
      />
    </div>
  );
}
