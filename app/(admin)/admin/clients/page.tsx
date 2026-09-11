import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Clients",
  description: "Client records, plan entitlements, and activation status.",
};

async function loadClients() {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("tenants")
    .select(
      `
        id,
        shop_name,
        owner_name,
        phone,
        city,
        shop_type,
        status:subscriptions(status, agreed_price, billing_cycle, current_period_end),
        created_at
      `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const subscription = Array.isArray(row.status) ? row.status[0] : row.status;
    const status = subscription?.status ?? "trialing";
    const agreedPrice = Number(subscription?.agreed_price ?? 0);

    return {
      id: row.id,
      shopName: row.shop_name,
      ownerName: row.owner_name,
      phone: row.phone,
      city: row.city,
      shopType: row.shop_type,
      status,
      agreedPrice,
      periodEnd: subscription?.current_period_end ?? null,
      createdAt: row.created_at,
    };
  });
}

export default async function AdminClientsPage() {
  await requirePlatformAdmin();
  const clients = await loadClients();

  return (
    <section className="section">
      <div className="shell">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Clients</p>
            <h1 className="heading mt-3">Activated shops</h1>
          </div>

          <Link href="/admin/clients/new" className="btn btn-primary btn-sm">
            Activate client
          </Link>
        </div>

        <div className="panel rim mt-8 overflow-hidden rounded-[22px]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[0.8125rem]">
              <thead className="border-b border-white/8 bg-white/2 text-mist-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Shop</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">City</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-mist-400">
                      No live clients yet.
                    </td>
                  </tr>
                ) : (
                  clients.map((client) => (
                    <tr key={client.id} className="border-b border-white/6 last:border-b-0">
                      <td className="px-4 py-3">
                        <Link href={`/admin/clients/${client.id}`} className="font-medium text-mist-50 hover:text-iris-200">
                          {client.shopName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-mist-300">{client.ownerName}</td>
                      <td className="px-4 py-3 text-mist-300">{client.city}</td>
                      <td className="px-4 py-3 text-mist-300">{client.shopType}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full border border-iris-400/30 bg-iris-500/10 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-iris-200">
                          {client.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-mist-300">Rs {client.agreedPrice.toLocaleString("en-PK")}</td>
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
