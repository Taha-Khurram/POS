import type { Metadata } from "next";
import Link from "next/link";

import { IconRegister, IconSettings } from "@/components/pos/icons";
import { requireSession } from "@/lib/auth";
import { perCycle, rupees } from "@/lib/format";
import { getEntitlements } from "@/lib/entitlements";
import { SAMPLE_ITEMS } from "@/lib/pos/catalog";
import { getCounter, getShopProfile, getShopSettings } from "@/lib/pos/shop";
import { Till } from "./till";

export const metadata: Metadata = {
  title: "Register",
  description: "Billing, stock, and khata for your counter.",
};

/**
 * The counter.
 *
 * A server component that reads the three rows the till needs — the counter
 * switch, the shop that prints at the top of the receipt, and the currency and
 * clock the receipt is written in — and hands them to one client component.
 * Nothing about the bill is worked out here; the arithmetic is in
 * `lib/pos/counter.ts` so that it holds on a tablet with no signal.
 *
 * The item list is still `SAMPLE_ITEMS`, the same rows Products & stock shows,
 * so the register and the catalog cannot disagree about what is on the shelf.
 * When `items` has real rows this becomes a query and nothing else moves.
 */
export default async function RegisterPage() {
  const session = await requireSession();

  if (!session.tenantId) return <NotAttached />;

  const [counter, shop, settings] = await Promise.all([
    getCounter(session.tenantId),
    getShopProfile(session.tenantId),
    getShopSettings(session.tenantId),
  ]);

  // No shop row, or the counter is switched off in Settings. Either way there
  // is nothing to bill against — a receipt with no shop name at the top is not
  // a receipt, and a counter nobody opened was not meant to sell.
  if (!shop || !counter.isActive) {
    return <CounterShut hasShop={Boolean(shop)} tenantId={session.tenantId} />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">
            Register
          </h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {counter.name} · {shop.shopName}
          </p>
        </div>

        <Link
          href="/app/settings?tab=counter"
          className="pos-btn pos-btn-soft pos-btn-sm"
        >
          <IconSettings className="h-4 w-4" />
          Counter settings
        </Link>
      </header>

      <Till
        items={SAMPLE_ITEMS}
        counter={counter}
        shop={shop}
        settings={settings}
      />
    </div>
  );
}

/**
 * Signed in, attached to a shop, and the counter is shut.
 *
 * It names the switch and links straight to it rather than saying the register
 * is unavailable — the owner is one tap from the thing that fixes this, and
 * "contact support" for a checkbox is how a Saturday gets wasted.
 */
async function CounterShut({
  hasShop,
  tenantId,
}: {
  hasShop: boolean;
  tenantId: string;
}) {
  const entitlements = hasShop ? await getEntitlements(tenantId) : null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="pos-card p-6">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
          <IconRegister className="h-5 w-5" />
        </span>

        <h1 className="mt-4 font-display text-[1.375rem] font-bold">
          The counter is shut
        </h1>

        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-graphite-700">
          {hasShop ? (
            <>
              Shukriya — your account is live. Open the counter in Settings and
              this screen becomes the till: scan or search an item, it goes on
              the bill, and the total prints on an 80 mm roll.
            </>
          ) : (
            <>
              This login is attached to a shop we cannot read. Run{" "}
              <code>npm run doctor</code> — it is almost always the Customize
              Access Token hook switched off in the Supabase project.
            </>
          )}
        </p>

        {hasShop ? (
          <Link
            href="/app/settings?tab=counter"
            className="pos-btn pos-btn-primary mt-5"
          >
            <IconSettings className="h-4 w-4" />
            Open the counter
          </Link>
        ) : null}

        {entitlements ? (
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-orchid-100 pt-5 text-[0.875rem]">
            <dt className="text-graphite-500">Plan</dt>
            <dd className="text-right font-medium">{entitlements.planName}</dd>

            <dt className="text-graphite-500">You pay</dt>
            <dd className="text-right font-medium">
              {rupees(entitlements.agreedPrice)} /{" "}
              {perCycle(entitlements.billingCycle)}
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

/** Same words as Settings' gate, because it is the same problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <h1 className="font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop. Message us on
        the same WhatsApp number you arranged Flo on and we will attach it.
      </p>
    </div>
  );
}
