"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { generatePassword } from "@/lib/password";
import { PLATFORM_SCREENS, isPlatformScreen, type PlatformScreen } from "@/lib/platform/admin";
import { requireSuperAdmin } from "@/lib/platform/access";
import { forgetPassword, keepPassword, readPassword } from "@/lib/platform/sealed";
import { STAFF_NAME_MAX, STAFF_NAME_MIN, workEmail } from "@/lib/pos/staff-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Who may work this console, and which screens each of them gets.
 *
 * Only the Flo owner gets here — `requireSuperAdmin` 404s everybody else, and
 * `platform_admins_read_self` says the same thing in SQL, so a team member
 * cannot even read the roster.
 *
 * Since `0047` a member is a name and a set of ticked screens. Flo mints both
 * halves of the login — `ali.raza@team.flopos.pk` and a password — because the
 * owner is going to send them on WhatsApp either way, and a person asked for
 * "an email to use" is a person who answers on Tuesday. The password is kept
 * sealed (`lib/platform/sealed.ts`) so Reveal can show it again; every reveal
 * is an audit row.
 *
 * **An account that also runs a shop is handled differently everywhere below.**
 * Only rows made before `0047` can be one. It is never banned, never given a
 * new password and never deleted from here: all three would reach through the
 * console into somebody's till.
 *
 * Every change takes effect at once, not at the next sign-in:
 * `requirePlatform` re-reads the member's own row — standing and screens — on
 * every request, so whatever their token says opens nothing.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** The ticked boxes, in rail order, with anything that is not a screen dropped. */
function readScreens(formData: FormData): PlatformScreen[] {
  const ticked = new Set(formData.getAll("screens").map(String).filter(isPlatformScreen));
  return PLATFORM_SCREENS.map((screen) => screen.id).filter((id) => ticked.has(id));
}

/** The subdomain every member's username sits under. A shop called "Team"
 *  would share it, which is why the suffix loop below steps past a taken one. */
const TEAM_SUBDOMAIN = "team";

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
  screens: string[];
};

async function onRoster(userId: string): Promise<Row | null> {
  const { data } = await createAdminClient()
    .from("platform_admins")
    .select("user_id, platform_role, full_name, email, is_active, screens")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as Row | null) ?? null;
}

