import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { activateClient } from "@/app/(admin)/admin/actions";
import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Activate client",
  description: "Create a tenant, branch, subscription, and invite in one action.",
};

async function loadPlans() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, list_price")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export default async function NewClientPage({
  searchParams,
}: PageProps<"/admin/clients/new">) {
  await requirePlatformAdmin();
  const plans = await loadPlans();
  const params = await searchParams;
  const error = typeof params?.error === "string" ? params.error : null;

  return (
    <section className="section">
      <div className="shell max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Activation</p>
            <h1 className="heading mt-3">Create a client</h1>
          </div>
          <Link href="/admin/clients" className="btn btn-ghost btn-sm">
            Back to clients
          </Link>
        </div>

        <form action={activateClient} className="panel rim rounded-[24px] p-6 sm:p-8">
          {error ? (
            <div className="mb-6 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">
              {error}
            </div>
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="shop_name" className="label">Shop name</label>
              <input id="shop_name" name="shop_name" className="field" required />
            </div>

            <div>
              <label htmlFor="owner_name" className="label">Owner name</label>
              <input id="owner_name" name="owner_name" className="field" required />
            </div>

            <div>
              <label htmlFor="phone" className="label">Phone</label>
              <input id="phone" name="phone" type="tel" className="field" required />
            </div>

            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" className="field" />
            </div>

            <div>
              <label htmlFor="city" className="label">City</label>
              <input id="city" name="city" className="field" required />
            </div>

            <div>
              <label htmlFor="shop_type" className="label">Shop type</label>
              <select id="shop_type" name="shop_type" className="field" required defaultValue="kiryana">
                <option value="kiryana">Kiryana</option>
                <option value="restaurant">Restaurant</option>
                <option value="bakery">Bakery</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="clothing">Clothing</option>
                <option value="retail">Retail</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="plan_code" className="label">Plan</label>
              <select id="plan_code" name="plan_code" className="field" defaultValue="standard">
                {plans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.name} · Rs {Number(plan.list_price).toLocaleString("en-PK")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="billing_cycle" className="label">Billing cycle</label>
              <select id="billing_cycle" name="billing_cycle" className="field" defaultValue="monthly">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <div>
              <label htmlFor="branches" className="label">Branches</label>
              <input id="branches" name="branches" type="number" className="field" min={1} defaultValue={1} required />
            </div>

            <div>
              <label htmlFor="registers" className="label">Registers</label>
              <input id="registers" name="registers" type="number" className="field" min={1} defaultValue={1} required />
            </div>

            <div>
              <label htmlFor="agreed_price" className="label">Agreed price</label>
              <input id="agreed_price" name="agreed_price" type="number" className="field" min={1} defaultValue={5000} required />
            </div>

            <div>
              <label htmlFor="trial_days" className="label">Trial days</label>
              <input id="trial_days" name="trial_days" type="number" className="field" min={0} defaultValue={0} required />
            </div>

            <div>
              <label htmlFor="start_date" className="label">Start date</label>
              <input id="start_date" name="start_date" type="date" className="field" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="notes" className="label">Notes</label>
              <textarea id="notes" name="notes" className="field min-h-24" placeholder="Haggled to Rs 8,500, restaurant, Lahore, has two printers." />
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end">
            <button type="submit" className="btn btn-primary">
              Activate client
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
