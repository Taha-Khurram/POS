import type { Metadata } from "next";
import Link from "next/link";

import { IconPlus } from "@/components/pos/icons";
import { rupees } from "@/lib/format";
import { standingOf } from "@/lib/platform/admin";
import { requireScreen } from "@/lib/platform/access";
import { listClients } from "@/lib/platform/console";

import { ClientsPanel } from "./clients-panel";

export const metadata: Metadata = {
  title: "Clients",
  description: "Every shop on Flo, what it pays, and whether it is selling.",
};

export default async function ClientsPage() {
  const session = await requireScreen("clients");
  const clients = await listClients();

  // Trading is everyone the till still charges for, trials included. MRR is
  // `active` and `past_due` only — the one definition `platform_overview()` and
  // the roster below both use. They are deliberately different sets, so the
  // line names each rather than printing two numbers that look like they
  // describe one.
  const trading = clients.filter((client) => standingOf(client.status).operable);
  const paying = trading.filter(
    (client) => client.status === "active" || client.status === "past_due",
  );
  const mrr = paying.reduce((total, client) => total + client.monthlyValue, 0);
  const onTrial = trading.length - paying.length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">Clients</h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {clients.length === 0
              ? "Nobody yet."
              : `${trading.length} trading${onTrial > 0 ? `, ${onTrial} on trial` : ""} · ${rupees(mrr)} a month from ${paying.length} paying`}
          </p>
        </div>

        {session.screens.includes("clients") ? (
          <Link href="/admin/clients/new" className="pos-btn pos-btn-primary">
            <IconPlus className="h-4 w-4" />
            Activate a shop
          </Link>
        ) : null}
      </header>

      <ClientsPanel clients={clients} />
    </div>
  );
}
