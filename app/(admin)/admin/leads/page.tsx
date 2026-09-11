import type { Metadata } from "next";
import { cookies } from "next/headers";

import { updateLeadStatus } from "@/app/(admin)/admin/actions";
import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Leads", description: "Demo enquiries and follow-up status." };

async function loadLeads() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("leads")
    .select("id, contact_name, phone, business_name, email, city, shop_type, message, status, notes, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function AdminLeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requirePlatformAdmin();
  const leads = await loadLeads();
  const params = await searchParams;
  const message = typeof params?.error === "string" ? params.error : typeof params?.success === "string" ? params.success : null;

  return (
    <section className="section"><div className="shell max-w-5xl">
      <p className="eyebrow">Leads</p><h1 className="heading mt-3">Demo enquiries</h1>
      {message ? <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[0.8125rem] text-mist-200">{message}</p> : null}
      <div className="mt-8 space-y-4">
        {leads.length === 0 ? <div className="panel rim rounded-[22px] p-8 text-mist-400">No enquiries yet.</div> : leads.map((lead) => {
          const waPhone = lead.phone.replace(/[^0-9]/g, "");
          return <article key={lead.id} className="panel rim rounded-[22px] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div><p className="text-lg font-bold text-mist-50">{lead.business_name || lead.contact_name}</p><p className="mt-1 text-[0.8125rem] text-mist-300">{lead.contact_name} · {lead.phone} · {lead.city || "City not set"}</p><p className="mt-3 text-[0.875rem] leading-relaxed text-mist-300">{lead.message || "No message."}</p></div>
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm shrink-0">WhatsApp</a>
            </div>
            <form action={updateLeadStatus} className="mt-5 grid gap-3 border-t border-white/8 pt-5 md:grid-cols-[auto_1fr_auto]">
              <input type="hidden" name="lead_id" value={lead.id} />
              <select name="status" className="field" defaultValue={lead.status}><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="won">Won</option><option value="lost">Lost</option></select>
              <input name="notes" className="field" defaultValue={lead.notes ?? ""} placeholder="Follow-up note" />
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
            </form>
          </article>;
        })}
      </div>
    </div></section>
  );
}
