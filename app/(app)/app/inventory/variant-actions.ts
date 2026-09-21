"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import {
  axesOf,
  checkGrid,
  gridOf,
  isVariantAdjustReason,
  VARIANT_BARCODE_MAX,
  VARIANT_SKU_MAX,
  writeVariant,
  type GridDraft,
  type Variant,
} from "@/lib/pos/variant";
import { listVariants } from "@/lib/pos/variants";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE_VARIANT, type VariantState } from "./state";

/**
 * Building an item's grid, and counting one row of it.
 *
 * The grid is written whole by `public.save_variants` rather than a row at a
 * time. A shop setting up a cloth line picks two axes and gets twelve rows;
 * saving them one by one would be twelve saves and eleven chances to stop
 * halfway with a half-built grid the till would offer.
 *
 * **Nothing here deletes a row.** A combination dropped from the grid is
 * switched off, because it may be on last month's receipts and may still have
 * stock — and stock that vanished with a row is stock `items.stock` still
 * counts, which is the one way the two can be made to disagree.
 *
 * Counting a row is `public.adjust_variant`, the same absolute-in
 * relative-down adapter under a row lock that `set_stock` and `adjust_batch`
 * are. Reading, subtracting and writing here would read the count before
 * counter 2 sells two and write a number that un-sells them.
 *
 * Gated by `can_edit_items`, like the rest of Products & stock.
 */

