"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import {
  IconAlert,
  IconBarcode,
  IconCamera,
  IconCart,
  IconCheck,
  IconClose,
  IconMinus,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconTrash,
  IconUser,
} from "@/components/pos/icons";
import { useDismiss } from "@/components/pos/use-dismiss";
import { useToast } from "@/components/pos/toaster";
import {
  billOf,
  lineTotal,
  moneyFormatter,
  parseQuantity,
  newSaleId,
  provisionalReceiptNumber,
  round3,
  type CartLine,
  type Counter,
  type TenderId,
} from "@/lib/pos/counter";
import {
  UNITS,
  matchesProduct,
  stockState,
  unitShort,
  type Product,
} from "@/lib/pos/catalog";
import {
  matchesCustomer,
  writePhone,
  type Customer,
} from "@/lib/pos/customer";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { recordSale } from "./actions";
import { PaymentSheet } from "./payment-sheet";
import { Receipt, type Sale } from "./receipt";

/**
 * The register.
 *
 * Client, and unavoidably so: a cashier with a queue searches, scans and
 * corrects several times a bill, and a round trip per keystroke over shop 3G
 * would make the counter feel broken. The arithmetic lives in
 * `lib/pos/counter.ts` and not in this file, so the same totals hold when the
 * lines come off `items` instead of the sample catalog.
 *
 * The search box is the whole input surface on purpose. A USB barcode scanner
 * is a keyboard that types digits and presses Enter, so it needs no code at all
 * — it types into the box that already has focus and the Enter handler puts the
 * item on the bill. Focus is therefore returned to that box after every action,
 * because a scanner firing into a closed dialog is a scan that vanished.
 *
 * The sale is recorded before it prints, through `recordSale`, which re-prices
 * every line from the catalog server-side — so the browser decides what and how
 * many, and never what it costs. The receipt number comes back from that write
 * rather than being invented here: it is the counter's own series, claimed in
 * the same transaction that inserts the sale, which is the only way two tablets
 * on one counter cannot print the same number.
 */
