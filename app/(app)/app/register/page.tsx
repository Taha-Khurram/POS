import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { COUNTER_COOKIE } from "@/components/pos/console-prefs";
import { IconRegister, IconSettings } from "@/components/pos/icons";
import { requireSession } from "@/lib/auth";
import { listSellableProducts } from "@/lib/pos/items";
import { getShopProfile, getShopSettings, listCounters } from "@/lib/pos/shop";
import { getAssignedCounterId } from "@/lib/pos/staff";
import { CounterPicker } from "./counter-picker";
import { Till } from "./till";

export const metadata: Metadata = {
  title: "Register",
  description: "Billing, stock, and khata for your counter.",
};

/**
 * The counter.
 *
 * A server component that reads what the till needs — the shop's open counters,
 * the shop that prints at the top of the receipt, and the currency and clock
 * the receipt is written in — and hands one counter's worth to a client
 * component. Nothing about the bill is worked out here; the arithmetic is in
 * `lib/pos/counter.ts` so that it holds on a tablet with a bad connection.
 *
 * Which counter, in order: the one the owner put this person on, then the one
 * this device was set to. The assignment wins because it is the more specific
 * statement — an owner who says "Bilal bills from counter 2" has said something
 * about Bilal, and the cookie only ever said something about a tablet. Without
 * an assignment the cookie resolves exactly as it always did, which is still
 * right for the shared tablet bolted to the counter by the door.
 *
 * The owner can never have an assignment, so their own behaviour is untouched:
 * the staff editor refuses their row, which is what makes `?pick=1` still mean
 * what it meant.
 *
 * Both are re-checked against the shop's own open counters on every load, so a
 * counter shut overnight sends the tablet back to the picker — or, for somebody
 * assigned to it, quietly back to the device's counter — rather than to a
 * register whose every sale would be refused.
 *
 * The item list is the shop's own `items`, minus the ones switched off — the
 * same rows Products & stock shows, so the register and the catalog cannot
 * disagree about what is on the shelf. The action that records the sale re-reads
 * them with the same filter, so a tab left open on an item since withdrawn
 * cannot sell it.
 */
export default async function RegisterPage({
  searchParams,
}: PageProps<"/app/register">) {
  const session = await requireSession();

  if (!session.tenantId) return <NotAttached />;

  const [counters, shop, settings, assigned, items, jar] = await Promise.all([
    listCounters(session.tenantId),
    getShopProfile(session.tenantId),
    getShopSettings(session.tenantId),
    getAssignedCounterId(session.userId),
    listSellableProducts(session.tenantId),
    cookies(),
  ]);

  // No shop row means the claim says there is one and RLS returned nothing —
  // in practice the access-token hook switched off. A receipt with no shop name
  // at the top is not a receipt either way.
  if (!shop) return <CounterShut hasShop={false} />;

  const open = counters.filter((counter) => counter.isActive);
  if (open.length === 0) return <CounterShut hasShop counters={counters.length} />;

  const remembered = jar.get(COUNTER_COOKIE)?.value ?? null;

  // The person first, then the device. `find` on the open list is what makes a
  // shut assignment fall through rather than strand somebody on a till that
  // cannot bill — the same re-check the cookie has always had.
  const mine = open.find((counter) => counter.id === assigned) ?? null;
  const chosen = mine ?? open.find((counter) => counter.id === remembered) ?? null;

  // Which till a device bills from is the owner's call, not the cashier's: a
  // cashier who could re-point the tablet mid-shift could drop a sale into
  // another counter's drawer and its receipt series. So `?pick=1` — the ask to
  // switch — is owner-only. A device that has not been set up yet still gets
  // the picker whoever unlocks it, or a new tablet could not bill at all.
  const maySwitch = session.tenantRole === "owner";

  // Without it, one open counter needs no question — a single-till shop should
  // never see this screen.
  const switching = maySwitch && (await searchParams).pick === "1";

  if (switching || !chosen) {
    if (switching || open.length > 1) {
      return <CounterPicker counters={open} current={chosen?.id ?? null} />;
    }
  }

  const counter = chosen ?? open[0];

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

        <div className="flex flex-wrap items-center gap-2">
          {maySwitch && open.length > 1 ? (
            <Link href="/app/register?pick=1" className="pos-btn pos-btn-soft pos-btn-sm">
              <IconRegister className="h-4 w-4" />
              Switch counter
            </Link>
          ) : null}
        </div>
      </header>

      <Till
        items={items}
        counter={counter}
        shop={shop}
        settings={settings}
      />
    </div>
  );
}

/**
 * Attached to a shop, and no counter is open.
 *
 * It names the switch and links straight to it rather than saying the register
 * is unavailable — the owner is one tap from the thing that fixes this, and
 * "contact support" for a checkbox is how a Saturday gets wasted.
 */
function CounterShut({
  hasShop,
  counters = 0,
}: {
  hasShop: boolean;
  /** How many exist but are shut, so the copy can tell "none yet" from
   *  "you have two and both are off". */
  counters?: number;
}) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="pos-card p-6">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
          <IconRegister className="h-5 w-5" />
        </span>

        <h1 className="mt-4 font-display text-[1.375rem] font-bold">
          {hasShop && counters > 0
            ? "Every counter is shut"
            : hasShop
              ? "No counter yet"
              : "We cannot read your shop"}
        </h1>

        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-graphite-700">
          {!hasShop ? (
            <>
              This login is attached to a shop we cannot read. Run{" "}
              <code>npm run doctor</code> — it is almost always the Customize
              Access Token hook switched off in the Supabase project.
            </>
          ) : counters > 0 ? (
            <>
              You have {counters} {counters === 1 ? "counter" : "counters"}, and
              none of them is open. Open one in Settings and this screen becomes
              the till.
            </>
          ) : (
            <>
              Shukriya — your account is live. Add a counter in Settings and
              this screen becomes the till: scan or search an item, it goes on
              the bill, and the total prints on an 80 mm roll.
            </>
          )}
        </p>

        {hasShop ? (
          <Link href="/app/settings?tab=counter" className="pos-btn pos-btn-primary mt-5">
            <IconSettings className="h-4 w-4" />
            {counters > 0 ? "Open a counter" : "Add a counter"}
          </Link>
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
