/**
 * The catalog's shape, its vocabulary, and a shop's worth of sample rows.
 *
 * No `server-only` here, and no imports — the same exception
 * `timeframe-options.ts` carries. The item list is read by the browser (search,
 * the add-product sheet's live margin, the CSV mapper) as well as by the server
 * that renders the first paint, and a module only one side could import would
 * force these constants to exist twice.
 *
 * Everything under "Arithmetic" is maths the real tables will keep needing —
 * margin, stock state, the internal barcode — so it is written against the
 * types rather than against the sample.
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
  department: string;
  category: string;
  unit: UnitId;
  tracking: TrackingMode;
  /** How many size/colour rows sit under this item. Only for `"variant"`. */
  variants?: number;
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
   Departments over categories over subcategories, because that is what the
   register's touchscreen pages through: a cashier taps twice and sees the
   item, rather than scrolling a list of 5,000. Three levels is the ceiling — a
   fourth costs a tap and saves nobody anything. */

export type Department = {
  id: string;
  name: string;
  categories: { id: string; name: string; sub: string[] }[];
};

export const DEPARTMENTS: Department[] = [
  {
    id: "beverages",
    name: "Beverages",
    categories: [
      {
        id: "soft-drinks",
        name: "Soft drinks",
        sub: ["Cola", "Lemon & lime", "Energy drinks"],
      },
      { id: "juices", name: "Juices & nectars", sub: ["Tetra packs", "Chilled bottles"] },
      {
        id: "tea-coffee",
        name: "Tea & coffee",
        sub: ["Black tea", "Green tea", "Instant coffee"],
      },
      { id: "water", name: "Water", sub: ["Bottled", "19-litre cans"] },
    ],
  },
  {
    id: "grocery",
    name: "Grocery",
    categories: [
      {
        id: "staples",
        name: "Atta, rice & pulses",
        sub: ["Atta", "Rice", "Daal & beans"],
      },
      {
        id: "oil-ghee",
        name: "Cooking oil & ghee",
        sub: ["Banaspati", "Cooking oil", "Desi ghee"],
      },
      { id: "sugar-salt", name: "Sugar & salt", sub: ["Sugar", "Salt"] },
      {
        id: "masala",
        name: "Masala & spices",
        sub: ["Recipe mixes", "Whole spices", "Ground spices"],
      },
    ],
  },
  {
    id: "dairy-bakery",
    name: "Dairy & bakery",
    categories: [
      { id: "milk", name: "Milk & cream", sub: ["UHT milk", "Fresh milk", "Cream"] },
      { id: "yogurt", name: "Yogurt & butter", sub: ["Dahi", "Butter & margarine"] },
      { id: "bread", name: "Bread & rusk", sub: ["Bread", "Rusk & cake"] },
    ],
  },
  {
    id: "snacks",
    name: "Snacks & confectionery",
    categories: [
      { id: "chips", name: "Chips & namkeen", sub: ["Chips", "Namkeen"] },
      { id: "biscuits", name: "Biscuits", sub: ["Family packs", "Ticky packs"] },
      { id: "chocolate", name: "Chocolates & toffees", sub: ["Chocolate", "Toffee jars"] },
    ],
  },
  {
    id: "household",
    name: "Household",
    categories: [
      {
        id: "detergent",
        name: "Detergents & soap",
        sub: ["Washing powder", "Bar soap", "Dishwash"],
      },
      { id: "cleaning", name: "Paper & cleaning", sub: ["Tissues", "Cleaners"] },
    ],
  },
  {
    id: "personal-care",
    name: "Personal care",
    categories: [
      { id: "hair-skin", name: "Hair & skin", sub: ["Shampoo", "Soap & body wash"] },
      { id: "oral", name: "Oral care", sub: ["Toothpaste", "Brushes"] },
    ],
  },
];

/** The categories under a department, by its display name. */
export const categoriesIn = (department: string) =>
  DEPARTMENTS.find((item) => item.name === department)?.categories ?? [];

/* ---------------- Sample rows ----------------
   Fourteen items a Gulberg kiryana would actually carry, priced the way they
   are priced. Three are deliberately awkward: loose sugar and loose rice have
   no manufacturer barcode and sell by the kilo, and the bakery's own rusk is
   private label — which is the whole reason the internal-barcode path exists. */

