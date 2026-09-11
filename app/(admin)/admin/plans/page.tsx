import type { Metadata } from "next";
import { cookies } from "next/headers";

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

export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const plans = await loadPlans();

  return (
    <section className="section">
      <div className="shell max-w-5xl">
        <p className="eyebrow">Plans</p>
        <h1 className="heading mt-3">Entitlements</h1>
        <p className="lede mt-3 max-w-2xl">
          Plan definitions are editable from the console, not from a deploy. This is
          the single source of truth for what a client can and cannot do.
        </p>

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
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
