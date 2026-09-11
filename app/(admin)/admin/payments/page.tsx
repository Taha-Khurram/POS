import type { Metadata } from "next";
import { cookies } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

type PaymentRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string | null;
  shop_name: string;
};

export const metadata: Metadata = {
  title: "Payments",
  description: "Record client renewals and track payment history.",
};

async function loadPayments(): Promise<PaymentRow[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, method, reference, paid_at, tenants(shop_name)")
    .order("paid_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<Record<string, any>>;

  return rows.map((row): PaymentRow => {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;

    return {
      id: row.id,
      amount: Number(row.amount ?? 0),
      method: row.method ?? "other",
      reference: row.reference ?? null,
      paid_at: row.paid_at ?? null,
      shop_name: tenant?.shop_name ?? "Unknown",
    };
  });
}

export default async function AdminPaymentsPage() {
  await requirePlatformAdmin();
  const payments = await loadPayments();

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <p className="eyebrow">Payments</p>
        <h1 className="heading mt-3">Renewal ledger</h1>

        <div className="panel rim mt-8 overflow-hidden rounded-[22px]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[0.8125rem]">
              <thead className="border-b border-white/8 bg-white/2 text-mist-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-mist-400">
                      No payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-white/6 last:border-b-0">
                      <td className="px-4 py-3 text-mist-50">{payment.shop_name}</td>
                      <td className="px-4 py-3 text-mist-300">{payment.method}</td>
                      <td className="px-4 py-3 text-mist-300">Rs {Number(payment.amount).toLocaleString("en-PK")}</td>
                      <td className="px-4 py-3 text-mist-300">{payment.reference ?? "—"}</td>
                      <td className="px-4 py-3 text-mist-300">
                        {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("en-PK") : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
