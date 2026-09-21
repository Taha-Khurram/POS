"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { isPlatformRole } from "@/lib/platform/admin";
import { requireSuperAdmin } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Who may work this console.
 *
 * Only a `super_admin` gets here — `requireSuperAdmin` 404s everybody else, and
 * `platform_admins_read_self` says the same thing in SQL, so a support account
 * cannot even read the roster.
 *
 * An operator is made from an account that already exists. There is no "invite
 * an admin" flow and there should not be: creating an auth user is
 * `/signup`'s single job, guarded by a hashed one-time token, and a second
 * route that mints users would be a second thing to get right. The person signs
 * up or is created in Supabase, tells you the email, and you grant it here.
 *
 * Granting takes effect on their **next sign-in**, because `platform_role` is a
 * JWT claim stamped by `custom_access_token_hook` and the token already in
 * their browser predates the row. The screen says so rather than leaving
 * somebody refreshing `/admin` and getting a 404 they cannot explain.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export async function addOperator(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requireSuperAdmin();

  const email = text(formData.get("email")).toLowerCase();
  const role = text(formData.get("platform_role"));
  const fullName = text(formData.get("full_name"));

  if (!email) return fail("Which account? Give the email they sign in with.");
  if (!isPlatformRole(role)) return fail("Pick full access or support.");

  const supabase = createAdminClient();

  // GoTrue's admin API has no "find by email", so the address is matched
  // against the first page of accounts. That is honest at this size — a
  // platform with two hundred auth users has not happened yet — and it is the
  // one thing on this screen that will need rewriting when it does, rather
  // than a subtle bug: an account past the first page is simply not found, and
  // the refusal below says so in words somebody can act on.
  const { data: found, error: lookupError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (lookupError) {
    console.error("[admin] operator lookup failed", lookupError);
    return fail("We could not look that account up. Please try again.");
  }

  const user = found.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );

  if (!user) {
    return fail(
      "No account signs in with that email yet. Create it in Supabase first, then grant it here.",
    );
  }

  const { error } = await supabase.from("platform_admins").upsert(
    {
      user_id: user.id,
      platform_role: role,
      full_name: fullName || (user.user_metadata?.full_name as string) || null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[admin] operator grant failed", error);
    return fail("That account could not be granted access. Please try again.");
  }

  await recordAudit(session, {
    action: "platform_admin.granted",
    subjectType: "platform_admin",
    subjectId: user.id,
    after: { email, platform_role: role },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${email} can work the console`,
      detail: "It takes effect when they next sign in.",
    },
  };
}

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

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("platform_admins")
    .select("platform_role, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (!before) return fail("That account is not on the roster any more.");

  const { error } = await supabase
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
    before,
    after: { platform_role: role },
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: "Access changed", detail: "It applies at their next sign-in." },
  };
}

/**
 * Off the console.
 *
 * The row goes; the auth account does not. Somebody who leaves support may
 * still be a shopkeeper on Flo, and deleting their login over a job change
 * would take their own shop with it.
 *
 * Their existing token keeps its `platform_role` claim until it expires, which
 * is the same sharp edge `requireSession` exists for at a till. It is stated on
 * the screen rather than papered over: for somebody who left badly, ban the
 * account in Supabase, which kills the refresh token immediately.
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

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("platform_admins")
    .select("platform_role, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("platform_admins")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("[admin] operator removal failed", error);
    return fail("That account could not be removed. Please try again.");
  }

  await recordAudit(session, {
    action: "platform_admin.revoked",
    subjectType: "platform_admin",
    subjectId: userId,
    before,
  });

  revalidatePath("/admin/team");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: "Access removed",
      detail: "Their own login still works. Ban it in Supabase if it must stop now.",
    },
  };
}
