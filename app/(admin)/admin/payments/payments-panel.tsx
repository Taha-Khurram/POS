"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconSearch, IconTrash } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  PAYMENT_METHODS,
  dateInput,
  methodLabel,
  writeDay,
} from "@/lib/platform/admin";
import type { Client, Order, Payment } from "@/lib/platform/console";

import { deletePayment, recordPayment } from "./actions";
import { IDLE } from "../state";

/**
 * Every rupee taken, and the form for taking the next one.
 *
 * The form is at the top because that is what this screen is opened for: a
 * transfer has landed, you have the statement open, and you want it recorded
 * against the right shop before you forget which one it was.
 *
 * The picker holds two kinds of payer. A waiting **order** is somebody who
 * checked out and has no shop yet — money against it buys no time and is what
 * lets the order be accepted. A **client** on a plan has its renewal date moved
 * in the same transaction as the money, so the two cannot come apart; one not
 * yet activated has its payment held for the first period.
 */
export function PaymentsPanel({
  payments,
  clients,
  orders,
  readOnly,
}: {
  payments: Payment[];
  clients: Client[];
  /** Orders still waiting on money — the only ones a payment can land on. */
  orders: Order[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(recordPayment, IDLE);
  const [removal, removeAction] = useActionState(deletePayment, IDLE);
  // `order:<id>` or `tenant:<id>`. One listbox, because the operator is
  // looking for a name on a statement and does not care yet which kind it is.
  // Orders first: they are the money nobody has placed yet.
  const [payer, setPayer] = useState(
    orders[0] ? `order:${orders[0].id}` : clients[0] ? `tenant:${clients[0].tenantId}` : "",
  );
  const [query, setQuery] = useState("");

  useActionToast(state, {
    saved: state.saved?.label ?? "Payment recorded",
    failed: "That payment did not record",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Payment removed",
    failed: "That payment did not come off",
  });

  const [kind, payerId] = payer.split(":") as ["order" | "tenant", string];
  const order = kind === "order" ? orders.find((entry) => entry.id === payerId) : undefined;
  const chosen = kind === "tenant" ? clients.find((client) => client.tenantId === payerId) : undefined;
  // Time can only be bought by a shop with a period to extend.
  const buysTime = Boolean(chosen?.status);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return payments;

    return payments.filter(
      (payment) =>
        payment.shopName.toLowerCase().includes(needle) ||
        payment.reference.toLowerCase().includes(needle) ||
        payment.orderReference.toLowerCase().includes(needle) ||
        methodLabel(payment.method).toLowerCase().includes(needle),
    );
  }, [payments, query]);

  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);

  const columns: Column<Payment>[] = [
    {
      key: "shop",
      header: "Shop",
      cell: (payment) => (
        <span className="block min-w-0">
          {payment.tenantId ? (
            <Link
              href={`/admin/clients/${payment.tenantId}`}
              className="font-medium text-graphite-900 underline-offset-2 hover:underline"
            >
              {payment.shopName}
            </Link>
          ) : (
            <span className="font-medium text-graphite-900">{payment.shopName}</span>
          )}
          {payment.orderReference ? (
            <span className="block font-mono text-[0.6875rem] text-graphite-500">
              {payment.tenantId ? payment.orderReference : `${payment.orderReference} · not accepted yet`}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "when",
      header: "Taken",
      cell: (payment) => (
        <span className="text-graphite-700">{writeDay(payment.paidAt)}</span>
      ),
    },
    {
      key: "how",
      header: "How",
      hideBelow: "sm",
      cell: (payment) => (
        <span className="text-graphite-700">
          {methodLabel(payment.method)}
          {payment.reference ? (
            <span className="block font-mono text-[0.6875rem] text-graphite-500">
              {payment.reference}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "covers",
      header: "Bought",
      hideBelow: "md",
      cell: (payment) =>
        payment.coversTo ? (
          <span className="text-graphite-700">to {writeDay(payment.coversTo)}</span>
        ) : (
          <span className="text-graphite-500">no time</span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (payment) => rupees(payment.amount),
    },
    ...(readOnly
      ? []
      : [
          {
            key: "remove",
            header: "",
            align: "end" as const,
            cell: (payment: Payment) => (
              <form action={removeAction} className="inline">
                <input type="hidden" name="payment_id" value={payment.id} />
                <button type="submit" className="pos-icon-btn h-7 w-7" title="Remove">
                  <IconTrash className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove this payment</span>
                </button>
              </form>
            ),
          },
        ]),
  ];

  return (
    <div className="space-y-4">
      {readOnly ? null : (
        <form action={action}>
          <ChartCard
            title="Record a payment"
            caption={
              order
                ? `Order ${order.reference} · quoted ${rupees(order.quotedPrice)}${order.paid > 0 ? ` · ${rupees(order.paid)} recorded so far` : ""}. Buys no time — accept the order next.`
                : chosen && chosen.status
                  ? `${chosen.planName} · ${rupees(chosen.agreedPrice)} a ${chosen.billingCycle === "monthly" ? "month" : chosen.billingCycle === "quarterly" ? "quarter" : "year"} · paid to ${writeDay(chosen.currentPeriodEnd)}`
                  : chosen
                    ? "Not activated yet. This is held for their first period."
                    : "Pick the shop or order the money came from."
            }
            footer={
              <button type="submit" className="pos-btn pos-btn-primary" disabled={pending}>
                {pending ? "Recording…" : "Record it"}
              </button>
            }
          >
            <fieldset disabled={pending} className="space-y-4">
              {state.error ? <p className="pos-note pos-note-bad">{state.error}</p> : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <SelectRow
                    label="Who paid"
                    value={payer}
                    onChange={setPayer}
                    options={[
                      ...orders.map((entry) => ({
                        id: `order:${entry.id}`,
                        label: `${entry.shopName} — order ${entry.reference}`,
                        description: `${entry.city} · waiting to be accepted`,
                      })),
                      ...clients.map((client) => ({
                        id: `tenant:${client.tenantId}`,
                        label: client.shopName,
                        description: `${client.city} · ${client.status ? client.planName : "not activated"}`,
                      })),
                    ]}
                    placeholder="No shops or orders yet"
                  />
                </div>
                <input type="hidden" name="order_id" value={kind === "order" ? payerId : ""} />
                <input type="hidden" name="tenant_id" value={kind === "tenant" ? payerId : ""} />

                <label className="block">
                  <span className="pos-label">Amount</span>
                  <input
                    name="amount"
                    className="pos-field"
                    key={payer}
                    defaultValue={order?.quotedPrice ?? chosen?.agreedPrice ?? ""}
                    inputMode="decimal"
                  />
                </label>

                <label className="block">
                  <span className="pos-label">How it arrived</span>
                  <select name="method" className="pos-field" defaultValue="bank_transfer">
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>

                {buysTime ? (
                  <label className="block">
                    <span className="pos-label">Cycles bought</span>
                    <input
                      name="cycles"
                      className="pos-field"
                      defaultValue="1"
                      inputMode="numeric"
                    />
                    <span className="pos-hint">0 records it and moves nothing.</span>
                  </label>
                ) : (
                  // No period to extend yet. The field is not drawn rather than
                  // drawn dead, and the action ignores it for these payers.
                  <input type="hidden" name="cycles" value="0" />
                )}

                <label className="block">
                  <span className="pos-label">Date</span>
                  <input
                    type="date"
                    name="paid_on"
                    className="pos-field"
                    defaultValue={dateInput(new Date())}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="pos-label">Reference — optional</span>
                  <input
                    name="reference"
                    className="pos-field"
                    placeholder="Meezan TID, Easypaisa number"
                    autoComplete="off"
                  />
                </label>
              </div>
            </fieldset>
          </ChartCard>
        </form>
      )}

      <ChartCard
        title="Everything taken"
        caption={
          rows.length === payments.length
            ? `${rupees(total)} across ${payments.length} ${payments.length === 1 ? "payment" : "payments"}.`
            : `${rupees(total)} across ${rows.length} of ${payments.length} payments.`
        }
        actions={
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pos-field w-44 pl-9 sm:w-56"
              placeholder="Shop, reference, method"
              aria-label="Search the payments"
            />
          </div>
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(payment) => payment.id}
          empty={
            payments.length === 0
              ? "Nothing taken yet. The first order's payment lands here."
              : "No payment matches that."
          }
        />
      </ChartCard>
    </div>
  );
}
