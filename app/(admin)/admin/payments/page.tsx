import type { Metadata } from "next";
import { cookies } from "next/headers";

import { recordPayment } from "@/app/(admin)/admin/actions";
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

type PaymentQueryRow = {
  id: string;
  amount: number | string;
  method: string;
  reference: string | null;
  paid_at: string | null;
  tenants: { shop_name: string } | Array<{ shop_name: string }> | null;
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

  const rows = (data ?? []) as PaymentQueryRow[];

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

async function loadClients() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("tenants")
    .select("id, shop_name, phone, subscriptions(agreed_price, billing_cycle)")
    .order("shop_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((client) => ({
    id: client.id,
    shopName: client.shop_name,
    phone: client.phone,
    subscription: Array.isArray(client.subscriptions) ? client.subscriptions[0] : client.subscriptions,
  }));
}

export default async function AdminPaymentsPage() {
  await requirePlatformAdmin();
  const [payments, clients] = await Promise.all([loadPayments(), loadClients()]);

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <p className="eyebrow">Payments</p>
        <h1 className="heading mt-3">Renewal ledger</h1>

        <form action={recordPayment} className="panel rim mt-8 rounded-[22px] p-6">
          <h2 className="text-xl font-bold text-mist-50">Record renewal</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label htmlFor="tenant_id" className="label">Client</label>
              <select id="tenant_id" name="tenant_id" className="field" required defaultValue="">
                <option value="" disabled>Select a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.shopName} · {client.phone}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="amount" className="label">Amount</label>
              <input id="amount" name="amount" type="number" min="1" step="0.01" className="field" required />
            </div>
            <div>
              <label htmlFor="method" className="label">Method</label>
              <select id="method" name="method" className="field" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="easypaisa">Easypaisa</option>
                <option value="jazzcash">JazzCash</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="reference" className="label">Reference</label>
              <input id="reference" name="reference" className="field" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label htmlFor="notes" className="label">Notes</label>
              <input id="notes" name="notes" className="field" />
            </div>
            <div className="flex items-end">
              <button type="submit" className="btn btn-primary w-full">Record payment</button>
            </div>
          </div>
        </form>

        <div className="panel rim mt-5 overflow-hidden rounded-[22px]">
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
