"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { featureLimit, getEntitlements } from "@/lib/entitlements";
import { generatePassword } from "@/lib/password";
import {
  PHONE_RE,
  STAFF_NAME_MAX,
  STAFF_NAME_MIN,
  isStaffRole,
  workEmail,
  type StaffRole,
} from "@/lib/pos/staff-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type StaffState } from "./state";

/**
 * Hiring, editing and removing staff.
 *
 * Every one of these writes with the service role, because the schema has no
 * update policy for a tenant JWT anywhere and because creating an auth user is
 * something only the service role can do at all. That makes `requireOwner()`
 * the whole of access control here: the tenant comes from the signed token's
 * claim and never from the form, and the `.eq("tenant_id", …)` on every lookup
 * is what stops a crafted id from editing somebody else's cashier.
 *
 * Only the owner may write — the one check worth being loud about on this
 * screen in particular, because a manager who could edit staff could promote
 * themselves to owner in two taps and there would be no record of who had
 * agreed to it.
 */

const fail = (error: string): StaffState => ({ ...IDLE, error });
const done = (): StaffState => ({ ...IDLE, savedAt: Date.now() });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/** Owner-only, in the words this screen uses. */
async function requireShopOwner() {
  const owner = await requireOwner();

  if (owner.ok) return owner;

  return {
    ok: false as const,
    error:
      owner.reason === "detached"
        ? "This login is not linked to a shop yet."
        : "Only the shop owner can add or change staff.",
  };
}

// -----------------------------------------------------------------------------
// Validation, shared by hiring and editing
// -----------------------------------------------------------------------------

type Details = {
  name: string;
  phone: string | null;
  role: StaffRole;
  /** The counter id as submitted. Checked against the shop's own before it
   *  is written — the composite foreign key from `0013` refuses a stranger's
   *  counter outright, but a clear sentence beats a 23503. */
  counterId: string | null;
};

/** The details, or the sentence to put under the form. */
function readDetails(formData: FormData): Details | string {
  const name = text(formData.get("full_name"));

  if (name.length < STAFF_NAME_MIN || name.length > STAFF_NAME_MAX) {
    return `Enter the staff member's name — between ${STAFF_NAME_MIN} and ${STAFF_NAME_MAX} characters.`;
  }

  const phone = text(formData.get("phone"));
  if (phone && !PHONE_RE.test(phone)) {
    return "That phone number does not look right. 03001234567, or leave it empty.";
  }

  const role = text(formData.get("tenant_role"));
  if (!isStaffRole(role)) return "Pick cashier or store manager.";

  // "" is the "ask this device" option, which is the absence of an assignment
  // rather than a counter named the empty string.
  const counterId = text(formData.get("counter_id")) || null;

  return { name, phone: phone || null, role, counterId };
}

/**
 * Is that counter this shop's?
 *
 * Any of them, not only the open ones: the select offers shut counters too, so
 * that an owner shutting a till for the afternoon does not silently unassign
 * everybody who stands at it. The register is what refuses to bill from a shut
 * counter, and it already does.
 */
