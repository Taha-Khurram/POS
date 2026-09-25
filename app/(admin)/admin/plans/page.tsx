import type { Metadata } from "next";

import { requireSuperAdmin } from "@/lib/platform/access";
import { listClients, listPlans } from "@/lib/platform/console";

import { PlansPanel } from "./plans-panel";

export const metadata: Metadata = {
  title: "Plans",
  description: "What each tier costs and what it says it includes.",
};

/**
 * The plans, editable without a deploy — which is the whole reason `plans` is a
 * table and not a constant. "Premium now includes X" should be a form.
 *
 * What the screen refuses to pretend is that editing a flag changes the
 * software. `0020` is the standing rule here: a flag is a promise the console
 * can be held to, so it goes on in the migration that lands the feature, and
 * the editor marks the ones the product does not do yet.
 */
export default async function PlansPage() {
  await requireSuperAdmin();

  const [plans, clients] = await Promise.all([listPlans(), listClients()]);

  const counts = clients.reduce<Record<string, number>>((tally, client) => {
    if (!client.planId) return tally;
    tally[client.planId] = (tally[client.planId] ?? 0) + 1;
    return tally;
  }, {});

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Plans</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          What a shop is sold, and for how much. Changing a price here changes
          what new shops are quoted — every shop already on a plan keeps the
          price it agreed.
        </p>
      </header>

      <PlansPanel
        plans={plans}
        counts={counts}
        readOnly={false}
      />
    </div>
  );
}
