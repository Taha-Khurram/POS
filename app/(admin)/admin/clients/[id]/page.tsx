import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Client record",
  description: "One client, their subscription, health, and support notes.",
};

async function loadClient(id: string) {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("tenants")
    .select(
      `
        id,
        shop_name,
        owner_name,
        phone,
        email,
        city,
        shop_type,
        notes,
        created_at,
        subscriptions (
          id,
          status,
          billing_cycle,
          agreed_price,
          current_period_end,
          plan_id,
          plans ( code, name )
        ),
        branches ( id, name, city, is_primary )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const subscription = Array.isArray(data.subscriptions)
    ? data.subscriptions[0]
    : data.subscriptions;

  const normalizedSubscription = subscription
    ? {
        ...subscription,
        plans: Array.isArray(subscription.plans) ? subscription.plans[0] : subscription.plans,
      }
    : null;

  return {
    id: data.id,
    shopName: data.shop_name,
    ownerName: data.owner_name,
    phone: data.phone,
    email: data.email,
    city: data.city,
    shopType: data.shop_type,
    notes: data.notes,
    createdAt: data.created_at,
    subscription: normalizedSubscription,
    branches: Array.isArray(data.branches) ? data.branches : data.branches ? [data.branches] : [],
  };
}

export default async function ClientDetailPage({ params }: PageProps<"/admin/clients/[id]">) {
  await requirePlatformAdmin();
  const { id } = await params;
  const client = await loadClient(id);

  if (!client) {
    notFound();
  }

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Client record</p>
            <h1 className="heading mt-3">{client.shopName}</h1>
          </div>
          <Link href="/admin/clients" className="btn btn-ghost btn-sm">
            Back to clients
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <article className="panel rim rounded-[22px] p-6">
            <h2 className="text-xl font-bold text-mist-50">Profile</h2>
            <dl className="mt-5 space-y-3 text-[0.875rem]">
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Owner</dt><dd className="text-right text-mist-50">{client.ownerName}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Phone</dt><dd className="text-right text-mist-50">{client.phone}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Email</dt><dd className="text-right text-mist-50">{client.email ?? "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">City</dt><dd className="text-right text-mist-50">{client.city}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Shop type</dt><dd className="text-right text-mist-50">{client.shopType}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Activated</dt><dd className="text-right text-mist-50">{new Date(client.createdAt).toLocaleDateString("en-PK")}</dd></div>
            </dl>
          </article>

          <article className="panel rim rounded-[22px] p-6">
            <h2 className="text-xl font-bold text-mist-50">Subscription</h2>
            <dl className="mt-5 space-y-3 text-[0.875rem]">
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Status</dt><dd className="text-right text-mist-50">{client.subscription?.status ?? "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Billing</dt><dd className="text-right text-mist-50">{client.subscription?.billing_cycle ?? "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Agreed price</dt><dd className="text-right text-mist-50">Rs {Number(client.subscription?.agreed_price ?? 0).toLocaleString("en-PK")}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Period end</dt><dd className="text-right text-mist-50">{client.subscription?.current_period_end ? new Date(client.subscription.current_period_end).toLocaleDateString("en-PK") : "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-mist-400">Plan</dt><dd className="text-right text-mist-50">{client.subscription?.plans?.name ?? "—"}</dd></div>
            </dl>
          </article>
        </div>

        <article className="panel rim mt-5 rounded-[22px] p-6">
          <h2 className="text-xl font-bold text-mist-50">Branches</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {client.branches.length === 0 ? (
              <p className="text-mist-400">No branches recorded yet.</p>
            ) : (
              client.branches.map((branch) => (
                <div key={branch.id} className="rounded-2xl border border-white/8 bg-white/2 p-4 text-[0.875rem]">
                  <p className="font-medium text-mist-50">{branch.name}</p>
                  <p className="mt-2 text-mist-300">{branch.city ?? "City not set"}</p>
                  <p className="mt-1 text-mist-400">{branch.is_primary ? "Primary branch" : "Secondary branch"}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel rim mt-5 rounded-[22px] p-6">
          <h2 className="text-xl font-bold text-mist-50">Notes</h2>
          <p className="mt-4 text-[0.875rem] leading-relaxed text-mist-300">
            {client.notes || "No notes recorded yet."}
          </p>
        </article>
      </div>
    </section>
  );
}
