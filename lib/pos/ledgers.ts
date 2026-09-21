import "server-only";

import { cookies } from "next/headers";

import {
  balanceOf,
  runningBalance,
  STATEMENT_MAX,
  type LedgerEntry,
  type PaymentMethod,
  type SupplierBalance,
  type SupplierPayment,
} from "@/lib/pos/ledger";
import { createClient } from "@/utils/supabase/server";

/**
 * The supplier account, read as rows.
 *
 * Through the shop's own JWT, like every other reader in `lib/pos/`. The
 * balances come from `public.supplier_balances`, which is `security invoker` —
 * so `p_tenant` is a filter and RLS is the gate, exactly as it is for
 * `dashboard_summary` and `reports_summary`.
 *
 * Writes are `app/(app)/app/purchasing/payment-actions.ts` on the service role,
 * because `0029` revoked insert/update/delete on `supplier_payments` from
 * `authenticated` outright. That matters more here than on most tables: a row
 * written straight into it moves what the shop believes it owes.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the other
 * readers are.
 */

const money = (value: number | string | null) => Number(value ?? 0) || 0;

const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

type BalanceRow = {
  supplier_id: string;
  invoiced: number | string;
  paid: number | string;
  deliveries: number | string;
  payments: number | string;
  last_invoiced_on: string | null;
  last_paid_on: string | null;
};

/**
 * Every supplier's balance, by supplier id.
 *
 * One round trip for the whole list. The opening balance is *not* in the SQL —
 * it sits on the supplier row, and `balanceOf` in `lib/pos/ledger.ts` is the
 * one place the three parts are added up, so the list, the record and the tiles
 * cannot each arrive at a slightly different figure.
 */
export async function listSupplierBalances(
  tenantId: string,
  /** The opening balances off the already-read supplier rows, so this costs no
   *  second read of a table the caller is holding. */
  openings: { id: string; opening: number; openingOn: string | null }[],
): Promise<Map<string, SupplierBalance>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase.rpc("supplier_balances", { p_tenant: tenantId });

  const rows = (data ?? []) as BalanceRow[];
  const byId = new Map(openings.map((entry) => [entry.id, entry]));
  const balances = new Map<string, SupplierBalance>();

  for (const row of rows) {
    const open = byId.get(row.supplier_id);
    const opening = open?.opening ?? 0;
    const invoiced = money(row.invoiced);
    const paid = money(row.paid);

    balances.set(row.supplier_id, {
      supplierId: row.supplier_id,
      opening,
      openingOn: open?.openingOn ?? null,
      invoiced,
      paid,
      balance: balanceOf({ opening, invoiced, paid }),
      deliveries: Number(row.deliveries) || 0,
      payments: Number(row.payments) || 0,
      lastInvoicedOn: row.last_invoiced_on,
      lastPaidOn: row.last_paid_on,
    });
  }

  return balances;
}

/* ---------------- Payments ---------------- */

const PAYMENT_COLUMNS = `
  id, supplier_id, paid_on, amount, method, reference, note, created_at,
  supplier:suppliers(name)
`;

type PaymentRow = {
  id: string;
  supplier_id: string;
  paid_on: string;
  amount: number | string;
  method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
  supplier: { name: string } | { name: string }[] | null;
};

const toPayment = (row: PaymentRow): SupplierPayment => ({
  id: row.id,
  supplierId: row.supplier_id,
  supplierName: embedded(row.supplier)?.name ?? "",
  paidOn: row.paid_on,
  amount: money(row.amount),
  method: row.method as PaymentMethod,
  reference: row.reference ?? "",
  note: row.note ?? "",
  createdAt: row.created_at,
});

/**
 * Every payment, newest first, capped.
 *
 * The cap is the same bargain `/app/sales` strikes: one read, then the panel
 * filters in the browser. A shop settles with a handful of distributors a
 * month, so four hundred rows is years of payments — and when it does bite, the
 * screen says so rather than quietly showing a shorter list.
 */
export async function listSupplierPayments(
  tenantId: string,
  limit = 400,
): Promise<SupplierPayment[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("supplier_payments")
    .select(PAYMENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown as PaymentRow[]).map(toPayment);
}

/* ---------------- One supplier's account ---------------- */

export type SupplierStatement = {
  entries: LedgerEntry[];
  /** Every delivery, oldest first, for `ageOf` to walk. Amount only — the
   *  ageing does not care what was on it. */
  debits: { on: string; amount: number }[];
  paid: number;
  /** True when the statement hit `STATEMENT_MAX` and is therefore not the whole
   *  account. Said on the screen, never papered over. */
  capped: boolean;
};

/**
 * One supplier's account, oldest first, with the balance carried down.
 *
 * Two reads and a merge in TypeScript rather than a SQL union: it is one
 * supplier, bounded by `STATEMENT_MAX`, and the merge has to happen in the
 * language that owns the ordering rule anyway — deliveries before payments on
 * the same day, because that is the order they happen in.
 *
 * `debits` comes back beside the entries so the caller can age the account
 * without re-deriving which lines were deliveries. The ageing itself is
 * `ageOf`, in `lib/pos/ledger.ts`, and it is a walk rather than a table.
 */
export async function getSupplierStatement(
  tenantId: string,
  supplierId: string,
  opening: { amount: number; on: string | null },
): Promise<SupplierStatement> {
  const supabase = createClient(await cookies());

  const [receipts, payments] = await Promise.all([
    supabase
      .from("goods_receipts")
      .select("id, grn_number, received_on, total, supplier_invoice_no")
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplierId)
      .order("received_on", { ascending: false })
      .limit(STATEMENT_MAX),
    supabase
      .from("supplier_payments")
      .select("id, paid_on, amount, method, reference")
      .eq("tenant_id", tenantId)
      .eq("supplier_id", supplierId)
      .order("paid_on", { ascending: false })
      .limit(STATEMENT_MAX),
  ]);

  const receiptRows = receipts.data ?? [];
  const paymentRows = payments.data ?? [];

  const debits = receiptRows
    .map((row) => ({ on: row.received_on as string, amount: money(row.total) }))
    .sort((a, b) => a.on.localeCompare(b.on));

  const entries = runningBalance(opening.amount, opening.on, [
    ...receiptRows.map((row) => ({
      id: row.id as string,
      on: row.received_on as string,
      kind: "delivery" as const,
      ref: row.grn_number as string,
      detail: row.supplier_invoice_no
        ? `Their invoice ${row.supplier_invoice_no}`
        : "Delivery",
      amount: money(row.total),
    })),
    ...paymentRows.map((row) => ({
      id: row.id as string,
      on: row.paid_on as string,
      kind: "payment" as const,
      ref: (row.reference as string | null) ?? "",
      detail: "Paid",
      // Negative, because the statement is one signed running column — the same
      // call `stock_movements.quantity` makes.
      amount: -money(row.amount),
    })),
  ]);

  return {
    entries,
    debits,
    paid: paymentRows.reduce((total, row) => total + money(row.amount), 0),
    capped:
      receiptRows.length >= STATEMENT_MAX || paymentRows.length >= STATEMENT_MAX,
  };
}
