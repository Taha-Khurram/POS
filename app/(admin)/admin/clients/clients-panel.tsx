"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconSearch } from "@/components/pos/icons";
import { Select } from "@/components/pos/select-field";
import { rupees } from "@/lib/format";
import {
  renewalMessage,
  statusOf,
  waLink,
  writeExpiry,
  writeWhen,
} from "@/lib/platform/admin";
import type { Client } from "@/lib/platform/console";

/**
 * The table you live in.
 *
 * Client-side, like the item and customer lists and for the same reason: the
 * whole roster arrives in one call, and searching it in the browser is the
 * difference between a box that answers as you type and one that waits on shop
 * 3G. When this is thousands of shops the window will have to move into the
 * URL; a hundred filters in a frame.
 *
 * Search matches the shop, the owner, the city and the phone's digits, so
 * "0300 84" finds the number as it is written on a WhatsApp profile. The cuts
 * beside it are the questions actually asked of this screen — who is about to
 * run out, who never signed in, who has stopped selling — each carrying its own
 * count, so choosing one is not a guess.
 */

const digits = (value: string) => value.replace(/\D/g, "");

const FILTERS = [
  { id: "all", label: "Everyone", match: () => true },
  {
    id: "attention",
    label: "Needs a call",
    description: "Trading, and the period runs out inside a week",
    match: (client: Client) =>
      client.status !== null &&
      statusOf(client.status).operable &&
      client.daysUntilExpiry <= 7,
  },
  {
    id: "quiet",
    label: "Gone quiet",
    description: "Paying, no bill in thirty days",
    match: (client: Client) =>
      client.status !== null && statusOf(client.status).operable && client.bills30d === 0,
  },
  {
    id: "unsigned",
    label: "Never signed in",
    description: "Activated, nobody has made an account",
    match: (client: Client) => client.userCount === 0,
  },
  {
    id: "stopped",
    label: "Stopped",
    description: "Suspended or cancelled",
    match: (client: Client) =>
      client.status !== null && !statusOf(client.status).operable,
  },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const SORTS = [
  { id: "shop", label: "Shop name" },
  { id: "expiry", label: "Runs out soonest" },
  { id: "value", label: "Worth the most" },
  { id: "newest", label: "Newest first" },
  { id: "quiet", label: "Quietest first" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

export function ClientsPanel({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("expiry");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((entry) => [entry.id, clients.filter(entry.match).length]),
      ) as Record<FilterId, number>,
    [clients],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const bare = digits(needle);
    const test = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];

    const found = clients.filter((client) => {
      if (!test.match(client)) return false;
      if (!needle) return true;

      return (
        client.shopName.toLowerCase().includes(needle) ||
        client.ownerName.toLowerCase().includes(needle) ||
        client.city.toLowerCase().includes(needle) ||
        client.planName.toLowerCase().includes(needle) ||
        (bare.length > 2 && digits(client.phone).includes(bare))
      );
    });

    const sorted = [...found];

    switch (sort) {
      case "expiry":
        sorted.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
        break;
      case "value":
        sorted.sort((a, b) => b.monthlyValue - a.monthlyValue);
        break;
      case "newest":
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "quiet":
        sorted.sort((a, b) => (a.lastSaleAt ?? "").localeCompare(b.lastSaleAt ?? ""));
        break;
      default:
        sorted.sort((a, b) => a.shopName.localeCompare(b.shopName));
    }

    return sorted;
  }, [clients, query, filter, sort]);

  const columns: Column<Client>[] = [
    {
      key: "shop",
      header: "Shop",
      cell: (client) => (
        <Link href={`/admin/clients/${client.tenantId}`} className="block min-w-0">
          <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
            {client.shopName}
          </span>
          <span className="block truncate text-[0.6875rem] text-graphite-500">
            {client.ownerName} · {client.city}
          </span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      hideBelow: "md",
      cell: (client) => (
        <span className="text-graphite-700">
          {client.planName}
          <span className="block text-[0.6875rem] text-graphite-500">
            {client.billingCycle}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Standing",
      cell: (client) => {
        const status = statusOf(client.status ?? "active");
        return (
          <span className={`pos-badge pos-badge-${status.tone}`}>{status.label}</span>
        );
      },
    },
    {
      key: "period",
      header: "Period",
      hideBelow: "sm",
      cell: (client) => {
        const over = client.daysUntilExpiry < 0;
        const soon = client.daysUntilExpiry <= 7;
        return (
          <span
            className={
              over ? "text-signal-bad" : soon ? "text-signal-warn" : "text-graphite-700"
            }
          >
            {writeExpiry(client.daysUntilExpiry)}
          </span>
        );
      },
    },
    {
      key: "selling",
      header: "Last bill",
      hideBelow: "lg",
      cell: (client) => (
        <span className={client.lastSaleAt ? "text-graphite-700" : "text-signal-bad"}>
          {client.lastSaleAt ? writeWhen(client.lastSaleAt) : "Never"}
        </span>
      ),
    },
    {
      key: "value",
      header: "A month",
      align: "end",
      cell: (client) => rupees(client.monthlyValue),
    },
    {
      key: "nudge",
      header: "",
      align: "end",
      hideBelow: "sm",
      cell: (client) => (
        <a
          href={waLink(client.phone, renewalMessage(client.shopName, client.daysUntilExpiry))}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="pos-btn pos-btn-quiet pos-btn-sm"
        >
          WhatsApp
        </a>
      ),
    },
  ];

  const worth = rows.reduce((total, client) => total + client.monthlyValue, 0);

  return (
    <ChartCard
      title="Clients"
      // The caption describes the rows under it, every time they are not all of
      // them — the same bargain `/app/sales` strikes with its totals.
      caption={
        rows.length === clients.length
          ? `All ${clients.length} shops · ${rupees(worth)} a month`
          : `${rows.length} of ${clients.length} shops · ${rupees(worth)} a month`
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pos-field w-44 pl-9 sm:w-56"
              placeholder="Shop, owner, city, phone"
              aria-label="Search the clients"
            />
          </div>

          <Select
            value={filter}
            onChange={(next) => setFilter(next as FilterId)}
            label="Which shops"
            className="w-44"
            options={FILTERS.map((entry) => ({
              id: entry.id,
              label: entry.label,
              description: "description" in entry ? entry.description : undefined,
              meta: counts[entry.id],
            }))}
          />

          <Select
            value={sort}
            onChange={(next) => setSort(next as SortId)}
            label="Sort by"
            className="w-40"
            options={SORTS.map((entry) => ({ id: entry.id, label: entry.label }))}
          />
        </div>
      }
      bleed
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(client) => client.tenantId}
        empty={
          clients.length === 0
            ? "No shops yet. Press “Activate a shop” and the first one is sixty seconds away."
            : "No shop matches that. Try the shop name, the owner, or the last four digits of their number."
        }
      />
    </ChartCard>
  );
}
