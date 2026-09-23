"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { generatePassword } from "@/lib/password";
import { isPlatformRole } from "@/lib/platform/admin";
import { requireSuperAdmin } from "@/lib/platform/access";
import { STAFF_NAME_MAX, STAFF_NAME_MIN } from "@/lib/pos/staff-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Who may work this console.
 *
 * Only a `super_admin` gets here — `requireSuperAdmin` 404s everybody else, and
 * `platform_admins_read_self` says the same thing in SQL, so a support account
 * cannot even read the roster.
 *
 * Since `0041` this screen makes the account itself: an email, a name, a level,
 * and Flo mints the password, shown once for the owner to hand over — the
 * bargain `/app/employees` strikes for a cashier, and for the same reason. A
 * person asked to "sign up first and tell me your email" is a person who does
 * it on Tuesday, and the preview allow-list in `login/actions.ts` would have
 * refused them anyway.
 *
 * **An account that also runs a shop is handled differently everywhere below.**
 * It can be granted the console, but it is never banned, never given a new
 * password and never deleted from here: all three would reach through the
 * console into somebody's till. Switching it off or removing it touches the
 * `platform_admins` row alone.
 *
 * Every change takes effect at once, not at the next sign-in:
 * `requirePlatform` re-reads the operator's own row on every request, so the
 * `platform_role` claim still sitting in their token opens nothing.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** Deliberately loose — GoTrue is the validator; this catches a name typed
 *  into the email box before an account is minted for it. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Does this login also belong to a shop? Read on the service role, because
 *  the answer decides whether a ban or a delete would shut somebody's till. */
async function runsAShop(userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  return Boolean(data?.tenant_id);
}

type Row = {
  user_id: string;
  platform_role: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
};

async function onRoster(userId: string): Promise<Row | null> {
  const { data } = await createAdminClient()
    .from("platform_admins")
    .select("user_id, platform_role, full_name, email, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as Row | null) ?? null;
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export async function addOperator(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const email = text(formData.get("email")).toLowerCase();
  const role = text(formData.get("platform_role"));
  const fullName = text(formData.get("full_name"));

  if (!EMAIL_RE.test(email)) return fail("Give the email they will sign in with.");
  if (fullName.length < STAFF_NAME_MIN || fullName.length > STAFF_NAME_MAX) {
    return fail(`Enter their name — between ${STAFF_NAME_MIN} and ${STAFF_NAME_MAX} characters.`);
  }
  if (!isPlatformRole(role)) return fail("Pick full access or support.");

  const supabase = createAdminClient();

  const { data: already } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();

  if (already) return fail("That email is already on the team. Change their access on the list above.");

  const password = generatePassword();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    // The owner hands the password over in person or on WhatsApp; there is no
    // confirmation mail in this flow, and an unconfirmed account cannot sign in.
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  let userId = created?.user?.id ?? null;
  let minted = Boolean(userId);

  if (!userId) {
    if (createError?.code !== "email_exists") {
      console.error("[admin] operator create failed", createError);
      return fail("We could not create that account. Please try again.");
    }

    // The address already has a login — usually a shopkeeper who is also
    // going to help on support. It is granted as it stands, with its own
    // password: minting a new one would change how they open their till.
    //
    // GoTrue's admin API has no "find by email", so the address is matched
    // against the first page of accounts. Honest at this size, and the one
    // thing here that needs rewriting when it is not — an account past the
    // first page is simply not found, and the sentence below says so.
    const { data: found, error: lookupError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });

    if (lookupError) {
      console.error("[admin] operator lookup failed", lookupError);
      return fail("We could not look that account up. Please try again.");
    }

    userId =
      found.users.find((candidate) => candidate.email?.toLowerCase() === email)?.id ?? null;

    if (!userId) return fail("That email already has a login we could not find. Please try again.");
    minted = false;
  }

  const { error } = await supabase.from("platform_admins").insert({
    user_id: userId,
    platform_role: role,
    full_name: fullName,
    email,
  });

  if (error) {
    // An account that exists and is on no roster can sign in to nothing — the
    // half-made state, so it is taken back. Only one this action made, though:
    // an existing login is somebody's and is not ours to delete.
    if (minted) await supabase.auth.admin.deleteUser(userId);
    console.error("[admin] operator grant failed", error);
    return fail("That account could not be given access. Please try again.");
  }

  await recordAudit(session, {
    action: minted ? "platform_admin.created" : "platform_admin.granted",
    subjectType: "platform_admin",
    subjectId: userId,
    // No password, here or anywhere.
    after: { email, platform_role: role, full_name: fullName },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: minted
      ? { label: `${fullName} can sign in now` }
      : {
          label: `${fullName} can work the console`,
          detail: "They already had a login, so they keep their own password.",
        },
    credentials: minted ? { name: fullName, email, password } : null,
  };
}

// -----------------------------------------------------------------------------
// Level
// -----------------------------------------------------------------------------

export async function setOperatorRole(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));
  const role = text(formData.get("platform_role"));

  if (!userId) return fail("That account is not on the roster any more.");
  if (!isPlatformRole(role)) return fail("Pick full access or support.");

  // Demoting yourself is how the last full-access account stops existing, and
  // there is no way back from a console nobody can open.
  if (userId === session.userId && role !== "super_admin") {
    return fail("You cannot take your own full access away. Ask the other holder to do it.");
  }

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the roster any more.");

  const { error } = await createAdminClient()
    .from("platform_admins")
    .update({ platform_role: role })
    .eq("user_id", userId);

  if (error) {
    console.error("[admin] operator role change failed", error);
    return fail("That did not save. Please try again.");
  }

  await recordAudit(session, {
    action: "platform_admin.changed",
    subjectType: "platform_admin",
    subjectId: userId,
    before: { platform_role: before.platform_role },
    after: { platform_role: role },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: "Access changed", detail: "It applies from their next click." },
  };
}

