"use server";

import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { sha256Hex } from "@/lib/invite-token";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function redeemInvite(formData: FormData) {
  if (!(await consumeRateLimit("signup", 5, 3600))) {
    redirect("/signup?error=Too+many+attempts.+Please+try+again+later.");
  }

  const token = text(formData.get("token"));
  const email = text(formData.get("email")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = text(formData.get("full_name"));

  if (!token || !email || password.length < 8 || !fullName) {
    redirect(`/signup?token=${encodeURIComponent(token)}&error=Enter+your+name,+email,+and+a+password+of+at+least+8+characters.`);
  }

  const supabase = createAdminClient();
  const tokenHash = await sha256Hex(token);
  const { data: invite, error: inviteError } = await supabase
    .from("invites")
    .select("id, tenant_id, tenant_role, email, expires_at, used_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError || !invite || invite.used_at || invite.revoked_at || new Date(invite.expires_at) <= new Date()) {
    redirect("/signup?error=That+invite+is+invalid+or+has+expired.");
  }

  const { data: user, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (userError || !user.user) {
    redirect(`/signup?token=${encodeURIComponent(token)}&error=That+email+could+not+be+registered.`);
  }

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", invite.tenant_id)
    .eq("is_primary", true)
    .maybeSingle();

  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.user.id,
    tenant_id: invite.tenant_id,
    branch_id: branch?.id ?? null,
    tenant_role: invite.tenant_role,
    full_name: fullName,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(user.user.id);
    redirect(`/signup?token=${encodeURIComponent(token)}&error=Your+account+could+not+be+attached+to+the+shop.`);
  }

  const { data: redeemedInvite, error: inviteUpdateError } = await supabase
    .from("invites")
    .update({ used_at: new Date().toISOString(), used_by: user.user.id })
    .eq("id", invite.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (inviteUpdateError || !redeemedInvite) {
    await supabase.from("profiles").delete().eq("id", user.user.id);
    await supabase.auth.admin.deleteUser(user.user.id);
    redirect(`/signup?token=${encodeURIComponent(token)}&error=That+invite+could+not+be+completed.`);
  }

  await recordAudit(null, {
    action: "invite.redeemed",
    tenantId: invite.tenant_id,
    subjectType: "invite",
    subjectId: invite.id,
    after: { user_id: user.user.id, email },
  });

  redirect("/login?created=1");
}
