"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  IconAlert,
  IconBarcode,
  IconCart,
  IconCheck,
  IconClose,
  IconMinus,
  IconPause,
  IconPercent,
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
  discountOf,
  lineTotal,
  moneyFormatter,
  NO_DISCOUNT,
  parseDiscount,
  parseQuantity,
  newSaleId,
  provisionalReceiptNumber,
  round3,
  roundOffs,
  stockLeft,
  type CartLine,
  type Counter,
  type Discount,
  cartKey,
  type TenderPart,
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
import {
  heldAge,
  heldTitle,
  HELD_LABEL_MAX,
  isStale,
  type HeldBill,
} from "@/lib/pos/held";
import type { TillAccess } from "@/lib/pos/modules";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import {
  priceOf,
  sellableVariants,
  writeVariant,
  type Variant,
} from "@/lib/pos/variant";
import { recordSale } from "./actions";
import { dropHeldBill, holdBill } from "./hold-actions";
import { PaymentSheet } from "./payment-sheet";
import { Receipt, type Sale } from "./receipt";
import { VariantPicker } from "./variant-picker";

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
  variants,
  customers,
  counter,
  shop,
  settings,
  access,
  held,
  drawerOpen,
}: {
  items: Product[];
  /** Every live variant in the shop, by item id. Read whole on the server, for
   *  the reason the item list is: a cloth house's cashier picks a size from a
   *  grid and a round trip per tap is a grid nobody uses. Empty for a shop that
   *  sells nothing by variant, which is most of them. */
  variants: Map<string, Variant[]>;
  /** Everyone the till may put a bill against — the shop's own, minus the ones
   *  switched off. Attaching one is optional and stays that way: most bills in
   *  most shops are a walk-in, and a register that insists on a name before it
   *  will charge is a register with a queue behind it. */
  customers: Customer[];
  counter: Counter;
  shop: ShopProfile;
  settings: ShopSettings;
  /** What this cashier may do at the counter — resolved on the server from the
   *  stored permissions, and re-checked by every action it unlocks. What
   *  crosses here is the answer, never the permissions row behind it. */
  access: TillAccess;
  /** The bills already parked at this till, oldest first. Read on the server
   *  and refreshed by the `revalidatePath` the hold actions fire, so the tray
   *  never has to poll. */
  held: HeldBill[];
  /** Whether a drawer is open on this counter. Nothing can be charged without
   *  one: the money has to land in a drawer somebody has counted into and will
   *  count out of, or the shift figures are a subset of the day and mean
   *  nothing. The Server Action refuses for itself as well. */
  drawerOpen: boolean;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Which item's grid is open, if any. A variant item cannot go straight on the
  // bill — the customer is buying a size, not the line — so `add` opens this
  // instead and the choice comes back through `add(item, variant)`.
  const [picking, setPicking] = useState<Product | null>(null);

  /**
   * What this tablet has sold since the page loaded, per item.
   *
   * `items` is read once by the server component and does not follow the shop,
   * so without this the shelf note would go on promising "4 left" through four
   * consecutive sales of the same thing. Re-fetching the catalog after every
   * bill would be the obvious fix and the wrong one — four hundred rows down
   * shop 3G between one customer and the next is exactly the round trip this
   * screen is built to avoid.
   *
   * It only knows about this tablet. The counter by the door is selling from
   * the same shelf and this will never hear about it, which is why the note it
   * feeds is worded as what Flo counts rather than as what is there.
   */
  const [sold, setSold] = useState<Record<string, number>>({});

  const searchRef = useRef<HTMLInputElement>(null);

  const money = moneyFormatter(settings);

  // What the cashier agreed to, as they said it. Resolved to rupees against
  // their own ceiling by `discountOf` — the same function the Server Action
  // runs again on the way in, so the figure on screen is the figure charged.
  const [discount, setDiscount] = useState<Discount>(NO_DISCOUNT);

  const bill = useMemo(() => {
    const gross = billOf(lines);
    const off = access.canDiscount
      ? discountOf(gross.subtotal, discount, access.discountCeilingPct)
      : 0;

    return billOf(lines, off);
  }, [lines, discount, access]);

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

  const add = useCallback((item: Product, variant?: Variant) => {
    const grid = variants.get(item.id) ?? [];

    // A variant item with a grid is never added directly: the customer is
    // buying a medium blue and the till has to be told which. An item *set* to
    // variant whose grid nobody has built yet falls through and sells as one
    // line, which is the honest reading of a grid that does not exist.
    if (!variant && grid.length > 0) {
      setPicking(item);
      setNotice(null);
      return;
    }

    const key = cartKey(item.id, variant?.id);
    const fractional = UNITS.find((unit) => unit.id === item.unit)?.fractional ?? false;

    // A variant's shelf is its own row's, not the item's total — the whole
    // point of the grid is that eight mediums and no larges is not "eight in
    // stock" for somebody asking for a large.
    const counted = variant ? variant.quantity : item.stock;
    const shelf = round3(counted - (sold[key] ?? 0));
    const label = variant ? writeVariant(variant) : "";
    const price = variant ? priceOf(variant, item.price) : item.price;

    // Nothing left to sell. Refused here rather than warned about, and said in
    // words that tell the cashier what to do next: the shelf count is what the
    // till bills from, so an item at zero has to be counted in on Products &
    // stock before it can go on a bill.
    const onBill = lines.find((line) => line.id === key)?.quantity ?? 0;
    const step = fractional ? 0.5 : 1;
    const what = label ? `${item.name} (${label})` : item.name;

    if (round3(shelf - onBill) < step) {
      setNotice(
        onBill > 0
          ? `That is all the ${what} Flo counts — ${shelf.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(item.unit)}. Count the shelf in on Products & stock to sell more.`
          : `${what} is out of stock, so it cannot go on a bill. Count it in on Products & stock first.`,
      );
      return;
    }

    setLines((previous) => {
      const existing = previous.find((line) => line.id === key);

      // The same bottle scanned twice is two bottles, not two rows. A second
      // row for an item already on the bill is how a customer ends up
      // disputing a receipt that is actually correct. Two *different* sizes of
      // one item are two rows, because they are two things on the counter —
      // which is exactly what `cartKey` decides.
      if (existing) {
        return previous.map((line) =>
          line.id === key
            ? { ...line, quantity: round3(line.quantity + step) }
            : line,
        );
      }

      return [
        ...previous,
        {
          id: key,
          itemId: item.id,
          variantId: variant?.id ?? null,
          variantLabel: label,
          name: item.name,
          urdu: item.urdu,
          // The catalog's own unit, which is what `sale_lines.unit` stores.
          // Shortened to "pc" or "kg" only where it is shown.
          unit: item.unit,
          quantity: 1,
          price,
          taxRate: item.taxRate,
          fractional,
          // What the page loaded, less whatever this tablet has sold since.
          stock: shelf,
        },
      ];
    });

    setPicking(null);
    setNotice(null);
    setConfirmClear(false);
  }, [sold, lines, variants]);

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

        // Never past what the shelf has. The plus button stops rather than
        // taking the line somewhere the Charge button would then refuse — a
        // control that moves a number into an invalid state is a control that
        // makes the cashier work out why nothing happens next.
        if (direction === 1 && quantity > line.stock) {
          setNotice(
            `Flo counts ${line.stock.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(line.unit)} of ${line.name}. Count the shelf in on Products & stock to sell more.`,
          );
          return [line];
        }

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
    setDiscount(NO_DISCOUNT);
    // Clearing the screen does not drop the parked bill it came from. The
    // cashier who resumes one and then clears has changed their mind about
    // this screen, not about the shopping still sitting on the counter — the
    // bill stays in the tray until somebody settles it or drops it by name.
    resumed.current = null;
    setConfirmClear(false);
    focusSearch();
  };

  /* ---------------- Settling ---------------- */

  /**
   * Why this bill cannot be charged, or null when it can.
   *
   * One string rather than a handful of booleans, because it is both the
   * disabled state and the sentence printed under the footer — a button that
   * is dead for a reason nobody states is a button a cashier taps three times
   * and then calls the owner about. The empty string is the one case that
   * needs no words: nothing on the bill yet.
   *
   * The order is the order a cashier can act on. A shut drawer is the first
   * thing to fix and applies to the whole bill; a line over the shelf count is
   * last, because it names an item and a number.
   */
  const short = lines.find((line) => stockLeft(line) < 0);

  const blocked: string | null =
    lines.length === 0
      ? ""
      : !drawerOpen
        ? "Open the drawer at the top of this screen before charging anything — a sale has to land in a till somebody has counted into."
        : short
          ? `Flo counts ${short.stock.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(short.unit)} of ${short.name} and this bill has ${short.quantity.toLocaleString("en-PK", { maximumFractionDigits: 3 })}. Lower it, or count the shelf in on Products & stock.`
          : null;

  // The sale's id, minted on the tablet the moment the payment sheet opens. It
  // is what makes a retry a replay rather than a second bill: `record_sale`
  // hands back the receipt the first attempt issued instead of claiming
  // another number. Re-minted for every new bill, never reused.
  const saleId = useRef<string>("");

  const toast = useToast();

  const tendered = async (
    parts: TenderPart[],
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
          tenders: parts,
          lines: frozen.map((line) => ({
            id: line.itemId,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          // The id only. The server re-reads the row, the same way it re-prices
          // every line — the browser says who, never what is true about them.
          customerId: customer?.id ?? null,
          // As the cashier said it. The ceiling is applied again on that side
          // against this session's own permissions, never against anything
          // sent from here.
          discount,
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
      // Whatever the sheet settled with: one part on almost every bill, two
      // when somebody put half on a card. The roll has been able to draw a
      // split since it was written; `0032` is what finally produces one.
      tenders: parts.map((part) => ({
        method: part.method,
        amount: part.amount,
      })),
      tendered: given,
      change,
    });

    // Off this tablet's running count of the shelf, but only for a sale that
    // was actually recorded — a bill printed without being written down has
    // not moved `items.stock` either, and pretending otherwise here would make
    // the next customer's shelf note wrong in the same direction twice.
    if (result?.ok) {
      setSold((previous) => {
        const next = { ...previous };
        for (const line of frozen) {
          next[line.id] = round3((next[line.id] ?? 0) + line.quantity);
        }
        return next;
      });
    }

    // A bill that was picked up off the tray and has now been paid for is no
    // longer on hold. Dropped after the sale is recorded and never before: a
    // parked bill removed first and a sale that then failed to write is
    // shopping nobody can account for.
    //
    // Fire and forget — the sale is already recorded and the receipt is on its
    // way to the printer, and blocking that on a tidy-up is the wrong order.
    // A row left behind is a stale bill in the tray, which is visible and
    // droppable; a receipt delayed is a queue.
    if (result?.ok && resumed.current) {
      const parked = resumed.current;
      resumed.current = null;
      void dropHeldBill(parked).catch(() => {});
    }

    // The next person at the counter is the next person at the counter. A
    // customer left attached is how somebody else's shopping lands on a
    // regular's record.
    setCustomer(null);
    setLines([]);
    // The next customer did not haggle. A discount left standing is the
    // cheapest way to give a shop's margin away all afternoon.
    setDiscount(NO_DISCOUNT);
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

  /* ---------------- Putting a bill down ---------------- */

  /**
   * Which parked bill is on the screen, if any.
   *
   * A bill picked up keeps its id, so putting it back down again — the cashier
   * who resumed it, added the dahi and was asked to wait again — updates the
   * row it came from rather than leaving a stale copy beside it. Cleared on a
   * completed sale and on Clear, because both of those end the bill.
   */
  const resumed = useRef<string | null>(null);
  const [parking, setParking] = useState(false);
  const [tray, setTray] = useState(false);

  const park = async (label: string) => {
    const id = resumed.current ?? newSaleId();

    const result = await holdBill({
      id,
      counterId: counter.id,
      label,
      customerId: customer?.id ?? null,
      // Ids and quantities. The prices are deliberately not sent: resuming
      // re-prices from the catalog, the same way recording a sale does.
      lines: lines.map((line) => ({
        // The catalog row and which one of it. The action re-prices both from
        // the shop's own rows — the browser never decides what anything costs.
        id: line.itemId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
      discount,
    }).catch(() => ({
      ok: false as const,
      error: "We could not reach Flo to put this bill down. Check the connection.",
    }));

    if (!result.ok) {
      toast({ title: "Not put down", detail: result.error, tone: "bad" });
      return;
    }

    toast({
      title: label ? `${label} is on hold` : "Bill on hold",
      detail: "Pick it up from Held bills when they come back.",
      tone: "good",
    });

    setLines([]);
    setCustomer(null);
    setDiscount(NO_DISCOUNT);
    resumed.current = null;
    setParking(false);
    focusSearch();
  };

  /**
   * Picking one back up.
   *
   * Re-priced here, not restored: the stored bill is item ids and quantities,
   * and the prices come off the catalog the till already holds. That is what
   * makes a bill parked before a rate change settle at the rate on the shelf.
   *
   * An item withdrawn while the bill was down is dropped and said out loud
   * rather than quietly left out — a cashier who is not told is a cashier who
   * hands over shopping that is not on the receipt.
   */
  const resume = (bill: HeldBill) => {
    const restored: CartLine[] = [];
    const lost: string[] = [];

    for (const line of bill.lines) {
      const item = items.find((entry) => entry.id === line.itemId);

      if (!item) {
        lost.push(line.itemId);
        continue;
      }

      // The size or colour it was parked as, re-found in today's grid. A row
      // switched off while the bill was down is dropped like a withdrawn item
      // and said out loud — the customer's medium blue is not a large blue.
      const variant = line.variantId
        ? (variants.get(item.id) ?? []).find((one) => one.id === line.variantId)
        : undefined;

      if (line.variantId && !variant) {
        lost.push(item.name);
        continue;
      }

      const key = cartKey(item.id, variant?.id);
      const counted = variant ? variant.quantity : item.stock;

      restored.push({
        id: key,
        itemId: item.id,
        variantId: variant?.id ?? null,
        variantLabel: variant ? writeVariant(variant) : "",
        name: item.name,
        urdu: item.urdu,
        unit: item.unit,
        quantity: line.quantity,
        // Today's price, off today's catalog — the variant's own where it has
        // one, which is the same rule the till follows when adding fresh.
        price: variant ? priceOf(variant, item.price) : item.price,
        taxRate: item.taxRate,
        fractional: UNITS.find((unit) => unit.id === item.unit)?.fractional ?? false,
        stock: round3(counted - (sold[key] ?? 0)),
      });
    }

    setLines(restored);
    setCustomer(
      bill.customerId
        ? (customers.find((entry) => entry.id === bill.customerId) ?? null)
        : null,
    );
    setDiscount(access.canDiscount ? bill.discount : NO_DISCOUNT);
    resumed.current = bill.id;
    setTray(false);

    setNotice(
      lost.length === 0
        ? null
        : lost.length === 1
          ? "One item on that bill is no longer in the list and has been left off. Check the shopping against the screen."
          : `${lost.length} items on that bill are no longer in the list and have been left off. Check the shopping against the screen.`,
    );

    focusSearch();
  };

  const drop = async (bill: HeldBill) => {
    const result = await dropHeldBill(bill.id).catch(() => ({
      ok: false as const,
      error: "We could not reach Flo to drop that bill.",
    }));

    if (!result.ok) {
      toast({ title: "Not dropped", detail: result.error, tone: "bad" });
      return;
    }

    if (resumed.current === bill.id) resumed.current = null;
    toast({ title: `${heldTitle(bill)} dropped`, tone: "good" });
  };

  // The scanner is a keyboard, so the box it types into has to be the one with
  // focus whenever no dialog is open.
  useEffect(() => {
    if (!paying && !sale) focusSearch();
  }, [paying, sale, focusSearch]);

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
      {/* The till is the screen, not a panel on it: it takes whatever height
          the fitted page has left, so the bill grows downwards into room that
          is already there and the Charge bar stays where the hand expects it,
          rather than sliding down the page as lines are added. It is measured
          rather than calculated — the old `100dvh` minus a guess at the chrome
          was a number that went wrong the moment the shift strip appeared
          above it and put the Charge bar under the fold. */}
      <section className="pos-card flex min-h-[30rem] w-full flex-col lg:min-h-0 lg:flex-1">
        {/* ================= Finding things ================= */}
        <div className="flex-none border-b border-orchid-100 p-3" ref={finder}>
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

            {/* Beside the search box rather than down in the footer. The
                haggling happens while the shopping is still going on the
                counter, so the control belongs in the row the cashier's hand
                is already in — and it is rendered whenever this cashier may
                discount, disabled on an empty bill, so the row does not
                reflow the moment the first item is scanned. */}
            {access.canDiscount ? (
              <DiscountBar
                subtotal={bill.subtotal}
                taken={bill.discount}
                discount={discount}
                ceilingPct={access.discountCeilingPct}
                disabled={lines.length === 0}
                money={money}
                // Never refocuses. This fires on every keystroke in the
                // per cent and rupees boxes, and sending focus back to the
                // search box from here threw the cashier out of the field
                // after a single character.
                onChange={setDiscount}
                // The scanner is a keyboard, so focus does have to come back
                // to the search box — but only when the panel is deliberately
                // finished with, not while somebody is still typing in it.
                onDone={focusSearch}
              />
            ) : null}

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
        </div>

        {/* ================= The bill ================= */}
        {/* One row, not three: the heading, who the bill is for, and the way
            off it. Each of those was a band across the card of its own, and
            three bands above an empty table is a screen that looks busier than
            the job it is doing. */}
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-orchid-100 px-3 py-2">
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

          {/* The tray. Drawn whenever anything is parked at this till, whether
              or not there is a bill on screen — a cashier standing at an empty
              register is exactly who needs to pick one up. */}
          {held.length > 0 ? (
            <button
              type="button"
              onClick={() => setTray(true)}
              className="pos-btn pos-btn-sm pos-btn-soft flex-none"
            >
              <IconPause className="h-3.5 w-3.5" />
              Held
              <span className="pos-badge pos-badge-warn ml-0.5">{held.length}</span>
            </button>
          ) : null}

          {lines.length > 0 ? (
            <button
              type="button"
              onClick={() => setParking(true)}
              className="pos-btn pos-btn-sm pos-btn-quiet flex-none"
            >
              <IconPause className="h-3.5 w-3.5" />
              Hold
            </button>
          ) : null}

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
                {held.length > 0 ? (
                  <>
                    {" "}
                    {held.length === 1 ? "One bill is" : `${held.length} bills are`}{" "}
                    on hold at this counter.
                  </>
                ) : null}
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
                        {/* Which size or colour, beside the name rather than
                            under it: a customer disputing a receipt is looking
                            for the word "Medium", and a bill that buries it is
                            a bill the cashier has to explain. */}
                        {line.variantLabel ? (
                          <span className="pos-badge">{line.variantLabel}</span>
                        ) : null}
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
                        <ShelfNote line={line} />
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
        <footer className="flex flex-none flex-wrap items-center gap-x-6 gap-y-3 border-t border-orchid-100 px-4 py-3">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
            <Figure label="Subtotal" value={money(bill.subtotal)} />

            {bill.discount > 0 ? (
              <Figure
                label="Discount"
                value={`−${money(bill.discount)}`}
              />
            ) : null}

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
              disabled={Boolean(blocked)}
              // The reason travels with the button. A control that is dead and
              // silent is a control a cashier taps three times and then calls
              // the owner about.
              title={blocked ?? undefined}
              aria-describedby={blocked ? "charge-blocked" : undefined}
              className="pos-btn pos-btn-primary px-8 py-3 text-[1rem] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Charge
            </button>
          </div>
        </footer>

        {/* Said under the bar rather than inside the button, because it names
            an item and a number and neither fits on a button. An empty string
            is "nothing on the bill yet", which needs no explanation at all. */}
        {blocked ? (
          <p
            id="charge-blocked"
            role="status"
            className="flex flex-none items-start gap-2 border-t border-orchid-100 bg-signal-warn/5 px-4 py-2.5 text-[0.8125rem] leading-relaxed text-graphite-700"
          >
            <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
            {blocked}
          </p>
        ) : null}
      </section>

      {picking ? (
        <VariantPicker
          item={picking}
          variants={sellableVariants(variants.get(picking.id) ?? [])}
          sold={sold}
          money={money}
          onPick={(variant: Variant) => add(picking, variant)}
          onClose={() => setPicking(null)}
        />
      ) : null}

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

      {parking ? (
        <HoldSheet
          customer={customer?.name ?? ""}
          lines={bill.lines}
          total={money(bill.total)}
          onClose={() => setParking(false)}
          onHold={park}
        />
      ) : null}

      {tray ? (
        <HeldTray
          held={held}
          counter={counter}
          busy={lines.length > 0}
          onResume={resume}
          onDrop={drop}
          onClose={() => setTray(false)}
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
 * Taking something off the bill.
 *
 * Haggling is not an edge case in a Pakistani shop and a till that cannot do
 * it is a till the cashier works around — out of the drawer, or by ringing up
 * one item fewer — and a till that is worked around stops being the record of
 * what the shop sold. So it sits in the top row beside the search box, where
 * the cashier's hand already is, rather than in a payment screen that opens
 * once the money is already in somebody's hand.
 *
 * Drawn whenever this cashier may discount and disabled on an empty bill,
 * rather than appearing when the first item lands: a control that materialises
 * in the row holding focus reflows the box the scanner types into.
 *
 * Three ways in, in the order they are actually said across a counter:
 *
 *   - **"Make it 470."** The round-off buttons, which is the commonest
 *     discount there is and the one a cashier would otherwise do in their head
 *     with a queue watching. Only the roundings that are inside the ceiling are
 *     offered, so a button that is there is a button that works.
 *   - **"Ten per cent for you."** Typed as a percentage, resolved to rupees
 *     before it leaves the browser.
 *   - **"Twenty rupees off."** Typed as rupees.
 *
 * The ceiling is stated in both currencies — "up to 5% · Rs 23.90 on this
 * bill" — because a percentage is not a number a cashier can check a customer's
 * demand against while holding their shopping. Going over it is clamped rather
 * than refused, with the clamp said out loud: the owner's ceiling means "this
 * much and no more", and a cashier who types 50 and gets 23.90 with a line
 * explaining why has learnt the limit, where one who gets an error has learnt
 * that the discount button is unreliable.
 */
function DiscountBar({
  subtotal,
  taken,
  discount,
  ceilingPct,
  disabled,
  money,
  onChange,
  onDone,
}: {
  subtotal: number;
  /** What actually came off after the ceiling — not what was typed. */
  taken: number;
  discount: Discount;
  ceilingPct: number;
  /** Nothing on the bill yet. There is no figure to take anything off. */
  disabled: boolean;
  money: (amount: number) => string;
  /** Fires on every keystroke, so it must not move focus. */
  onChange: (next: Discount) => void;
  /**
   * The panel is finished with — put focus back where the scanner types.
   *
   * Only on Done, No discount and Escape. Deliberately not on an outside
   * click: that click landed somewhere the cashier chose, and yanking focus
   * out of it would be the same bug one step along.
   */
  onDone: () => void;
}) {
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();
  const [draft, setDraft] = useState("");

  const close = () => {
    setOpen(false);
    onDone();
  };

  const ceiling = Math.ceil(subtotal * Math.max(0, ceilingPct)) / 100;
  const roundings = roundOffs(subtotal, ceilingPct);

  // What was typed was more than the owner allows. Said rather than silently
  // applied: the cashier has to know the customer is not getting what they
  // asked for before they say the total out loud.
  const asked = discountOf(subtotal, discount, 100);
  const clamped = asked > taken;

  const set = (next: Discount) => {
    onChange(next);
    setDraft(next.value > 0 ? String(next.value) : "");
  };

  const type = (value: string, kind: Discount["kind"]) => {
    setDraft(value);
    const parsed = parseDiscount(value, kind);
    // Unparseable leaves the bill alone rather than zeroing it — mid-typing,
    // "1." is not an instruction to remove the discount.
    if (parsed !== null) onChange({ kind, value: parsed });
  };

  return (
    <div className="pos-select-wrap flex-none" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={disabled}
        className={`pos-btn ${taken > 0 ? "pos-btn-primary" : "pos-btn-soft"} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <IconPercent className="h-4 w-4" />
        <span className="hidden sm:inline">
          {taken > 0 ? `−${money(taken)}` : "Discount"}
        </span>
      </button>

      {open ? (
        // `pos-menu` and not `pos-select-menu`: the second is left-aligned and
        // exactly as wide as its trigger, which for a small button at the right
        // edge of the search row would hang the panel off the card. This one
        // hangs off the right edge, which is what a toolbar button wants.
        <div
          className="pos-menu w-72 p-3"
          onKeyDown={(event) => {
            // Both mean "I am done here" to a cashier with their hands on the
            // number pad. Enter must not reach the bill — the Charge button is
            // the only thing that settles one.
            if (event.key !== "Enter" && event.key !== "Escape") return;
            if (event.target instanceof HTMLButtonElement) return;

            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <p className="text-[0.75rem] leading-relaxed text-graphite-500">
            Up to {ceilingPct}% on this bill — {money(ceiling)}.
          </p>

          {roundings.length > 0 ? (
            <div className="mt-2.5">
              <span className="pos-label">Round it off</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {roundings.map((off) => (
                  <button
                    key={off}
                    type="button"
                    onClick={() => set({ kind: "amount", value: off })}
                    className="pos-btn pos-btn-soft pos-btn-sm tabular-nums"
                  >
                    Make it {money(subtotal - off)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="pos-label">Per cent</span>
              <input
                className="pos-field py-1.5 text-right tabular-nums"
                inputMode="decimal"
                placeholder="0"
                value={discount.kind === "percent" ? draft : ""}
                onChange={(event) => type(event.target.value, "percent")}
                onFocus={(event) => event.target.select()}
              />
            </label>

            <label className="block">
              <span className="pos-label">Rupees off</span>
              <input
                className="pos-field py-1.5 text-right tabular-nums"
                inputMode="decimal"
                placeholder="0"
                value={discount.kind === "amount" ? draft : ""}
                onChange={(event) => type(event.target.value, "amount")}
                onFocus={(event) => event.target.select()}
              />
            </label>
          </div>

          {clamped ? (
            <p className="mt-2 text-[0.75rem] leading-relaxed text-signal-warn">
              That is over your limit, so {money(taken)} came off instead. Ask
              the owner if the customer needs more.
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-orchid-100 pt-2.5">
            <button
              type="button"
              onClick={() => {
                set(NO_DISCOUNT);
                close();
              }}
              disabled={taken === 0}
              className="pos-btn pos-btn-quiet pos-btn-sm disabled:opacity-50"
            >
              No discount
            </button>

            <button
              type="button"
              onClick={close}
              className="pos-btn pos-btn-soft pos-btn-sm"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What is left on the shelf, once this line is rung up.
 *
 * Said only when it is worth saying. A bill for two of something the shop has
 * ninety of needs no commentary, and a note on every line is a note nobody
 * reads — so it appears at the last few, and turns into a warning when the
 * bill has gone past the count.
 *
 * The count is a limit, not a hint: at zero the item will not go on a bill at
 * all, and a line over it makes the Charge button refuse and say which item and
 * by how much. This note is the warning that comes before either, so the
 * cashier reaches for the stocktake on Products & stock before there is a
 * customer waiting on it rather than after.
 */
function ShelfNote({ line }: { line: CartLine }) {
  const left = stockLeft(line);

  // A shelf that is not short and is not nearly short. Nothing to say.
  if (left > 3) return null;

  const short = left < 0;

  return (
    <span
      className={`ml-2 ${short ? "font-medium text-signal-bad" : "text-signal-warn"}`}
    >
      {short
        ? `Flo counts only ${line.stock.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(line.unit)} — check the shelf`
        : `${left.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(line.unit)} left after this`}
    </span>
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

/* -------------------------------------------------------------------------- */

/**
 * Naming a bill before it goes down.
 *
 * One field, and it is optional — a cashier with three people waiting will not
 * type anything, and a dialog that insists is a dialog that gets worked around
 * by not holding the bill at all. But the field is the difference between a
 * tray a cashier can read and one they have to open four bills to search, so it
 * is offered with the fastest thing to type already in it: the customer's name
 * when one is attached, which is the case where the label matters least and
 * costs nothing to fill.
 *
 * Enter holds. The hands are on the keyboard because they were just typing a
 * name, and reaching for a button is the slow way.
 */
function HoldSheet({
  customer,
  lines,
  total,
  onClose,
  onHold,
}: {
  customer: string;
  lines: number;
  total: string;
  onClose: () => void;
  onHold: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(customer);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const hold = async () => {
    if (busy) return;
    setBusy(true);
    await onHold(label);
    setBusy(false);
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Put this bill on hold"
        className="pos-sheet outline-none"
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconPause className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Put this bill down
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {lines} {lines === 1 ? "line" : "lines"} · {total}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-icon-btn disabled:opacity-50"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="px-4 py-5 sm:px-5">
          <label className="block">
            <span className="pos-label">What will you call it?</span>
            <input
              ref={fieldRef}
              className="pos-field"
              value={label}
              onChange={(event) =>
                setLabel(event.target.value.slice(0, HELD_LABEL_MAX))
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void hold();
              }}
              placeholder="Blue shirt, the aunty with the pram, Bilal…"
              autoComplete="off"
              autoCorrect="off"
            />
            <p className="pos-hint">
              Optional. Whatever you will recognise across the counter — leave
              it blank and the list shows the time and what was on it.
            </p>
          </label>

          <p className="mt-4 rounded-xl bg-orchid-50 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-graphite-700">
            Nothing is sold and no stock moves. When you pick it up the prices
            come off the list again, so a rate that changes in between is the
            rate you charge.
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-btn pos-btn-quiet disabled:opacity-60"
          >
            Back to the bill
          </button>

          <button
            type="button"
            onClick={() => void hold()}
            disabled={busy}
            className="pos-btn pos-btn-primary disabled:opacity-60"
          >
            {busy ? "Putting it down…" : "Put it on hold"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The bills already down at this till.
 *
 * Oldest first, because the one that has been waiting longest is the one
 * somebody is about to ask about — and because a list that reorders as bills
 * are added is a list a cashier re-reads every time.
 *
 * Picking one up while there is already a bill on screen would silently throw
 * that bill away, so it is said rather than prevented: the cashier is told what
 * will happen and can put the current one down first. Preventing it outright
 * would be a tray that refuses to open in exactly the situation it exists for.
 *
 * Dropping asks twice, in the same tap-again shape the Clear button uses.
 * Nothing about a held bill is recoverable — there is no money, no receipt and
 * no stock movement behind it — so the second tap is the only thing standing
 * between a busy thumb and a customer's shopping.
 */
function HeldTray({
  held,
  counter,
  busy,
  onResume,
  onDrop,
  onClose,
}: {
  held: HeldBill[];
  counter: Counter;
  /** Whether there is a bill on screen that picking one up would replace. */
  busy: boolean;
  onResume: (bill: HeldBill) => void;
  onDrop: (bill: HeldBill) => Promise<void>;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bills on hold at ${counter.name}`}
        className="pos-sheet outline-none"
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconPause className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              On hold at {counter.name}
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {held.length} {held.length === 1 ? "bill" : "bills"} waiting to be
              picked up
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="px-4 py-4 sm:px-5">
          {busy ? (
            <p className="mb-3 flex items-start gap-2 rounded-xl border border-signal-warn/40 bg-signal-warn/5 p-3 text-[0.8125rem] leading-relaxed text-graphite-700">
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
              There is a bill on the screen already. Picking one up will replace
              it — put this one down first if you still need it.
            </p>
          ) : null}

          <ul className="space-y-2">
            {held.map((bill) => (
              <li
                key={bill.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-orchid-100 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-[0.9375rem] font-semibold text-graphite-900">
                      {heldTitle(bill)}
                    </span>

                    {bill.customerName ? (
                      <span className="text-[0.8125rem] text-graphite-500">
                        {bill.customerName}
                      </span>
                    ) : null}

                    {/* A bill left overnight. Flagged and never swept away on a
                        timer — deleting a shop's own data while nobody is
                        looking is how a cashier loses one they meant to keep. */}
                    {isStale(bill.at) ? (
                      <span className="pos-badge pos-badge-warn">Overnight</span>
                    ) : null}
                  </p>

                  <p className="mt-0.5 text-[0.75rem] text-graphite-500">
                    {bill.lines.length}{" "}
                    {bill.lines.length === 1 ? "item" : "items"} ·{" "}
                    {heldAge(bill.at)} · {bill.by}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setConfirm((id) => (id === bill.id ? null : bill.id));
                  }}
                  onBlur={() => setConfirm(null)}
                  className={`pos-btn pos-btn-sm flex-none ${confirm === bill.id ? "pos-btn-primary" : "pos-btn-quiet"}`}
                >
                  {confirm === bill.id ? "Tap again to drop" : "Drop"}
                </button>

                {confirm === bill.id ? (
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      // The Drop button's blur would clear the confirmation
                      // before this click landed. Handled on pointer-down for
                      // the same reason the search list is.
                      event.preventDefault();
                      setConfirm(null);
                      void onDrop(bill);
                    }}
                    className="pos-btn pos-btn-sm pos-btn-primary flex-none"
                  >
                    Yes, drop it
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => onResume(bill)}
                  className="pos-btn pos-btn-sm pos-btn-soft flex-none"
                >
                  Pick it up
                </button>
              </li>
            ))}
          </ul>
        </div>

        <footer className="flex items-center justify-end border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-quiet">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
