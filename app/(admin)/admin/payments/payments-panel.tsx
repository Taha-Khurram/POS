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
import type { Client, Payment } from "@/lib/platform/console";

import { deletePayment, recordPayment } from "./actions";
import { IDLE } from "../state";

/**
 * Every rupee taken, and the form for taking the next one.
 *
 * The form is at the top because that is what this screen is opened for: a
 * transfer has landed, you have the statement open, and you want it recorded
 * against the right shop before you forget which one it was. Recording it moves
 * that shop's renewal date in the same transaction — one write, so the money
 * and the days it bought cannot come apart.
 */
export function PaymentsPanel({
  payments,
  clients,
  readOnly,
}: {
  payments: Payment[];
  clients: Client[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(recordPayment, IDLE);
  const [removal, removeAction] = useActionState(deletePayment, IDLE);
  const [tenantId, setTenantId] = useState(clients[0]?.tenantId ?? "");
  const [query, setQuery] = useState("");

  useActionToast(state, {
    saved: state.saved?.label ?? "Payment recorded",
    failed: "That payment did not record",
  });
  useActionToast(removal, {
    saved: removal.saved?.label ?? "Payment removed",
    failed: "That payment did not come off",
  });

  const chosen = clients.find((client) => client.tenantId === tenantId);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return payments;

    return payments.filter(
      (payment) =>
        payment.shopName.toLowerCase().includes(needle) ||
        payment.reference.toLowerCase().includes(needle) ||
        methodLabel(payment.method).toLowerCase().includes(needle),
    );
  }, [payments, query]);

  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);

  const columns: Column<Payment>[] = [
    {
      key: "shop",
      header: "Shop",
      cell: (payment) => (
        <Link
          href={`/admin/clients/${payment.tenantId}`}
          className="font-medium text-graphite-900 underline-offset-2 hover:underline"
        >
          {payment.shopName}
        </Link>
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
              chosen
                ? `${chosen.planName} · ${rupees(chosen.agreedPrice)} a ${chosen.billingCycle === "monthly" ? "month" : chosen.billingCycle === "quarterly" ? "quarter" : "year"} · paid to ${writeDay(chosen.currentPeriodEnd)}`
                : "Pick the shop the money came from."
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
                    label="Which shop"
                    value={tenantId}
                    onChange={setTenantId}
                    options={clients.map((client) => ({
                      id: client.tenantId,
                      label: client.shopName,
                      description: `${client.city} · ${client.planName}`,
                    }))}
                    placeholder="No shops yet"
                  />
                </div>
                <input type="hidden" name="tenant_id" value={tenantId} />

                <label className="block">
                  <span className="pos-label">Amount</span>
                  <input
                    name="amount"
                    className="pos-field"
                    key={tenantId}
                    defaultValue={chosen?.agreedPrice ?? ""}
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
              ? "Nothing taken yet. The first renewal lands here."
              : "No payment matches that."
          }
        />
      </ChartCard>
    </div>
  );
}
