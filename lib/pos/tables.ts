import "server-only";

import { cookies } from "next/headers";

import {
  lineTotalOf,
  orderTotal,
  unsentLines,
  type CourseId,
  type DiningTable,
  type OrderLine,
  type ServiceId,
  type TableOrder,
  type TableOrderSummary,
} from "@/lib/pos/restaurant";
import { createClient } from "@/utils/supabase/server";

/**
 * The floor, read as rows.
 *
 * Through the shop's own JWT like every other reader in `lib/pos/`, and — like
 * all of them — **not** wrapped in React `cache()`: the floor changes under
 * you, and a memoised read would hand a waiter the map as it stood before the
 * order they just sent.
 *
 * Writes are `app/(app)/app/tables/actions.ts` on the service role, because
 * `0033` revoked insert/update/delete on all six tables from `authenticated`
 * outright.
 *
 * **Whether a table is occupied is never read from a column**, because there is
 * none: it is whether an open order sits on it. A stored status is the second
 * copy that drifts the first time a settle fails halfway, and a floor map that
 * shows a table free while a party is eating at it is worse than no map.
 *
 * The staff roster is handed in rather than embedded, the same call
 * `listMovements` and `listHeldBills` make: `opened_by` points at `auth.users`
 * and not at `profiles`, so there is no foreign key for PostgREST to embed
 * through — and resolving the name here is what keeps the roster off the wire.
 * A waiter's tablet is handed "Bilal", never the list of everybody who could
 * have opened a table.
 */

/** Who somebody is, or the honest answer. `created_by` is `on delete set null`
 *  everywhere, so a table opened by somebody who has left keeps the table. */
const nameOf = (staff: { id: string; name: string }[], id: string | null) =>
  staff.find((person) => person.id === id)?.name ?? (id ? "Former staff" : "—");

const money = (value: number | string | null) => Number(value ?? 0) || 0;

const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

/* ---------------- The map ---------------- */

/**
 * Every table, with whatever is open on it.
 *
 * Three reads: the tables, the open orders, and those orders' lines. That is
 * one round trip each rather than one per table, which is the n+1 a floor map
 * would otherwise pay every time somebody glances at it — and a waiter glances
 * at it constantly.
 *
 * The totals are worked out here rather than in SQL because `lineTotalOf` is
 * the definition of what a line comes to, modifiers folded in, and it lives in
 * TypeScript. A second definition written as a SQL sum is the copy that drifts
 * from the figure the table watched being built.
 */
export async function listTables(
  tenantId: string,
  staff: { id: string; name: string }[],
): Promise<DiningTable[]> {
  const supabase = createClient(await cookies());

  const [{ data: tables }, { data: orders }] = await Promise.all([
    supabase
      .from("dining_tables")
      .select("id, name, area, seats, sort_order, is_active")
      .eq("tenant_id", tenantId)
      .order("area", { nullsFirst: true })
      .order("sort_order")
      .order("name"),
    supabase
      .from("table_orders")
      .select("id, table_id, order_number, service, covers, opened_at, opened_by")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
  ]);

  const openOrders = (orders ?? []) as unknown as {
    id: string;
    table_id: string | null;
    order_number: string;
    service: string;
    covers: number | null;
    opened_at: string;
    opened_by: string | null;
  }[];

  const lines = await linesFor(openOrders.map((order) => order.id));

  const byTable = new Map<string, TableOrderSummary>();

  for (const order of openOrders) {
    if (!order.table_id) continue;

    const own = lines.get(order.id) ?? [];

    byTable.set(order.table_id, {
      id: order.id,
      orderNumber: order.order_number,
      service: order.service as ServiceId,
      covers: order.covers,
      openedAt: order.opened_at,
      openedBy: nameOf(staff, order.opened_by),
      total: orderTotal(own),
      lines: own.filter((line) => line.status !== "void").length,
      unsent: unsentLines(own).length,
    });
  }

  return ((tables ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    area: row.area ?? "",
    seats: row.seats,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    order: byTable.get(row.id) ?? null,
  }));
}

