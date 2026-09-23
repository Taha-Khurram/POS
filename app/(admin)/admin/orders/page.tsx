import type { Metadata } from "next";

import { requirePlatform } from "@/lib/platform/access";
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
  const session = await requirePlatform();

  const orders = await listOrders();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Orders</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Somebody filled in the checkout and says they have paid. Match it
          against the statement, record the payment against the order, then
          accept it — accepting makes it a client, ready to activate.
        </p>
      </header>

      <OrdersPanel
        orders={orders}
        readOnly={session.platformRole !== "super_admin"}
      />
    </div>
  );
}
