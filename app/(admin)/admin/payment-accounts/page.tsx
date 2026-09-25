import type { Metadata } from "next";

import { requireSuperAdmin } from "@/lib/platform/access";
import { listPaymentAccounts } from "@/lib/platform/console";

import { AccountsPanel } from "./accounts-panel";

export const metadata: Metadata = {
  title: "Payment accounts",
  description: "Where a buyer sends the money for a self-serve order.",
};

/**
 * The bank and wallet accounts `/order/[reference]` tells a buyer to pay into.
 *
 * A table and not a constant for the reason `plans` is one: a wallet hits its
 * monthly ceiling, a bank account changes, and either should be a form rather
 * than a deploy. A support account reads it — they field "where do I send it?"
 * on WhatsApp — and cannot change a digit of it.
 */
export default async function PaymentAccountsPage() {
  await requireSuperAdmin();
  const accounts = await listPaymentAccounts();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Payment accounts
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Where a buyer sends the money after checking out. Every account that
          is on shows on the order&rsquo;s payment page, with a copy button beside
          each number.
        </p>
      </header>

      <AccountsPanel accounts={accounts} readOnly={false} />
    </div>
  );
}
