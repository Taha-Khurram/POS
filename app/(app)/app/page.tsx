import type { Metadata } from "next";
import { getEntitlements } from "@/lib/entitlements";
import { perCycle, rupees } from "@/lib/format";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Register",
  description: "Billing, stock, and khata for your counter.",
};

export default async function RegisterPage() {
  const session = await requireSession("/app");

  // A user with no tenant is inert by design — RLS shows it nothing at all, so
  // say why rather than rendering an empty counter.
  if (!session.tenantId) {
    return (
      <div className="pos-card mx-auto max-w-lg p-6">
        <h1 className="text-[1.375rem] font-bold">Account not attached yet</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
          You are signed in, but this login is not linked to a shop. That
          normally means the activation is still with us. Message us on the same
          WhatsApp number you arranged Flo on and we will attach it — usually
          within a few minutes.
        </p>
      </div>
    );
  }

  const entitlements = await getEntitlements(session.tenantId);

  return (
    <div className="mx-auto max-w-lg">
      <div className="pos-card p-6">
        <h1 className="text-[1.375rem] font-bold">Counter is ready</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
          Shukriya — your account is live. Billing, stock, and udhaar khata land
          here as each module ships. Nothing to ring up yet.
        </p>

        {entitlements ? (
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-paper-200 pt-5 text-[0.875rem]">
            <dt className="text-graphite-500">Plan</dt>
            <dd className="text-right font-medium">{entitlements.planName}</dd>

            <dt className="text-graphite-500">You pay</dt>
            <dd className="text-right font-medium">
              {rupees(entitlements.agreedPrice)} / {perCycle(entitlements.billingCycle)}
            </dd>

            <dt className="text-graphite-500">Registers</dt>
            <dd className="text-right font-medium">{entitlements.maxRegisters}</dd>

            <dt className="text-graphite-500">Branches</dt>
            <dd className="text-right font-medium">{entitlements.maxBranches}</dd>

            <dt className="text-graphite-500">Renews in</dt>
            <dd className="text-right font-medium">
              {entitlements.daysUntilExpiry} days
            </dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
