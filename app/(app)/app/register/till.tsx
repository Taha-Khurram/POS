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
 * because a scanner firing into a closed dialog is a scan that vanished — and
 * the matches hang under it as a dropdown that is closed until something is
 * typed, so the screen at rest is the bill and nothing else.
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

  // The list hangs off the search box and nothing else. It used to sit open
  // beside the bill showing the first twelve rows of the catalog, which for a
  // shop with four hundred items is a wall to read past rather than a way in —
  // and the two ways in are the scanner and this box. Nothing is offered until
  // somebody asks for something.
  const {
    ref: finder,
    open: listOpen,
    setOpen: setListOpen,
  } = useDismiss<HTMLDivElement>();

  // Which row Enter would take. Not the same thing as the row under the
  // pointer: a cashier arrowing down the list has their hands on the keyboard
  // and their eyes on the counter.
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // `matchesProduct` is the catalog screen's own matcher, not a copy of it: a
  // cashier who cannot find an item the owner can see assumes it is not in the
  // list and adds it a second time. It searches the barcode alongside the name
  // because the fastest way to find something at the counter is to scan it.
  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return [];

    return items.filter((item) => matchesProduct(item, raw)).slice(0, 24);
  }, [items, query]);

  const showResults = listOpen && results.length > 0;

  // Arrowing past the bottom of the list has to move the list.
  useEffect(() => {
    if (!showResults) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [showResults, active]);

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

  /** Take an item off the list: on the bill, box emptied, list shut, focus
   *  back where the scanner types. */
  const take = (item: Product) => {
    add(item);
    setQuery("");
    setListOpen(false);
    focusSearch();
  };

  /**
   * Enter in the search box — which is also every scan off a USB scanner.
   *
   * An exact barcode or SKU wins over the filtered list, because a scan is an
   * unambiguous statement about which item is on the counter and a substring
   * match is a guess. Only then does the row the cashier arrowed to get taken.
   */
  const submit = () => {
    const raw = query.trim();
    if (!raw) return;

    const exact = items.find(
      (item) =>
        item.barcode === raw || item.sku.toLowerCase() === raw.toLowerCase(),
    );

    const hit = exact ?? results[active] ?? results[0];

    if (!hit) {
      setNotice(
        `Nothing in the list matches “${raw}”. Add it on Products & stock, or check the spelling.`,
      );
      return;
    }

    take(hit);
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

    take(hit);
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

  /**
   * The keyboard in the search box.
   *
   * Arrows walk the list without the hands leaving it, Enter takes whatever
   * `submit` decides, and Escape shuts the list before it empties the box —
   * two different things, and a cashier who meant the first would lose a typed
   * name to the second.
   */
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!showResults) return;
      event.preventDefault();

      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.min(results.length - 1, Math.max(0, index + step)),
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === "Escape") {
      if (showResults) setListOpen(false);
      else setQuery("");
    }
  };

  return (
    <>
      {/* The till is the screen, not a panel on it: it takes the window's
          whole height so the bill grows downwards into room that is already
          there and the Charge bar stays where the hand expects it, rather
          than sliding down the page as lines are added. */}
      <section className="pos-card flex min-h-[30rem] w-full flex-col lg:h-[calc(100dvh-11.25rem)]">
        {/* ================= Finding things ================= */}
        <div className="border-b border-orchid-100 p-3" ref={finder}>
          <div className="relative flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Scan or search an item</span>
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
              <input
                ref={searchRef}
                className="pos-field py-2.5 pl-9 text-[0.9375rem]"
                role="combobox"
                aria-expanded={showResults}
                aria-controls="till-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  showResults ? `till-result-${active}` : undefined
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                  setListOpen(true);
                  setNotice(null);
                }}
                onKeyDown={onSearchKeyDown}
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
              className={`pos-btn flex-none ${scanning ? "pos-btn-primary" : "pos-btn-soft"}`}
            >
              <IconCamera className="h-4 w-4" />
              <span className="hidden sm:inline">Camera</span>
            </button>

            {/* What was searched for, and nothing else. Tapping a row is the
                second way in; the scanner is the first, and loose items have
                no barcode to scan at all. */}
            {showResults ? (
              <ul
                id="till-results"
                ref={listRef}
                role="listbox"
                aria-label="Matching items"
                className="pos-menu pos-select-menu"
              >
                {results.map((item, index) => {
                  const state = stockState(item);

                  return (
                    <li
                      key={item.id}
                      id={`till-result-${index}`}
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      className="pos-option"
                      // Focus stays in the box the scanner types into. A row
                      // that could take it would swallow the next scan.
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerEnter={() => setActive(index)}
                      onClick={() => take(item)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-medium">
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
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {notice ? (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-orchid-50 px-3 py-2 text-[0.8125rem] leading-relaxed text-graphite-700">
              <IconBarcode className="mt-0.5 h-4 w-4 flex-none text-orchid-700" />
              {notice}
            </p>
          ) : null}

          {/* An empty catalog is worth saying once, where the searching
              happens — a box that finds nothing whatever is typed otherwise
              reads as a broken search. */}
          {items.length === 0 ? (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-graphite-500">
              There is nothing in the item list yet, so this counter has nothing
              to ring up. Add your first products on Products &amp; stock, or
              bring your sheet in through Bulk import.
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

        {/* ================= The bill ================= */}
        {/* One row, not three: the heading, who the bill is for, and the way
            off it. Each of those was a band across the card of its own, and
            three bands above an empty table is a screen that looks busier than
            the job it is doing. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-orchid-100 px-3 py-2">
          <IconCart className="h-4 w-4 flex-none text-orchid-700" />
          <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
            This bill
          </h2>

          <CustomerBar
            className="ml-auto w-full sm:w-72"
            customers={customers}
            chosen={customer}
            onChoose={(next) => {
              setCustomer(next);
              focusSearch();
            }}
          />

          {lines.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              onBlur={() => setConfirmClear(false)}
              className={`pos-btn pos-btn-sm flex-none ${confirmClear ? "pos-btn-primary" : "pos-btn-quiet"}`}
            >
              {confirmClear ? "Tap again to clear" : "Clear"}
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {lines.length === 0 ? (
            <p className="grid h-full place-content-center px-4 py-10 text-center text-[0.875rem] leading-relaxed text-graphite-500">
              Nothing on the bill yet.
              <span className="mt-1 block text-[0.75rem]">
                Scan an item, or search for it above.
              </span>
            </p>
          ) : (
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Price</th>
                  <th>
                    <span className="sr-only">Take off the bill</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="whitespace-normal">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-graphite-900">
                          {line.name}
                        </span>
                        <span
                          dir="rtl"
                          className="text-[0.8125rem] text-graphite-500"
                        >
                          {line.urdu}
                        </span>
                      </span>

                      {/* What one of them costs. The column two over is what
                          the line comes to, and on three kilos of anything the
                          two are not the same number. */}
                      <span className="mt-0.5 block text-[0.75rem] tabular-nums text-graphite-500">
                        {money(line.price)} per {unitShort(line.unit)}
                      </span>
                    </td>

                    <td>
                      <div className="flex items-center justify-end gap-1">
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

                        <span className="ml-0.5 w-5 text-left text-[0.75rem] text-graphite-500">
                          {unitShort(line.unit)}
                        </span>
                      </div>
                    </td>

                    <td className="pos-num font-display text-[0.9375rem] font-semibold text-graphite-900">
                      {money(lineTotal(line))}
                    </td>

                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => remove(line.id)}
                        className="pos-icon-btn h-8 w-8"
                        aria-label={`Take ${line.name} off the bill`}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ---- What it comes to ---- */}
        {/* Across the foot of the card rather than stacked in a corner of it.
            The total and the button that takes the money are the two things a
            cashier looks at without looking away from the customer, so they
            sit at the same height, at the end of the line, every time. */}
        <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-orchid-100 px-4 py-3">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
            <Figure label="Subtotal" value={money(bill.subtotal)} />

            {bill.taxIncluded > 0 ? (
              <Figure
                label="Sales tax, already included"
                value={money(bill.taxIncluded)}
                quiet
              />
            ) : null}
          </dl>

          <div className="ml-auto flex flex-1 items-center justify-end gap-4 sm:flex-none">
            <div className="text-right">
              <p className="text-[0.75rem] leading-none text-graphite-500">
                Total
              </p>
              <p className="mt-1 font-display text-[1.625rem] leading-none font-bold tracking-tight tabular-nums text-graphite-900">
                {money(bill.total)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                saleId.current = newSaleId();
                setPaying(true);
              }}
              disabled={lines.length === 0}
              className="pos-btn pos-btn-primary px-8 py-3 text-[1rem] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Charge
            </button>
          </div>
        </footer>
      </section>

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
 * One field in the bill's own header, and a walk-in by default — because a
 * walk-in is most bills in most shops, and a register that asks for a name
 * before it will charge is a register with a queue behind it. Attaching
 * somebody is typing into it; the till never insists.
 *
 * The same combobox as the item box above it, for the same reason: a cashier
 * types a name and picks it off a list, rather than opening something, typing,
 * picking and closing it. Focusing the field offers the shop's regulars
 * straight away, which an item list of four hundred rows could not do and a
 * customer list can.
 *
 * The search is `matchesCustomer`, shared with the Customers screen, so
 * somebody the owner can find is somebody the cashier can find. Phone digits
 * match without their spaces: a cashier reading the number off the customer's
 * own screen types the spaces that are printed on it.
 *
 * Once somebody is attached the field becomes their name, because a bill is
 * for one person and a box still inviting a search would read as though nobody
 * were on it. The × puts it back.
 */
function CustomerBar({
  customers,
  chosen,
  onChoose,
  className = "",
}: {
  customers: Customer[];
  chosen: Customer | null;
  onChoose: (next: Customer | null) => void;
  /** Where it sits in the header row. The control has no margins of its own —
   *  it is one item in that row, not a band across the card. */
  className?: string;
}) {
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const raw = query.trim();
    if (!raw) return customers.slice(0, 8);
    return customers.filter((entry) => matchesCustomer(entry, raw)).slice(0, 12);
  }, [customers, query]);

  const showResults = open && results.length > 0;

  useEffect(() => {
    if (!showResults) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [showResults, active]);

  // Nobody on the list yet is not an error and does not get a control. A shop
  // that has never added a customer sees nothing here at all rather than a
  // field that can only come back empty.
  if (customers.length === 0 && !chosen) return null;

  const pick = (next: Customer | null) => {
    onChoose(next);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!open) {
        setOpen(true);
        return;
      }

      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.min(results.length - 1, Math.max(0, index + step)),
      );
      return;
    }

    if (event.key === "Enter") {
      // Never submits anything — the bill is charged from its own button, and
      // Enter here is only ever "this one".
      event.preventDefault();
      if (showResults && results[active]) pick(results[active]);
      return;
    }

    if (event.key === "Escape") {
      if (showResults) setOpen(false);
      else setQuery("");
    }
  };

  return (
    <div className={`pos-select-wrap ${className}`} ref={ref}>
      {chosen ? (
        <div className="pos-field flex items-center gap-2 py-1.5">
          <IconUser className="h-4 w-4 flex-none text-graphite-500" aria-hidden />

          <p className="min-w-0 flex-1 truncate text-[0.8125rem]">
            <span className="font-medium text-graphite-900">{chosen.name}</span>
            {chosen.phone ? (
              <span className="ml-1.5 font-mono text-[0.75rem] text-graphite-500">
                {writePhone(chosen.phone)}
              </span>
            ) : null}
          </p>

          <button
            type="button"
            onClick={() => pick(null)}
            className="pos-filter-tag-x flex-none"
            aria-label={`Take ${chosen.name} off this bill — make it a walk-in`}
          >
            <IconClose className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <label className="relative block">
          <span className="sr-only">Attach a customer to this bill</span>
          <IconUser className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
          <input
            className="pos-field py-1.5 pl-9 text-[0.8125rem]"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="till-customers"
            aria-autocomplete="list"
            aria-activedescendant={
              showResults ? `till-customer-${active}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            // The shop's regulars, offered before a letter is typed. The
            // cashier who knows the face but not the spelling is the reason.
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Walk-in — search a name or phone"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      )}

      {showResults ? (
        <ul
          id="till-customers"
          ref={listRef}
          role="listbox"
          aria-label="Customers"
          className="pos-menu pos-select-menu"
        >
          {results.map((entry, index) => (
            <li
              key={entry.id}
              id={`till-customer-${index}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              className="pos-option"
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(entry)}
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.phone ? (
                <span className="flex-none font-mono text-[0.75rem] text-graphite-500">
                  {writePhone(entry.phone)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Said under the field rather than in a menu nobody opened: a name that
          is not on the list is a customer who has not been added, and the
          cashier needs to know that without losing what they typed. */}
      {open && results.length === 0 ? (
        <p className="pos-menu pos-select-menu p-3 text-[0.75rem] leading-relaxed text-graphite-500">
          Nobody matches that. Add them on Customers — it takes a name and a
          number — or leave this bill as a walk-in.
        </p>
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

/** A figure in the bill's footer bar, label then value on one line. */
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
    <div className="flex items-baseline gap-2">
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
