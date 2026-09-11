import type { Metadata } from "next";

import { redeemInvite } from "@/app/(site)/signup/actions";
import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/invite-token";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Redeem your Flo invitation and join your shop workspace.",
};

async function loadInvite(token: string) {
  if (!token) return null;
  const supabase = createAdminClient();
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase
    .from("invites")
    .select("email, expires_at, used_at, revoked_at, tenants(shop_name)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data || data.used_at || data.revoked_at || new Date(data.expires_at) <= new Date()) return null;
  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;
  return { email: data.email, shopName: tenant?.shop_name ?? "your shop" };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const query = await searchParams;
  const token = typeof query?.token === "string" ? query.token : "";
  const error = typeof query?.error === "string" ? query.error : null;
  const invite = await loadInvite(token);

  return (
    <section className="section">
      <div className="shell max-w-lg">
        <p className="eyebrow">Invitation</p>
        <h1 className="heading mt-3">Join {invite?.shopName ?? "your Flo shop"}</h1>
        <p className="lede mt-4">Your account is created from an activated subscription. Use the invitation once, then sign in at the counter.</p>

        {!invite ? (
          <div className="panel rim mt-8 rounded-[24px] p-6 text-[0.875rem] text-mist-300">This invitation is invalid, expired, or already used. Ask Flo support to send a fresh invite.</div>
        ) : (
          <form action={redeemInvite} className="panel rim mt-8 rounded-[24px] p-6 sm:p-8">
            {error ? <p className="mb-5 rounded-2xl border border-flare-400/30 bg-flare-400/10 px-4 py-3 text-[0.8125rem] text-mist-200">{error}</p> : null}
            <input type="hidden" name="token" value={token} />
            <div className="grid gap-5">
              <div><label htmlFor="full_name" className="label">Your name</label><input id="full_name" name="full_name" className="field" required /></div>
              <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" defaultValue={invite.email ?? ""} className="field" required /></div>
              <div><label htmlFor="password" className="label">Password</label><input id="password" name="password" type="password" minLength={8} className="field" required /></div>
            </div>
            <button type="submit" className="btn btn-primary mt-7">Create account</button>
          </form>
        )}
      </div>
    </section>
  );
}
