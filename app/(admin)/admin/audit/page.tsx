import type { Metadata } from "next";

import { requirePlatform } from "@/lib/platform/access";
import { AUDIT_MAX, listAudit } from "@/lib/platform/console";

import { AuditPanel } from "./audit-panel";

export const metadata: Metadata = {
  title: "Audit trail",
  description: "Every change any operator made, append-only.",
};

/**
 * Non-negotiable, and it is `Plan.md` that says so: this console can activate
 * paid accounts and read every client's sales, so everything it does is
 * written down — including ours.
 *
 * `audit_log` is append-only by trigger rather than by policy, because the
 * service role has `bypassrls` and the console writes with it. Nothing in this
 * codebase can edit a row here, which is what makes the screen worth having.
 */
export default async function AuditPage() {
  await requirePlatform();
  const rows = await listAudit();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Audit trail
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Append-only. Nothing in Flo can change or remove a line of it, this
          console included.
        </p>
      </header>

      <AuditPanel rows={rows} capped={rows.length >= AUDIT_MAX} />
    </div>
  );
}
