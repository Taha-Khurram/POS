import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/utils/supabase/admin";
import type { SessionContext } from "@/lib/auth";

export type AuditActorKind = "platform_admin" | "tenant_user" | "system";

export type AuditEntry = {
  /** Dotted and past-tense: `tenant.activated`, `order.rejected`. */
  action: string;
  tenantId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Append a row to `audit_log`. The table has an append-only trigger, so this is
 * the only thing that can ever be done to it — nothing here, and nothing in the
 * console, can rewrite history afterwards.
 *
 * Deliberately never throws: an audit write failing must not roll back the
 * activation the operator just took money for. It logs loudly instead, and
 * Sentry picks it up in Part 7.
 */
export async function recordAudit(
  actor: SessionContext | null,
  entry: AuditEntry,
): Promise<void> {
  try {
    const requestHeaders = await headers();
    const supabase = createAdminClient();

    const { error } = await supabase.from("audit_log").insert({
      actor_id: actor?.userId ?? null,
      actor_email: actor?.email ?? null,
      actor_kind: actorKind(actor),
      action: entry.action,
      tenant_id: entry.tenantId ?? actor?.tenantId ?? null,
      subject_type: entry.subjectType ?? null,
      subject_id: entry.subjectId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: clientIp(requestHeaders),
      user_agent: requestHeaders.get("user-agent"),
    });

    if (error) {
      console.error("[audit] failed to record %s: %s", entry.action, error.message);
    }
  } catch (cause) {
    console.error("[audit] failed to record %s", entry.action, cause);
  }
}

/**
 * Every signed-in actor is a tenant user now — the platform console, and the
 * `platform_admin` kind that went with it, are gone. The kind is kept on the
 * row because `audit_log` is append-only: history written by the old console
 * still carries it, and re-labelling it is not possible by design.
 */
const actorKind = (actor: SessionContext | null): AuditActorKind =>
  actor ? "tenant_user" : "system";

/**
 * `x-forwarded-for` is a list; the client is the first entry. Stored as `inet`,
 * so anything that is not a bare address is dropped rather than guessed at.
 */
function clientIp(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get("x-forwarded-for");
  const candidate = forwarded?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip");
  if (!candidate) return null;
  return /^[0-9a-fA-F.:]+$/.test(candidate) ? candidate : null;
}
