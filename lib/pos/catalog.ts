/**
 * The catalog's shape, its vocabulary, and the arithmetic done on top of it.
 *
 * No `server-only` here, and no imports — the same exception
 * `timeframe-options.ts` carries. The item list is read by the browser (search,
 * the add-product sheet's live margin, the CSV mapper) as well as by the server
 * that renders the first paint and the Server Actions that validate what comes
 * back, and a module only one side could import would force these constants to
 * exist twice.
 *
 * The rows themselves live in `public.items` and are read by `lib/pos/items.ts`.
 * What is here is everything both sides have to agree about: the units, the
 * tree, the field limits, and the maths — margin, stock state, the in-store
 * barcode — which is written against the types rather than against any
 * particular shop.
 */

export type TrackingMode = "unit" | "weight" | "variant";

export type UnitId =
  | "piece"
  | "kg"
  | "gram"
  | "litre"
  | "dozen"
  | "packet"
  | "carton"
  | "plate";

export type Product = {
  id: string;
  name: string;
  /** What is actually painted on the shelf label in a kiryana. */
  urdu: string;
  sku: string;
  /** `null` for a loose or handmade item that never had a manufacturer code. */
  barcode: string | null;
  /** The tree's two levels, as their names stood when the item was filed. */
  department: string;
  category: string;
  unit: UnitId;
  tracking: TrackingMode;
  /** How many size/colour rows sit under this item. Only for `"variant"`. */
  variants?: number;
  /** Off hides it from the register without losing its history. A seasonal
   *  item, or one the shop has stopped carrying but still has sales against. */
  isActive: boolean;
  cost: number;
  price: number;
  stock: number;
  /** Alert below this. Per item, never one number for the whole shop. */
  lowAt: number;
  supplier: string;
  taxRate: number;
};

/* ---------------- Vocabulary ---------------- */

export const UNITS: {
  id: UnitId;
  label: string;
  short: string;
  fractional: boolean;
}[] = [
  { id: "piece", label: "Piece — adad", short: "pc", fractional: false },
  { id: "kg", label: "Kilogram", short: "kg", fractional: true },
  { id: "gram", label: "Gram", short: "g", fractional: true },
  { id: "litre", label: "Litre", short: "L", fractional: true },
  { id: "dozen", label: "Dozen", short: "dz", fractional: false },
  { id: "packet", label: "Packet", short: "pkt", fractional: false },
  { id: "carton", label: "Carton", short: "ctn", fractional: false },
  { id: "plate", label: "Plate", short: "plate", fractional: false },
];

export const unitShort = (id: UnitId) =>
  UNITS.find((unit) => unit.id === id)?.short ?? id;

export const TRACKING: { id: TrackingMode; label: string; blurb: string }[] = [
  {
    id: "unit",
    label: "By the unit",
    blurb: "Whole pieces, packets or cartons. One count, one price.",
  },
  {
    id: "weight",
    label: "By weight",
    blurb:
      "Sold loose off a scale — sugar, daal, qeema. Stock is a decimal and the register asks for the weight.",
  },
  {
    id: "variant",
    label: "By variant",
    blurb:
      "One item, many rows — size and colour for a cloth house, flavour for a bakery. Each row keeps its own stock and barcode.",
  },
];

/* ---------------- The tree ----------------
   Two levels, because that is what the register's touchscreen pages through: a
   department tile, a category tile inside it, then items. A third was tried as
   `items.subcategory` and dropped in migration 0016 — nobody browsed by it, and
   it was one more dropdown between a shopkeeper and a saved item.

   The rows are the shop's own, read by `lib/pos/tree.ts` and written by
   `app/(app)/app/inventory/tree-actions.ts`. Nothing here is a constant any
   more: a hardware store's departments are not a kiryana's, and the six that
   used to live in this file were a list every shop was stuck inside. What is
   left is the shape both sides agree about and the arithmetic done on it. */

export type Category = {
  id: string;
  name: string;
  /** Items filed under it. Counted by the reader, not stored. */
  items: number;
};

export type Department = {
  id: string;
  name: string;
  categories: Category[];
  items: number;
};

/** The categories under a department, by its display name. */
export const categoriesIn = (tree: Department[], department: string) =>
  tree.find((item) => item.name === department)?.categories ?? [];

/* A department or category name. Short, because it is a tile on a 10-inch
   register grid — a name that wraps to three lines is a tile a cashier cannot
   read at a glance. The database check constraint says the same 40. */
