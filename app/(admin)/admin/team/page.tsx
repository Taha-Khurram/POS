import type { Metadata } from "next";

import { requireSuperAdmin } from "@/lib/platform/access";
import { listOperators } from "@/lib/platform/console";

import { TeamPanel } from "./team-panel";

export const metadata: Metadata = {
  title: "Team",
  description: "Who may work the platform console, and which screens each of them gets.",
};

/**
 * The roster, and only the Flo owner sees it — `requireSuperAdmin` 404s
 * everybody else, and `platform_admins_read_self` in `0001_init.sql` says the
 * same thing in SQL, so a team member cannot read the list even by asking the
 * database directly.
 */
export default async function TeamPage() {
  const session = await requireSuperAdmin();
  const operators = await listOperators();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Team</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Give somebody a login and only the screens they need. Everything they
          do is written to the audit trail.
        </p>
      </header>

      <TeamPanel operators={operators} selfId={session.userId} />
    </div>
  );
}
