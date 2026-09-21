"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconAlert,
  IconCheck,
  IconChevron,
  IconClose,
  IconPrinter,
  IconSearch,
  IconTrash,
} from "@/components/pos/icons";
import { useToast } from "@/components/pos/toaster";
import { matchesProduct, unitShort, type Product } from "@/lib/pos/catalog";
import {
  newSaleId,
  tendersOn,
  type Counter,
  type TenderPart,
} from "@/lib/pos/counter";
import type { TillAccess } from "@/lib/pos/modules";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import {
  byCourse,
  COURSES,
  course as courseOf,
  lineTotalOf,
  LINE_NOTE_MAX,
  orderTotal,
  service as serviceOf,
  sittingFor,
  unitPriceOf,
  unsentLines,
  type CourseId,
  type OrderLine,
  type TableOrder,
} from "@/lib/pos/restaurant";
import { priceOf, sellableVariants, writeVariant, type Variant } from "@/lib/pos/variant";
import { addLines, cancelOrder, sendToKitchen, settleOrder, voidLine } from "./actions";
import { KotTicket } from "./kot-ticket";

/**
 * One table's bill, while the meal is still going.
 *
 * The screen is in the order of the job: what they have already ordered on the
 * left, the menu on the right, and the two buttons that matter — send to the
 * kitchen, and settle — where a thumb reaches them.
 *
 * **Lines are grouped by course**, because that is what a kitchen sequences on
 * and what a waiter reads back to a table. A flat list of eleven dishes is a
 * list nobody can check against what is on the table.
 *
 * **Nothing is priced here.** Tapping a dish sends its id; `addLines` re-reads
 * the menu and stamps the price, and the modifiers are priced off the shop's
 * own rows. The totals on this screen are the same arithmetic
 * `settle_table_order` does in SQL — `lineTotalOf` is the one definition — so
 * the figure a table watches being built is the figure they are handed.
 */
