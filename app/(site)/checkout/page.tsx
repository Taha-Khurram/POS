import type { Metadata } from "next";
import { connection } from "next/server";

import { CheckoutForm, type CheckoutPlan } from "@/app/(site)/checkout/checkout-form";
import { PayAccounts } from "@/components/site/pay-accounts";
import { listPublicPaymentAccounts } from "@/lib/platform/console";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Get started",
  description: "Choose a Flo plan, pay by bank transfer, Easypaisa or JazzCash, and get your shop's login on WhatsApp.",
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
async function loadPlans(): Promise<CheckoutPlan[]> {
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, list_price, pitch, features")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((plan) => {
    const ceiling = (plan.features as Record<string, unknown> | null)?.max_registers;
    return {
      code: String(plan.code),
      name: String(plan.name),
      listPrice: Number(plan.list_price),
      pitch: plan.pitch ? String(plan.pitch) : null,
      counters: typeof ceiling === "number" ? ceiling : null,
    };
  });
}

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  // The accounts after `loadPlans`, whose `connection()` is what keeps both
  // reads out of the build.
  const plans = await loadPlans();
  const [accounts, params] = await Promise.all([listPublicPaymentAccounts(), searchParams]);
  const error = typeof params?.error === "string" ? params.error : null;
  // /pricing's "Get started" names the card it was pressed on.
  const chosen = plans.find((plan) => plan.code === params?.plan) ?? plans[0];

  return (
    <section className="section">
      <div className="shell max-w-3xl">
        <p className="eyebrow">Get started</p>
        <h1 className="heading mt-3">Order Flo for your shop</h1>
        <p className="lede mt-4 max-w-2xl">One page: your shop, your plan, and where to send the money. Your login arrives on WhatsApp once the transfer is checked.</p>

        <CheckoutForm
          plans={plans}
          chosen={chosen?.code ?? ""}
          error={error}
          accounts={<PayAccounts accounts={accounts} />}
        />
      </div>
    </section>
  );
}