const fail = (error: string): VariantState => ({ ...IDLE_VARIANT, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const raw = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

const amount = (value: FormDataEntryValue | null) => {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};

async function requireCatalog() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.inventory) {
    return {
      ok: false as const,
      error: "You are not allowed to change stock. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

async function ownItem(tenantId: string, itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) return null;

  const { data } = await createAdminClient()
    .from("items")
    .select("id, name, tracking, tracks_batches")
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();

  return data;
}

function revalidateStock() {
  revalidatePath("/app/inventory");
  revalidatePath("/app/register");
}

/**
 * A 23505 from any of the three unique indexes a variant can hit, in words.
 *
 * The barcode one is raised by `0031`'s cross-table trigger as well as by the
 * index, with the same code and constraint name on purpose — so one sentence
 * covers both, and a code already on an ordinary item reads the same as one
 * already on another variant. It is the same problem to the person scanning.
 */
function conflict(message: string): string | null {
  if (message.includes("item_variants_tenant_barcode_idx") ||
      message.includes("already on an item") ||
      message.includes("already on a variant")) {
    return "One of those barcodes is already in use somewhere else in your list. A scanned code has to mean exactly one thing.";
  }

  if (message.includes("item_variants_tenant_sku_idx")) {
    return "One of those SKUs is already in use. Change it, or clear it and leave the row without one.";
  }

  if (message.includes("items_one_stock_split")) {
    return "An item is counted by batch or sold by variant, not both. Switch batch tracking off first.";
  }

  return null;
}

// -----------------------------------------------------------------------------
// The grid
// -----------------------------------------------------------------------------

export async function saveGrid(
  _previous: VariantState,
  formData: FormData,
): Promise<VariantState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const item = await ownItem(session.tenantId, formData.get("item_id"));
  if (!item) {
    return fail("That item is not in your list any more. Reload and try again.");
  }

  if (item.tracking !== "variant") {
    return fail(
      "This item is not sold by variant. Set it to 'By variant' on the item above first.",
    );
  }

  const draft: GridDraft = {
    axisA: text(formData.get("axis_a")),
    valuesA: raw(formData.get("values_a")),
    axisB: text(formData.get("axis_b")),
    valuesB: raw(formData.get("values_b")),
  };

  // The same function the editor greys its save button out with.
  const complaint = checkGrid(draft);
  if (complaint) return fail(complaint);

  const rows = gridOf(draft);

  // Codes and per-row prices, keyed by combination, so a grid that is rebuilt
  // after adding one colour keeps the barcodes already printed on the others.
  // The browser sends them as `code:Small|Blue` fields, which is the only shape
  // that survives a grid whose rows have no ids yet.
  const codes = new Map<string, { sku: string; barcode: string; price: string }>();

  for (const [key, value] of formData.entries()) {
    const match = /^row\[(.*)\]\[(sku|barcode|price)\]$/.exec(key);
    if (!match || typeof value !== "string") continue;

    const entry = codes.get(match[1]) ?? { sku: "", barcode: "", price: "" };
    entry[match[2] as "sku" | "barcode" | "price"] = value.trim();
    codes.set(match[1], entry);
  }

  const { data, error } = await createAdminClient().rpc("save_variants", {
    p_tenant: session.tenantId,
    p_item: item.id,
    p_axes: axesOf(draft),
    p_rows: rows.map((row) => {
      const key = `${row.optionA}|${row.optionB}`;
      const extra = codes.get(key);
      const price = Number(extra?.price ?? "");

      return {
        option_a: row.optionA,
        option_b: row.optionB || null,
        sku: (extra?.sku ?? "").slice(0, VARIANT_SKU_MAX) || null,
        barcode: (extra?.barcode ?? "").slice(0, VARIANT_BARCODE_MAX) || null,
        // Blank means "use the item's", which is the common case and is stored
        // as null rather than as a copy of a number that has one home.
        selling_price: Number.isFinite(price) && extra?.price ? price : null,
        cost_price: null,
      };
    }),
    p_by: session.userId,
  });

  if (error) {
    console.error("[inventory] save_variants failed", error);
    return fail(
      conflict(error.message) ??
        "We could not save that grid. Check the connection and try again.",
    );
  }

  const switchedOff =
    data && typeof data === "object" && "switched_off" in data
      ? Number((data as { switched_off: unknown }).switched_off)
      : 0;

  await recordAudit(session, {
    action: "variants.saved",
    subjectType: "item",
    subjectId: item.id,
    after: {
      item_name: item.name,
      axes: axesOf(draft),
      rows: rows.length,
      switched_off: switchedOff,
    },
  });

  revalidateStock();

  return {
    error: null,
    savedAt: Date.now(),
    saved: {
      action: "grid",
      detail:
        switchedOff > 0
          ? `${rows.length} rows, ${switchedOff} switched off`
          : `${rows.length} rows`,
    },
    variants: await listVariants(session.tenantId, item.id),
  };
}

// -----------------------------------------------------------------------------
// Counting one row
// -----------------------------------------------------------------------------

export async function adjustVariantStock(
  _previous: VariantState,
  formData: FormData,
): Promise<VariantState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const variantId = text(formData.get("variant_id"));
  const reason = text(formData.get("reason"));
  const to = amount(formData.get("to"));

  if (!isVariantAdjustReason(reason)) return fail("Say why the count is changing.");

  if (!Number.isFinite(to) || to < 0) {
    return fail("That count is not a number.");
  }

  const supabase = createAdminClient();

  const { data: variant } = await supabase
    .from("item_variants")
    .select("id, item_id, option_a, option_b, quantity")
    .eq("tenant_id", session.tenantId)
    .eq("id", variantId)
    .maybeSingle();

  if (!variant) {
    return fail("That row is not on this item any more. Reload and try again.");
  }

  const { data, error } = await supabase.rpc("adjust_variant", {
    p_tenant: session.tenantId,
    p_variant: variant.id,
    p_to: to,
    p_reason: reason,
    p_note: text(formData.get("note")).slice(0, 200) || null,
    p_by: session.userId,
  });

  if (error) {
    console.error("[inventory] adjust_variant failed", error);
    return fail("We could not change that count. Check the connection and try again.");
  }

  const moved =
    data && typeof data === "object" && "moved" in data
      ? Boolean((data as { moved: unknown }).moved)
      : false;

  const label = writeVariant({
    optionA: variant.option_a as string,
    optionB: (variant.option_b as string | null) ?? "",
  });

  // Nothing changed, so nothing is audited and nothing is announced — the same
  // call `set_stock` and `adjust_batch` make for a zero delta.
  if (moved) {
    await recordAudit(session, {
      action: "variant.counted",
      subjectType: "item",
      subjectId: variant.item_id as string,
      before: { quantity: variant.quantity },
      after: { variant: label, quantity: to, reason },
    });

    revalidateStock();
  }

  return {
    error: null,
    savedAt: Date.now(),
    saved: { action: "counted", detail: label },
    variants: await listVariants(session.tenantId, variant.item_id as string),
  };
}

/** One item's grid, for the editor to load when it opens. A read through a
 *  Server Action rather than data shipped with the catalog, the same call
 *  `loadBatches` and `loadMovements` make beside it. */
export async function loadVariants(itemId: string): Promise<Variant[]> {
  const gate = await requireCatalog();
  if (!gate.ok) return [];

  const item = await ownItem(gate.session.tenantId, itemId);
  if (!item) return [];

  return listVariants(gate.session.tenantId, item.id);
}
