import type { Metadata } from "next";

import { requirePlatform } from "@/lib/platform/access";
import { listOrders, listPlans, proofUrl } from "@/lib/platform/console";

import { OrdersPanel } from "./orders-panel";

export const metadata: Metadata = {
  title: "Orders",
  description: "Self-serve checkouts waiting to be matched against the bank.",
};

/** Nothing here is cached: a queue two operators are working has to be read
 *  fresh, and the signed proof links expire in ten minutes anyway. */
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await requirePlatform();

  const [orders, plans] = await Promise.all([listOrders(), listPlans()]);

  // Only the ones somebody is about to look at. Signing every proof in the
  // history would be a storage round trip per settled order on every load, for
  // links nobody opens.
  const pending = orders.filter(
    (order) =>
      order.proofPath &&
      (order.status === "proof_submitted" || order.status === "awaiting_payment"),
  );

  const links = await Promise.all(
    pending.map(async (order) => [order.id, await proofUrl(order.proofPath)] as const),
  );

  const proofs = Object.fromEntries(
    links.filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Orders</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Somebody filled in the checkout and says they have paid. Match it
          against the statement before you verify — verifying activates the shop.
        </p>
      </header>

      <OrdersPanel
        orders={orders}
        plans={plans}
        proofs={proofs}
        readOnly={session.platformRole !== "super_admin"}
      />
    </div>
  );
}
