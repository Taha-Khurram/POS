import type { Metadata } from "next";
import Link from "next/link";

import { IconPlus } from "@/components/pos/icons";
import { rupees } from "@/lib/format";
import { statusOf } from "@/lib/platform/admin";
import { requirePlatform } from "@/lib/platform/access";
import { listClients } from "@/lib/platform/console";

import { ClientsPanel } from "./clients-panel";

export const metadata: Metadata = {
  title: "Clients",
  description: "Every shop on Flo, what it pays, and whether it is selling.",
};

export default async function ClientsPage() {
  const session = await requirePlatform();
  const clients = await listClients();

  const trading = clients.filter(
    (client) => client.status !== null && statusOf(client.status).operable,
  );
  const mrr = trading
    .filter((client) => client.status !== "trialing")
    .reduce((total, client) => total + client.monthlyValue, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">Clients</h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {clients.length === 0
              ? "Nobody yet."
              : `${trading.length} trading · ${rupees(mrr)} a month`}
          </p>
        </div>

        {session.platformRole === "super_admin" ? (
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
