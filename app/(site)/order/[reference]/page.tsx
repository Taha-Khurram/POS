import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { uploadPaymentProof } from "@/app/(site)/order/[reference]/actions";
import { WaitForVerification } from "@/app/(site)/order/[reference]/wait-for-verification";
import { PayAccounts, PayFact } from "@/components/site/pay-accounts";
import { rupees } from "@/lib/format";
import { listPublicPaymentAccounts } from "@/lib/platform/console";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Your order",
  description: "Where your Flo order stands, and where to send the payment screenshot.",
};

/**
 * What the buyer is told at each status — in their words, not the queue's.
 * `ORDER_STATUSES` in `lib/platform/admin.ts` is the operator's side of the
 * same five, and says what *they* have to do next.
 */
const STANDING: Record<string, { title: string; body: string; tone: "wait" | "good" | "bad" }> = {
  awaiting_payment: {
    title: "Waiting for your payment",
    body: "Send the exact amount to any one account below, then upload the screenshot here.",
    tone: "wait",
  },
  proof_submitted: {
    title: "Checking your payment",
    body: "We have your screenshot and are matching it against our statement. You do not need to send anything else — this page moves on by itself, and your login comes to you on WhatsApp.",
    tone: "wait",
  },
  verified: {
    title: "Payment confirmed",
    body: "Your shop's login comes to you on WhatsApp. Once you have it, sign in below.",
    tone: "good",
  },
  rejected: {
    title: "We could not confirm this payment",
    body: "Nothing was charged to your shop. Place a new order once the transfer is sorted.",
    tone: "bad",
  },
  expired: {
    title: "This order expired",
    body: "No payment arrived against it. Place a new order when you are ready.",
    tone: "bad",
  },
};

/**
 * Where a paid order is, drawn while it waits. The screenshot is in and cannot
 * be sent again (`attachProof` refuses it), so the page's only job is to say
 * nothing more is needed. A wrong screenshot is the operator's to raise: they
 * reject with a reason, and the buyer reads it here.
 */
const WAITING_STEPS = [
  { label: "Order placed", state: "done" },
  { label: "Screenshot received", state: "done" },
  { label: "Checking the transfer", state: "now" },
  { label: "Login sent on WhatsApp", state: "next" },
] as const;

const TONE = {
  wait: "border-iris-200 bg-iris-200/20",
  good: "border-mint-400/30 bg-mint-400/10",
  bad: "border-flare-400/30 bg-flare-400/10",
};

/** Per request, never at build time — see the note in `checkout/page.tsx`. */
async function loadOrder(reference: string) {
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("reference, shop_name, status, quoted_price, billing_cycle, rejection_reason")
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

  if (!order) {
    return <section className="section"><div className="shell max-w-2xl"><h1 className="heading">Order not found</h1><p className="lede mt-4">Check the FLO reference from your confirmation message.</p></div></section>;
  }

  const standing = STANDING[order.status] ?? STANDING.awaiting_payment;
  // Only a buyer who has not paid yet needs the accounts in front of them.
  const accounts = order.status === "awaiting_payment" ? await listPublicPaymentAccounts() : [];
  const amount = rupees(Number(order.quoted_price));

  return (
    <section className="section">
      <div className="shell max-w-2xl">
        <p className="eyebrow">Order {order.reference}</p>
        <h1 className="heading mt-3">{order.shop_name}</h1>
        <div className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
          {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}

          <div className={`rounded-2xl border px-5 py-4 ${TONE[standing.tone]}`}>
            <h2 className="text-lg font-bold text-mist-50">{standing.title}</h2>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-mist-200">{standing.body}</p>
            {order.status === "rejected" && order.rejection_reason ? (
              <p className="mt-3 text-[0.875rem] text-mist-50">
                <span className="text-mist-400">Why: </span>
                {order.rejection_reason}
              </p>
            ) : null}
          </div>

          <dl className="mt-6 grid gap-3 text-[0.875rem] sm:grid-cols-2">
            <div><dt className="text-mist-400">Amount</dt><dd className="mt-1 text-mist-50">{amount}</dd></div>
            <div><dt className="text-mist-400">Billing</dt><dd className="mt-1 capitalize text-mist-50">{order.billing_cycle}</dd></div>
          </dl>

          {order.status === "awaiting_payment" ? (
            <div className="mt-7 border-t border-ink-700 pt-6">
              {/* The two things a transfer is matched on, above the accounts
                  and copyable, because an amount a rupee off or a reference
                  left blank is a payment nobody can find on the statement. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <PayFact label="Send exactly" value={amount} copy={String(Number(order.quoted_price))} />
                <PayFact label="Transfer note" value={order.reference} copy={order.reference} />
              </div>
              <div className="mt-5">
                <PayAccounts accounts={accounts} />
              </div>
            </div>
          ) : null}

          {order.status === "proof_submitted" ? (
            <div className="mt-7 border-t border-ink-700 pt-6">
              <ol className="space-y-3">
                {WAITING_STEPS.map((step) => (
                  <li key={step.label} className="flex items-center gap-3 text-[0.9375rem]">
                    {step.state === "done" ? (
                      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-mint-400/20 text-[0.75rem] font-bold text-mint-400" aria-hidden>✓</span>
                    ) : step.state === "now" ? (
                      <span className="relative grid h-6 w-6 flex-none place-items-center" aria-hidden>
                        <span className="absolute inset-0 animate-ping rounded-full bg-iris-500/40" />
                        <span className="h-2.5 w-2.5 rounded-full bg-iris-500" />
                      </span>
                    ) : (
                      <span className="grid h-6 w-6 flex-none place-items-center" aria-hidden>
                        <span className="h-2.5 w-2.5 rounded-full border border-ink-600" />
                      </span>
                    )}
                    <span className={step.state === "next" ? "text-mist-400" : "text-mist-50"}>
                      {step.label}
                      {step.state === "now" ? <span className="sr-only"> (in progress)</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              <WaitForVerification />
            </div>
          ) : order.status === "awaiting_payment" ? (
            <form action={uploadPaymentProof} className="mt-7 border-t border-ink-700 pt-6">
              <input type="hidden" name="reference" value={order.reference} />
              <label htmlFor="proof" className="label">Payment screenshot or receipt</label>
              <input id="proof" name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="field file:mr-3 file:rounded-lg file:border-0 file:bg-iris-500 file:px-3 file:py-2 file:text-white" required />
              <button type="submit" className="btn btn-primary mt-5">Send screenshot</button>
            </form>
          ) : order.status === "verified" ? (
            <Link href="/login" className="btn btn-primary mt-7">Sign in</Link>
          ) : (
            <Link href="/checkout" className="btn btn-primary mt-7">Place a new order</Link>
          )}
        </div>
      </div>
    </section>
  );
}
