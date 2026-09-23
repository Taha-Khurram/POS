"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ProofPreview } from "@/components/admin/proof-preview";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconClose } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import { orderStatusOf, waLink, writeWhen } from "@/lib/platform/admin";
import type { Order } from "@/lib/platform/console";

import { acceptOrder, rejectOrder } from "./actions";
import { IDLE } from "../state";

/**
 * The self-serve queue.
 *
 * An order is a claim of payment, not a payment. Open it beside your bank
 * statement and see the screenshot. If the money is there, record it in
 * Payments against this order, then accept it here, which makes the order a
 * client. If it is not, reject it with a reason the buyer reads on their own
 * order page. The plan is started from the client's record, not from here.
 *
 * Opening a row is a sheet rather than a navigation, the same call
 * `/app/sales` makes: a queue somebody is working through must survive looking
 * at one of its rows.
 */
export function OrdersPanel({
  orders,
  readOnly,
}: {
  orders: Order[];
  readOnly: boolean;
}) {
  const [open, setOpen] = useState<Order | null>(null);

  const waiting = orders.filter(
    (order) => order.status === "proof_submitted" || order.status === "awaiting_payment",
  );

  const columns: Column<Order>[] = [
    {
      key: "reference",
      header: "Reference",
      cell: (order) => (
        <span className="font-mono text-[0.8125rem] text-graphite-900">
          {order.reference}
        </span>
      ),
    },
    {
      key: "shop",
      header: "Shop",
      cell: (order) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-graphite-900">
            {order.shopName}
          </span>
          <span className="block truncate text-[0.6875rem] text-graphite-500">
            {order.ownerName} · {order.city}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Standing",
      cell: (order) => {
        const status = orderStatusOf(order.status);
        return (
          <span className={`pos-badge pos-badge-${status.tone}`}>{status.label}</span>
        );
      },
    },
    {
      key: "proof",
      header: "Proof",
      hideBelow: "md",
      cell: (order) =>
        order.proofUploadedAt ? (
          <span className="text-graphite-700">{writeWhen(order.proofUploadedAt)}</span>
        ) : (
          <span className="text-graphite-500">none sent</span>
        ),
    },
    {
      key: "paid",
      header: "Recorded",
      align: "end",
      hideBelow: "sm",
      cell: (order) =>
        order.paid > 0 ? (
          <span className="text-graphite-900">{rupees(order.paid)}</span>
        ) : (
          <span className="text-graphite-500">nothing yet</span>
        ),
    },
    {
      key: "amount",
      header: "Quoted",
      align: "end",
      cell: (order) => rupees(order.quotedPrice),
    },
  ];

  return (
    <>
      <ChartCard
        title="Orders"
        caption={
          waiting.length > 0
            ? `${waiting.length} waiting on you. Open one beside the bank statement.`
            : "Nothing waiting. Every order has been dealt with."
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={orders}
          rowKey={(order) => order.id}
          onRowClick={(order) => setOpen(order)}
          rowLabel={(order) => `Open order ${order.reference}`}
          isCurrent={(order) => order.id === open?.id}
          empty="Nobody has checked out on the site yet. Orders from /checkout land here."
        />
      </ChartCard>

      {open ? (
        <OrderSheet
          order={open}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function OrderSheet({
  order,
  readOnly,
  onClose,
}: {
  order: Order;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptOrder, IDLE);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectOrder, IDLE);

  useActionToast(acceptState, {
    saved: acceptState.saved?.label ?? "Order accepted",
    failed: "That order was not accepted",
  });
  useActionToast(rejectState, {
    saved: rejectState.saved?.label ?? "Order rejected",
    failed: "That order was not rejected",
  });

  // The sheet holds the row it was opened with; the accept result is what says
  // it has moved on before the list behind it re-renders.
  const acceptedInto =
    acceptState.tenantId ?? (order.status === "verified" ? order.tenantId : null);
  const settled = acceptedInto !== null || order.status === "rejected";

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !accepting && !rejecting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.reference}`}
        className="pos-sheet outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              {order.shopName}
            </h2>
            <p className="mt-0.5 truncate font-mono text-[0.75rem] text-graphite-500">
              {order.reference} · {writeWhen(order.createdAt)}
            </p>
          </div>

          <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
            <IconClose />
          </button>
        </header>

        <div className="space-y-5 px-4 py-5 sm:px-5">
          <dl className="grid gap-x-6 gap-y-1.5 text-[0.8125rem] sm:grid-cols-2">
            <Row label="Owner" value={order.ownerName} />
            <Row label="Phone" value={order.phone} />
            <Row label="City" value={order.city} />
            <Row label="They said they are" value={order.shopType} />
            <Row label="Plan asked for" value={order.planName} />
            <Row label="Billed" value={order.billingCycle} />
            <Row label="Counters" value={String(order.registers)} />
            <Row label="Quoted" value={rupees(order.quotedPrice)} />
            <Row
              label="Recorded against it"
              value={order.paid > 0 ? rupees(order.paid) : "Nothing yet"}
            />
          </dl>

          {/* The screenshot, which is the whole of the verification — drawn
              inline so it sits beside the figures it is checked against, and
              kept on accepted and rejected orders too, because "what did they
              send us" is still asked after the decision. */}
          {order.proofKind ? (
            <ProofPreview
              src={`/admin/orders/${order.id}/proof`}
              kind={order.proofKind}
              label={
                order.proofUploadedAt
                  ? `Payment proof · sent ${writeWhen(order.proofUploadedAt).toLowerCase()}`
                  : "Payment proof"
              }
            />
          ) : (
            <p className="pos-note pos-note-warn">
              No screenshot was uploaded. Record a payment only if you can see
              the transfer on the statement with this reference against it.
            </p>
          )}

          <a
            href={waLink(order.phone, `Assalam-o-Alaikum! Flo order ${order.reference} ke baare mein baat karni thi.`)}
            target="_blank"
            rel="noreferrer"
            className="pos-btn pos-btn-quiet pos-btn-sm"
          >
            Message them on WhatsApp
          </a>

          {settled ? (
            acceptedInto ? (
              <div className="pos-note pos-note-good space-y-2">
                <p>
                  {order.status === "verified" && order.verifiedAt
                    ? `Accepted ${writeWhen(order.verifiedAt).toLowerCase()}. `
                    : "Accepted. "}
                  It is a client now — activate the plan from their record, which
                  also makes the owner&rsquo;s login.
                </p>
                <Link
                  href={`/admin/clients/${acceptedInto}`}
                  className="pos-btn pos-btn-primary pos-btn-sm"
                >
                  Open the client
                </Link>
              </div>
            ) : (
              <p className="pos-note pos-note-bad">
                Rejected. They were told: &ldquo;{order.rejectionReason}&rdquo;
              </p>
            )
          ) : readOnly ? (
            <p className="pos-note">
              A support account can read this queue and work none of it.
            </p>
          ) : (
            <>
              <form action={acceptAction} className="space-y-3 border-t border-orchid-100 pt-4">
                <input type="hidden" name="order_id" value={order.id} />

                {acceptState.error ? (
                  <p className="pos-note pos-note-bad">{acceptState.error}</p>
                ) : null}

                <button
                  type="submit"
                  className="pos-btn pos-btn-primary w-full"
                  disabled={accepting}
                >
                  {accepting ? "Accepting…" : "Accept — make it a client"}
                </button>
              </form>

              <form action={rejectAction} className="space-y-2 border-t border-orchid-100 pt-4">
                <input type="hidden" name="order_id" value={order.id} />

                {rejectState.error ? (
                  <p className="pos-note pos-note-bad">{rejectState.error}</p>
                ) : null}

                <label className="block">
                  <span className="pos-label">Reject, and tell them why</span>
                  <input
                    name="reason"
                    className="pos-field"
                    placeholder="We could not find this transfer — check the reference and send it again."
                  />
                  <span className="pos-hint">They read this on their order page.</span>
                </label>

                <button
                  type="submit"
                  className="pos-btn pos-btn-quiet w-full"
                  disabled={rejecting}
                >
                  {rejecting ? "Rejecting…" : "Reject this order"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none text-graphite-500">{label}</dt>
      <dd className="min-w-0 truncate text-graphite-900">
        {value || <span className="text-graphite-500">—</span>}
      </dd>
    </div>
  );
}
