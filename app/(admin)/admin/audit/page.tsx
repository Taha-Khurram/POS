import type { Metadata } from "next";
import { cookies } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const metadata: Metadata = { title: "Audit", description: "Append-only admin activity history." };

async function loadAudit() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, tenant_id, subject_type, subject_id, before, after, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export default async function AdminAuditPage() {
  await requirePlatformAdmin();
  const entries = await loadAudit();

  return <section className="section"><div className="shell max-w-6xl"><p className="eyebrow">Audit</p><h1 className="heading mt-3">Admin activity</h1><div className="panel rim mt-8 overflow-hidden rounded-[22px]"><div className="overflow-x-auto"><table className="min-w-full text-left text-[0.8125rem]"><thead className="border-b border-white/8 bg-white/2 text-mist-300"><tr><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Subject</th><th className="px-4 py-3 font-medium">Change</th></tr></thead><tbody>{entries.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-mist-400">No audit entries yet.</td></tr> : entries.map((entry) => <tr key={entry.id} className="border-b border-white/6 last:border-b-0"><td className="whitespace-nowrap px-4 py-3 text-mist-400">{new Date(entry.created_at).toLocaleString("en-PK")}</td><td className="px-4 py-3 text-mist-300">{entry.actor_email ?? "system"}</td><td className="px-4 py-3 font-medium text-mist-50">{entry.action}</td><td className="px-4 py-3 text-mist-300">{entry.subject_type ?? "—"} {entry.subject_id ? `· ${entry.subject_id}` : ""}</td><td className="max-w-md px-4 py-3 text-mist-400"><details><summary className="cursor-pointer">View</summary><pre className="mt-2 whitespace-pre-wrap text-[0.6875rem]">{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre></details></td></tr>)}</tbody></table></div></div></div></section>;
}
