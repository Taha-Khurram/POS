import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { Counter } from "@/lib/pos/counter";
import {
  CURRENCIES,
  CURRENCY_FORMATS,
  DAY_ENDS,
  DEFAULT_PERMISSIONS,
  DEFAULT_SETTINGS,
  FISCAL_YEAR_STARTS,
  TIMEZONES,
  WEEK_STARTS,
  isAccessLevel,
  pickOption,
  type AccessLevel,
  type RolePermission,
  type ShopSettings,
} from "@/lib/pos/settings-options";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop as Settings needs it: the `tenants` row.
 *
 * Read through the shop's own JWT rather than the service role. The table
 * carries a `select` policy scoped to the `tenant_id` claim, so RLS is the gate
 * here and the read doubles as a live check that the access-token hook is
 * stamping claims — a service-role read would happily return the row with the
 * hook switched off and hide the one failure that breaks everything else.
 *
 * Writes are a different matter. They go through `app/(app)/app/settings/
 * actions.ts` on the service role like every other write in the app, because
 * there is no update policy anywhere in the schema.
 */

export type ShopProfile = {
  id: string;
  shopName: string;
  ownerName: string;
  phone: string;
  email: string | null;
  city: string;
  shopType: string;
  /** FBR registration. Most kiryana shops have neither. */
  ntn: string | null;
  strn: string | null;
};

export async function getShopProfile(
  tenantId: string,
): Promise<ShopProfile | null> {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("tenants")
    .select("id, shop_name, owner_name, phone, email, city, shop_type, ntn, strn")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    shopName: data.shop_name,
    ownerName: data.owner_name,
    phone: data.phone,
    email: data.email,
    city: data.city,
    shopType: data.shop_type,
    ntn: data.ntn,
    strn: data.strn,
  };
}

/** What the console is dressed as when there is no shop row to read. */
export const FALLBACK_SHOP_NAME = "Your shop";

/**
 * Just the name, for the chrome.
 *
 * The rail's account block is on every `/app` page, so this is deliberately one
 * column and nothing else rather than a `getShopProfile()` the layout would
 * throw eight fields of away. Cached for the request, so a page that also asks
 * costs no second round-trip.
 *
 * A null tenant, or a row RLS will not return, falls back to the label the
 * layout used to hard-code — an account that is not attached to a shop yet
 * still reaches the dashboard, and that stays true.
 */
export const getShopName = cache(
  async (tenantId: string | null): Promise<string> => {
    if (!tenantId) return FALLBACK_SHOP_NAME;

    const supabase = createClient(await cookies());
    const { data } = await supabase
      .from("tenants")
      .select("shop_name")
      .eq("id", tenantId)
      .maybeSingle();

    return data?.shop_name ?? FALLBACK_SHOP_NAME;
  },
);

/**
 * Currency and clock. A shop with no row reads the application defaults rather
 * than an empty form: `0009` backfills every tenant that existed when it ran,
 * and one created afterwards gets its row on the first save.
 */
export async function getShopSettings(tenantId: string): Promise<ShopSettings> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("tenant_settings")
    .select(
      "currency, currency_format, timezone, day_ends_at, week_starts_on, fiscal_year_starts",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) return DEFAULT_SETTINGS;

  // Every column is a check constraint over the same list the selects render,
  // so a value that fails `pickOption` here is a row written before this file
  // existed. Falling back beats rendering a select with nothing selected.
  return {
    currency: pickOption(CURRENCIES, data.currency) ?? DEFAULT_SETTINGS.currency,
    currencyFormat:
      pickOption(CURRENCY_FORMATS, data.currency_format) ??
      DEFAULT_SETTINGS.currencyFormat,
    timezone: pickOption(TIMEZONES, data.timezone) ?? DEFAULT_SETTINGS.timezone,
    dayEndsAt: pickOption(DAY_ENDS, data.day_ends_at) ?? DEFAULT_SETTINGS.dayEndsAt,
    weekStartsOn:
      pickOption(WEEK_STARTS, data.week_starts_on) ?? DEFAULT_SETTINGS.weekStartsOn,
    fiscalYearStarts:
      pickOption(FISCAL_YEAR_STARTS, data.fiscal_year_starts) ??
      DEFAULT_SETTINGS.fiscalYearStarts,
  };
}

/**
 * What the cashier and the manager may do, one entry per access level and
 * always both — a missing row is the default, not a level that disappears off
 * the screen.
 */
export async function getRolePermissions(
  tenantId: string,
): Promise<Record<AccessLevel, RolePermission>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("role_permissions")
    .select(
      `
        access_level,
        can_discount,
        discount_ceiling_pct,
        can_manage_customers,
        can_refund,
        can_open_drawer,
        can_close_shift,
        can_edit_items,
        can_change_price,
        can_view_reports
      `,
    )
    .eq("tenant_id", tenantId);

  const permissions = {
    cashier: { ...DEFAULT_PERMISSIONS.cashier },
    manager: { ...DEFAULT_PERMISSIONS.manager },
  };

  for (const row of data ?? []) {
    if (!isAccessLevel(row.access_level)) continue;

    permissions[row.access_level] = {
      accessLevel: row.access_level,
      canDiscount: row.can_discount,
      discountCeilingPct: Number(row.discount_ceiling_pct),
      canManageCustomers: row.can_manage_customers,
      canRefund: row.can_refund,
      canOpenDrawer: row.can_open_drawer,
      canCloseShift: row.can_close_shift,
      canEditItems: row.can_edit_items,
      canChangePrice: row.can_change_price,
      canViewReports: row.can_view_reports,
    };
  }

  return permissions;
}

/**
 * Every counter in the shop, in the order they are picked in.
 *
 * Deliberately NOT wrapped in `cache()`, like the three readers above it.
 * `cache()` is scoped to the request, and a Server Action plus the re-render
 * its `revalidatePath` triggers are one request — so a memoised read hands the
 * re-render the rows as they were before the write, and Settings redraws itself
 * with the values the owner just changed away from. It looks like the save
 * failed until you navigate away and come back on a fresh request, which is the
 * worst possible way for a settings screen to be wrong.
 *
 * A shop with no rows gets an empty list, not an implied counter: 0011 backfills
 * nothing, and "no counter yet" is a real state the register has to draw.
 */
export async function listCounters(tenantId: string): Promise<Counter[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("counters")
    .select(
      "id, name, is_active, receipt_prefix, accepts_cash, accepts_card, receipt_footer, auto_print, sort_order, receipt_day, receipt_serial",
    )
    .eq("tenant_id", tenantId)
    .order("sort_order")
    .order("created_at");

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    receiptPrefix: row.receipt_prefix,
    acceptsCash: row.accepts_cash,
    acceptsCard: row.accepts_card,
    receiptFooter: row.receipt_footer,
    autoPrint: row.auto_print,
    sortOrder: row.sort_order,
    // Only meaningful on the day it was issued. A yesterday's number shown
    // against today reads as "this counter has already sold something".
    lastReceiptNo:
      row.receipt_day && row.receipt_serial > 0
        ? `${row.receipt_prefix}-${row.receipt_day.slice(2).replace(/-/g, "")}-${String(row.receipt_serial).padStart(4, "0")}`
        : null,
  }));
}

/** One counter, by id, scoped to the shop that asked. */
export async function getCounter(
  tenantId: string,
  counterId: string,
): Promise<Counter | null> {
  const counters = await listCounters(tenantId);
  return counters.find((counter) => counter.id === counterId) ?? null;
}
