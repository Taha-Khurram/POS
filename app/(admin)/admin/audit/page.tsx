import type { Metadata } from "next";

import { requireSuperAdmin } from "@/lib/platform/access";
import { parseAuditFilters } from "@/lib/platform/audit";
import { searchAudit } from "@/lib/platform/console";

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
 *
 * Every filter is in the URL and every page is read on the server
 * (`searchAudit`), so the trail is never capped: page 40 is as reachable as
 * page 1, and "every failed sign-in this week" is a link.
 */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireSuperAdmin();
  const filters = parseAuditFilters(await searchParams);
  const result = await searchAudit(filters);

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

      <AuditPanel filters={{ ...filters, page: result.page }} result={result} />
    </div>
  );
}
