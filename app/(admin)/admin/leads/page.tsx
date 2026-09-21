import type { Metadata } from "next";

import { requirePlatform } from "@/lib/platform/access";
import { listLeads } from "@/lib/platform/console";

import { LeadsPanel } from "./leads-panel";

export const metadata: Metadata = {
  title: "Leads",
  description: "Everybody who asked for a demo, and where each one got to.",
};

export default async function LeadsPage() {
  await requirePlatform();
  const leads = await listLeads();

  const fresh = leads.filter((lead) => lead.status === "new").length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Leads</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {fresh > 0
            ? `${fresh} nobody has rung yet. The number is the whole lead — message them today.`
            : "Everybody has been contacted."}
        </p>
      </header>

      <LeadsPanel leads={leads} />
    </div>
  );
}
