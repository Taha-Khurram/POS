"use client";

import { useActionState, useState } from "react";

import { InviteCard } from "@/components/admin/invite-card";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconClose } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import { orderStatusOf, waLink, writeWhen } from "@/lib/platform/admin";
import type { Order, Plan } from "@/lib/platform/console";

import { rejectOrder, verifyOrder } from "./actions";
import { IDLE } from "../state";

/**
 * The self-serve queue.
 *
 * An order is a claim of payment, not a payment. The screen is built around
 * the one action that matters — open it beside your bank statement, see the
 * screenshot, and either verify it (which activates the shop and mints the
 * link) or reject it with a reason the buyer will read on their own order page.
 *
 * Opening a row is a sheet rather than a navigation, the same call
 * `/app/sales` makes: a queue somebody is working through must survive looking
 * at one of its rows.
 */
export function OrdersPanel({
  orders,
  plans,
  proofs,
  readOnly,
}: {
  orders: Order[];
  plans: Plan[];
  /** Signed, short-lived links for the proofs worth looking at. The bucket is
   *  private and these expire in ten minutes — a payment screenshot carries an
   *  account number and a name. */
  proofs: Record<string, string>;
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
          plans={plans}
          proof={proofs[open.id] ?? null}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function OrderSheet({
  order,
  plans,
  proof,
  readOnly,
  onClose,
}: {
  order: Order;
  plans: Plan[];
  proof: string | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyOrder, IDLE);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectOrder, IDLE);

  useActionToast(verifyState, {
    saved: verifyState.saved?.label ?? "Shop activated",
    failed: "That order was not verified",
  });
  useActionToast(rejectState, {
    saved: rejectState.saved?.label ?? "Order rejected",
    failed: "That order was not rejected",
  });

  const [planId, setPlanId] = useState(order.planId ?? plans[0]?.id ?? "");
  const [price, setPrice] = useState(String(order.quotedPrice));

  const settled = order.status === "verified" || order.status === "rejected";

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !verifying && !rejecting) onClose();
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
          {verifyState.invite ? <InviteCard invite={verifyState.invite} /> : null}

          <dl className="grid gap-x-6 gap-y-1.5 text-[0.8125rem] sm:grid-cols-2">
            <Row label="Owner" value={order.ownerName} />
            <Row label="Phone" value={order.phone} />
            <Row label="City" value={order.city} />
            <Row label="They said they are" value={order.shopType} />
            <Row label="Plan asked for" value={order.planName} />
            <Row label="Billed" value={order.billingCycle} />
            <Row label="Counters" value={String(order.registers)} />
            <Row label="Quoted" value={rupees(order.quotedPrice)} />
          </dl>

          {/* The screenshot, which is the whole of the verification. A link
              rather than an inline image: it is a private-bucket URL that dies
              in ten minutes, and a broken <img> in a queue reads as a bug. */}
          {proof ? (
            <a
              href={proof}
              target="_blank"
              rel="noreferrer"
              className="pos-btn pos-btn-soft"
            >
              Open the payment screenshot
            </a>
          ) : (
            <p className="pos-note pos-note-warn">
              No screenshot was uploaded. Verify only if you can see the transfer
              on the statement with this reference against it.
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
            <p className={`pos-note ${order.status === "verified" ? "pos-note-good" : "pos-note-bad"}`}>
              {order.status === "verified"
                ? `Verified ${writeWhen(order.verifiedAt).toLowerCase()}. It is a working shop now.`
                : `Rejected. They were told: “${order.rejectionReason}”`}
            </p>
          ) : readOnly ? (
            <p className="pos-note">
              A support account can read this queue and work none of it.
            </p>
          ) : (
            <>
              <form action={verifyAction} className="space-y-3 border-t border-orchid-100 pt-4">
                <input type="hidden" name="order_id" value={order.id} />

                {verifyState.error ? (
                  <p className="pos-note pos-note-bad">{verifyState.error}</p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectRow
                    label="Plan to activate on"
                    value={planId}
                    onChange={setPlanId}
                    options={plans.map((plan) => ({
                      id: plan.id,
                      label: plan.name,
                      description: `${rupees(plan.listPrice)} a month list`,
                    }))}
                  />
                  <input type="hidden" name="plan_id" value={planId} />

                  <label className="block">
                    <span className="pos-label">Price to record</span>
                    <input
                      name="agreed_price"
                      className="pos-field"
                      value={price}
                      inputMode="decimal"
                      onChange={(event) => setPrice(event.target.value)}
                    />
                    <span className="pos-hint">
                      What actually landed, which is not always what was quoted.
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="pos-btn pos-btn-primary w-full"
                  disabled={verifying}
                >
                  {verifying ? "Activating…" : "Verify and activate the shop"}
                </button>

                <p className="text-[0.75rem] text-graphite-500">
                  This creates the shop, its subscription and a one-time sign-up
                  link — the same thing the Activate form does.
                </p>
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
