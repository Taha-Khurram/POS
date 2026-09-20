"use client";

import {
  lineTotal,
  moneyFormatter,
  receiptStamp,
  writeQuantity,
  type Bill,
  type CartLine,
  type Counter,
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
  /** Who it was rung up for, as their name stood at that moment. Null is a
   *  walk-in, which is most bills — and prints nothing at all rather than the
   *  words "walk-in", which would be a line of paper saying nothing. */
  customer: string | null;
  bill: Bill;
  /**
   * How it was settled — one row per tender, because `sale_tenders` is a
   * one-to-many by design. The payment sheet writes exactly one today; a split
   * bill must print both halves rather than the first one twice, and a reprint
   * off the history prints back whatever was actually stored.
   */
  tenders: { method: string; amount: number }[];
  /** What the customer handed over. Null on a card sale — there is nothing to
   *  count and no change to give — and null on a reprint, because the notes in
   *  the hand at the time were never written down. */
  tendered: number | null;
  change: number;
  /**
   * A second copy of a bill that has already been printed, taken off the sales
   * history. Said on the roll, because a duplicate that looks like an original
   * is a bill that can be presented twice for the same return.
   */
  reprint?: boolean;
  /**
   * The money going back rather than coming in.
   *
   * Stamped at the top, in the same box the other two exceptions use, and
   * carrying the bill it reverses — a customer holding a refund slip that looks
   * like a receipt can present it for a second refund, and a shop counting its
   * drawer needs to be able to tell the two piles apart without reading the
   * totals.
   *
   * `bill.total` on a refund is the amount given back, written positive,
   * because "TOTAL −Rs 300" is a line that makes the reader do a double
   * negative while a customer waits.
   */
  refundOf?: string;
};

/** The tender as the roll spells it. Upper case, because the customer checks
 *  this line and the drawer is counted against it. */
const writeMethod = (method: string) => method.toUpperCase();

export function Receipt({
  sale,
  shop,
  counter,
  settings,
}: {
  sale: Sale;
  shop: ShopProfile;
  /** Only the two fields that print. A reprint of a bill from a counter since
   *  deleted has a name and no row behind it, and that still prints. */
  counter: Pick<Counter, "name" | "receiptFooter">;
  settings: ShopSettings;
}) {
  const money = moneyFormatter(settings);
  const only = sale.tenders.length === 1 ? sale.tenders[0] : null;
  const cash = only?.method === "cash";

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

      {/* A refund is stamped in the same place and for a stronger version of
          the same reason: a slip that reads like a receipt is a slip that can
          be brought back for a second refund, and the pile of them in the
          drawer at 11 pm has to be tellable from the sales. */}
      {sale.refundOf ? (
        <p className="mt-2 border-2 border-black px-1.5 py-1 text-center font-display text-[0.8125rem] font-bold uppercase">
          Refund
          <span className="mt-0.5 block text-[0.6875rem] leading-snug font-normal normal-case">
            Money returned against bill {sale.refundOf}. This is not a sale.
          </span>
        </p>
      ) : null}

      {/* A duplicate is stamped, and stamped where the "not recorded" box goes
          — the place a cashier's eye already lands. A reprint that looks like
          an original is a bill a customer can present twice. */}
      {sale.reprint ? (
        <p className="mt-2 border border-dashed border-black px-1.5 py-1 text-center font-display text-[0.8125rem] font-bold uppercase">
          Duplicate
          <span className="mt-0.5 block text-[0.6875rem] leading-snug font-normal normal-case">
            A copy of a bill already issued. Counted once in the takings.
          </span>
        </p>
      ) : null}

      {/* ---- Which bill ---- */}
      <dl className={sale.recorded && !sale.reprint && !sale.refundOf ? undefined : "mt-2"}>
        <Row label={sale.refundOf ? "Refund" : "Bill"} value={sale.receiptNo} mono />
        <Row label="Date" value={receiptStamp(sale.at, settings.timezone)} />
        <Row label="Counter" value={counter.name} />
        {sale.customer ? <Row label="Customer" value={sale.customer} /> : null}
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

        {/* Printed whenever there is one, and printed as a negative, because
            the customer agreed to it out loud and the receipt is where they
            check that what was agreed is what was charged. A bill whose total
            is simply lower than its lines is a bill somebody queries. */}
        {sale.bill.discount > 0 ? (
          <Row
            label="Discount"
            value={`−${money(sale.bill.discount)}`}
            money
          />
        ) : null}

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
        <span>{sale.refundOf ? "GIVEN BACK" : "TOTAL"}</span>
        <span>{money(sale.bill.total)}</span>
      </p>

      <Rule />

      {/* ---- How it was paid ----
          The line the customer checks and the line the drawer is counted
          against, so the method is spelled out rather than abbreviated. */}
      <dl>
        {only ? (
          <Row label="Paid by" value={writeMethod(only.method)} />
        ) : sale.tenders.length === 0 ? (
          // Nothing settled it. `record_sale` always writes a tender, so this
          // is a bill from before that was true — and a blank line is a worse
          // answer than saying so.
          <Row label="Paid by" value="NOT RECORDED" />
        ) : (
          // Split. Every half printed, and the arithmetic left visible so the
          // customer can check it adds to the total above.
          sale.tenders.map((tender, index) => (
            <Row
              key={`${tender.method}-${index}`}
              label={index === 0 ? "Paid by" : ""}
              value={`${writeMethod(tender.method)}  ${money(tender.amount)}`}
              money
            />
          ))
        )}

        {cash && sale.tendered !== null ? (
          <>
            <Row label="Cash given" value={money(sale.tendered)} money />
            <Row label="Change" value={money(sale.change)} money />
          </>
        ) : null}

        {only?.method === "card" ? (
          <Row label="Card" value="Approved on the machine" />
        ) : null}
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