export const SAMPLE_ITEMS: Product[] = [
  {
    id: "itm-01",
    name: "Coca-Cola 1.5 L",
    urdu: "کوکا کولا",
    sku: "BEV-COL-1500",
    barcode: "5449000000996",
    department: "Beverages",
    category: "Soft drinks",
    unit: "piece",
    tracking: "unit",
    cost: 148,
    price: 180,
    stock: 64,
    lowAt: 24,
    supplier: "Coca-Cola Icecek — Lahore",
    taxRate: 18,
  },
  {
    id: "itm-02",
    name: "Pepsi 345 ml can",
    urdu: "پیپسی",
    sku: "BEV-PEP-0345",
    barcode: "6281006230125",
    department: "Beverages",
    category: "Soft drinks",
    unit: "piece",
    tracking: "unit",
    cost: 62,
    price: 80,
    stock: 18,
    lowAt: 24,
    supplier: "Riaz Bottlers",
    taxRate: 18,
  },
  {
    id: "itm-03",
    name: "Tapal Danedar 475 g",
    urdu: "ٹپال دانے دار",
    sku: "BEV-TAP-0475",
    barcode: "8964000201473",
    department: "Beverages",
    category: "Tea & coffee",
    unit: "packet",
    tracking: "unit",
    cost: 985,
    price: 1150,
    stock: 22,
    lowAt: 10,
    supplier: "Tapal Tea — distributor",
    taxRate: 18,
  },
  {
    id: "itm-04",
    name: "Nestlé Milkpak 1 L",
    urdu: "ملک پیک",
    sku: "DRY-MPK-1000",
    barcode: "8964000101018",
    department: "Dairy & bakery",
    category: "Milk & cream",
    unit: "piece",
    tracking: "unit",
    cost: 268,
    price: 300,
    stock: 41,
    lowAt: 20,
    supplier: "Nestlé Pakistan",
    taxRate: 18,
  },
  {
    id: "itm-05",
    name: "Sugar — loose",
    urdu: "چینی",
    sku: "GRO-SUG-0001",
    barcode: null,
    department: "Grocery",
    category: "Sugar & salt",
    unit: "kg",
    tracking: "weight",
    cost: 142,
    price: 165,
    stock: 84.5,
    lowAt: 25,
    supplier: "Ravi Trading — Akbari Mandi",
    taxRate: 0,
  },
  {
    id: "itm-06",
    name: "Super Kernel basmati — loose",
    urdu: "سپر کرنل چاول",
    sku: "GRO-SUP-0002",
    barcode: null,
    department: "Grocery",
    category: "Atta, rice & pulses",
    unit: "kg",
    tracking: "weight",
    cost: 295,
    price: 360,
    stock: 6.2,
    lowAt: 20,
    supplier: "Ravi Trading — Akbari Mandi",
    taxRate: 0,
  },
  {
    id: "itm-07",
    name: "Dalda Banaspati 2.5 kg",
    urdu: "ڈالڈا",
    sku: "GRO-DAL-2500",
    barcode: "8964000384015",
    department: "Grocery",
    category: "Cooking oil & ghee",
    unit: "piece",
    tracking: "unit",
    cost: 1420,
    price: 1590,
    stock: 9,
    lowAt: 12,
    supplier: "Dalda Foods",
    taxRate: 18,
  },
  {
    id: "itm-08",
    name: "Shan Biryani Masala 50 g",
    urdu: "شان بریانی مصالحہ",
    sku: "GRO-SHA-0050",
    barcode: "8964000221471",
    department: "Grocery",
    category: "Masala & spices",
    unit: "packet",
    tracking: "unit",
    cost: 88,
    price: 110,
    stock: 120,
    lowAt: 36,
    supplier: "Shan Foods",
    taxRate: 18,
  },
  {
    id: "itm-09",
    name: "Lay's Masala 50 g",
    urdu: "لیز مصالحہ",
    sku: "SNA-MAS-0050",
    barcode: "8964000567012",
    department: "Snacks & confectionery",
    category: "Chips & namkeen",
    unit: "packet",
    tracking: "unit",
    cost: 42,
    price: 50,
    stock: 0,
    lowAt: 48,
    supplier: "PepsiCo Snacks",
    taxRate: 18,
  },
  {
    id: "itm-10",
    name: "Gala biscuit family pack",
    urdu: "گالا بسکٹ",
    sku: "SNA-GAL-0110",
    barcode: "8964000743119",
    department: "Snacks & confectionery",
    category: "Biscuits",
    unit: "packet",
    tracking: "unit",
    cost: 96,
    price: 120,
    stock: 54,
    lowAt: 24,
    supplier: "Peek Freans — distributor",
    taxRate: 18,
  },
  {
    id: "itm-11",
    name: "Rusk — our own bakery",
    urdu: "رس",
    sku: "DAI-RUS-0001",
    barcode: "2000010000012",
    department: "Dairy & bakery",
    category: "Bread & rusk",
    unit: "packet",
    tracking: "unit",
    cost: 130,
    price: 220,
    stock: 15,
    lowAt: 8,
    supplier: "Made in-house",
    taxRate: 0,
  },
  {
    id: "itm-12",
    name: "Surf Excel 1 kg",
    urdu: "سرف ایکسل",
    sku: "HOU-SUR-1000",
    barcode: "8964000112458",
    department: "Household",
    category: "Detergents & soap",
    unit: "piece",
    tracking: "unit",
    cost: 615,
    price: 690,
    stock: 27,
    lowAt: 12,
    supplier: "Unilever Pakistan",
    taxRate: 18,
  },
  {
    id: "itm-13",
    name: "Sunsilk shampoo 185 ml",
    urdu: "سن سلک",
    sku: "PER-SUN-0185",
    barcode: "8964000339022",
    department: "Personal care",
    category: "Hair & skin",
    unit: "piece",
    tracking: "unit",
    cost: 398,
    price: 450,
    stock: 31,
    lowAt: 12,
    supplier: "Unilever Pakistan",
    taxRate: 18,
  },
  {
    id: "itm-14",
    name: "Shop apron — printed",
    urdu: "ایپرن",
    sku: "HOU-APR-0002",
    barcode: "2000010000029",
    department: "Household",
    category: "Paper & cleaning",
    unit: "piece",
    tracking: "variant",
    variants: 6,
    cost: 540,
    price: 950,
    stock: 23,
    lowAt: 6,
    supplier: "Azam Cloth Market",
    taxRate: 18,
  },
];

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
