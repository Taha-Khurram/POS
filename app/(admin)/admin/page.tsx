import type { Metadata } from "next";
import { cookies } from "next/headers";

import { monthlyEquivalent, rupees } from "@/lib/format";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = {
  title: "Console",
  description: "Active clients, renewals, and the verification queue.",
};

type Tile = { label: string; value: string; note: string };

/**
 * Read with your own JWT, not the service role. Every figure here comes back
 * through the `is_platform_admin()` read policies, so this page is also a live
 * check that those policies still work.
 */
async function loadOverview() {
  const supabase = createClient(await cookies());
  const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const [clients, live, expiring, queue, leads] = await Promise.all([
    supabase.from("tenants").select("id", { count: "exact", head: true }),
    supabase
      .from("subscriptions")
      .select("status, billing_cycle, agreed_price")
      .in("status", ["trialing", "active", "past_due"]),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["trialing", "active"])
      .lte("current_period_end", in7Days),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["awaiting_payment", "proof_submitted"]),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
  ]);

  const rows = live.data ?? [];
  const mrr = rows.reduce(
    (total, row) =>
      total + monthlyEquivalent(Number(row.agreed_price), String(row.billing_cycle)),
    0,
  );

  return {
    clients: clients.count ?? 0,
    active: rows.length,
    trials: rows.filter((row) => row.status === "trialing").length,
    mrr,
    expiring: expiring.count ?? 0,
    queue: queue.count ?? 0,
    leads: leads.count ?? 0,
  };
}

export default async function AdminOverviewPage() {
  const overview = await loadOverview();

  const TILES: Tile[] = [
    {
      label: "Monthly recurring",
      value: rupees(overview.mrr),
      note: "At the prices actually agreed, not list",
    },
    {
      label: "Live clients",
      value: String(overview.active),
      note: `${overview.trials} on trial · ${overview.clients} total on file`,
    },
    {
      label: "Expiring in 7 days",
      value: String(overview.expiring),
      note: "Send the renewal nudge before it lapses",
    },
    {
      label: "Awaiting verification",
      value: String(overview.queue),
      note: "Match each against your bank statement",
    },
    {
      label: "New enquiries",
      value: String(overview.leads),
      note: "From the demo form",
    },
  ];

  return (
    <section className="section">
      <div className="shell">
        <p className="eyebrow">Console</p>
        <h1 className="heading mt-3">Today at a glance</h1>
        <p className="lede mt-3 max-w-xl">
          Every client on Flo, what they pay, and what needs you before the day
          is out.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((tile) => (
            <div key={tile.label} className="panel rim rounded-[20px] p-6">
              <p className="eyebrow text-[0.6875rem]">{tile.label}</p>
              <p className="mt-3 font-display text-[2rem] font-bold leading-none text-mist-50">
                {tile.value}
              </p>
              <p className="mt-3 text-[0.8125rem] text-mist-400">{tile.note}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[0.8125rem] text-mist-500">
          Client activation, the verification queue, plans, and the audit trail
          arrive in Part 1.
        </p>
      </div>
    </section>
  );
}
