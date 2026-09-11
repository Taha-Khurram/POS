import "server-only";

import { headers } from "next/headers";

import { sha256Hex } from "@/lib/invite-token";
import { createAdminClient } from "@/utils/supabase/admin";

export async function consumeRateLimit(scope: string, limit: number, windowSeconds: number) {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || requestHeaders.get("x-real-ip") || "unknown";
  const keyHash = await sha256Hex(address);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  return !error && data === true;
}
