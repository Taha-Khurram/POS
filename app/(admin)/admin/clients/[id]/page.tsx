import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { extendSubscription, regenerateInvite, revokeInvite, updateClientLifecycle, updateClientSubscription } from "@/app/(admin)/admin/actions";
import { canTakePayments, requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Client record",
  description: "One client, their subscription, health, and support notes.",
};

async function loadClient(id: string) {
  const supabase = createClient(await cookies());

  const [{ data, error }, { data: plans, error: plansError }] = await Promise.all([
    supabase
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
          max_branches,
          max_registers,
          feature_overrides,
          current_period_end,
          plan_id,
          plans ( code, name )
        ),
        branches ( id, name, city, is_primary )
      `,
    )
    .eq("id", id)
    .maybeSingle(),
    supabase.from("plans").select("code, name").eq("is_active", true).order("sort_order", { ascending: true }),
  ]);

  if (error || plansError || !data) {
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

  const [{ data: payments, error: paymentsError }, { data: invites, error: invitesError }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, amount, method, reference, paid_at, notes")
      .eq("tenant_id", id)
      .order("paid_at", { ascending: false }),
    supabase
      .from("invites")
      .select("id, email, phone, tenant_role, expires_at, used_at, revoked_at, created_at")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (paymentsError || invitesError) {
    return null;
  }

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
    payments: payments ?? [],
    invites: invites ?? [],
    plans: plans ?? [],
  };
}

export default async function ClientDetailPage({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  const session = await requirePlatformAdmin();
  const { id } = await params;
  const client = await loadClient(id);
  const query = await searchParams;

  if (!client) {
    notFound();
  }

  const message = typeof query?.error === "string" ? query.error : typeof query?.success === "string" ? query.success : null;
  const inviteUrl = typeof query?.invite === "string" ? query.invite : null;

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
        {message ? <p className="mb-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[0.8125rem] text-mist-200">{message}</p> : null}
        {inviteUrl ? <p className="mb-5 break-all rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-3 text-[0.8125rem] text-mist-100">New invite: {inviteUrl}</p> : null}

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
            {canTakePayments(session) && client.subscription ? (
              <div className="mt-6 border-t border-white/8 pt-5">
                <p className="label">Lifecycle</p>
                <form action={updateClientLifecycle} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="tenant_id" value={client.id} />
                  {(["active", "past_due", "suspended", "cancelled"] as const).map((status) => (
                    <button key={status} type="submit" name="status" value={status} className="btn btn-ghost btn-sm">
                      {status.replace("_", " ")}
                    </button>
                  ))}
                </form>
                <form action={extendSubscription} className="mt-4 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant_id" value={client.id} />
                  <div>
                    <label htmlFor="extension-days" className="label">Extend days</label>
                    <input id="extension-days" name="days" type="number" min="1" max="365" defaultValue="7" className="field w-32" />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm">Extend period</button>
                </form>
              </div>
            ) : null}
            {session.platformRole === "super_admin" && client.subscription ? (
              <details className="mt-6 border-t border-white/8 pt-5">
                <summary className="cursor-pointer text-[0.8125rem] font-medium text-mist-200">Edit entitlements</summary>
                <form action={updateClientSubscription} className="mt-5 grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="tenant_id" value={client.id} />
                  <div><label htmlFor="plan_code" className="label">Plan</label><select id="plan_code" name="plan_code" className="field" defaultValue={client.subscription.plans?.code ?? ""}>{client.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></div>
                  <div><label htmlFor="agreed_price" className="label">Agreed price</label><input id="agreed_price" name="agreed_price" type="number" min="0" step="0.01" className="field" defaultValue={client.subscription.agreed_price} /></div>
                  <div><label htmlFor="max_branches" className="label">Max branches</label><input id="max_branches" name="max_branches" type="number" min="1" className="field" defaultValue={client.subscription.max_branches} /></div>
                  <div><label htmlFor="max_registers" className="label">Max registers</label><input id="max_registers" name="max_registers" type="number" min="1" className="field" defaultValue={client.subscription.max_registers} /></div>
                  <div className="md:col-span-2"><label htmlFor="feature_overrides" className="label">Feature overrides JSON</label><textarea id="feature_overrides" name="feature_overrides" rows={4} className="field font-mono text-[0.75rem]" defaultValue={JSON.stringify(client.subscription.feature_overrides ?? {}, null, 2)} /></div>
                  <div><button type="submit" className="btn btn-primary btn-sm">Save entitlements</button></div>
                </form>
              </details>
            ) : null}
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

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <article className="panel rim rounded-[22px] p-6">
            <h2 className="text-xl font-bold text-mist-50">Payment history</h2>
            <div className="mt-4 space-y-3">
              {client.payments.length === 0 ? (
                <p className="text-[0.875rem] text-mist-400">No payments recorded yet.</p>
              ) : (
                client.payments.map((payment) => (
                  <div key={payment.id} className="flex items-start justify-between gap-4 border-b border-white/8 pb-3 text-[0.8125rem] last:border-b-0 last:pb-0">
                    <div>
                      <p className="font-medium text-mist-50">Rs {Number(payment.amount).toLocaleString("en-PK")}</p>
                      <p className="mt-1 text-mist-400">{payment.method} {payment.reference ? `· ${payment.reference}` : ""}</p>
                    </div>
                    <time className="text-mist-400" dateTime={payment.paid_at}>{new Date(payment.paid_at).toLocaleDateString("en-PK")}</time>
                  </div>
                ))
              )}
            </div>
            {session.platformRole === "super_admin" ? <div className="mt-5 flex flex-wrap gap-2 border-t border-white/8 pt-5"><form action={regenerateInvite}><input type="hidden" name="tenant_id" value={client.id} /><button type="submit" className="btn btn-ghost btn-sm">Regenerate invite</button></form><form action={revokeInvite}><input type="hidden" name="tenant_id" value={client.id} /><button type="submit" className="btn btn-ghost btn-sm">Revoke pending invite</button></form></div> : null}
          </article>

          <article className="panel rim rounded-[22px] p-6">
            <h2 className="text-xl font-bold text-mist-50">Invite status</h2>
            <div className="mt-4 space-y-3">
              {client.invites.length === 0 ? (
                <p className="text-[0.875rem] text-mist-400">No invite has been generated.</p>
              ) : (
                client.invites.map((invite) => {
                  const state = invite.used_at
                    ? "used"
                    : invite.revoked_at
                      ? "revoked"
                      : new Date(invite.expires_at) < new Date()
                        ? "expired"
                        : "pending";

                  return (
                    <div key={invite.id} className="border-b border-white/8 pb-3 text-[0.8125rem] last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-medium text-mist-50">{invite.tenant_role} invite</p>
                        <span className="text-mist-300">{state}</span>
                      </div>
                      <p className="mt-1 text-mist-400">{invite.email ?? invite.phone ?? "No contact recorded"}</p>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
