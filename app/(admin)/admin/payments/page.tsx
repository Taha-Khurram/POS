import type { Metadata } from "next";

import { rupees } from "@/lib/format";
import { requireScreen } from "@/lib/platform/access";
import { PAYMENTS_MAX, listClients, listOrders, listPayments } from "@/lib/platform/console";

import { PaymentsPanel } from "./payments-panel";

export const metadata: Metadata = {
  title: "Payments",
  description: "Every rupee taken, against which shop, and by whom.",
};

export default async function PaymentsPage() {
  const session = await requireScreen("payments");

  const [payments, clients, orders] = await Promise.all([
    listPayments(),
    listClients(),
    listOrders(),
  ]);

  // Only the orders money can still land against. One already accepted has a
  // client to pay against instead, and one rejected has nothing to buy.
  const waiting = orders.filter(
    (order) => order.status === "awaiting_payment" || order.status === "proof_submitted",
  );

  const month = payments.filter(
    (payment) =>
      new Date(payment.paidAt) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const takenThisMonth = month.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Payments</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {rupees(takenThisMonth)} in this month.
          {payments.length >= PAYMENTS_MAX
            ? ` The last ${PAYMENTS_MAX} payments are shown; the figures are for these.`
            : ""}
        </p>
      </header>

      <PaymentsPanel
        payments={payments}
        clients={clients}
        orders={waiting}
        readOnly={!session.screens.includes("payments")}
      />
    </div>
  );
}
