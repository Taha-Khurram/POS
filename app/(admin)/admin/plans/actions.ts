"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import {
  BRANCHES_MAX,
  HIGHLIGHTS_MAX,
  HIGHLIGHT_MAX,
  PLAN_FEATURES,
  PLAN_LIMITS,
  REGISTERS_MAX,
} from "@/lib/platform/admin";
import { requireBilling } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * The plans, editable without a deploy.
 *
 * That is the whole point of `plans` being a table: "Premium now includes X" is
 * a form rather than a release. What it is not is a licence to promise things.
 * `0020`'s rule stands — a flag is a promise the console can be held to, and an
 * owner on Premium who reads `advanced_reports` and finds a placeholder has
 * been sold something. The editor marks which flags the product actually
 * honours and says plainly that the rest are copy for `/pricing`, because the
 * honest version of "editable without a deploy" includes being told what an
 * edit does and does not do.
 *
 * Since `0045` an edit here is what `/pricing` prints: the name, the price, the
 * pitch, the ceilings, a sentence per flag and the extra lines. Counters is
 * what a new shop on the plan is activated with, and Staff is checked when an
 * owner hires — see `PLAN_LIMITS`.
 *
 * Every write merges over the stored JSON rather than replacing it, the way
 * `0020` and `0021` did: a key added by a future migration, or by somebody at
 * 11 pm, survives a save from this form.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const revalidatePlans = () => {
  revalidatePath("/admin/plans");
  revalidatePath("/admin/clients");
  revalidatePath("/pricing");
};

/** The flags and the ceilings, read off the form and merged over what is
 *  stored. An unchecked box is absent from the body altogether, so absent is
 *  false — but only for the keys this form actually drew. */
function readFeatures(formData: FormData, stored: Record<string, unknown>) {
  const features: Record<string, unknown> = { ...stored };

  for (const feature of PLAN_FEATURES) {
    features[feature.key] = formData.get(`feature:${feature.key}`) === "on";
  }

  for (const limit of PLAN_LIMITS) {
    const raw = text(formData.get(`limit:${limit.key}`));
    // Counters and branches become a subscription's not-null columns the day a
    // shop is activated on this plan, so they have to be a number. Staff may
    // be empty, which is a real answer — no ceiling — and is stored as null.
    const ceiling =
      limit.key === "max_registers" ? REGISTERS_MAX : limit.key === "max_branches" ? BRANCHES_MAX : null;

    if (!raw) {
      if (ceiling !== null) return `${limit.label} needs a number — it is what a new shop on this plan starts with.`;
      features[limit.key] = null;
      continue;
    }

    const value = Number(raw);
    const floor = ceiling === null ? 0 : 1;
    if (!Number.isInteger(value) || value < floor) {
      return ceiling === null
        ? `${limit.label} has to be a whole number, or empty for no limit.`
        : `${limit.label} has to be a whole number, at least 1.`;
    }
    if (ceiling !== null && value > ceiling) return `${limit.label} can be at most ${ceiling}.`;
    features[limit.key] = value;
  }

  return features;
}

/** One line per promise, blanks dropped. Each is printed on `/pricing` as
 *  typed, so the bound is on what a card can carry, not on the database. */