type Row = {
  id: string;
  name: string;
  area: string | null;
  seats: number;
  sort_order: number;
  is_active: boolean;
};

/**
 * The floor as a list of rows, with nothing sitting on it.
 *
 * Settings lays the tables out; `/app/tables` works them. That screen needs the
 * open bills and pays three reads for them — this one is four text boxes per
 * row, so it pays one and hands every table a null order. Reusing `listTables`
 * here would run the order and line queries to render a form that cannot show
 * either of them.
 *
 * Switched-off tables are included, because this is the screen that switches
 * them back on.
 */
export async function listDiningTables(tenantId: string): Promise<DiningTable[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("dining_tables")
    .select("id, name, area, seats, sort_order, is_active")
    .eq("tenant_id", tenantId)
    .order("area", { nullsFirst: true })
    .order("sort_order")
    .order("name");

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    area: row.area ?? "",
    seats: row.seats,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    order: null,
  }));
}

/**
 * The parcels and deliveries, which sit on no table and would otherwise be
 * invisible on a map made of tables.
 */
export async function listCounterOrders(
  tenantId: string,
  staff: { id: string; name: string }[],
): Promise<TableOrderSummary[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("table_orders")
    .select("id, order_number, service, covers, opened_at, opened_by")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("table_id", null)
    .order("opened_at");

  const rows = (data ?? []) as unknown as {
    id: string;
    order_number: string;
    service: string;
    covers: number | null;
    opened_at: string;
    opened_by: string | null;
  }[];

  const lines = await linesFor(rows.map((row) => row.id));

  return rows.map((row) => {
    const own = lines.get(row.id) ?? [];

    return {
      id: row.id,
      orderNumber: row.order_number,
      service: row.service as ServiceId,
      covers: row.covers,
      openedAt: row.opened_at,
      openedBy: nameOf(staff, row.opened_by),
      total: orderTotal(own),
      lines: own.filter((line) => line.status !== "void").length,
      unsent: unsentLines(own).length,
    };
  });
}

/* ---------------- One order ---------------- */

const LINE_COLUMNS = `
  id, order_id, item_id, variant_id, name_snapshot, unit, quantity, unit_price,
  course, status, note, voided_reason,
  kot:kots(kot_number),
  modifiers:table_order_line_modifiers(id, modifier_id, name_snapshot, price_delta)
`;

type LineRow = {
  id: string;
  order_id: string;
  item_id: string | null;
  variant_id: string | null;
  name_snapshot: string;
  unit: string;
  quantity: number | string;
  unit_price: number | string;
  course: string;
  status: string;
  note: string | null;
  voided_reason: string | null;
  kot: { kot_number: string } | { kot_number: string }[] | null;
  modifiers:
    | { id: string; modifier_id: string | null; name_snapshot: string; price_delta: number | string }[]
    | null;
};

const toLine = (row: LineRow): OrderLine => ({
  id: row.id,
  itemId: row.item_id,
  variantId: row.variant_id,
  name: row.name_snapshot,
  unit: row.unit,
  quantity: money(row.quantity),
  unitPrice: money(row.unit_price),
  course: row.course as CourseId,
  status: row.status as OrderLine["status"],
  note: row.note ?? "",
  modifiers: (row.modifiers ?? []).map((mod) => ({
    id: mod.modifier_id,
    name: mod.name_snapshot,
    priceDelta: money(mod.price_delta),
  })),
  kotNumber: embedded(row.kot)?.kot_number ?? "",
  voidedReason: row.voided_reason ?? "",
});

/** Every line of several orders at once, by order id — one read rather than one
 *  per order, which is what keeps the map to three round trips. */