async function ownCounter(
  tenantId: string,
  counterId: string | null,
): Promise<boolean> {
  if (!counterId) return true;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("counters")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", counterId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Claim a work address for this shop.
 *
 * The suffix loop is the whole of it: the second Bilal at Al-Madina becomes
 * `bilal2@almadina.flopos.pk` rather than a form that bounces the owner for
 * hiring two people with the same first name. `profiles.email` carries a unique
 * index and `auth.users` has one of its own, so this is a way to find a free
 * address quickly and not the thing that guarantees it is free — the insert is.
 */
async function claimEmail(
  staffName: string,
  shopName: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  for (let suffix = 0; suffix < 25; suffix += 1) {
    const candidate = workEmail(staffName, shopName, suffix);

    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", candidate)
      .maybeSingle();

    if (!data) return candidate;
  }

  return null;
}

/** The shop's one branch, inherited by a new staff member. */
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

/**
 * The staff member's id arrives in the form, so it is checked against the
 * shop's own rows before anything is written — and the owner's own row is
 * refused here rather than in each caller. A crafted id must not reach `.eq()`,
 * and the owner must not be reachable from a screen that can also delete.
 */
async function ownStaff(tenantId: string, staffId: unknown) {
  if (typeof staffId !== "string" || !staffId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, tenant_role, counter_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("id", staffId)
    .maybeSingle();

  if (!data || data.tenant_role === "owner") return null;
  return data;
}

// -----------------------------------------------------------------------------
// Add
// -----------------------------------------------------------------------------

/**
 * Hire someone.
 *
 * Two writes that have to hold together — an auth user, then the `profiles` row
 * that tells the access-token hook which shop they belong to and what they may
 * do. There is no transaction across those two, so a failed profile deletes the
 * user it was for: an auth account with no profile signs in successfully, gets
 * a null `tenant_id` claim, and lands on a console that can read nothing. That
 * is a worse state to leave a shop in than a refused form.
 */
export async function addStaff(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const owner = await requireShopOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const details = readDetails(formData);
  if (typeof details === "string") return fail(details);

  if (!(await ownCounter(session.tenantId, details.counterId))) {
    return fail("That counter is not one of yours. Reload and try again.");
  }

  const supabase = createAdminClient();

  // The plan's Staff ceiling (`max_staff_pins`, set on /admin/plans and
  // printed on /pricing). Every account but the owner's counts, switched off or
  // not — switching one back on is not a hire, so it is never refused, and a
  // ceiling lowered later stops new hires without removing anybody. Read live
  // off the plan, so it follows the editor rather than the day the shop signed.
  const entitlements = await getEntitlements(session.tenantId);
  const ceiling = entitlements ? featureLimit(entitlements, "max_staff_pins") : null;

  if (ceiling !== null) {
    const { count, error: countError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .neq("tenant_role", "owner");

    if (countError) return fail("We could not check your staff list. Please try again.");

    if ((count ?? 0) >= ceiling) {
      return fail(
        `Your plan covers ${ceiling} staff ${ceiling === 1 ? "account" : "accounts"} and all of them are in use. Delete one you no longer need, or message us about a bigger plan.`,
      );
    }
  }

  const [{ data: shop }, branchId] = await Promise.all([
    supabase
      .from("tenants")
      .select("shop_name")
      .eq("id", session.tenantId)
      .maybeSingle(),
    primaryBranch(session.tenantId),
  ]);

  const email = await claimEmail(details.name, shop?.shop_name ?? "shop");
  if (!email) {
    return fail(
      "We could not make a work email for that name. Try their full name, or a different spelling.",
    );
  }

  const password = generatePassword();

  const { data: created, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    // Nothing is ever delivered to this address — there is no inbox behind it.
    // Leaving it unconfirmed would mean a cashier who cannot sign in until an
    // email that will never arrive has been opened.
    email_confirm: true,
    user_metadata: { full_name: details.name },
  });

  if (userError || !created.user) {
    return fail("We could not create that account. Please try again.");
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    tenant_id: session.tenantId,
    branch_id: branchId,
    tenant_role: details.role,
    full_name: details.name,
    phone: details.phone,
    counter_id: details.counterId,
    email,
    created_by: session.userId,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return fail("We could not attach that account to your shop. Please try again.");
  }

  await recordAudit(session, {
    action: "staff.added",
    subjectType: "profile",
    subjectId: created.user.id,
    // No password, here or anywhere. The trail records that an account was made
    // and by whom, which is the question it exists to answer.
    after: {
      email,
      tenant_role: details.role,
      full_name: details.name,
      counter_id: details.counterId,
    },
  });

  revalidatePath("/app/employees");

  return {
    error: null,
    savedAt: Date.now(),
    credentials: { name: details.name, email, password },
  };
}

// -----------------------------------------------------------------------------
// Edit
// -----------------------------------------------------------------------------

/**
 * Change a staff member's name, phone, role, or whether they may sign in.
 *
 * The work email is not on that list. It is their login and it is printed on
 * nothing, so renaming it would silently lock out a cashier standing at the
 * counter with the old one written on a chit — and there is no gain to weigh
 * against that.
 *
 * Suspending bans the auth user rather than only flipping `is_active`, because
 * a flag on a table is a flag every future code path has to remember to read.
 * The ban is enforced by GoTrue at the sign-in itself, so a suspended cashier
 * cannot get a session even if this app forgets to ask.
 */
export async function saveStaff(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const owner = await requireShopOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const before = await ownStaff(session.tenantId, formData.get("staff_id"));
  if (!before) {
    return fail("That staff member is not one of yours. Reload and try again.");
  }

  const details = readDetails(formData);
  if (typeof details === "string") return fail(details);

  if (!(await ownCounter(session.tenantId, details.counterId))) {
    return fail("That counter is not one of yours. Reload and try again.");
  }

  const isActive = formData.get("is_active") === "on";

  const supabase = createAdminClient();

  const after = {
    full_name: details.name,
    phone: details.phone,
    tenant_role: details.role,
    counter_id: details.counterId,
    is_active: isActive,
  };

  const { error } = await supabase
    .from("profiles")
    .update(after)
    .eq("id", before.id)
    .eq("tenant_id", session.tenantId);

  if (error) return fail("We could not save those changes. Please try again.");

  if (isActive !== before.is_active) {
    // A hundred years, which is how GoTrue spells "until somebody lifts it".
    const { error: banError } = await supabase.auth.admin.updateUserById(before.id, {
      ban_duration: isActive ? "none" : "876000h",
    });

    // The row saved and the ban did not, so the roster would say one thing and
    // the login door another. Put the row back rather than leave the two
    // disagreeing about whether this person still works here.
    if (banError) {
      await supabase
        .from("profiles")
        .update({ is_active: before.is_active })
        .eq("id", before.id);

      return fail(
        isActive
          ? "We could not let them back in. Please try again."
          : "We could not suspend that account — they can still sign in. Please try again.",
      );
    }
  }

  await recordAudit(session, {
    // A role change and a suspension are the two entries somebody comes looking
    // for after an argument, so they are named for what happened rather than
    // for the form that did it.
    action:
      isActive === before.is_active
        ? "staff.updated"
        : isActive
          ? "staff.reinstated"
          : "staff.suspended",
    subjectType: "profile",
    subjectId: before.id,
    before,
    after,
  });

  revalidatePath("/app/employees");
  return done();
}

// -----------------------------------------------------------------------------
// New password
// -----------------------------------------------------------------------------

/**
 * Mint a new password for somebody who has lost theirs.
 *
 * Not a reset link — there is no inbox at the other end of a work address to
 * send one to. The owner is the recovery path, which is the trade that comes
 * with generating the credentials in the first place: they hand the new one
 * over the same way they handed over the first.
 */
export async function resetStaffPassword(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const owner = await requireShopOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const staff = await ownStaff(session.tenantId, formData.get("staff_id"));
  if (!staff) {
    return fail("That staff member is not one of yours. Reload and try again.");
  }

  const password = generatePassword();

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(staff.id, { password });

  if (error) return fail("We could not change that password. Please try again.");

  await recordAudit(session, {
    action: "staff.password_reset",
    subjectType: "profile",
    subjectId: staff.id,
    after: { email: staff.email },
  });

  return {
    error: null,
    savedAt: Date.now(),
    credentials: {
      name: staff.full_name ?? staff.email ?? "This staff member",
      email: staff.email ?? "",
      password,
    },
  };
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove somebody for good.
 *
 * Deleting the auth user cascades to `profiles`, which is why the profile is
 * not deleted first — a profile gone with the user still standing is an account
 * that can sign in and read nothing, the same broken state `addStaff` guards
 * against from the other end.
 *
 * What it deliberately does not touch is their sales. `sales.created_by` is
 * `on delete set null`, so the day's takings stay where they were and only stop
 * saying who rang them up. A shop whose cashier walked out with money in the
 * drawer needs that history more than it needs a tidy roster — which is why
 * suspending sits first on the card and is the right answer almost every time.
 */
export async function deleteStaff(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const owner = await requireShopOwner();
  if (!owner.ok) return fail(owner.error);
  const { session } = owner;

  const staff = await ownStaff(session.tenantId, formData.get("staff_id"));
  if (!staff) {
    return fail("That staff member is not one of yours. Reload and try again.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(staff.id);

  if (error) {
    // The sentence the owner gets cannot be the one Postgres wrote, so the real
    // one has to go somewhere. This exact failure — "Database error deleting
    // user" for every account in the shop — was the append-only trigger on
    // `audit_log` refusing the `on delete set null` that the FK made Postgres
    // run, and it took 0014 to find because nothing anywhere said so.
    console.error("[staff] deleteUser failed for %s", staff.id, error);
    return fail("We could not remove that account. Please try again.");
  }

  await recordAudit(session, {
    action: "staff.deleted",
    subjectType: "profile",
    subjectId: staff.id,
    before: staff,
  });

  revalidatePath("/app/employees");
  redirect("/app/employees");
}