// -----------------------------------------------------------------------------
// Switch off, switch back on
// -----------------------------------------------------------------------------

/**
 * Suspend or reinstate.
 *
 * The row is flagged and — for a console-only account — the auth user is
 * banned too, because a flag is something every code path has to remember and
 * a ban is enforced by GoTrue at the sign-in itself, the call `saveStaff`
 * makes. An account that runs a shop is not banned: its console goes, its till
 * stays.
 */
export async function setOperatorActive(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));
  const active = formData.get("is_active") === "true";

  if (userId === session.userId) return fail("You cannot switch your own access off.");

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the roster any more.");
  if (before.is_active === active) return fail("Nothing to change — reload the list.");

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("platform_admins")
    .update({ is_active: active })
    .eq("user_id", userId);

  if (error) {
    console.error("[admin] operator standing change failed", error);
    return fail("That did not save. Please try again.");
  }

  if (!(await runsAShop(userId))) {
    // A hundred years, which is how GoTrue spells "until somebody lifts it".
    const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : "876000h",
    });

    // The row and the login door must not disagree about whether this person
    // still works here, so the row goes back.
    if (banError) {
      await supabase
        .from("platform_admins")
        .update({ is_active: before.is_active })
        .eq("user_id", userId);

      console.error("[admin] operator ban change failed", banError);
      return fail(
        active
          ? "We could not let them back in. Please try again."
          : "We could not switch that account off — it can still sign in. Please try again.",
      );
    }
  }

  await recordAudit(session, {
    action: active ? "platform_admin.reinstated" : "platform_admin.suspended",
    subjectType: "platform_admin",
    subjectId: userId,
    before: { is_active: before.is_active },
    after: { is_active: active },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: active
      ? { label: "Switched back on", detail: "They can sign in with the password they had." }
      : { label: "Switched off", detail: "They are out of the console from their next click." },
  };
}

// -----------------------------------------------------------------------------
// New password
// -----------------------------------------------------------------------------

/**
 * A new password for somebody who has lost theirs. There is no reset mail —
 * the owner handed over the first one and is the recovery path for the next.
 * Refused for a login that runs a shop, whose password is the shopkeeper's own.
 */
export async function resetOperatorPassword(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));

  if (userId === session.userId) {
    return fail("Your own password is not changed from here.");
  }

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the roster any more.");

  if (await runsAShop(userId)) {
    return fail("That login also runs a shop, so its password is theirs to change, not ours.");
  }

  const password = generatePassword();

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });

  if (error) {
    console.error("[admin] operator password reset failed", error);
    return fail("We could not change that password. Please try again.");
  }

  await recordAudit(session, {
    action: "platform_admin.password_reset",
    subjectType: "platform_admin",
    subjectId: userId,
    after: { email: before.email },
  });

  const name = before.full_name ?? before.email ?? "This operator";

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: `New password for ${name}` },
    credentials: { name, email: before.email ?? "", password },
  };
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Off the team for good.
 *
 * A console-only account is deleted outright — the login existed for this
 * console and nothing else. The row cascades from `auth.users`, and every
 * column that points at the person (`payments.recorded_by`,
 * `tenant_notes.author_id`, `orders.verified_by`, …) is `on delete set null`,
 * so the history stays and only stops saying who did it. `audit_log` keeps the
 * actor's email as text, which is the record that matters.
 *
 * An account that runs a shop loses its row and keeps its login.
 */
export async function removeOperator(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));
  if (!userId) return fail("That account is not on the roster any more.");

  if (userId === session.userId) {
    return fail("You cannot remove your own access from here.");
  }

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the roster any more.");

  const supabase = createAdminClient();
  const keepsLogin = await runsAShop(userId);

  const { error } = keepsLogin
    ? await supabase.from("platform_admins").delete().eq("user_id", userId)
    : await supabase.auth.admin.deleteUser(userId);

  if (error) {
    console.error("[admin] operator removal failed", error);
    return fail("That account could not be removed. Please try again.");
  }

  await recordAudit(session, {
    action: keepsLogin ? "platform_admin.revoked" : "platform_admin.deleted",
    subjectType: "platform_admin",
    subjectId: userId,
    before,
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: keepsLogin
      ? { label: "Access removed", detail: "Their shop login still works; the console does not." }
      : { label: "Account deleted", detail: "That email and password open nothing now." },
  };
}
