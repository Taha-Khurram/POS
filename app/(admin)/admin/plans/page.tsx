import type { Metadata } from "next";
import { cookies } from "next/headers";

import { updatePlan } from "@/app/(admin)/admin/actions";
import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Plans",
  description: "Plan definitions and entitlement flags for activated clients.",
};

async function loadPlans() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, pitch, list_price, features, is_active, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export default async function AdminPlansPage({ searchParams }: PageProps<"/admin/plans">) {
  const session = await requirePlatformAdmin();
  const plans = await loadPlans();
  const params = await searchParams;
  const error = typeof params?.error === "string" ? params.error : null;
  const success = typeof params?.success === "string" ? params.success : null;

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <p className="eyebrow">Plans</p>
        <h1 className="heading mt-3">Entitlements</h1>
        <p className="lede mt-3 max-w-2xl">
          Plan definitions are editable from the console, not from a deploy. This is
          the single source of truth for what a client can and cannot do.
        </p>
        {error ? <p className="mt-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}
        {success ? <p className="mt-5 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-3 text-[0.8125rem] text-mist-100">{success}</p> : null}

        <div className="mt-8 space-y-5">
          {plans.map((plan) => (
            <article key={plan.code} className="panel rim rounded-[22px] p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="eyebrow text-[0.6875rem]">{plan.code}</p>
                  <h2 className="mt-2 text-2xl font-bold text-mist-50">{plan.name}</h2>
                </div>
                <p className="text-lg font-medium text-iris-200">
                  Rs {Number(plan.list_price).toLocaleString("en-PK")}
                </p>
              </div>

              <p className="mt-4 text-[0.875rem] text-mist-400">{plan.pitch}</p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(plan.features ?? {}).map(([flag, value]) => (
                  <div key={flag} className="rounded-2xl border border-white/8 bg-white/2 p-3">
                    <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-mist-500">{flag}</p>
                    <p className="mt-2 text-[0.875rem] font-medium text-mist-50">
                      {value === true ? "Enabled" : value === false ? "Disabled" : String(value)}
                    </p>
                  </div>
                ))}
              </div>

              {session.platformRole === "super_admin" ? (
                <details className="mt-6 border-t border-white/8 pt-5">
                  <summary className="cursor-pointer text-[0.8125rem] font-medium text-mist-200">Edit plan</summary>
                  <form action={updatePlan} className="mt-5 grid gap-4 md:grid-cols-2">
                    <input type="hidden" name="code" value={plan.code} />
                    <div><label htmlFor={`${plan.code}-name`} className="label">Name</label><input id={`${plan.code}-name`} name="name" className="field" defaultValue={plan.name} required /></div>
                    <div><label htmlFor={`${plan.code}-price`} className="label">List price</label><input id={`${plan.code}-price`} name="list_price" type="number" min="0" step="0.01" className="field" defaultValue={plan.list_price} required /></div>
                    <div className="md:col-span-2"><label htmlFor={`${plan.code}-pitch`} className="label">Pitch</label><input id={`${plan.code}-pitch`} name="pitch" className="field" defaultValue={plan.pitch ?? ""} /></div>
                    <div className="md:col-span-2"><label htmlFor={`${plan.code}-features`} className="label">Features JSON</label><textarea id={`${plan.code}-features`} name="features" rows={6} className="field font-mono text-[0.75rem]" defaultValue={JSON.stringify(plan.features ?? {}, null, 2)} required /></div>
                    <div><label htmlFor={`${plan.code}-sort`} className="label">Sort order</label><input id={`${plan.code}-sort`} name="sort_order" type="number" className="field" defaultValue={plan.sort_order} required /></div>
                    <label className="flex items-center gap-3 self-end text-[0.8125rem] text-mist-300"><input type="checkbox" name="is_active" defaultChecked={plan.is_active} /> Active plan</label>
                    <div><button type="submit" className="btn btn-primary btn-sm">Save plan</button></div>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
