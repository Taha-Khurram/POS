import type { Metadata } from "next";
import { connection } from "next/server";

import { createCheckoutOrder } from "@/app/(site)/checkout/actions";
import { SiteSelectField } from "@/components/site/select-field";
import { rupees } from "@/lib/format";
import { BILLING_CYCLES } from "@/lib/platform/admin";
import { SHOP_TYPES } from "@/lib/pos/settings-options";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Get started",
  description: "Choose a Flo plan and request activation for your shop.",
};

/**
 * The plans, read per request.
 *
 * `connection()` before the client is built, because `next build` renders this
 * page once to see whether it can be prerendered — and without this that
 * attempt reaches Supabase, so a deploy whose environment is missing
 * `SUPABASE_SERVICE_ROLE_KEY` fails the *build* rather than the page. A
 * marketing site must not need a live database to compile. Nothing but luck
 * was stopping it: `await searchParams` below bails out of a prerender too,
 * but it runs after this and nothing said it had to.
 */
async function loadPlans() {
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, list_price, pitch, features")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const plans = await loadPlans();
  const params = await searchParams;
  const error = typeof params?.error === "string" ? params.error : null;
  // /pricing's "Get started" names the card it was pressed on.
  const chosen = plans.find((plan) => plan.code === params?.plan) ?? plans[0];
  // The browser's hint only — the action refuses more than the chosen plan's
  // own ceiling, which this cannot know until the plan is picked.
  const mostCounters = Math.max(
    1,
    ...plans.map((plan) => {
      const ceiling = (plan.features as Record<string, unknown> | null)?.max_registers;
      return typeof ceiling === "number" ? ceiling : 1;
    }),
  );

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
            {/* Flo's own list, so the word an owner picks here is one the console
                can still show them on Settings. It has one entry today. */}
            <SiteSelectField
              name="shop_type"
              label="Shop type"
              defaultValue={SHOP_TYPES[0].id}
              options={SHOP_TYPES.map((type) => ({ id: type.id, label: type.label }))}
            />
            <SiteSelectField
              name="plan_code"
              label="Plan"
              defaultValue={chosen?.code ?? ""}
              placeholder="No plan on sale right now"
              options={plans.map((plan) => {
                const ceiling = (plan.features as Record<string, unknown> | null)?.max_registers;
                return {
                id: String(plan.code),
                label: String(plan.name),
                description: [
                  plan.pitch ? String(plan.pitch) : null,
                  typeof ceiling === "number" ? `Up to ${ceiling} ${ceiling === 1 ? "counter" : "counters"}.` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
                meta: `${rupees(Number(plan.list_price))}/mo`,
                };
              })}
            />
            <SiteSelectField
              name="billing_cycle"
              label="Billing cycle"
              defaultValue="monthly"
              options={BILLING_CYCLES.map((cycle) => ({
                id: cycle.id,
                label: cycle.label,
                description: cycle.description,
              }))}
            />
            {/* One shop. `branches` is still sent, because the order row and
                the price both take it — but Flo runs a single branch today and
                a field offering more is a promise the software cannot keep. */}
            <input type="hidden" name="branches" value="1" />
            <div><label htmlFor="registers" className="label">Counters</label><input id="registers" name="registers" type="number" min="1" max={mostCounters} className="field" defaultValue="1" /></div>
          </div>
          <button type="submit" className="btn btn-primary mt-7">Create payment order</button>
        </form>
      </div>
    </section>
  );
}
