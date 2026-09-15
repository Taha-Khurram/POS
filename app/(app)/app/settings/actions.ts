"use server";

import { revalidatePath } from "next/cache";

import { requireSession, type SessionContext } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  ACCESS_LEVELS,
  CURRENCIES,
  CURRENCY_FORMATS,
  DAY_ENDS,
  FISCAL_YEAR_STARTS,
  PERMISSION_TOGGLES,
  SHOP_TYPES,
  TIMEZONES,
  WEEK_STARTS,
  parseAmount,
  pickOption,
  type AccessLevel,
} from "@/lib/pos/settings-options";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * The three Settings forms.
 *
 * Every one of them writes with the service role, because the schema has no
 * update policy for a tenant JWT anywhere — `0001` revoked insert/update/delete
 * from `authenticated` outright so that there is one auditable write path
 * rather than a policy surface to get wrong. That makes the checks below the
 * whole of access control: the tenant comes from the signed token's claim and
 * never from the form, and `.eq("id", tenantId)` is what stops a crafted
 * request from renaming somebody else's shop.
 *
 * Only the owner may write. The register enforces a manager's ceiling, so a
 * manager who could raise it would be setting their own limit.
 */

export type SettingsState = {
  error: string | null;
  /** Wall-clock stamp of the last good save, so a second identical save still
   *  re-renders the confirmation rather than sitting there looking ignored. */
  savedAt: number | null;
};

const fail = (error: string): SettingsState => ({ error, savedAt: null });
const done = (): SettingsState => ({ error: null, savedAt: Date.now() });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/** An optional column: an emptied box means null, not the empty string. */
const nullable = (value: FormDataEntryValue | null) => text(value) || null;

type OwnerCheck =
  | { ok: true; session: SessionContext & { tenantId: string } }
  | { ok: false; error: string };

/**
 * Owner-only, and attached to a shop. Carries the session out on success so the
 * caller has the actor to audit with, and a narrowed `tenantId` with it.
 */
async function requireOwner(): Promise<OwnerCheck> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop yet." };
  }

  if (session.tenantRole !== "owner") {
    return { ok: false, error: "Only the shop owner can change settings." };
  }

  return { ok: true, session: { ...session, tenantId: session.tenantId } };
}

// -----------------------------------------------------------------------------
// Shop details — the `tenants` row that prints at the top of every receipt.
// -----------------------------------------------------------------------------
export async function saveShopDetails(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const shopName = text(formData.get("shop_name"));
  const ownerName = text(formData.get("owner_name"));
  const phone = text(formData.get("phone"));
  const city = text(formData.get("city"));
  const shopType = pickOption(SHOP_TYPES, text(formData.get("shop_type")));

  // The four columns `tenants` declares not-null, checked here so the failure
  // is a sentence under the form rather than a 23514 from Postgres.
  if (!shopName || !ownerName || !phone || !city) {
    return fail("Shop name, owner, phone, and city cannot be empty.");
  }

  if (!shopType) return fail("Pick a shop type from the list.");

  const after = {
    shop_name: shopName,
    owner_name: ownerName,
    phone,
    email: nullable(formData.get("email")),
    city,
    shop_type: shopType,
    ntn: nullable(formData.get("ntn")),
    strn: nullable(formData.get("strn")),
  };

  const supabase = createAdminClient();

  // The old row first, so the audit entry carries what actually changed. A read
  // that fails is not fatal — the write still happens and the entry simply has
  // no `before`, which beats refusing to save because logging is unwell.
  const { data: before } = await supabase
    .from("tenants")
    .select("shop_name, owner_name, phone, email, city, shop_type, ntn, strn")
    .eq("id", session.tenantId)
    .maybeSingle();

  const { error } = await supabase
    .from("tenants")
    .update(after)
    .eq("id", session.tenantId);

  if (error) return fail("We could not save the shop details. Please try again.");

  await recordAudit(session, {
    action: "shop.details_updated",
    subjectType: "tenant",
    subjectId: session.tenantId,
    before,
    after,
  });

  revalidatePath("/app/settings");
  return done();
}

