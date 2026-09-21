/**
 * The closed option lists behind Settings, and the parsers that guard them.
 *
 * No `server-only` here, for the same reason `timeframe-options.ts` carries
 * none: the selects are client components and the Server Action validating
 * their output has to agree with them exactly. One list, read from both sides
 * — and every id below is also a check constraint in `0009_shop_settings.sql`,
 * so a value that slips past this file still cannot reach the table.
 */

export type Option<T extends string> = {
  id: T;
  label: string;
  /** Rendered as a second line inside the dropdown row. Only worth having
   *  where the label alone does not say which one to pick. */
  description?: string;
};

/**
 * One entry, deliberately. Flo is a supermarket till — aisles, barcodes, a
 * trolley at a counter — and the list is what the product is, not a survey of
 * what a shop might be. A dhaba or a cloth house needs a floor map or a
 * size/colour grid at the till before the word on this dropdown means
 * anything, and offering the word first is how the site came to promise seven
 * shops and serve one.
 *
 * `0034` narrows the check constraint on `tenants.shop_type` to match, so a
 * value that slips past this file still cannot reach the table.
 */
export const SHOP_TYPES = [
  { id: "supermarket", label: "Supermarket / general store" },
] as const satisfies readonly Option<string>[];

export const CURRENCIES = [
  { id: "PKR", label: "Pakistani rupee — Rs" },
  { id: "AED", label: "UAE dirham — AED" },
  { id: "SAR", label: "Saudi riyal — SAR" },
  { id: "USD", label: "US dollar — $" },
] as const satisfies readonly Option<string>[];

/** How the rupee is written on the receipt. The shop that prints "₨" on a
 *  thermal roll usually finds out the printer cannot — which is the one thing
 *  worth knowing here, so each row carries it. */
export const CURRENCY_FORMATS = [
  {
    id: "rs-prefix",
    label: "Rs 1,250",
    description: "Prints on every thermal roll. The safe one.",
  },
  {
    id: "symbol",
    label: "₨ 1,250",
    description: "Many 80 mm printers cannot draw this glyph.",
  },
  {
    id: "suffix",
    label: "1,250 PKR",
    description: "Unambiguous on an invoice you email.",
  },
] as const satisfies readonly Option<string>[];

export const TIMEZONES = [
  { id: "Asia/Karachi", label: "Pakistan — PKT (UTC+5)" },
  { id: "Asia/Dubai", label: "United Arab Emirates — GST (UTC+4)" },
  { id: "Asia/Riyadh", label: "Saudi Arabia — AST (UTC+3)" },
] as const satisfies readonly Option<string>[];

export const DAY_ENDS = [
  { id: "00:00", label: "Midnight" },
  { id: "01:00", label: "1:00 am" },
  { id: "02:00", label: "2:00 am" },
  { id: "03:00", label: "3:00 am" },
  { id: "04:00", label: "4:00 am" },
] as const satisfies readonly Option<string>[];

export const WEEK_STARTS = [
  { id: "monday", label: "Monday" },
  { id: "sunday", label: "Sunday" },
  { id: "saturday", label: "Saturday" },
] as const satisfies readonly Option<string>[];

export const FISCAL_YEAR_STARTS = [
  { id: "07-01", label: "1 July — Pakistan" },
  { id: "01-01", label: "1 January" },
  { id: "04-01", label: "1 April" },
] as const satisfies readonly Option<string>[];

export type ShopType = (typeof SHOP_TYPES)[number]["id"];
export type Currency = (typeof CURRENCIES)[number]["id"];
export type CurrencyFormat = (typeof CURRENCY_FORMATS)[number]["id"];
export type Timezone = (typeof TIMEZONES)[number]["id"];
export type DayEnd = (typeof DAY_ENDS)[number]["id"];
export type WeekStart = (typeof WEEK_STARTS)[number]["id"];
export type FiscalYearStart = (typeof FISCAL_YEAR_STARTS)[number]["id"];

export type ShopSettings = {
  currency: Currency;
  currencyFormat: CurrencyFormat;
  timezone: Timezone;
  dayEndsAt: DayEnd;
  weekStartsOn: WeekStart;
  fiscalYearStarts: FiscalYearStart;
};

/** What a shop with no row reads as — the same values `0009` backfills with. */
export const DEFAULT_SETTINGS: ShopSettings = {
  currency: "PKR",
  currencyFormat: "rs-prefix",
  timezone: "Asia/Karachi",
  dayEndsAt: "00:00",
  weekStartsOn: "monday",
  fiscalYearStarts: "07-01",
};

// -----------------------------------------------------------------------------
// Access levels
// -----------------------------------------------------------------------------

/** Admin is not here. It is allowed everything by definition, and a stored row
 *  saying so is a row an owner can eventually switch off and lock themselves
 *  out with. */
