import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Clients",
  description: "Client records, plan entitlements, and activation status.",
};

async function loadClients(filters: { search: string; status: string; city: string }) {
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
  }).filter((client) => {
    const haystack = `${client.shopName} ${client.ownerName} ${client.phone}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase()))
      && (!filters.status || client.status === filters.status)
      && (!filters.city || client.city === filters.city);
  });
}

export default async function AdminClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const filters = {
    search: typeof params?.search === "string" ? params.search : "",
    status: typeof params?.status === "string" ? params.status : "",
    city: typeof params?.city === "string" ? params.city : "",
  };
  const clients = await loadClients(filters);
  const cities = [...new Set(clients.map((client) => client.city))].sort();

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

        <form method="get" className="panel mt-6 grid gap-3 rounded-[18px] p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <input name="search" className="field" placeholder="Search shop, owner, or phone" defaultValue={filters.search} />
          <select name="status" className="field" defaultValue={filters.status}><option value="">All statuses</option><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select>
          <select name="city" className="field" defaultValue={filters.city}><option value="">All cities</option>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select>
          <button type="submit" className="btn btn-ghost">Filter</button>
        </form>

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