// -----------------------------------------------------------------------------
// Currency and clock
// -----------------------------------------------------------------------------
export async function saveCurrencyClock(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const currency = pickOption(CURRENCIES, text(formData.get("currency")));
  const currencyFormat = pickOption(
    CURRENCY_FORMATS,
    text(formData.get("currency_format")),
  );
  const timezone = pickOption(TIMEZONES, text(formData.get("timezone")));
  const dayEndsAt = pickOption(DAY_ENDS, text(formData.get("day_ends_at")));
  const weekStartsOn = pickOption(WEEK_STARTS, text(formData.get("week_starts_on")));
  const fiscalYearStarts = pickOption(
    FISCAL_YEAR_STARTS,
    text(formData.get("fiscal_year_starts")),
  );

  if (
    !currency ||
    !currencyFormat ||
    !timezone ||
    !dayEndsAt ||
    !weekStartsOn ||
    !fiscalYearStarts
  ) {
    return fail("One of those choices is not on the list. Reload and try again.");
  }

  const after = {
    tenant_id: session.tenantId,
    currency,
    currency_format: currencyFormat,
    timezone,
    day_ends_at: dayEndsAt,
    week_starts_on: weekStartsOn,
    fiscal_year_starts: fiscalYearStarts,
  };

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("tenant_settings")
    .select(
      "currency, currency_format, timezone, day_ends_at, week_starts_on, fiscal_year_starts",
    )
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  // Upsert rather than update: a tenant created after 0009 ran has no row, and
  // an insert-if-missing done as two statements is a race on a shared counter
  // where two tablets can press Save at once.
  const { error } = await supabase
    .from("tenant_settings")
    .upsert(after, { onConflict: "tenant_id" });

  if (error) return fail("We could not save the currency settings. Please try again.");

  await recordAudit(session, {
    action: "shop.settings_updated",
    subjectType: "tenant_settings",
    subjectId: session.tenantId,
    before,
    after,
  });

  revalidatePath("/app/settings");
  return done();
}

// -----------------------------------------------------------------------------
// Roles and permissions
// -----------------------------------------------------------------------------

/** A checkbox absent from the FormData is one that was switched off. */
const checked = (formData: FormData, name: string) => formData.get(name) === "on";

export async function saveRolePermissions(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  // Both levels in one submit, so the form is one Save rather than two that can
  // half-apply. Field names are `<level>.<column>`.
  const rows: Record<string, unknown>[] = [];

  for (const level of ACCESS_LEVELS) {
    const id: AccessLevel = level.id;

    const discountCeiling = parseAmount(
      String(formData.get(`${id}.discount_ceiling_pct`) ?? ""),
      100,
    );
    if (discountCeiling === null) {
      return fail(`${level.label}'s discount ceiling must be between 0 and 100 per cent.`);
    }

    const khataCeiling = parseAmount(
      String(formData.get(`${id}.khata_ceiling`) ?? ""),
      // numeric(12, 2) — ten digits before the point.
      9_999_999_999,
    );
    if (khataCeiling === null) {
      return fail(`${level.label}'s khata ceiling is not a rupee amount.`);
    }

    const row: Record<string, unknown> = {
      tenant_id: session.tenantId,
      access_level: id,
      discount_ceiling_pct: discountCeiling,
      khata_ceiling: khataCeiling,
    };

    for (const toggle of PERMISSION_TOGGLES) {
      row[toggle.column] = checked(formData, `${id}.${toggle.column}`);
    }

    rows.push(row);
  }

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("role_permissions")
    .select("*")
    .eq("tenant_id", session.tenantId);

  const { error } = await supabase
    .from("role_permissions")
    .upsert(rows, { onConflict: "tenant_id,access_level" });

  if (error) return fail("We could not save the permissions. Please try again.");

  await recordAudit(session, {
    action: "shop.permissions_updated",
    subjectType: "role_permissions",
    subjectId: session.tenantId,
    before,
    after: rows,
  });

  revalidatePath("/app/settings");
  return done();
}