export const ACCESS_LEVELS = [
  { id: "cashier", label: "Cashier" },
  { id: "manager", label: "Store manager" },
] as const satisfies readonly Option<string>[];

export type AccessLevel = (typeof ACCESS_LEVELS)[number]["id"];

/** The switches, in the order the counter meets them. `column` is both the form
 *  field name and the column on `role_permissions` — they are kept identical so
 *  the action can loop rather than list them twice. */
export const PERMISSION_TOGGLES = [
  {
    column: "can_discount",
    label: "Give a discount",
    hint: "Up to the ceiling set below.",
  },
  {
    column: "can_manage_customers",
    label: "See and edit the customer list",
    hint: "Names, numbers, and what each one has bought.",
  },
  {
    column: "can_refund",
    label: "Cancel a printed receipt or take a return",
    hint: null,
  },
  {
    column: "can_open_drawer",
    label: "Open the drawer without a sale",
    hint: null,
  },
  {
    column: "can_close_shift",
    label: "Count the drawer and close the shift",
    hint: "Also shows the over-or-short.",
  },
  {
    column: "can_edit_items",
    label: "Add or edit items",
    hint: null,
  },
  {
    column: "can_change_price",
    label: "Change a selling price",
    hint: null,
  },
  {
    column: "can_manage_purchasing",
    label: "Buy stock — suppliers, orders and deliveries",
    hint: "Also sets what the shop paid, which is what margin is worked out from.",
  },
  {
    column: "can_view_reports",
    label: "See profit, margins, and full reports",
    hint: "Today's sales total is visible to everyone.",
  },
] as const;

export type PermissionColumn = (typeof PERMISSION_TOGGLES)[number]["column"];

export type RolePermission = {
  accessLevel: AccessLevel;
  canDiscount: boolean;
  discountCeilingPct: number;
  canManageCustomers: boolean;
  canRefund: boolean;
  canOpenDrawer: boolean;
  canCloseShift: boolean;
  canEditItems: boolean;
  canChangePrice: boolean;
  canManagePurchasing: boolean;
  canViewReports: boolean;
};

export const DEFAULT_PERMISSIONS: Record<AccessLevel, RolePermission> = {
  cashier: {
    accessLevel: "cashier",
    canDiscount: true,
    discountCeilingPct: 5,
    // On: a cashier who cannot look a regular up by phone asks the owner for
    // the number, which is the notebook this screen replaces.
    canManageCustomers: true,
    canRefund: false,
    canOpenDrawer: false,
    canCloseShift: false,
    canEditItems: false,
    canChangePrice: false,
    // Off. Buying is the owner's side of the shop — a cashier trusted to
    // correct a shelf count at the counter is not thereby trusted to say what
    // the shop paid for it, which is the number every margin is worked out
    // from.
    canManagePurchasing: false,
    canViewReports: false,
  },
  manager: {
    accessLevel: "manager",
    canDiscount: true,
    discountCeilingPct: 15,
    canManageCustomers: true,
    canRefund: true,
    canOpenDrawer: true,
    canCloseShift: true,
    canEditItems: true,
    canChangePrice: false,
    canManagePurchasing: true,
    canViewReports: true,
  },
};

/** The camelCase field a `PermissionColumn` maps to on `RolePermission`. */
export const TOGGLE_FIELD = {
  can_discount: "canDiscount",
  can_manage_customers: "canManageCustomers",
  can_refund: "canRefund",
  can_open_drawer: "canOpenDrawer",
  can_close_shift: "canCloseShift",
  can_edit_items: "canEditItems",
  can_change_price: "canChangePrice",
  can_manage_purchasing: "canManagePurchasing",
  can_view_reports: "canViewReports",
} as const satisfies Record<PermissionColumn, keyof RolePermission>;

// -----------------------------------------------------------------------------
// Parsers. Used by the Server Action, so every one of them rejects rather than
// coerces — a shop type that is not on the list is a typo or an attack, and
// silently writing 'other' hides both.
// -----------------------------------------------------------------------------

export function pickOption<T extends string>(
  options: readonly Option<T>[],
  value: unknown,
): T | null {
  return options.some((option) => option.id === value) ? (value as T) : null;
}

export const isAccessLevel = (value: unknown): value is AccessLevel =>
  pickOption(ACCESS_LEVELS, value) !== null;

/**
 * A bounded decimal from a form field. Blank reads as zero — a cleared ceiling
 * means "none", which is what an owner emptying the box intends.
 */
export function parseAmount(
  value: unknown,
  max: number,
): number | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") return 0;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > max) return null;

  // Two decimals, matching numeric(_, 2) on both columns.
  return Math.round(amount * 100) / 100;
}
