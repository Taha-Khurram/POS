import type { Metadata } from "next";

import { uploadPaymentProof } from "@/app/(site)/order/[reference]/actions";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Payment order",
  description: "Submit payment proof for your Flo activation order.",
};

async function loadOrder(reference: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("reference, shop_name, status, quoted_price, billing_cycle, branches, registers, proof_uploaded_at")
    .eq("reference", reference)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export default async function OrderPage({ params, searchParams }: PageProps<"/order/[reference]">) {
  const { reference } = await params;
  const order = await loadOrder(reference);
  const query = await searchParams;
  const error = typeof query?.error === "string" ? query.error : null;
  const success = typeof query?.success === "string" ? query.success : null;

  if (!order) {
    return <section className="section"><div className="shell max-w-2xl"><h1 className="heading">Order not found</h1><p className="lede mt-4">Check the FLO reference from your confirmation message.</p></div></section>;
  }

  return (
    <section className="section">
      <div className="shell max-w-2xl">
        <p className="eyebrow">Order {order.reference}</p>
        <h1 className="heading mt-3">Finish your Flo activation</h1>
        <div className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
          {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}
          {success ? <p className="mb-5 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-3 text-[0.8125rem] text-mist-100">{success}</p> : null}
          <dl className="grid gap-3 text-[0.875rem] sm:grid-cols-2">
            <div><dt className="text-mist-400">Shop</dt><dd className="mt-1 text-mist-50">{order.shop_name}</dd></div>
            <div><dt className="text-mist-400">Status</dt><dd className="mt-1 text-mist-50">{order.status}</dd></div>
            <div><dt className="text-mist-400">Amount</dt><dd className="mt-1 text-mist-50">Rs {Number(order.quoted_price).toLocaleString("en-PK")}</dd></div>
            <div><dt className="text-mist-400">Billing</dt><dd className="mt-1 text-mist-50">{order.billing_cycle}</dd></div>
          </dl>
          <div className="mt-7 border-t border-white/8 pt-6">
            <h2 className="text-xl font-bold text-mist-50">Pay by bank or wallet</h2>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-mist-300">Send the exact amount to your Flo payment account, and include {order.reference} in the transfer reference. Then upload the screenshot below.</p>
            <p className="mt-4 rounded-2xl border border-white/8 bg-white/2 p-4 text-[0.875rem] text-mist-200">Bank details will be confirmed by Flo support on WhatsApp before you transfer.</p>
          </div>
          <form action={uploadPaymentProof} className="mt-7">
            <input type="hidden" name="reference" value={order.reference} />
            <label htmlFor="proof" className="label">Payment screenshot or receipt</label>
            <input id="proof" name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="field file:mr-3 file:rounded-lg file:border-0 file:bg-iris-500 file:px-3 file:py-2 file:text-white" required />
            <button type="submit" className="btn btn-primary mt-5" disabled={order.status === "verified" || order.status === "rejected"}>Submit proof</button>
          </form>
        </div>
      </div>
    </section>
  );
}