function readHighlights(formData: FormData) {
  const lines = String(formData.get("highlights") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (lines.length > HIGHLIGHTS_MAX) return `At most ${HIGHLIGHTS_MAX} extra lines — a card longer than that is not read.`;
  if (lines.some((line) => line.length > HIGHLIGHT_MAX)) {
    return `Each line can be at most ${HIGHLIGHT_MAX} characters.`;
  }
  return lines;
}

export async function savePlan(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const planId = text(formData.get("plan_id"));
  const name = text(formData.get("name"));
  const pitch = text(formData.get("pitch"));
  const price = Number(text(formData.get("list_price")));
  const sortOrder = Number(text(formData.get("sort_order")) || "0");

  if (!planId) return fail("That plan is not there any more.");
  if (!name) return fail("A plan needs a name — it is what the shop is told they are on.");
  if (!Number.isFinite(price) || price < 0) return fail("The list price has to be a number.");
  if (!Number.isInteger(sortOrder)) return fail("The order has to be a whole number.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("plans")
    .select("code, name, pitch, list_price, features, highlights, sort_order, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!before) return fail("That plan is not there any more.");

  const features = readFeatures(
    formData,
    (before.features as Record<string, unknown> | null) ?? {},
  );

  if (typeof features === "string") return fail(features);

  const highlights = readHighlights(formData);
  if (typeof highlights === "string") return fail(highlights);

  // No `is_active`: whether a plan is on sale has one writer, `togglePlan`.
  // A checkbox here as well was rendered with the value from page load, so
  // taking a plan off sale and then saving its price put it straight back on.
  const row = {
    name,
    pitch: pitch || null,
    list_price: price,
    sort_order: sortOrder,
    features,
    highlights,
  };

  const { error } = await supabase.from("plans").update(row).eq("id", planId);

  if (error) {
    console.error("[admin] plan save failed for %s", planId, error);
    return fail("That plan did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "plan.updated",
    subjectType: "plan",
    subjectId: planId,
    before,
    after: row,
  });

  revalidatePlans();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${name} saved`,
      detail: before.is_active
        ? "/pricing shows it now."
        : "It is off sale, so /pricing does not show it.",
    },
  };
}

/**
 * A new tier.
 *
 * `code` is lower-case and unique by check constraint, and it is what
 * `/checkout` and `getEntitlements` match on — so it is asked for once here and
 * never editable afterwards. Renaming a plan is a display change; re-coding one
 * silently re-points every subscription that quotes it.
 */
export async function createPlan(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const code = text(formData.get("code")).toLowerCase().replace(/[^a-z0-9_]/g, "");
  const name = text(formData.get("name"));
  const price = Number(text(formData.get("list_price")));

  if (!code) return fail("A plan needs a code — lower case, no spaces. “premium”.");
  if (code.length > 30) return fail("That code is too long.");
  if (!name) return fail("A plan needs a name.");
  if (!Number.isFinite(price) || price < 0) return fail("The list price has to be a number.");

  const supabase = createAdminClient();

  // A new plan starts with nothing switched on. The alternative — copying
  // another tier's flags — is how a plan ships promising a feature nobody
  // decided to include in it.
  const { data: created, error } = await supabase
    .from("plans")
    .insert({
      code,
      name,
      pitch: text(formData.get("pitch")) || null,
      list_price: price,
      sort_order: Number(text(formData.get("sort_order")) || "0") || 0,
      is_active: false,
      // The two ceilings a subscription cannot be activated without, at their
      // floor. Every flag stays off.
      features: { max_branches: 1, max_registers: 1 },
    })
    .select("id")
    .single();

  if (error || !created) {
    const duplicate = error?.message.includes("plans_code_key");
    console.error("[admin] plan create failed", error);
    return fail(
      duplicate
        ? "There is already a plan with that code."
        : "That plan could not be created. Please try again.",
    );
  }

  await recordAudit(gate.session, {
    action: "plan.created",
    subjectType: "plan",
    subjectId: created.id,
    after: { code, name, list_price: price },
  });

  revalidatePlans();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${name} created`,
      detail: "It is off until you switch it on. Set what it includes first.",
    },
  };
}

/**
 * Off, not deleted.
 *
 * `subscriptions.plan_id` is `on delete restrict`, so a plan with a shop on it
 * cannot be removed at all — and should not be: the shops already on it keep
 * their entitlements, and what switching it off does is stop `/checkout` and
 * this console offering it to anybody new.
 */
export async function togglePlan(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const planId = text(formData.get("plan_id"));
  const on = text(formData.get("is_active")) === "on";

  if (!planId) return fail("That plan is not there any more.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("plans")
    .select("name, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!before) return fail("That plan is not there any more.");

  const { error } = await supabase
    .from("plans")
    .update({ is_active: on })
    .eq("id", planId);

  if (error) {
    console.error("[admin] plan toggle failed for %s", planId, error);
    return fail("That did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: on ? "plan.enabled" : "plan.disabled",
    subjectType: "plan",
    subjectId: planId,
    before,
    after: { is_active: on },
  });

  revalidatePlans();

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${before.name} is ${on ? "on sale" : "off sale"}`,
      detail: on
        ? undefined
        : "Shops already on it are untouched. Nobody new can be sold it.",
    },
  };
}
