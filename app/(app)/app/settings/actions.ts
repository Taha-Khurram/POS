"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession, type SessionContext } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getEntitlements } from "@/lib/entitlements";
import {
  RECEIPT_FOOTER_MAX,
  RECEIPT_PREFIX_RE,
  newCounterDefaults,
} from "@/lib/pos/counter";
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
 * The four Settings forms.
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

// -----------------------------------------------------------------------------
// Counters
//
// A shop has as many as its plan allows, each with its own receipt series and
// its own register. `max_registers` comes from `getEntitlements`, which is the
// single authority on what a plan allows — the cap is not re-stated here.
// -----------------------------------------------------------------------------

/** The counter's id arrives in the form, so it is checked against the tenant's
 *  own rows before anything is written. A crafted id must not reach `.eq()`. */
async function ownCounter(tenantId: string, counterId: unknown) {
  if (typeof counterId !== "string" || !counterId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("counters")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", counterId)
    .maybeSingle();

  return data?.id ?? null;
}

export async function saveCounter(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const counterId = await ownCounter(session.tenantId, formData.get("counter_id"));
  if (!counterId) return fail("That counter is not one of yours. Reload and try again.");

  const name = text(formData.get("name"));
  if (!name) return fail("Give the counter a name — the receipt prints it.");

  // Typed in lower case as often as not, and the constraint only accepts upper.
  // Correcting it here is kinder than bouncing the form for a shift key.
  const receiptPrefix = text(formData.get("receipt_prefix")).toUpperCase();
  if (!RECEIPT_PREFIX_RE.test(receiptPrefix)) {
    return fail(
      "The receipt prefix must be 1 to 8 letters, digits or dashes — ALM, or SHOP-1.",
    );
  }

  const footer = text(formData.get("receipt_footer"));
  if (footer.length > RECEIPT_FOOTER_MAX) {
    return fail(
      `The footer line has to fit the roll — ${RECEIPT_FOOTER_MAX} characters at most.`,
    );
  }

  const acceptsCash = checked(formData, "accepts_cash");
  const acceptsCard = checked(formData, "accepts_card");
  const isActive = checked(formData, "is_active");

  // An open counter that can take neither cash nor card is a register with a
  // Charge button that cannot finish a sale. Refused here rather than
  // discovered by a cashier with a queue.
  if (isActive && !acceptsCash && !acceptsCard) {
    return fail("An open counter has to take cash, card, or both.");
  }

  const after = {
    name,
    is_active: isActive,
    receipt_prefix: receiptPrefix,
    accepts_cash: acceptsCash,
    accepts_card: acceptsCard,
    receipt_footer: footer || null,
    auto_print: checked(formData, "auto_print"),
  };

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("counters")
    .select(
      "name, is_active, receipt_prefix, accepts_cash, accepts_card, receipt_footer, auto_print",
    )
    .eq("id", counterId)
    .maybeSingle();

  const { error } = await supabase
    .from("counters")
    .update(after)
    .eq("id", counterId)
    .eq("tenant_id", session.tenantId);

  if (error) {
    // The one failure worth naming: two counters cannot share a prefix, or
    // their receipt numbers stop telling the tills apart.
    return fail(
      error.code === "23505"
        ? `Another counter already uses the prefix ${receiptPrefix}. Give this one its own.`
        : "We could not save the counter. Please try again.",
    );
  }

  await recordAudit(session, {
    // Opening and closing a counter is the entry somebody will come looking for
    // after an argument about a missing afternoon of sales, so it is named for
    // the switch rather than for the form.
    action: isActive ? "counter.opened" : "counter.closed",
    subjectType: "counter",
    subjectId: counterId,
    before,
    after,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app/register");
  return done();
}

/**
 * Add a counter, then go straight to its settings.
 *
 * It arrives shut, named for its position, and with a prefix cut from the same
 * number — all three of which the owner is about to change, which is why this
 * redirects into the editor rather than dropping a half-configured till into a
 * list and leaving them to find it.
 */
export async function addCounter(): Promise<void> {
  const owner = await requireOwner();
  // A plain action behind a button, so there is no state to return a sentence
  // in. The panel only draws the button when there is room; this is the check
  // that actually holds.
  if (!owner.ok) redirect("/app/settings?tab=counter");
  const { session } = owner;

  const supabase = createAdminClient();

  const [{ data: existing }, entitlements, branchId] = await Promise.all([
    supabase
      .from("counters")
      .select("sort_order")
      .eq("tenant_id", session.tenantId)
      .order("sort_order", { ascending: false }),
    getEntitlements(session.tenantId),
    primaryBranch(session.tenantId),
  ]);

  const counters = existing ?? [];
  const allowed = entitlements?.maxRegisters ?? 1;

  if (counters.length >= allowed) redirect("/app/settings?tab=counter&full=1");

  const position = (counters[0]?.sort_order ?? 0) + 1;
  const seed = newCounterDefaults(position);

  const { data: created, error } = await supabase
    .from("counters")
    .insert({
      tenant_id: session.tenantId,
      name: seed.name,
      receipt_prefix: seed.receiptPrefix,
      is_active: seed.isActive,
      accepts_cash: seed.acceptsCash,
      accepts_card: seed.acceptsCard,
      auto_print: seed.autoPrint,
      sort_order: seed.sortOrder,
      // Inherits the shop's branch. Nothing picks one yet — there is one per
      // shop — but `sales.branch_id` is not-null, so a counter without one
      // cannot record a sale.
      branch_id: branchId,
    })
    .select("id")
    .single();

  if (error || !created) redirect("/app/settings?tab=counter&failed=1");

  await recordAudit(session, {
    action: "counter.added",
    subjectType: "counter",
    subjectId: created.id,
    after: seed,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app/register");
  redirect(`/app/settings?tab=counter&counter=${created.id}`);
}

/**
 * Remove a counter.
 *
 * Refused once it has rung up a sale. `sales.counter_id` is `on delete
 * restrict` for exactly this reason: a day's takings that cannot say which till
 * took the money is not a day's takings, and the fix for a counter a shop has
 * stopped using is to shut it, not to erase where its money came from.
 */
export async function deleteCounter(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const owner = await requireOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const counterId = await ownCounter(session.tenantId, formData.get("counter_id"));
  if (!counterId) return fail("That counter is not one of yours. Reload and try again.");

  const supabase = createAdminClient();

  const { count } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("counter_id", counterId);

  if (count && count > 0) {
    return fail(
      `This counter has ${count} ${count === 1 ? "sale" : "sales"} against it, so it cannot be deleted — that money has to stay accounted for. Switch it off instead.`,
    );
  }

  const { data: before } = await supabase
    .from("counters")
    .select("name, receipt_prefix, is_active")
    .eq("id", counterId)
    .maybeSingle();

  const { error } = await supabase
    .from("counters")
    .delete()
    .eq("id", counterId)
    .eq("tenant_id", session.tenantId);

  if (error) return fail("We could not delete the counter. Please try again.");

  await recordAudit(session, {
    action: "counter.deleted",
    subjectType: "counter",
    subjectId: counterId,
    before,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app/register");
  redirect("/app/settings?tab=counter");
}

/** The shop's one branch. 0011 gives every tenant a primary one; this is the
 *  lookup a counter created after that migration ran needs. */
async function primaryBranch(tenantId: string): Promise<string | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("is_primary", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
