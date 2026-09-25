import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { requirePlatform } from "@/lib/platform/access";
import { proofUrl } from "@/lib/platform/console";
import { createClient } from "@/utils/supabase/server";

/**
 * One order's payment screenshot, for the console and nobody else.
 *
 * A stable address in front of a link that is not. The bucket is private
 * (`0003_storage.sql`) and a signed URL dies in minutes, so a URL signed when the
 * queue was rendered went dead under an operator who left the sheet open over
 * lunch — and a proof preview that breaks is a proof nobody looks at. This
 * signs a fresh one on every request and redirects to it, so the `<img>` on the
 * order sheet, the link on the client's record and a tab opened an hour later
 * all work.
 *
 * The gate is the same two layers as every other `/admin` read:
 * `requirePlatform()` 404s anybody without a platform role (and the check
 * below anybody not given Orders or Clients), and the order row is read
 * through the operator's own JWT, so RLS decides whether its path is visible
 * at all. Only the signing is the service role, because storage has no
 * policy for the platform role and should not grow one.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/admin/orders/[id]/proof">) {
  // Drawn on the order sheet and on a client's record, so either screen opens it.
  const session = await requirePlatform();
  if (!session.screens.some((screen) => screen === "orders" || screen === "clients")) notFound();

  const { id } = await ctx.params;

  const supabase = createClient(await cookies());
  const { data } = await supabase
    .from("orders")
    .select("proof_path")
    .eq("id", id)
    .maybeSingle();

  const url = await proofUrl((data?.proof_path as string | null | undefined) ?? null);
  if (!url) notFound();

  const response = NextResponse.redirect(url, 302);
  // The redirect target expires; a cached redirect would point at a dead link.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
