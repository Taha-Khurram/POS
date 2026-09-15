"use client";

import {
  lineTotal,
  moneyFormatter,
  receiptStamp,
  writeQuantity,
  type Bill,
  type CartLine,
  type Counter,
  type TenderId,
} from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";

/**
 * The bill, as it comes off the roll.
 *
 * Laid out for 80 mm thermal paper — one narrow column, no rules that are not
 * load-bearing, and the item name on its own line above its own arithmetic
 * because "Super Kernel basmati — loose" does not share a line with a quantity
 * and a total at 32 characters wide.
 *
 * Printing is `window.print()` against the `@media print` block in
 * `globals.css`, which hides the console and leaves this element. That is the
 * fallback the plan calls for; ESC/POS over WebUSB, which drives the drawer and
 * the cutter as well, is the register's own Part 4 job.
 *
 * Money is written through the shop's currency card rather than `rupees()` —
 * "written as" is a setting about what this printer can draw, and the roll is
 * the only place it can possibly show.
 */
export type Sale = {
  receiptNo: string;
  /** False when the sale could not be written down and the cashier printed it
   *  anyway. The roll says so, because a bill that is missing from the day's
   *  takings must never look like one that is in them. */
  recorded: boolean;
  at: Date;
  /** Frozen at tender. The cart is cleared the moment this exists, so a
   *  reprint shows what was sold and not what is on the screen now. */
  lines: CartLine[];
  bill: Bill;
  tender: TenderId;
  /** What the customer handed over. Null on a card sale — there is nothing to
   *  count and no change to give. */
  tendered: number | null;
  change: number;
};

export function Receipt({
  sale,
  shop,
  counter,
  settings,
}: {
  sale: Sale;
  shop: ShopProfile;
  counter: Counter;
  settings: ShopSettings;
}) {
  const money = moneyFormatter(settings);
  const cash = sale.tender === "cash";

  return (
    <div className="pos-receipt">
      {/*
        The roll size, mounted with the receipt rather than written into
        `globals.css`. `@page` cannot be scoped by a selector, so a rule in the
        stylesheet would set every page on the marketing site to 80 mm too —
        including the pricing page somebody prints for a client.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: "@page { size: 80mm auto; margin: 4mm; }",
        }}
      />

      {/* ---- The shop ---- */}
      <header className="text-center">
        <p className="font-display text-[0.9375rem] leading-tight font-bold tracking-tight uppercase">
          {shop.shopName}
        </p>
        <p className="mt-0.5">{shop.city}</p>
        <p>{shop.phone}</p>

        {shop.ntn ? <p className="mt-0.5">NTN {shop.ntn}</p> : null}
        {shop.strn ? <p>STRN {shop.strn}</p> : null}
      </header>

      <Rule />

      {/* An unrecorded sale is stated at the top, in the place a cashier's eye
          already goes, rather than in small print at the bottom. The money was
          taken; what is missing is the record of it. */}
      {!sale.recorded ? (
        <p className="border border-black px-1.5 py-1 text-center font-display text-[0.8125rem] font-bold uppercase">
          Not recorded
          <span className="mt-0.5 block text-[0.6875rem] leading-snug font-normal normal-case">
            This bill is not in today&rsquo;s takings. Keep it and re-enter the
            sale once Flo is back.
          </span>
        </p>
      ) : null}

      {/* ---- Which bill ---- */}
      <dl className={sale.recorded ? undefined : "mt-2"}>
        <Row label="Bill" value={sale.receiptNo} mono />
        <Row label="Date" value={receiptStamp(sale.at, settings.timezone)} />
        <Row label="Counter" value={counter.name} />
      </dl>

      <Rule />

      {/* ---- What was bought ----
          Name on its own line, arithmetic under it. Two columns of ten
          characters each is how a receipt ends up with "Super Kernel…". */}
      <ul>
        {sale.lines.map((line) => (
          <li key={line.id} className="mt-1.5 first:mt-0">
            <p className="font-medium">
              {line.name}
              {line.urdu ? (
                <span dir="rtl" className="ms-1.5 font-normal">
                  {line.urdu}
                </span>
              ) : null}
            </p>

            <p className="flex items-baseline justify-between gap-2 tabular-nums">
              <span>
                {writeQuantity(line)} × {money(line.price)}
              </span>
              <span className="font-medium">{money(lineTotal(line))}</span>
            </p>
          </li>
        ))}
      </ul>

      <Rule />

      {/* ---- What it comes to ---- */}
      <dl>
        <Row
          label="Items"
          value={`${sale.bill.lines} ${sale.bill.lines === 1 ? "line" : "lines"} · ${sale.bill.units} units`}
        />
        <Row label="Subtotal" value={money(sale.bill.subtotal)} money />

        {/* Only when something on the bill is actually taxed. A kiryana that
            sells nothing but loose atta should not print a zero it has to
            explain to a customer. */}
        {sale.bill.taxIncluded > 0 ? (
          <Row
            label="Incl. sales tax"
            value={money(sale.bill.taxIncluded)}
            money
          />
        ) : null}
      </dl>

      <Rule />

      <p className="flex items-baseline justify-between gap-2 font-display text-[1rem] font-bold tabular-nums">
        <span>TOTAL</span>
        <span>{money(sale.bill.total)}</span>
      </p>

      <Rule />

      {/* ---- How it was paid ----
          The line the customer checks and the line the drawer is counted
          against, so the method is spelled out rather than abbreviated. */}
      <dl>
        <Row label="Paid by" value={cash ? "CASH" : "CARD"} />

        {cash && sale.tendered !== null ? (
          <>
            <Row label="Cash given" value={money(sale.tendered)} money />
            <Row label="Change" value={money(sale.change)} money />
          </>
        ) : null}

        {!cash ? <Row label="Card" value="Approved on the machine" /> : null}
      </dl>

      <Rule />

      <footer className="text-center">
        {counter.receiptFooter ? (
          <p className="mb-1">{counter.receiptFooter}</p>
        ) : null}

        <p className="font-display font-semibold">Shukriya!</p>
        <p className="mt-0.5">Billed on Flo</p>
      </footer>
    </div>
  );
}

/** A label-and-figure line. Both halves on one row, the figure right-aligned
 *  and tabular so a column of them lines up down the roll. */
function Row({
  label,
  value,
  money = false,
  mono = false,
}: {
  label: string;
  value: string;
  money?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt>{label}</dt>
      <dd
        className={`text-right ${money ? "tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** The dashed separator a thermal roll draws. A border rather than a row of
 *  hyphens, so it stays one pixel at any print resolution. */
const Rule = () => (
  <hr className="pos-receipt-rule my-2 border-0 border-t border-dashed border-graphite-500/60" />
);
