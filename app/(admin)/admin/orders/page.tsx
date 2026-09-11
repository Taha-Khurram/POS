import type { Metadata } from "next";
import { cookies } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Orders",
  description: "Self-serve checkout requests waiting for verification.",
};

async function loadOrders() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("orders")
    .select("id, reference, shop_name, owner_name, phone, city, status, quoted_price, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export default async function AdminOrdersPage() {
  await requirePlatformAdmin();
  const orders = await loadOrders();

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <p className="eyebrow">Orders</p>
        <h1 className="heading mt-3">Verification queue</h1>

        <div className="panel rim mt-8 overflow-hidden rounded-[22px]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[0.8125rem]">
              <thead className="border-b border-white/8 bg-white/2 text-mist-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Shop</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-mist-400">
                      No checkout orders in the queue.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b border-white/6 last:border-b-0">
                      <td className="px-4 py-3 font-medium text-mist-50">{order.reference}</td>
                      <td className="px-4 py-3 text-mist-300">{order.shop_name}</td>
                      <td className="px-4 py-3 text-mist-300">{order.owner_name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full border border-iris-400/30 bg-iris-500/10 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-iris-200">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-mist-300">Rs {Number(order.quoted_price).toLocaleString("en-PK")}</td>
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