export const TREE_NAME_MIN = 2;
export const TREE_NAME_MAX = 40;

/* ---------------- Fields ----------------
   The lengths and the lists the add-product sheet enforces and the Server
   Action enforces again. One module, because a form that allows a 200-character
   name and an action that refuses one is a form that loses somebody's typing. */

export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const URDU_MAX = 120;
export const SKU_MAX = 40;
export const BARCODE_MAX = 32;
export const SUPPLIER_MAX = 80;

/** What the register may charge for one unit. Well above any shop's ceiling,
 *  low enough that a mis-keyed row is refused rather than banked. */
export const PRICE_MAX = 9_999_999;
export const STOCK_MAX = 999_999;

/* The rate and who levies it, in two pieces. The dropdown that shows these is
   a listbox and can carry a second line; anything reading them as one string
   still has `label`, which is why the rate is in both. */
export const TAX_RATES = [
  { id: 18, label: "18% — standard (FBR)", short: "18%", levy: "Standard rate — FBR" },
  {
    id: 16,
    label: "16% — Punjab services (PRA)",
    short: "16%",
    levy: "Punjab services — PRA",
  },
  { id: 0, label: "0% — exempt or zero-rated", short: "0%", levy: "Exempt or zero-rated" },
];

export const isUnitId = (value: unknown): value is UnitId =>
  UNITS.some((unit) => unit.id === value);

export const isTrackingMode = (value: unknown): value is TrackingMode =>
  TRACKING.some((mode) => mode.id === value);

export const isFractional = (unit: UnitId) =>
  UNITS.find((item) => item.id === unit)?.fractional ?? false;

/**
 * The department and category as the shop's own tree knows them, or the nearest
 * thing to them.
 *
 * A CSV column saying "Bevrages" should not stop an import — the row is worth
 * more than its spelling. So an unrecognised department falls to the first one
 * and an unrecognised category to that department's first, which is a row the
 * owner can re-file in two taps rather than a row they have to retype.
 *
 * `null` when the shop has no departments at all. That is not a spelling
 * problem and must not be papered over: there is nowhere to file the item, and
 * the caller has to say so.
 */
export function placeInTree(
  tree: Department[],
  department: string,
  category: string,
): { department: string; category: string } | null {
  if (tree.length === 0) return null;

  const dept =
    tree.find(
      (item) => item.name.toLowerCase() === department.trim().toLowerCase(),
    ) ?? tree[0];

  const cat = dept.categories.find(
    (item) => item.name.toLowerCase() === category.trim().toLowerCase(),
  );

  // The category is optional and stays optional: a department with none yet,
  // or a shopkeeper who does not file that deep, gets an empty string and the
  // item sits directly under the department. Only an unrecognised *category*
  // under a real department falls to that department's first.
  return {
    department: dept.name,
    category: cat?.name ?? (category.trim() ? (dept.categories[0]?.name ?? "") : ""),
  };
}

/**
 * What goes into `items.search_terms`, which carries a GIN index.
 *
 * Lower-cased and de-duplicated, so the column is a set of handles rather than
 * a second copy of the row. The Urdu name goes in as typed — the script has no
 * case, and `toLowerCase` on it is a no-op that only looks thorough.
 */
export function searchTerms(item: {
  name: string;
  urdu?: string | null;
  sku?: string | null;
  barcode?: string | null;
}): string[] {
  const parts = [
    item.name,
    item.urdu ?? "",
    item.sku ?? "",
    item.barcode ?? "",
    // Words as well as the whole name, so "danedar" finds "Tapal Danedar 475 g".
    ...item.name.split(/\s+/),
  ];

  return [
    ...new Set(
      parts
        .map((part) => part.trim())
        .filter((part) => part.length > 1)
        .map((part) => (/[a-z0-9]/i.test(part) ? part.toLowerCase() : part)),
    ),
  ];
}

/**
 * Does this item answer to what somebody typed?
 *
 * Shared by the catalog list and the till so the two agree about what a search
 * finds — a cashier who cannot find an item the owner can see assumes it is not
 * in the list and adds it a second time.
 *
 * The barcode is matched deliberately: the fastest way to ask whether an item
 * is already in the catalog is to scan it, and somebody standing at the counter
 * will do exactly that.
 */