async function linesFor(orderIds: string[]): Promise<Map<string, OrderLine[]>> {
  if (orderIds.length === 0) return new Map();

  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("table_order_lines")
    .select(LINE_COLUMNS)
    .in("order_id", orderIds);

  const byOrder = new Map<string, OrderLine[]>();

  for (const row of (data ?? []) as unknown as LineRow[]) {
    const line = toLine(row);
    const list = byOrder.get(row.order_id);
    if (list) list.push(line);
    else byOrder.set(row.order_id, [line]);
  }

  return byOrder;
}

/** One order, everything on it, and every ticket it has sent. */
export async function getTableOrder(
  tenantId: string,
  orderId: string,
  staff: { id: string; name: string }[],
): Promise<TableOrder | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("table_orders")
    .select(
      `id, table_id, order_number, service, status, covers, customer_id, note,
       opened_at, opened_by,
       dining_table:dining_tables(name),
       customer:customers(name)`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as {
    id: string;
    table_id: string | null;
    order_number: string;
    service: string;
    status: string;
    covers: number | null;
    customer_id: string | null;
    note: string | null;
    opened_at: string;
    opened_by: string | null;
    dining_table: { name: string } | { name: string }[] | null;
    customer: { name: string } | { name: string }[] | null;
  };

  const [lines, { data: kots }] = await Promise.all([
    linesFor([orderId]),
    supabase
      .from("kots")
      .select("id, kot_number, sent_at")
      .eq("order_id", orderId)
      .order("sent_at"),
  ]);

  const own = lines.get(orderId) ?? [];

  return {
    id: row.id,
    orderNumber: row.order_number,
    tableId: row.table_id,
    tableName: embedded(row.dining_table)?.name ?? "",
    service: row.service as ServiceId,
    status: row.status as TableOrder["status"],
    covers: row.covers,
    customerId: row.customer_id,
    customerName: embedded(row.customer)?.name ?? "",
    note: row.note ?? "",
    openedAt: row.opened_at,
    openedBy: nameOf(staff, row.opened_by),
    lines: own,
    kots: (kots ?? []).map((kot) => ({
      id: kot.id as string,
      number: kot.kot_number as string,
      sentAt: kot.sent_at as string,
      lines: own.filter((line) => line.kotNumber === kot.kot_number).length,
    })),
  };
}

/* ---------------- Modifiers ---------------- */

/**
 * Every item's modifiers, by item id.
 *
 * One read for the whole menu rather than one per item — the order screen
 * offers them the instant a dish is tapped, and a round trip in the middle of
 * taking an order at a table is a round trip with four people watching.
 */
export async function modifiersByItem(
  tenantId: string,
): Promise<Map<string, { id: string; group: string; name: string; priceDelta: number }[]>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_modifiers")
    .select("id, item_id, group_name, name, price_delta")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");

  const byItem = new Map<
    string,
    { id: string; group: string; name: string; priceDelta: number }[]
  >();

  for (const row of data ?? []) {
    const itemId = row.item_id as string;
    const entry = {
      id: row.id as string,
      group: row.group_name as string,
      name: row.name as string,
      priceDelta: money(row.price_delta),
    };

    const list = byItem.get(itemId);
    if (list) list.push(entry);
    else byItem.set(itemId, [entry]);
  }

  return byItem;
}

/** What the floor is holding right now, for the tiles above the map. */
export function floorSummary(tables: DiningTable[], counter: TableOrderSummary[]) {
  const seated = tables.filter((table) => table.order);

  const open = [...seated.map((table) => table.order!), ...counter];

  return {
    tables: tables.filter((table) => table.isActive).length,
    occupied: seated.length,
    covers: open.reduce((sum, order) => sum + (order.covers ?? 0), 0),
    onFloor: Math.round(open.reduce((sum, order) => sum + order.total, 0) * 100) / 100,
    // Food nobody is cooking. The one figure on this screen that is a problem
    // rather than a fact.
    unsent: open.reduce((sum, order) => sum + order.unsent, 0),
  };
}

/** Exported for the order screen, which needs the same folding the map uses. */
export { lineTotalOf };
