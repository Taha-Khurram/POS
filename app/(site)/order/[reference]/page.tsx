import type { Metadata } from "next";
import { connection } from "next/server";

import { uploadPaymentProof } from "@/app/(site)/order/[reference]/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { rupees } from "@/lib/format";
import { isWallet, methodLabel, writeIban, writeWallet } from "@/lib/platform/admin";
import { listPublicPaymentAccounts, type PaymentAccount } from "@/lib/platform/console";
import { createAdminClient } from "@/utils/supabase/admin";

/** Site-styled, for the copy buttons beside every number a buyer has to type. */
const COPY = "btn btn-ghost btn-sm flex-none gap-1.5 !px-3 !py-1.5 text-[0.8125rem]";

/** One of the two figures a transfer is matched on, with a copy button. */
function PayFact({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-iris-200 bg-iris-200/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[0.75rem] font-semibold tracking-wide text-iris-600 uppercase">{label}</p>
        <p className="mt-0.5 truncate font-display text-[1.125rem] font-bold text-mist-50">{value}</p>
      </div>
      <CopyButton value={copy} className={COPY} />
    </div>
  );
}

/** A labelled line inside an account card; `copy` puts a button beside it. */
function AccountLine({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-700 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[0.75rem] text-mist-400">{label}</dt>
        <dd className={`mt-0.5 break-all text-[0.9375rem] text-mist-50 ${copy ? "font-mono tracking-wide" : "font-medium"}`}>{value}</dd>
      </div>
      {copy ? <CopyButton value={copy} className={COPY} /> : null}
    </div>
  );
}

/**
 * One account, the way a banking app asks for it. Numbers are printed spaced
 * for reading and copied bare, because an app that refuses a pasted IBAN over
 * a space is a buyer who types it in by hand instead.
 */
function AccountCard({ account }: { account: PaymentAccount }) {
  const wallet = isWallet(account.method);

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-950 p-4 sm:p-5">
      <p className="text-[0.75rem] font-semibold tracking-wide text-iris-600 uppercase">
        {wallet ? methodLabel(account.method) : account.bankName}
      </p>
      <dl className="mt-3">
        <AccountLine label="Account title" value={account.accountTitle} />
        {wallet ? (
          <AccountLine label={`${methodLabel(account.method)} number`} value={writeWallet(account.accountNumber)} copy={account.accountNumber} />
        ) : (
          <>
            <AccountLine label="Account number" value={account.accountNumber} copy={account.accountNumber} />
            {account.iban ? <AccountLine label="IBAN" value={writeIban(account.iban)} copy={account.iban} /> : null}
          </>
        )}
      </dl>
    </div>
  );
}

export const metadata: Metadata = {
  title: "Payment order",
  description: "Submit payment proof for your Flo activation order.",
};

/** Per request, never at build time — see the note in `checkout/page.tsx`. */
async function loadOrder(reference: string) {
  await connection();

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
  const [order, accounts] = await Promise.all([loadOrder(reference), listPublicPaymentAccounts()]);
  const query = await searchParams;
  const error = typeof query?.error === "string" ? query.error : null;
  const success = typeof query?.success === "string" ? query.success : null;

  if (!order) {
    return <section className="section"><div className="shell max-w-2xl"><h1 className="heading">Order not found</h1><p className="lede mt-4">Check the FLO reference from your confirmation message.</p></div></section>;
  }

  const amount = rupees(Number(order.quoted_price));

  return (
    <section className="section">
      <div className="shell max-w-2xl">
        <p className="eyebrow">Order {order.reference}</p>
        <h1 className="heading mt-3">Finish your Flo activation</h1>
        <div className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
          {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}
          {success ? <p className="mb-5 rounded-2xl border border-mint-400/30 bg-mint-400/10 px-4 py-3 text-[0.8125rem] text-mist-50">{success}</p> : null}
          <dl className="grid gap-3 text-[0.875rem] sm:grid-cols-2">
            <div><dt className="text-mist-400">Shop</dt><dd className="mt-1 text-mist-50">{order.shop_name}</dd></div>
            <div><dt className="text-mist-400">Status</dt><dd className="mt-1 text-mist-50">{order.status}</dd></div>
            <div><dt className="text-mist-400">Amount</dt><dd className="mt-1 text-mist-50">{amount}</dd></div>
            <div><dt className="text-mist-400">Billing</dt><dd className="mt-1 text-mist-50">{order.billing_cycle}</dd></div>
          </dl>
          <div className="mt-7 border-t border-ink-700 pt-6">
            <h2 className="text-xl font-bold text-mist-50">Pay by bank or wallet</h2>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-mist-300">
              {accounts.length > 0
                ? "Send the exact amount to any one of the accounts below, with your order number in the transfer's reference or note. Then upload the screenshot below."
                : `Send the exact amount, and include ${order.reference} in the transfer reference. Then upload the screenshot below.`}
            </p>

            {/* The two things a transfer is matched on, above the accounts and
                copyable, because an amount a rupee off or a reference left
                blank is a payment nobody can find on the statement. */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <PayFact label="Send exactly" value={amount} copy={String(Number(order.quoted_price))} />
              <PayFact label="Reference" value={order.reference} copy={order.reference} />
            </div>

            {accounts.length > 0 ? (
              <div className="mt-5 space-y-3">
                {accounts.map((account) => (
                  <AccountCard key={account.id} account={account} />
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-2xl border border-ink-700 bg-ink-900 p-4 text-[0.875rem] text-mist-200">
                Bank details will be confirmed by Flo support on WhatsApp before you transfer.
              </p>
            )}
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
