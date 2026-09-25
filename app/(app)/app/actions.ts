"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

/**
 * Ends the session and sends the person back to the login page.
 *
 * A Server Action for the same reason `signIn` is one: only a request that is
 * allowed to set cookies can clear them, and a Server Component's `setAll` is a
 * no-op. Doing it here also means the sign-out button is a plain `<form>` — it
 * works before hydration, which on a tablet that has just woken up is the
 * difference between a till that logs out and one that appears frozen.
 */
export async function signOut() {
  // A console account's sign-out is on the audit trail beside its sign-in, so
  // the trail can say when somebody's session began and ended. Read before the
  // session is cleared, because afterwards there is nobody to name.
  const session = await getSessionContext();
  if (session?.platformRole) {
    await recordAudit(
      { ...session, console: true },
      {
        action: "platform_admin.signed_out",
        subjectType: "platform_admin",
        subjectId: session.userId,
        tenantId: null,
      },
    );
  }

  const supabase = createClient(await cookies());
  await supabase.auth.signOut();

  redirect("/login");
}
