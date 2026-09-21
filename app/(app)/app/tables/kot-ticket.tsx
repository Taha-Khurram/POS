"use client";

import { useEffect } from "react";

import { IconClose, IconPrinter } from "@/components/pos/icons";
import { receiptStamp } from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import {
  byCourse,
  course as courseOf,
  service as serviceOf,
  type OrderLine,
  type TableOrder,
} from "@/lib/pos/restaurant";

/**
 * The kitchen ticket.
 *
 * **A print, not a printer.** Flo does not route to a particular machine at the
 * grill — that is hardware it does not have and will not pretend to. What it
 * has is the ticket: numbered, timed, grouped by course, and reprintable. That
 * is what a kitchen argues over when a table says they never got the naan.
 *
 * It prints through the same `@media print` block in `globals.css` that the
 * receipt uses — everything else on the page is hidden and this is left
 * visible, so what is on screen is what comes off the roll.
 *
 * **No prices anywhere.** A cook does not need them and a ticket with money on
 * it is one a customer must never be handed by mistake. What a cook needs is
 * how many, of what, and what was said about it — so the quantity is set large
 * and the note is set beside the dish rather than under it.
 */
export function KotTicket({
  order,
  kotNumber,
  lines,
  shop,
  settings,
  onClose,
}: {
  order: TableOrder;
  kotNumber: string;
  /** What went on *this* ticket, not the whole bill. A kitchen works off the
   *  second ticket without re-reading the first. */
  lines: OrderLine[];
  shop: ShopProfile;
  settings: ShopSettings;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const groups = byCourse(lines);

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" className="pos-sheet max-w-sm outline-none">
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 print:hidden">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] font-bold">{kotNumber}</h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {lines.length} line{lines.length === 1 ? "" : "s"} to the kitchen
            </p>
          </div>

          <button type="button" onClick={onClose} className="pos-icon-btn" aria-label="Close">
            <IconClose />
          </button>
        </header>

        {/* `pos-receipt` is what the print block leaves visible. The ticket is
            deliberately the same width as a receipt: it comes off the same
            80 mm roll, because that is the printer a dhaba actually owns. */}
        <div className="pos-receipt px-4 py-4 font-mono text-[0.8125rem] leading-snug text-graphite-900">
          <p className="text-center text-[1.125rem] font-bold tracking-wide">
            KITCHEN
          </p>
          <p className="mt-0.5 text-center text-[0.75rem]">{shop.shopName}</p>

          <p className="mt-3 flex justify-between">
            <span className="text-[1rem] font-bold">{kotNumber}</span>
            <span>{receiptStamp(new Date(), settings.timezone)}</span>
          </p>

          <p className="mt-1 flex justify-between border-y border-dashed border-graphite-900 py-1">
            {/* The two things a cook reads first: where it is going and how
                urgent the room is. A parcel is packed, a table is plated. */}
            <span className="text-[1rem] font-bold">
              {order.tableName || serviceOf(order.service).label.toUpperCase()}
            </span>
            <span>
              {order.orderNumber}
              {order.covers ? ` · ${order.covers} pax` : ""}
            </span>
          </p>

          {groups.map((group) => (
            <section key={group.course} className="mt-2.5">
              <p className="font-bold uppercase">{courseOf(group.course).label}</p>

              <ul className="mt-0.5 space-y-1.5">
                {group.lines.map((line) => (
                  <li key={line.id} className="flex gap-2">
                    <span className="w-8 flex-none text-[1.0625rem] font-bold tabular-nums">
                      {line.quantity}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{line.name}</span>

                      {line.modifiers.length > 0 ? (
                        <span className="block">
                          + {line.modifiers.map((mod) => mod.name).join(", ")}
                        </span>
                      ) : null}

                      {/* Set apart, because it is the thing a cook gets wrong
                          when it is buried: "no onions" has to be impossible to
                          skim past. */}
                      {line.note ? (
                        <span className="block font-bold uppercase">
                          ** {line.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="mt-3 border-t border-dashed border-graphite-900 pt-1 text-center text-[0.6875rem]">
            {order.openedBy}
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-orchid-100 px-4 py-3 print:hidden">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-soft">
            Done
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="pos-btn pos-btn-primary"
          >
            <IconPrinter className="h-4 w-4" />
            Print
          </button>
        </footer>
      </div>
    </div>
  );
}