export function OrderScreen({
  order,
  products,
  variants,
  modifiers,
  counters,
  access,
  settings,
  shop,
  money,
}: {
  order: TableOrder;
  products: Product[];
  variants: Map<string, Variant[]>;
  modifiers: Map<string, { id: string; group: string; name: string; priceDelta: number }[]>;
  counters: Counter[];
  access: TillAccess;
  settings: ShopSettings;
  shop: ShopProfile;
  money: (value: number) => string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [query, setQuery] = useState("");
  const [course, setCourse] = useState<CourseId>("main");
  const [adding, setAdding] = useState<Product | null>(null);
  const [settling, setSettling] = useState(false);
  const [ticket, setTicket] = useState<{ number: string; lines: OrderLine[] } | null>(
    null,
  );

  const saleId = useRef("");

  const total = orderTotal(order.lines);
  const unsent = unsentLines(order.lines);
  const groups = byCourse(order.lines);
  const closed = order.status !== "open";

  const matches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return products.slice(0, 24);

    return products.filter((product) => matchesProduct(product, needle)).slice(0, 24);
  }, [products, query]);

  /** Tapping a dish. One with a grid or modifiers opens the sheet; everything
   *  else goes straight on, because a dhaba's chai should be one tap. */
  const tap = (product: Product) => {
    const grid = sellableVariants(variants.get(product.id) ?? []);
    const mods = modifiers.get(product.id) ?? [];

    if (grid.length > 0 || mods.length > 0) {
      setAdding(product);
      return;
    }

    send([
      {
        itemId: product.id,
        variantId: null,
        quantity: 1,
        course,
        note: "",
        modifierIds: [],
      },
    ]);
  };

  const send = (lines: Parameters<typeof addLines>[0]["lines"]) =>
    start(async () => {
      const result = await addLines({ orderId: order.id, lines });

      if (!result.ok) {
        toast({ title: "That did not go on the bill", detail: result.error, tone: "bad" });
        return;
      }

      setAdding(null);
      router.refresh();
    });

  const fire = () =>
    start(async () => {
      // Frozen before the send, because the ticket has to print what went to
      // the kitchen and the refresh below will have moved them to `sent`.
      const going = unsent.map((line) => ({ ...line }));

      const result = await sendToKitchen(order.id);

      if (!result.ok) {
        toast({ title: "Nothing went to the kitchen", detail: result.error, tone: "bad" });
        return;
      }

      if (result.sent === 0) {
        toast({ title: "Nothing new to send", tone: "info" });
        return;
      }

      toast({
        title: `${result.kotNumber} sent`,
        detail: `${result.sent} line${result.sent === 1 ? "" : "s"} to the kitchen.`,
        tone: "good",
      });

      setTicket({ number: result.kotNumber ?? "", lines: going });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Link
        href="/app/tables"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-graphite-500 hover:text-graphite-900"
      >
        <IconChevron className="h-3.5 w-3.5 rotate-90" />
        The floor
      </Link>

      <header className="pos-card flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-[1.375rem] leading-tight font-bold">
            {order.tableName || serviceOf(order.service).label}
            <span className="pos-badge">{order.orderNumber}</span>
            {closed ? (
              <span className="pos-badge pos-badge-warn">
                {order.status === "settled" ? "Settled" : "Cancelled"}
              </span>
            ) : null}
          </h1>

          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {serviceOf(order.service).label}
            {order.covers ? ` · ${order.covers} covers` : ""} ·{" "}
            {sittingFor(order.openedAt)} · opened by {order.openedBy}
            {order.customerName ? ` · ${order.customerName}` : ""}
          </p>
        </div>

        <p className="text-right">
          <span className="block text-[0.6875rem] text-graphite-500">The bill</span>
          <span className="font-display text-[1.75rem] leading-none font-bold tabular-nums text-orchid-800">
            {money(total)}
          </span>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* ---------------- What they have ordered ---------------- */}
        <ChartCard
          title="On the bill"
          caption={
            unsent.length > 0
              ? `${unsent.length} not yet in the kitchen`
              : "Everything ordered has gone through"
          }
          actions={
            closed ? null : (
              <>
                <button
                  type="button"
                  onClick={fire}
                  disabled={pending || unsent.length === 0}
                  className="pos-btn pos-btn-soft disabled:pointer-events-none disabled:opacity-45"
                >
                  <IconPrinter className="h-4 w-4" />
                  Send {unsent.length > 0 ? `(${unsent.length})` : ""}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    saleId.current = newSaleId();
                    setSettling(true);
                  }}
                  disabled={pending || order.lines.length === 0}
                  className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
                >
                  Settle · {money(total)}
                </button>
              </>
            )
          }
        >
          {groups.length === 0 ? (
            <p className="px-4 pb-6 text-center text-[0.8125rem] leading-relaxed text-graphite-500">
              Nothing ordered yet. Tap a dish on the right — it goes on as a{" "}
              {courseOf(course).label.toLowerCase().replace(/s$/, "")} until you
              change the course.
            </p>
          ) : (
            <div className="space-y-4 px-4 pb-4">
              {groups.map((group) => (
                <section key={group.course}>
                  <h3 className="pos-label">{courseOf(group.course).label}</h3>

                  <ul className="mt-1 space-y-1.5">
                    {group.lines.map((line) => (
                      <LineRow
                        key={line.id}
                        line={line}
                        money={money}
                        closed={closed}
                        busy={pending}
                        onVoid={(reason) =>
                          start(async () => {
                            const result = await voidLine(line.id, reason);
                            if (!result.ok) {
                              toast({
                                title: "That did not come off",
                                detail: result.error,
                                tone: "bad",
                              });
                              return;
                            }
                            router.refresh();
                          })
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {/* Voided lines, kept and greyed. "Who cancelled the mutton after
                  it was fired" is the question a restaurant asks at the end of
                  a bad night, and a deleted row cannot answer it. */}
              {order.lines.some((line) => line.status === "void") ? (
                <section>
                  <h3 className="pos-label">Taken off</h3>
                  <ul className="mt-1 space-y-1">
                    {order.lines
                      .filter((line) => line.status === "void")
                      .map((line) => (
                        <li
                          key={line.id}
                          className="flex items-baseline justify-between gap-2 text-[0.75rem] text-graphite-500 line-through"
                        >
                          <span className="truncate">
                            {line.quantity} × {line.name}
                          </span>
                          <span className="flex-none no-underline">
                            {line.voidedReason || "no reason given"}
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </ChartCard>

        {/* ---------------- The menu ---------------- */}
        {closed ? null : (
          <ChartCard title="Menu" caption={courseOf(course).note}>
            <div className="space-y-2 px-4 pb-4">
              <div className="flex gap-1">
                {COURSES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setCourse(entry.id)}
                    className={`pos-btn pos-btn-sm flex-1 ${
                      entry.id === course ? "pos-btn-primary" : "pos-btn-soft"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
                <input
                  className="pos-field pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a dish"
                  aria-label="Find a dish"
                  autoComplete="off"
                />
              </div>

              <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
                {matches.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => tap(product)}
                      disabled={pending}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-orchid-100 px-2.5 py-2 text-left hover:border-orchid-300 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[0.8125rem] font-medium text-graphite-900">
                          {product.name}
                        </span>
                        {(modifiers.get(product.id)?.length ?? 0) > 0 ||
                        sellableVariants(variants.get(product.id) ?? []).length > 0 ? (
                          <span className="block text-[0.6875rem] text-graphite-500">
                            has choices
                          </span>
                        ) : null}
                      </span>
                      <span className="flex-none text-[0.8125rem] tabular-nums text-graphite-700">
                        {money(product.price)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </ChartCard>
        )}
      </div>

      {/* ---- The tickets already sent, so one can be printed again ---- */}
      {order.kots.length > 0 ? (
        <ChartCard
          title="Kitchen tickets"
          caption={`${order.kots.length} sent`}
        >
          <ul className="flex flex-wrap gap-2 px-4 pb-4">
            {order.kots.map((kot) => (
              <li key={kot.id}>
                <button
                  type="button"
                  onClick={() =>
                    setTicket({
                      number: kot.number,
                      lines: order.lines.filter((line) => line.kotNumber === kot.number),
                    })
                  }
                  className="pos-btn pos-btn-soft pos-btn-sm"
                >
                  <IconPrinter className="h-3.5 w-3.5" />
                  {kot.number} · {kot.lines} line{kot.lines === 1 ? "" : "s"}
                </button>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

      {/* ---- Closing an empty bill ---- */}
      {!closed && order.lines.length === 0 ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await cancelOrder(order.id, "nobody sat down");
              if (!result.ok) {
                toast({ title: "That bill stayed open", detail: result.error, tone: "bad" });
                return;
              }
              router.push("/app/tables");
            })
          }
          className="pos-btn pos-btn-quiet pos-btn-sm"
        >
          <IconTrash className="h-4 w-4" />
          Close this bill — nobody sat down
        </button>
      ) : null}

      {adding ? (
        <ChoiceSheet
          product={adding}
          variants={sellableVariants(variants.get(adding.id) ?? [])}
          modifiers={modifiers.get(adding.id) ?? []}
          course={course}
          money={money}
          busy={pending}
          onClose={() => setAdding(null)}
          onAdd={(line) => send([line])}
        />
      ) : null}

      {settling ? (
        <SettleSheet
          order={order}
          total={total}
          counters={counters}
          access={access}
          money={money}
          busy={pending}
          onClose={() => setSettling(false)}
          onSettle={(input) =>
            start(async () => {
              const result = await settleOrder({
                orderId: order.id,
                saleId: saleId.current,
                ...input,
              });

              if (!result.ok) {
                toast({ title: "That bill did not settle", detail: result.error, tone: "bad" });
                return;
              }

              toast({
                title: `${result.receiptNo} — ${money(result.total)}`,
                detail: "Settled and on the day's takings.",
                tone: "good",
              });

              router.push("/app/tables");
            })
          }
        />
      ) : null}

      {ticket ? (
        <KotTicket
          order={order}
          kotNumber={ticket.number}
          lines={ticket.lines}
          shop={shop}
          settings={settings}
          onClose={() => setTicket(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LineRow({
  line,
  money,
  closed,
  busy,
  onVoid,
}: {
  line: OrderLine;
  money: (value: number) => string;
  closed: boolean;
  busy: boolean;
  onVoid: (reason: string) => void;
}) {
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <li className="rounded-xl border border-orchid-100 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[0.875rem] text-graphite-900">
            {line.quantity} × {line.name}
            {line.status === "new" ? (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">
                Not sent
              </span>
            ) : null}
          </span>

          {line.modifiers.length > 0 ? (
            <span className="block text-[0.6875rem] text-graphite-700">
              {line.modifiers
                .map((mod) =>
                  mod.priceDelta === 0
                    ? mod.name
                    : `${mod.name} ${mod.priceDelta > 0 ? "+" : ""}${mod.priceDelta}`,
                )
                .join(", ")}
            </span>
          ) : null}

          {line.note ? (
            <span className="block text-[0.6875rem] text-graphite-500">
              {line.note}
            </span>
          ) : null}

          <span className="block text-[0.625rem] text-graphite-500">
            {money(unitPriceOf(line))} per {unitShort(line.unit as Product["unit"])}
            {line.kotNumber ? ` · ${line.kotNumber}` : ""}
          </span>
        </span>

        <span className="flex flex-none items-center gap-1.5">
          <span className="font-semibold tabular-nums text-graphite-900">
            {money(lineTotalOf(line))}
          </span>

          {closed ? null : (
            <button
              type="button"
              onClick={() => setArming((open) => !open)}
              disabled={busy}
              className="pos-icon-btn"
              aria-label={`Take ${line.name} off`}
            >
              <IconClose className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      {arming ? (
        <div className="mt-2 border-t border-orchid-100 pt-2">
          {/* A sent line needs a reason; an unsent one is a mistype and is just
              deleted. Said here rather than discovered, because the two
              buttons look the same and do different things. */}
          {line.status === "sent" ? (
            <input
              className="pos-field text-[0.8125rem]"
              value={reason}
              maxLength={LINE_NOTE_MAX}
              placeholder="Why? The kitchen has already cooked it."
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          ) : (
            <p className="text-[0.75rem] text-graphite-500">
              This has not gone to the kitchen, so it comes straight off.
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onVoid(reason)}
              disabled={busy || (line.status === "sent" && !reason.trim())}
              className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-50"
            >
              {line.status === "sent" ? "Void it" : "Take it off"}
            </button>
            <button
              type="button"
              onClick={() => setArming(false)}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** A dish with choices: which size, what to add, and anything the kitchen needs
 *  told in words. */
function ChoiceSheet({
  product,
  variants,
  modifiers,
  course,
  money,
  busy,
  onClose,
  onAdd,
}: {
  product: Product;
  variants: Variant[];
  modifiers: { id: string; group: string; name: string; priceDelta: number }[];
  course: CourseId;
  money: (value: number) => string;
  busy: boolean;
  onClose: () => void;
  onAdd: (line: {
    itemId: string;
    variantId: string | null;
    quantity: number;
    course: CourseId;
    note: string;
    modifierIds: string[];
  }) => void;
}) {
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const variant = variants.find((one) => one.id === variantId);
  const base = variant ? priceOf(variant, product.price) : product.price;
  const extra = modifiers
    .filter((mod) => picked.includes(mod.id))
    .reduce((sum, mod) => sum + mod.priceDelta, 0);

  const groups = [...new Set(modifiers.map((mod) => mod.group))];

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
            <h2 className="font-display text-[1rem] font-bold">{product.name}</h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              Going on as a {courseOf(course).label.toLowerCase().replace(/s$/, "")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
            <IconClose />
          </button>
        </header>

        <fieldset disabled={busy} className="space-y-4 px-4 py-5 sm:px-5">
          {variants.length > 0 ? (
            <div>
              <span className="pos-label">Which one</span>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {variants.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    onClick={() => setVariantId(one.id)}
                    className={`rounded-xl border px-2 py-2 text-center text-[0.8125rem] ${
                      one.id === variantId
                        ? "border-orchid-700 bg-orchid-50"
                        : "border-orchid-100"
                    }`}
                  >
                    {writeVariant(one)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {groups.map((group) => (
            <div key={group}>
              <span className="pos-label">{group}</span>
              <div className="mt-1 space-y-1.5">
                {modifiers
                  .filter((mod) => mod.group === group)
                  .map((mod) => (
                    <label
                      key={mod.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-orchid-100 px-2.5 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(mod.id)}
                        onChange={(event) =>
                          setPicked((current) =>
                            event.target.checked
                              ? [...current, mod.id]
                              : current.filter((id) => id !== mod.id),
                          )
                        }
                        className="h-4 w-4 flex-none accent-orchid-700"
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.875rem] text-graphite-900">
                        {mod.name}
                      </span>
                      <span className="flex-none text-[0.8125rem] tabular-nums text-graphite-700">
                        {mod.priceDelta === 0
                          ? "—"
                          : `${mod.priceDelta > 0 ? "+" : ""}${money(mod.priceDelta)}`}
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <label className="block">
              <span className="pos-label">How many</span>
              <input
                className="pos-field w-24 text-right tabular-nums"
                inputMode="numeric"
                value={quantity}
                onChange={(event) =>
                  setQuantity(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </label>

            <label className="block">
              <span className="pos-label">Tell the kitchen — optional</span>
              <input
                className="pos-field"
                value={note}
                maxLength={LINE_NOTE_MAX}
                placeholder="No onions. Well done. Less spicy."
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <p className="mr-auto text-[0.8125rem] tabular-nums text-graphite-700">
            <span className="text-graphite-500">Comes to </span>
            <span className="font-display font-bold text-graphite-900">
              {money((base + extra) * quantity)}
            </span>
          </p>

          <button type="button" onClick={onClose} disabled={busy} className="pos-btn pos-btn-soft">
            Cancel
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onAdd({
                itemId: product.id,
                variantId: variantId || null,
                quantity,
                course,
                note,
                modifierIds: picked,
              })
            }
            className="pos-btn pos-btn-primary disabled:opacity-60"
          >
            <IconCheck className="h-4 w-4" />
            Put it on
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Taking the money. Deliberately thinner than the register's payment sheet:
 *  the bill is already built and the only questions left are which till and
 *  how it was paid. */
function SettleSheet({
  order,
  total,
  counters,
  access,
  money,
  busy,
  onClose,
  onSettle,
}: {
  order: TableOrder;
  total: number;
  counters: Counter[];
  access: TillAccess;
  money: (value: number) => string;
  busy: boolean;
  onClose: () => void;
  onSettle: (input: {
    counterId: string;
    tenders: TenderPart[];
    discountAmount: number;
  }) => void;
}) {
  const [counterId, setCounterId] = useState(counters[0]?.id ?? "");
  const [discount, setDiscount] = useState("");

  const counter = counters.find((one) => one.id === counterId);
  const available = counter ? tendersOn(counter) : [];
  const [method, setMethod] = useState(available[0]?.id ?? "cash");

  const off = access.canDiscount ? Math.max(0, Number(discount) || 0) : 0;
  const due = Math.max(0, Math.round((total - off) * 100) / 100);

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
              Settle {order.tableName || order.orderNumber}
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              This is the moment it becomes a sale and the stock comes off.
            </p>
          </div>
          <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
            <IconClose />
          </button>
        </header>

        <fieldset disabled={busy} className="space-y-4 px-4 py-5 sm:px-5">
          <p className="rounded-2xl bg-orchid-50 px-4 py-3.5 text-center">
            <span className="block text-[0.75rem] font-medium text-graphite-500">
              Amount due
            </span>
            <span className="mt-1 block font-display text-[2rem] leading-none font-bold tabular-nums text-orchid-800">
              {money(due)}
            </span>
          </p>

          {counters.length > 1 ? (
            <label className="block">
              <span className="pos-label">Which till</span>
              <select
                className="pos-field"
                value={counterId}
                onChange={(event) => setCounterId(event.target.value)}
              >
                {counters.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div>
            <span className="pos-label">Paid by</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {available.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setMethod(entry.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-[0.875rem] ${
                    entry.id === method
                      ? "border-orchid-700 bg-orchid-50"
                      : "border-orchid-100"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {access.canDiscount ? (
            <label className="block">
              <span className="pos-label">Take something off — optional</span>
              <input
                className="pos-field text-right tabular-nums"
                inputMode="decimal"
                value={discount}
                placeholder="0"
                onChange={(event) => setDiscount(event.target.value)}
              />
              <p className="pos-hint">
                Up to your ceiling of {access.discountCeilingPct}%. Over it clamps
                and says so.
              </p>
            </label>
          ) : null}
        </fieldset>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          {counters.length === 0 ? (
            <p className="mr-auto flex items-center gap-1.5 text-[0.75rem] text-signal-bad">
              <IconAlert className="h-3.5 w-3.5" />
              No till is open. Open one in Settings first.
            </p>
          ) : null}

          <button type="button" onClick={onClose} disabled={busy} className="pos-btn pos-btn-soft">
            Back to the bill
          </button>

          <button
            type="button"
            disabled={busy || !counterId || due <= 0}
            onClick={() =>
              onSettle({
                counterId,
                tenders: [{ method, amount: due, reference: "" }],
                discountAmount: off,
              })
            }
            className="pos-btn pos-btn-primary disabled:opacity-60"
          >
            <IconCheck className="h-4 w-4" />
            {busy ? "Settling…" : `Take ${money(due)}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
