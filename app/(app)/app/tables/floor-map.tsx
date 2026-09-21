"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconAlert, IconClose, IconPlus, IconSearch } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import { newSaleId } from "@/lib/pos/counter";
import type { Customer } from "@/lib/pos/customer";
import {
  checkOrderOpen,
  COVERS_MAX,
  matchesTable,
  SERVICES,
  service as serviceOf,
  sittingFor,
  type DiningTable,
  type ServiceId,
  type TableOrderSummary,
} from "@/lib/pos/restaurant";
import { openOrder } from "./actions";

/**
 * The floor, as a map.
 *
 * Grouped by area rather than listed, because a waiter reads this the way they
 * walk: the terrace is a place, not a filter. A flat list of twenty tables is
 * twenty rows somebody has to scan for "T7".
 *
 * **A table's state is never read from a column** — it is whether a bill is
 * open on it. What the card shows is therefore always what is true, and a
 * settle that failed halfway leaves a table looking occupied rather than
 * looking free, which is the safe way round.
 *
 * The three things on an occupied card are the three a floor actually asks:
 * how long they have been sitting, what the bill is at, and whether anything
 * is still waiting to go to the kitchen. The last is drawn as a warning because
 * it is the only one that is a problem.
 */
export function FloorMap({
  tables,
  counterOrders,
  customers,
  money,
}: {
  tables: DiningTable[];
  /** Parcels and deliveries, which sit on no table and would otherwise be
   *  invisible on a map made of tables. */
  counterOrders: TableOrderSummary[];
  customers: Customer[];
  money: (value: number) => string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [query, setQuery] = useState("");
  const [seating, setSeating] = useState<DiningTable | "counter" | null>(null);

  const live = useMemo(
    () => tables.filter((table) => table.isActive && matchesTable(table, query)),
    [tables, query],
  );

  // Grouped in the order the reader sorted them, so the areas come out in the
  // order the shop arranged them rather than alphabetically.
  const areas = useMemo(() => {
    const byArea = new Map<string, DiningTable[]>();

    for (const table of live) {
      const key = table.area || "The floor";
      const list = byArea.get(key);
      if (list) list.push(table);
      else byArea.set(key, [table]);
    }

    return [...byArea.entries()];
  }, [live]);

  const open = (table: DiningTable) => {
    if (table.order) {
      router.push(`/app/tables?order=${table.order.id}`);
      return;
    }
    setSeating(table);
  };

  return (
    <>
      <ChartCard
        title="The floor"
        caption={`${live.filter((table) => table.order).length} of ${live.length} in use`}
        actions={
          <button
            type="button"
            onClick={() => setSeating("counter")}
            className="pos-btn pos-btn-soft"
          >
            <IconPlus className="h-4 w-4" />
            Parcel
          </button>
        }
      >
        <div className="px-4 pb-3">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pr-9 pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Table, area, or bill number"
              aria-label="Find a table"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="pos-filter-tag-x absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Clear the search"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {areas.length === 0 ? (
          <p className="px-4 pb-6 text-center text-[0.8125rem] leading-relaxed text-graphite-500">
            {tables.length === 0
              ? "No tables yet. Add them under Settings → Tables — a name, which part of the shop they are in, and how many they seat."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          <div className="space-y-5 px-4 pb-4">
            {areas.map(([area, group]) => (
              <section key={area}>
                <h3 className="pos-label">{area}</h3>

                <ul className="mt-1.5 grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {group.map((table) => (
                    <li key={table.id}>
                      <TableCard table={table} money={money} onOpen={() => open(table)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ChartCard>

      {/* ---- Parcels and deliveries ----
          Their own list, because a map made of tables has nowhere to draw
          something that is not at one — and a shop doing twenty parcels an
          evening would otherwise be running them off paper. */}
      {counterOrders.length > 0 ? (
        <ChartCard
          title="At the counter"
          caption={`${counterOrders.length} parcel${counterOrders.length === 1 ? "" : "s"} and deliveries open`}
        >
          <ul className="grid gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            {counterOrders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/app/tables?order=${order.id}`)}
                  className="w-full rounded-2xl border border-orchid-200 p-3 text-left hover:border-orchid-700"
                >
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[0.8125rem] font-medium text-graphite-900">
                      {order.orderNumber}
                    </span>
                    <span className="pos-badge">{serviceOf(order.service).short}</span>
                  </p>
                  <p className="mt-1 text-[0.75rem] text-graphite-500">
                    {sittingFor(order.openedAt)} · {order.lines} line
                    {order.lines === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 font-display text-[1rem] font-bold tabular-nums text-graphite-900">
                    {money(order.total)}
                  </p>
                  {order.unsent > 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-signal-warn">
                      <IconAlert className="h-3 w-3" />
                      {order.unsent} not sent
                    </p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

      {seating ? (
        <SeatSheet
          table={seating === "counter" ? null : seating}
          customers={customers}
          busy={pending}
          onClose={() => setSeating(null)}
          onSeat={(input) =>
            start(async () => {
              const result = await openOrder(input);

              if (!result.ok) {
                toast({ title: "That table did not open", detail: result.error, tone: "bad" });
                return;
              }

              toast({ title: `${result.orderNumber} opened`, tone: "good" });
              setSeating(null);
              router.push(`/app/tables?order=${result.orderId}`);
            })
          }
        />
      ) : null}
    </>
  );
}

function TableCard({
  table,
  money,
  onOpen,
}: {
  table: DiningTable;
  money: (value: number) => string;
  onOpen: () => void;
}) {
  const busy = Boolean(table.order);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full w-full flex-col rounded-2xl border p-3 text-left transition ${
        busy
          ? "border-orchid-700 bg-orchid-50"
          : "border-orchid-100 hover:border-orchid-300"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-display text-[1rem] font-bold text-graphite-900">
          {table.name}
        </span>
        <span className="text-[0.6875rem] text-graphite-500">
          {table.order?.covers ?? table.seats} seat
          {(table.order?.covers ?? table.seats) === 1 ? "" : "s"}
        </span>
      </span>

      {busy ? (
        <>
          <span className="mt-1 block font-mono text-[0.6875rem] text-graphite-500">
            {table.order!.orderNumber} · {sittingFor(table.order!.openedAt)}
          </span>

          <span className="mt-auto block pt-2 font-display text-[1.125rem] font-bold tabular-nums text-orchid-800">
            {money(table.order!.total)}
          </span>

          {table.order!.unsent > 0 ? (
            <span className="mt-1 flex items-center gap-1 text-[0.6875rem] text-signal-warn">
              <IconAlert className="h-3 w-3" />
              {table.order!.unsent} not sent
            </span>
          ) : null}
        </>
      ) : (
        <span className="mt-auto block pt-2 text-[0.75rem] text-graphite-500">
          Free — tap to seat
        </span>
      )}
    </button>
  );
}

/** Seating a party, or starting a parcel. Two questions and a Go, because
 *  somebody is standing at a door while this is open. */
function SeatSheet({
  table,
  customers,
  busy,
  onClose,
  onSeat,
}: {
  /** Null for a parcel or delivery, which sits at no table. */
  table: DiningTable | null;
  customers: Customer[];
  busy: boolean;
  onClose: () => void;
  onSeat: (input: {
    orderId: string;
    tableId: string;
    service: ServiceId;
    covers: number | null;
    customerId: string | null;
  }) => void;
}) {
  const [serviceId, setServiceId] = useState<ServiceId>(table ? "dine_in" : "parcel");
  const [covers, setCovers] = useState(table ? String(table.seats) : "");
  const [customerId, setCustomerId] = useState("");

  const coverCount = covers.trim() ? Number(covers) : null;

  const complaint = checkOrderOpen({
    service: serviceId,
    tableId: table?.id ?? "",
    covers: coverCount,
  });

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" className="pos-sheet outline-none">
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] font-bold">
              {table ? `Seat ${table.name}` : "Start a parcel"}
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {table
                ? `${table.area || "The floor"} · seats ${table.seats}`
                : "Packed and handed over, or sent out."}
            </p>
          </div>

          <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
            <IconClose />
          </button>
        </header>

        <fieldset disabled={busy} className="space-y-4 px-4 py-5 sm:px-5">
          {table ? null : (
            <SelectRow
              label="How it is going out"
              value={serviceId}
              onChange={(next) => setServiceId(next as ServiceId)}
              options={SERVICES.filter((entry) => entry.id !== "dine_in").map(
                (entry) => ({
                  id: entry.id,
                  label: entry.label,
                  description: entry.note,
                }),
              )}
            />
          )}

          {table ? (
            <label className="block">
              <span className="pos-label">How many people</span>
              <input
                className="pos-field text-right tabular-nums"
                inputMode="numeric"
                value={covers}
                onChange={(event) => setCovers(event.target.value)}
                autoFocus
              />
              <p className="pos-hint">
                Covers and spend per cover are the two figures a restaurant runs
                on, and neither can be worked out afterwards from a bill.
              </p>
            </label>
          ) : null}

          {customers.length > 0 ? (
            <SelectRow
              label="Customer — optional"
              value={customerId}
              onChange={setCustomerId}
              placeholder="Nobody in particular"
              options={[
                { id: "", label: "Nobody in particular" },
                ...customers.map((one) => ({ id: one.id, label: one.name })),
              ]}
            />
          ) : null}
        </fieldset>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          {complaint ? (
            <p className="mr-auto text-[0.75rem] text-graphite-700">{complaint}</p>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-btn pos-btn-soft"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={busy || Boolean(complaint)}
            onClick={() =>
              onSeat({
                // Minted here so a retry on shop Wi-Fi replays rather than
                // opening a second bill for one party.
                orderId: newSaleId(),
                tableId: table?.id ?? "",
                service: table ? "dine_in" : serviceId,
                covers:
                  coverCount && coverCount > 0 && coverCount <= COVERS_MAX
                    ? coverCount
                    : null,
                customerId: customerId || null,
              })
            }
            className="pos-btn pos-btn-primary disabled:opacity-60"
          >
            {busy ? "Opening…" : table ? "Seat them" : "Start it"}
          </button>
        </footer>
      </div>
    </div>
  );
}