/** The owner's own row, or another owner's, is not edited from here. */
const isOwnerRow = (row: Row) => row.platform_role === "super_admin";

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export async function addOperator(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const fullName = text(formData.get("full_name"));
  const screens = readScreens(formData);

  if (fullName.length < STAFF_NAME_MIN || fullName.length > STAFF_NAME_MAX) {
    return fail(`Enter their name — between ${STAFF_NAME_MIN} and ${STAFF_NAME_MAX} characters.`);
  }
  if (screens.length === 0) return fail("Tick at least one screen they may use.");

  const supabase = createAdminClient();
  const password = generatePassword();

  // The second Ali is `ali2@team.flopos.pk`, not a form asking the owner to be
  // more creative about names — the same bargain `/app/employees` strikes.
  let userId: string | null = null;
  let email = "";

  for (let suffix = 0; suffix < 25 && !userId; suffix += 1) {
    email = workEmail(fullName, TEAM_SUBDOMAIN, suffix);

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      // Nothing is ever delivered to a flopos.pk address, and an unconfirmed
      // account cannot sign in.
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (created?.user) {
      userId = created.user.id;
    } else if (error?.code !== "email_exists") {
      console.error("[admin] operator create failed", error);
      return fail("We could not create that account. Please try again.");
    }
  }

  if (!userId) return fail("We could not find a free username for that name. Try adding a surname.");

  const { error } = await supabase.from("platform_admins").insert({
    user_id: userId,
    platform_role: "support",
    full_name: fullName,
    email,
    screens,
  });

  if (error) {
    // A login on no roster signs in to nothing — the half-made state, so it is
    // taken back.
    await supabase.auth.admin.deleteUser(userId);
    console.error("[admin] operator grant failed", error);
    return fail("That account could not be given access. Please try again.");
  }

  const kept = await keepPassword(userId, password);

  await recordAudit(session, {
    action: "platform_admin.created",
    subjectType: "platform_admin",
    subjectId: userId,
    // No password, here or anywhere.
    after: { email, full_name: fullName, screens },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${fullName} can sign in now`,
      detail: kept ? undefined : "Copy the password now — it could not be saved for Reveal.",
    },
    credentials: { name: fullName, email, password },
  };
}

// -----------------------------------------------------------------------------
// Screens
// -----------------------------------------------------------------------------

export async function setOperatorScreens(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));
  const screens = readScreens(formData);

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the team any more.");
  if (isOwnerRow(before)) return fail("The Flo owner has every screen already.");
  if (screens.length === 0) {
    return fail("Leave at least one screen ticked — or switch them off instead.");
  }

  const { error } = await createAdminClient()
    .from("platform_admins")
    .update({ screens })
    .eq("user_id", userId);

  if (error) {
    console.error("[admin] operator screens change failed", error);
    return fail("That did not save. Please try again.");
  }

  await recordAudit(session, {
    action: "platform_admin.screens_changed",
    subjectType: "platform_admin",
    subjectId: userId,
    before: { screens: before.screens },
    after: { screens },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: "Access saved", detail: "It applies from their next click." },
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
  if (!before) return fail("That account is not on the team any more.");
  if (isOwnerRow(before)) return fail("The Flo owner's account is not switched off from here.");
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
// Reveal, and a new password
// -----------------------------------------------------------------------------

/**
 * Show a member's login again. The one read in this file that writes an audit
 * row, because it is the one read that hands somebody a way in.
 */
export async function revealOperatorLogin(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the team any more.");
  if (isOwnerRow(before)) return fail("Your own password is not shown here.");

  if (await runsAShop(userId)) {
    return fail("That login also runs a shop, so its password is theirs and Flo never kept it.");
  }

  const password = await readPassword(userId);
  if (!password) {
    return fail("Flo has no saved password for this account. Press New password to make one.");
  }

  await recordAudit(session, {
    action: "platform_admin.login_revealed",
    subjectType: "platform_admin",
    subjectId: userId,
    after: { email: before.email },
  });

  const name = before.full_name ?? before.email ?? "This member";

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: `Login for ${name}` },
    credentials: { name, email: before.email ?? "", password },
  };
}

/**
 * A new password for somebody who has lost theirs, or somebody who may have
 * seen it who should not have. There is no reset mail — the owner is the
 * recovery path. Refused for a login that runs a shop, whose password is the
 * shopkeeper's own.
 */
export async function resetOperatorPassword(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the team any more.");
  if (isOwnerRow(before)) return fail("Your own password is not changed from here.");

  if (await runsAShop(userId)) {
    return fail("That login also runs a shop, so its password is theirs to change, not ours.");
  }

  const password = generatePassword();

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });

  if (error) {
    console.error("[admin] operator password reset failed", error);
    return fail("We could not change that password. Please try again.");
  }

  const kept = await keepPassword(userId, password);

  await recordAudit(session, {
    action: "platform_admin.password_reset",
    subjectType: "platform_admin",
    subjectId: userId,
    after: { email: before.email },
  });

  const name = before.full_name ?? before.email ?? "This member";

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `New password for ${name}`,
      detail: kept ? "The old one stopped working." : "Copy it now — it could not be saved for Reveal.",
    },
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
 * console and nothing else. The row and the sealed password cascade from
 * `auth.users`, and every column that points at the person
 * (`payments.recorded_by`, `tenant_notes.author_id`, `orders.verified_by`, …)
 * is `on delete set null`, so the history stays and only stops saying who did
 * it. `audit_log` keeps the actor's email as text, which is the record that
 * matters.
 *
 * An account that runs a shop loses its row and keeps its login.
 */
export async function removeOperator(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const userId = text(formData.get("user_id"));

  const before = await onRoster(userId);
  if (!before) return fail("That account is not on the team any more.");
  if (isOwnerRow(before)) return fail("The Flo owner's account is not removed from here.");

  const supabase = createAdminClient();
  const keepsLogin = await runsAShop(userId);

  const { error } = keepsLogin
    ? await supabase.from("platform_admins").delete().eq("user_id", userId)
    : await supabase.auth.admin.deleteUser(userId);

  if (error) {
    console.error("[admin] operator removal failed", error);
    return fail("That account could not be removed. Please try again.");
  }

  if (keepsLogin) await forgetPassword(userId);

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
      : { label: "Account deleted", detail: "That username and password open nothing now." },
  };
}
