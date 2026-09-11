import type { Metadata } from "next";

import { createCheckoutOrder } from "@/app/(site)/checkout/actions";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Get started",
  description: "Choose a Flo plan and request activation for your shop.",
};

async function loadPlans() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, list_price, pitch")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const plans = await loadPlans();
  const params = await searchParams;
  const error = typeof params?.error === "string" ? params.error : null;

  return (
    <section className="section">
      <div className="shell max-w-3xl">
        <p className="eyebrow">Get started</p>
        <h1 className="heading mt-3">Set up your Flo order</h1>
        <p className="lede mt-4 max-w-2xl">Choose your plan, submit your shop details, then pay by bank transfer, Easypaisa, or JazzCash.</p>

        <form action={createCheckoutOrder} className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
          {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}
          <div className="grid gap-5 md:grid-cols-2">
            <div><label htmlFor="shop_name" className="label">Shop name</label><input id="shop_name" name="shop_name" className="field" required /></div>
            <div><label htmlFor="owner_name" className="label">Owner name</label><input id="owner_name" name="owner_name" className="field" required /></div>
            <div><label htmlFor="phone" className="label">Phone</label><input id="phone" name="phone" type="tel" className="field" required /></div>
            <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" className="field" /></div>
            <div><label htmlFor="city" className="label">City</label><input id="city" name="city" className="field" required /></div>
            <div><label htmlFor="shop_type" className="label">Shop type</label><select id="shop_type" name="shop_type" className="field" defaultValue="kiryana"><option value="kiryana">Kiryana</option><option value="restaurant">Restaurant</option><option value="bakery">Bakery</option><option value="retail">Retail</option><option value="other">Other</option></select></div>
            <div><label htmlFor="plan_code" className="label">Plan</label><select id="plan_code" name="plan_code" className="field" defaultValue={plans[0]?.code ?? "standard"}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · Rs {Number(plan.list_price).toLocaleString("en-PK")}</option>)}</select></div>
            <div><label htmlFor="billing_cycle" className="label">Billing cycle</label><select id="billing_cycle" name="billing_cycle" className="field" defaultValue="monthly"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div>
            <div><label htmlFor="branches" className="label">Branches</label><input id="branches" name="branches" type="number" min="1" className="field" defaultValue="1" /></div>
            <div><label htmlFor="registers" className="label">Registers</label><input id="registers" name="registers" type="number" min="1" className="field" defaultValue="1" /></div>
          </div>
          <button type="submit" className="btn btn-primary mt-7">Create payment order</button>
        </form>
      </div>
    </section>
  );
}
