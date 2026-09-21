"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { PLAN_FEATURES, PLAN_LIMITS } from "@/lib/platform/admin";
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
    // Empty means no ceiling, which is a real answer and is stored as null —
    // `featureLimit` reads anything non-numeric as "no limit".
    if (!raw) {
      features[limit.key] = null;
      continue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return `${limit.label} has to be a whole number, or empty for no limit.`;
    features[limit.key] = value;
  }

  return features;
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
    .select("code, name, pitch, list_price, features, sort_order, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!before) return fail("That plan is not there any more.");

  const features = readFeatures(
    formData,
    (before.features as Record<string, unknown> | null) ?? {},
  );

  if (typeof features === "string") return fail(features);

  const row = {
    name,
    pitch: pitch || null,
    list_price: price,
    sort_order: sortOrder,
    is_active: text(formData.get("is_active")) === "on",
    features,
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
      detail: row.is_active ? undefined : "It is off, so nothing can be sold on it.",
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
      features: {},
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
