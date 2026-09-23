import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

import {
  lapseOf,
  type BillingCycle,
  type FeatureFlags,
  type SubscriptionStatus,
} from "@/lib/platform/admin";

export type { BillingCycle, FeatureFlags, SubscriptionStatus };

export type Entitlements = {
  tenantId: string;
  planCode: string;
  planName: string;
  /**
   * Where the shop stands *now*, through `lapseOf` — not the stored column.
   * A period that ended at noon reads past due at 12:01 whether or not the
   * hourly sweep has written it yet, and suspended once the grace runs out.
   */
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  agreedPrice: number;
  /** Can this shop bill right now? Trial, active and past-due-within-grace. */
  canOperate: boolean;
  maxBranches: number;
  maxRegisters: number;
  features: FeatureFlags;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  /** When the till stops if nothing is paid: the period end plus grace. */
  graceEndsAt: string;
  /** Negative once the period has passed. Drives the expiry banners. */
  daysUntilExpiry: number;
};

const OPERABLE: readonly SubscriptionStatus[] = ["trialing", "active", "past_due"];

const DAY_MS = 86_400_000;

/**
 * The only authority on what a shop may do.
 *
 * Resolution order — the plan's own flags, then the subscription's ceiling
 * columns, which win because that is where a haggled "bhai teen branch kar do"
 * is recorded. There is no per-shop flag layer any more: `0040` dropped
 * `subscriptions.feature_overrides`, which was merged in here and read by
 * nothing at all. Layouts and Server Actions call this; client-side gating is
 * UX and never a control (§4.3).
 *
 * Reads with the service role on purpose: `plans` is not readable by a tenant's
 * own JWT, which is what stops a Standard client from discovering — let alone
 * claiming — a Premium flag by crafting a request.
 */
export async function getEntitlements(
  tenantId: string,
): Promise<Entitlements | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      `
        status,
        billing_cycle,
        agreed_price,
        max_branches,
        max_registers,
        trial_ends_at,
        current_period_end,
        grace_days,
        plans ( code, name, features )
      `,
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return null;

  const plan = (Array.isArray(data.plans) ? data.plans[0] : data.plans) as
    | { code: string; name: string; features: FeatureFlags | null }
    | null
    | undefined;

  const features: FeatureFlags = { ...(plan?.features ?? {}) };

  const currentPeriodEnd = data.current_period_end as string;
  const { status, graceEndsAt } = lapseOf(
    data.status as SubscriptionStatus,
    currentPeriodEnd,
    Number(data.grace_days),
  );

  return {
    tenantId,
    planCode: plan?.code ?? "unknown",
    planName: plan?.name ?? "Unknown plan",
    status,
    billingCycle: data.billing_cycle as BillingCycle,
    agreedPrice: Number(data.agreed_price),
    canOperate: OPERABLE.includes(status),
    // The subscription columns are the ceiling, not the plan's — one client's
    // deal must never be capped by the list plan.
    maxBranches: Number(data.max_branches),
    maxRegisters: Number(data.max_registers),
    features,
    trialEndsAt: (data.trial_ends_at as string | null) ?? null,
    currentPeriodEnd,
    graceEndsAt,
    daysUntilExpiry: Math.ceil(
      (new Date(currentPeriodEnd).getTime() - Date.now()) / DAY_MS,
    ),
  };
}

/** True only for a flag explicitly set to true. Missing means off. */
export const hasFeature = (entitlements: Entitlements, flag: string): boolean =>
  entitlements.features[flag] === true;

/** Numeric caps out of the feature JSON. `null` means no ceiling. */
export function featureLimit(
  entitlements: Entitlements,
  flag: string,
): number | null {
  const value = entitlements.features[flag];
  return typeof value === "number" ? value : null;
}