export function matchesProduct(item: Product, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;

  const needle = raw.toLowerCase();

  return (
    item.name.toLowerCase().includes(needle) ||
    item.sku.toLowerCase().includes(needle) ||
    item.supplier.toLowerCase().includes(needle) ||
    item.category.toLowerCase().includes(needle) ||
    (item.barcode?.includes(needle) ?? false) ||
    item.urdu.includes(raw)
  );
}

/* ---------------- Arithmetic ---------------- */

export type Margin = {
  /** Rupees kept on one unit. */
  profit: number;
  /** Profit over the selling price — what a shopkeeper calls margin. */
  marginPct: number;
  /** Profit over the cost — what a distributor's rate list calls markup. */
  markupPct: number;
};

/**
 * Margin and markup are different numbers and shops mix them up constantly:
 * buy at 100, sell at 150, and that is a 33% margin but a 50% markup. The form
 * shows both for exactly that reason.
 */
export const marginOf = (cost: number, price: number): Margin | null => {
  if (!(cost > 0) || !(price > 0)) return null;
  const profit = price - cost;
  return {
    profit,
    marginPct: (profit / price) * 100,
    markupPct: (profit / cost) * 100,
  };
};

export type StockState = "out" | "low" | "ok";

export const stockState = (item: Pick<Product, "stock" | "lowAt">): StockState =>
  item.stock <= 0 ? "out" : item.stock <= item.lowAt ? "low" : "ok";

/**
 * A SKU a human can read down a phone line: department, a squeeze of the name,
 * and a serial. Not an id — `items.id` is a ULID, and this is the label.
 */
export const suggestSku = (department: string, name: string, serial: number) => {
  const dept =
    department.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "GEN";

  // The first word long enough to mean something — "Coca-Cola 1.5 L" should not
  // key off "1.5", and an Urdu-only name falls through to the department.
  const word =
    name
      .split(/\s+/)
      .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
      .find((part) => part.length >= 3) ?? "";

  const stem = (word || "ITM").slice(0, 3).toUpperCase().padEnd(3, "X");
  return `${dept}-${stem}-${String(serial).padStart(4, "0")}`;
};

/**
 * An EAN-13 in the 20–29 prefix, which GS1 reserves for restricted
 * circulation — in-store codes guaranteed never to collide with a
 * manufacturer's. That is the difference between printing your own label and
 * printing one that rings up as somebody else's biscuits.
 */
export const internalBarcode = (serial: number) => {
  const body = `200${String(serial).padStart(9, "0")}`.slice(0, 12);
  // Odd positions count once, even positions three times, left to right.
  const sum = body
    .split("")
    .reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0,
    );
  return `${body}${(10 - (sum % 10)) % 10}`;
};

/** True for anything that could actually be a scanned UPC/EAN. */
export const looksScanned = (code: string) => /^\d{8}$|^\d{12,14}$/.test(code.trim());

/* ---------------- The global lookup ---------------- */

export type Lookup = {
  name: string;
  brand: string;
  size: string;
  department: string;
  category: string;
};

/**
 * What a global barcode database gives back, once we are calling one.
 *
 * Until then: six codes off the shelf behind the counter, and the screen says
 * so rather than implying a live service. A lookup that silently misses is how
 * a shop ends up with "Product 5449000000996" printed on a receipt.
 */
export const GLOBAL_SAMPLE: Record<string, Lookup> = {
  "5449000000996": {
    name: "Coca-Cola 1.5 L",
    brand: "Coca-Cola",
    size: "1.5 L bottle",
    department: "Beverages",
    category: "Soft drinks",
  },
  "6281006230125": {
    name: "Pepsi 345 ml can",
    brand: "Pepsi",
    size: "345 ml can",
    department: "Beverages",
    category: "Soft drinks",
  },
  "8964000201473": {
    name: "Tapal Danedar 475 g",
    brand: "Tapal",
    size: "475 g carton",
    department: "Beverages",
    category: "Tea & coffee",
  },
  "8964000101018": {
    name: "Nestlé Milkpak 1 L",
    brand: "Nestlé",
    size: "1 L tetra pack",
    department: "Dairy & bakery",
    category: "Milk & cream",
  },
  "8964000221471": {
    name: "Shan Biryani Masala 50 g",
    brand: "Shan Foods",
    size: "50 g sachet",
    department: "Grocery",
    category: "Masala & spices",
  },
  "8964000112458": {
    name: "Surf Excel 1 kg",
    brand: "Surf Excel",
    size: "1 kg bag",
    department: "Household",
    category: "Detergents & soap",
  },
};