export function Till({
  items,
  customers,
  counter,
  shop,
  settings,
}: {
  items: Product[];
  /** Everyone the till may put a bill against — the shop's own, minus the ones
   *  switched off. Attaching one is optional and stays that way: most bills in
   *  most shops are a walk-in, and a register that insists on a name before it
   *  will charge is a register with a queue behind it. */
  customers: Customer[];
  counter: Counter;
  shop: ShopProfile;
  settings: ShopSettings;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const money = moneyFormatter(settings);
  const bill = useMemo(() => billOf(lines), [lines]);

  /* ---------------- Finding an item ---------------- */

  // `matchesProduct` is the catalog screen's own matcher, not a copy of it: a
  // cashier who cannot find an item the owner can see assumes it is not in the
  // list and adds it a second time. It searches the barcode alongside the name
  // because the fastest way to find something at the counter is to scan it.
  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return items.slice(0, 12);

    return items.filter((item) => matchesProduct(item, raw)).slice(0, 24);
  }, [items, query]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  /* ---------------- Putting it on the bill ---------------- */

  const add = useCallback((item: Product) => {
    const fractional = UNITS.find((unit) => unit.id === item.unit)?.fractional ?? false;

    setLines((previous) => {
      const existing = previous.find((line) => line.id === item.id);

      // The same bottle scanned twice is two bottles, not two rows. A second
      // row for an item already on the bill is how a customer ends up
      // disputing a receipt that is actually correct.
      if (existing) {
        return previous.map((line) =>
          line.id === item.id
            ? { ...line, quantity: round3(line.quantity + (fractional ? 0.5 : 1)) }
            : line,
        );
      }

      return [
        ...previous,
        {
          id: item.id,
          name: item.name,
          urdu: item.urdu,
          // The catalog's own unit, which is what `sale_lines.unit` stores.
          // Shortened to "pc" or "kg" only where it is shown.
          unit: item.unit,
          quantity: 1,
          price: item.price,
          taxRate: item.taxRate,
          fractional,
        },
      ];
    });

    setNotice(null);
    setConfirmClear(false);
  }, []);

  /**
   * Enter in the search box — which is also every scan off a USB scanner.
   *
   * An exact barcode or SKU wins over the filtered list, because a scan is an
   * unambiguous statement about which item is on the counter and a substring
   * match is a guess. Only then does the top result get taken.
   */
  const submit = () => {
    const raw = query.trim();
    if (!raw) return;

    const exact = items.find(
      (item) =>
        item.barcode === raw || item.sku.toLowerCase() === raw.toLowerCase(),
    );

    const hit = exact ?? results[0];

    if (!hit) {
      setNotice(
        `Nothing in the list matches “${raw}”. Add it on Products & stock, or check the spelling.`,
      );
      return;
    }

    add(hit);
    setQuery("");
  };

  /** A code off the tablet camera. Only a real barcode match counts — a
   *  decoder that read one digit wrong must not sell the wrong thing. */
  const acceptScan = (code: string) => {
    setScanning(false);

    const hit = items.find((item) => item.barcode === code);

    if (!hit) {
      setQuery(code);
      setNotice(
        `Scanned ${code}, which is not on any item yet. Add it on Products & stock.`,
      );
      focusSearch();
      return;
    }

    add(hit);
    focusSearch();
  };

  const setQuantity = (id: string, value: string) =>
    setLines((previous) =>
      previous.map((line) => {
        if (line.id !== id) return line;
        const quantity = parseQuantity(value, line.fractional);
        // A quantity that will not parse leaves the line alone rather than
        // zeroing it — mid-typing, "0." is not an instruction to delete.
        return quantity === null ? line : { ...line, quantity };
      }),
    );

  const step = (id: string, direction: 1 | -1) =>
    setLines((previous) =>
      previous.flatMap((line) => {
        if (line.id !== id) return [line];

        const quantity = round3(
          line.quantity + direction * (line.fractional ? 0.25 : 1),
        );

        // Stepping past zero takes the line off the bill, which is what the
        // cashier meant — nobody presses minus five times to reach nothing.
        return quantity > 0 ? [{ ...line, quantity }] : [];
      }),
    );

  const remove = (id: string) =>
    setLines((previous) => previous.filter((line) => line.id !== id));

  const clear = () => {
    if (!confirmClear) return setConfirmClear(true);
    setLines([]);
    setCustomer(null);
    setConfirmClear(false);
    focusSearch();
  };

  /* ---------------- Settling ---------------- */

  // The sale's id, minted on the tablet the moment the payment sheet opens. It
  // is what makes a retry a replay rather than a second bill: `record_sale`
  // hands back the receipt the first attempt issued instead of claiming
  // another number. Re-minted for every new bill, never reused.
  const saleId = useRef<string>("");

  const toast = useToast();

  const tendered = async (
    tender: TenderId,
    given: number | null,
    change: number,
    force: boolean,
  ): Promise<string | null> => {
    const frozen = lines.map((line) => ({ ...line }));

    // Printing an unrecorded sale is the escape hatch, taken only after the
    // write has already failed — so it never asks the server a second time.
    const result = force
      ? null
      : await recordSale({
          saleId: saleId.current,
          counterId: counter.id,
          tender,
          lines: frozen.map((line) => ({ id: line.id, quantity: line.quantity })),
          // The id only. The server re-reads the row, the same way it re-prices
          // every line — the browser says who, never what is true about them.
          customerId: customer?.id ?? null,
        }).catch(() => ({
          ok: false as const,
          error:
            "We could not reach Flo to record this sale. Check the connection and try again.",
        }));

    if (result && !result.ok) return result.error;

    const at = new Date();

    setSale({
      // The counter's own number when the sale was recorded; an unmistakable
      // stand-in when it was not, so a bill that is missing from the takings
      // can never be confused for one that is in them.
      receiptNo: result?.ok ? result.receiptNo : provisionalReceiptNumber(at),
      recorded: Boolean(result?.ok),
      at,
      // Frozen above. The cart is emptied on the next line, and a receipt that
      // re-read it would print the next customer's shopping.
      lines: frozen,
      // The name as it was when the bill was rung up, for the same reason
      // `sale_lines.name_snapshot` exists: the roll is a record of what
      // happened, not a view onto rows that can change afterwards.
      customer: customer ? customer.name : null,
      bill,
      // One tender, because the sheet takes one. A list all the same, so the
      // roll already draws a split bill the day the sheet can settle one.
      tenders: [{ method: tender, amount: bill.total }],
      tendered: given,
      change,
    });

    // The next person at the counter is the next person at the counter. A
    // customer left attached is how somebody else's shopping lands on a
    // regular's record.
    setCustomer(null);
    setLines([]);
    setPaying(false);
    saleId.current = "";

    // The receipt fills the screen behind this, so the toast is not how the
    // cashier finds out a sale went through — it is what is still on screen
    // after they close it, and the one place a bill that was printed but never
    // recorded says so once the roll is off the printer.
    if (result?.ok) {
      toast({ title: `Recorded ${result.receiptNo}`, tone: "good" });
    } else {
      toast({
        title: "Printed but not recorded",
        detail: "This bill is not in the day's takings. Ring it up again once Flo is back.",
        tone: "warn",
      });
    }

    return null;
  };

  const newSale = () => {
    setSale(null);
    setQuery("");
    setNotice(null);
    focusSearch();
  };

  // The scanner is a keyboard, so the box it types into has to be the one with
  // focus whenever no dialog is open.
  useEffect(() => {
    if (!scanning && !paying && !sale) focusSearch();
  }, [scanning, paying, sale, focusSearch]);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* ================= Finding things ================= */}
        <section className="pos-card flex min-w-0 flex-col">
          <div className="border-b border-orchid-100 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[13rem] flex-1">
                <span className="sr-only">Scan or search an item</span>
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
                <input
                  ref={searchRef}
                  className="pos-field pl-9"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setNotice(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submit();
                    }
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="Scan a barcode, or type a name, Urdu name or SKU"
                  autoComplete="off"
                  // The counter tablet's keyboard must not correct "atta" into
                  // "attar" halfway through a queue.
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>

              <button
                type="button"
                onClick={() => setScanning((on) => !on)}
                aria-pressed={scanning}
                className={`pos-btn ${scanning ? "pos-btn-primary" : "pos-btn-soft"}`}
              >
                <IconCamera className="h-4 w-4" />
                <span className="hidden sm:inline">Camera</span>
              </button>
            </div>

            {notice ? (
              <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-orchid-50 px-3 py-2 text-[0.8125rem] leading-relaxed text-graphite-700">
                <IconBarcode className="mt-0.5 h-4 w-4 flex-none text-orchid-700" />
                {notice}
              </p>
            ) : null}

            {scanning ? (
              <div className="mt-3">
                <BarcodeScanner
                  onRead={acceptScan}
                  onClose={() => {
                    setScanning(false);
                    focusSearch();
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* The list. Tapping is the second way in; the scanner is the first,
              and loose items have no barcode to scan at all. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="px-2 py-8 text-center text-[0.875rem] leading-relaxed text-graphite-500">
                {items.length === 0 ? (
                  <>
                    There is nothing in the item list yet, so this counter has
                    nothing to ring up. Add your first products on Products
                    &amp; stock, or bring your sheet in through Bulk import.
                  </>
                ) : (
                  <>
                    Nothing matches that. Check the spelling, or add the item on
                    Products &amp; stock.
                  </>
                )}
              </p>
            ) : (
              <ul className="space-y-1">
                {results.map((item) => {
                  const state = stockState(item);

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          add(item);
                          setQuery("");
                          focusSearch();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-orchid-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate font-medium text-graphite-900">
                              {item.name}
                            </span>
                            <span
                              dir="rtl"
                              className="shrink-0 text-[0.8125rem] text-graphite-500"
                            >
                              {item.urdu}
                            </span>
                          </span>

                          <span className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-graphite-500">
                            <span className="font-mono">{item.sku}</span>
                            {state === "out" ? (
                              <span className="pos-badge pos-badge-bad">Out</span>
                            ) : state === "low" ? (
                              <span className="pos-badge pos-badge-warn">Low</span>
                            ) : null}
                          </span>
                        </span>

                        <span className="flex-none text-right">
                          <span className="block font-display text-[0.875rem] font-semibold tabular-nums">
                            {money(item.price)}
                          </span>
                          <span className="block text-[0.6875rem] text-graphite-500">
                            per {unitShort(item.unit)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!query.trim() ? (
            <p className="border-t border-orchid-100 px-4 py-2.5 text-[0.75rem] text-graphite-500">
              Showing {results.length} of {items.length}. Scan, or start typing.
            </p>
          ) : null}
        </section>

        {/* ================= The bill ================= */}
        <section className="pos-card flex min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]">
          <header className="flex items-center gap-2 border-b border-orchid-100 px-4 py-3">
            <IconCart className="h-4 w-4 flex-none text-orchid-700" />
            <h2 className="flex-1 font-display text-[0.9375rem] leading-tight font-semibold">
              This bill
            </h2>

            {lines.length > 0 ? (
              <button
                type="button"
                onClick={clear}
                onBlur={() => setConfirmClear(false)}
                className={`pos-btn pos-btn-sm ${confirmClear ? "pos-btn-primary" : "pos-btn-quiet"}`}
              >
                {confirmClear ? "Tap again to clear" : "Clear"}
              </button>
            ) : null}
          </header>

          <CustomerBar
            customers={customers}
            chosen={customer}
            onChoose={(next) => {
              setCustomer(next);
              focusSearch();
            }}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <p className="px-4 py-10 text-center text-[0.875rem] leading-relaxed text-graphite-500">
                Nothing on the bill yet.
                <span className="mt-1 block text-[0.75rem]">
                  Scan an item, or tap it in the list.
                </span>
              </p>
            ) : (
              <ul className="divide-y divide-orchid-100">
                {lines.map((line) => (
                  <li key={line.id} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[0.875rem] leading-snug font-medium text-graphite-900">
                        {line.name}
                      </p>

                      <button
                        type="button"
                        onClick={() => remove(line.id)}
                        className="pos-icon-btn h-7 w-7 flex-none"
                        aria-label={`Take ${line.name} off the bill`}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => step(line.id, -1)}
                          className="pos-icon-btn h-8 w-8"
                          aria-label={`Fewer ${line.name}`}
                        >
                          <IconMinus className="h-3.5 w-3.5" />
                        </button>

                        <QuantityInput
                          line={line}
                          onChange={(value) => setQuantity(line.id, value)}
                        />

                        <button
                          type="button"
                          onClick={() => step(line.id, 1)}
                          className="pos-icon-btn h-8 w-8"
                          aria-label={`More ${line.name}`}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                        </button>

                        <span className="ml-0.5 text-[0.75rem] text-graphite-500">
                          {unitShort(line.unit)}
                        </span>
                      </div>

                      <span className="ml-auto text-right">
                        <span className="block font-display text-[0.9375rem] font-semibold tabular-nums">
                          {money(lineTotal(line))}
                        </span>
                        <span className="block text-[0.6875rem] text-graphite-500 tabular-nums">
                          {money(line.price)} each
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- What it comes to ---- */}
          <footer className="border-t border-orchid-100 px-4 py-3.5">
            <dl className="space-y-1.5 text-[0.8125rem]">
              <Figure label="Subtotal" value={money(bill.subtotal)} />

              {bill.taxIncluded > 0 ? (
                <Figure
                  label="Sales tax, already included"
                  value={money(bill.taxIncluded)}
                  quiet
                />
              ) : null}

              <div className="flex items-baseline justify-between gap-2 border-t border-orchid-100 pt-2.5">
                <dt className="font-display text-[0.9375rem] font-semibold">
                  Total
                </dt>
                <dd className="font-display text-[1.375rem] leading-none font-bold tracking-tight tabular-nums text-graphite-900">
                  {money(bill.total)}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => {
                saleId.current = newSaleId();
                setPaying(true);
              }}
              disabled={lines.length === 0}
              className="pos-btn pos-btn-primary mt-3.5 w-full py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Charge {lines.length > 0 ? money(bill.total) : ""}
            </button>
          </footer>
        </section>
      </div>

      {paying ? (
        <PaymentSheet
          bill={bill}
          counter={counter}
          settings={settings}
          onClose={() => {
            setPaying(false);
            // A bill that was never tendered keeps no id. Reusing it on the
            // next customer would make `record_sale` replay this one and hand
            // back a receipt for shopping nobody bought.
            saleId.current = "";
          }}
          onTender={tendered}
        />
      ) : null}

      {sale ? (
        <SaleDone
          sale={sale}
          shop={shop}
          counter={counter}
          settings={settings}
          onDone={newSale}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Who the bill is for.
 *
 * One line at the top of the bill, and a walk-in by default — because a walk-in
 * is most bills in most shops, and a register that asks for a name before it
 * will charge is a register with a queue behind it. Attaching somebody is a tap
 * and a search; the till never insists.
 *
 * The search is `matchesCustomer`, shared with the Customers screen, so
 * somebody the owner can find is somebody the cashier can find. Phone digits
 * match without their spaces: a cashier reading the number off the customer's
 * own screen types the spaces that are printed on it.
 *
 * It closes on a choice, unlike the catalog's filter menu — picking a customer
 * is one decision and the cashier's hands are needed back on the scanner.
 */
function CustomerBar({
  customers,
  chosen,
  onChoose,
}: {
  customers: Customer[];
  chosen: Customer | null;
  onChoose: (next: Customer | null) => void;
}) {
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return customers.slice(0, 8);
    return customers.filter((entry) => matchesCustomer(entry, raw)).slice(0, 12);
  }, [customers, query]);

  // Nobody on the list yet is not an error and does not get a control. A shop
  // that has never added a customer sees nothing here at all rather than a
  // button that opens an empty box.
  if (customers.length === 0 && !chosen) return null;

  const pick = (next: Customer | null) => {
    onChoose(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative border-b border-orchid-100 px-4 py-2" ref={ref}>
      <div className="flex items-center gap-2">
        <IconUser className="h-3.5 w-3.5 flex-none text-graphite-500" aria-hidden />

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 truncate text-left text-[0.8125rem] text-graphite-700 underline-offset-2 hover:underline"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {chosen ? (
            <>
              <span className="font-medium text-graphite-900">{chosen.name}</span>
              {chosen.phone ? (
                <span className="ml-1.5 font-mono text-[0.75rem] text-graphite-500">
                  {writePhone(chosen.phone)}
                </span>
              ) : null}
            </>
          ) : (
            "Walk-in customer — tap to attach one"
          )}
        </button>

        {chosen ? (
          <button
            type="button"
            onClick={() => pick(null)}
            className="pos-filter-tag-x flex-none"
            aria-label={`Take ${chosen.name} off this bill`}
          >
            <IconClose className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="pos-menu pos-menu-panel" role="dialog" aria-label="Attach a customer">
          <div className="pos-menu-head">
            <span className="pos-menu-title">Who is this bill for?</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="pos-filter-tag-x"
              aria-label="Close"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>

          <input
            className="pos-field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or phone"
            aria-label="Search customers"
            autoComplete="off"
            autoFocus
          />

          <ul className="mt-2 max-h-56 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-1 py-3 text-[0.8125rem] text-graphite-500">
                Nobody matches that. Add them on Customers — it takes a name and
                a number.
              </li>
            ) : (
              results.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => pick(entry)}
                    className="pos-menu-item w-full text-left"
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.phone ? (
                      <span className="ml-2 flex-none font-mono text-[0.75rem] text-graphite-500">
                        {writePhone(entry.phone)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>

          {chosen ? (
            <div className="pos-menu-foot">
              <button
                type="button"
                onClick={() => pick(null)}
                className="pos-btn pos-btn-quiet pos-btn-sm"
              >
                Make it a walk-in
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The sale is over: here is the roll, print it or start the next one.
 *
 * The dialog is what `@media print` leaves on the page, so what is on screen is
 * what comes out of the printer — a preview drawn separately is a preview that
 * eventually disagrees with the paper.
 */
function SaleDone({
  sale,
  shop,
  counter,
  settings,
  onDone,
}: {
  sale: Sale;
  shop: ShopProfile;
  counter: Counter;
  settings: ShopSettings;
  onDone: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };

    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onDone]);

  // A frame before printing. `window.print()` snapshots the page synchronously,
  // and called straight out of the effect it can catch the dialog mid-paint and
  // send a blank roll through a printer nobody is watching.
  useEffect(() => {
    if (!counter.autoPrint) return;

    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [counter.autoPrint]);

  return (
    <div className="pos-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Receipt ${sale.receiptNo}`}
        className="pos-sheet outline-none"
      >
        <header className="print-hide flex items-center gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span
            className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
              sale.recorded
                ? "bg-signal-good/15 text-signal-good"
                : "bg-signal-warn/15 text-signal-warn"
            }`}
          >
            {sale.recorded ? (
              <IconCheck className="h-[18px] w-[18px]" />
            ) : (
              <IconAlert className="h-[18px] w-[18px]" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              {sale.recorded ? "Sale done" : "Printed, not recorded"}
            </h2>
            <p className="mt-0.5 font-mono text-[0.75rem] text-graphite-500">
              {sale.receiptNo}
            </p>
          </div>

          <button
            type="button"
            onClick={onDone}
            className="pos-icon-btn"
            aria-label="Close and start the next sale"
          >
            <IconClose />
          </button>
        </header>

        <div className="px-4 py-5 sm:px-5">
          {/* The roll's own width on screen too, so nothing lines up here that
              will wrap on paper. */}
          <div className="mx-auto max-w-[19rem] rounded-xl border border-orchid-100 bg-paper-50 p-4 font-mono text-[0.75rem] leading-relaxed text-graphite-900">
            <Receipt
              sale={sale}
              shop={shop}
              counter={counter}
              settings={settings}
            />
          </div>
        </div>

        <footer className="print-hide flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => window.print()}
            className="pos-btn pos-btn-soft"
          >
            <IconPrinter className="h-4 w-4" />
            Print again
          </button>

          <button type="button" onClick={onDone} className="pos-btn pos-btn-primary">
            Next sale
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The quantity box.
 *
 * It holds the text as typed rather than the parsed number, because "0.75 kg"
 * is typed one character at a time and "0." is not a quantity. Echoing the
 * parsed value straight back would snap the field to "0" mid-keystroke and
 * make a weighed line impossible to type — the cashier would get "075".
 *
 * The draft is dropped on blur, so anything that never parsed (a stray letter,
 * a half-typed decimal) falls back to what is actually on the bill instead of
 * sitting there looking like it was accepted.
 */
function QuantityInput({
  line,
  onChange,
}: {
  line: CartLine;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <label className="relative">
      <span className="sr-only">{line.name} quantity</span>
      <input
        className="pos-field pos-qty"
        value={draft ?? String(line.quantity)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(null)}
        inputMode={line.fractional ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={`${line.name} quantity in ${unitShort(line.unit)}`}
      />
    </label>
  );
}

/** A line in the bill's footer. */
function Figure({
  label,
  value,
  quiet = false,
}: {
  label: string;
  value: string;
  quiet?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className={quiet ? "text-graphite-500" : "text-graphite-700"}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${quiet ? "text-graphite-500" : "font-medium text-graphite-900"}`}
      >
        {value}
      </dd>
    </div>
  );
}
