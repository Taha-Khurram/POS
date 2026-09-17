"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { COUNTER_COOKIE } from "@/components/pos/console-prefs";
import { requireSession } from "@/lib/auth";
import { listCounters } from "@/lib/pos/shop";

/**
 * Point this tablet at a counter.
 *
 * In its own module rather than beside `recordSale`, because a `"use server"`
 * file exports an endpoint per function and this one is called from a server
 * component — keeping it apart means the register's sale path is not pulled in
 * by the picker, and the picker is not pulled in by the till.
 *
 * The cookie is written only after the id is checked against the shop's own
 * open counters. It is a device preference and cannot grant anything on its
 * own — every sale re-reads the counter and re-checks it — but a cookie that
 * can hold a stranger's uuid is still a cookie worth not writing.
 *
 * Re-pointing a tablet that is already set up is the owner's call, checked here
 * and not only by the hidden button: a cashier who could move the device
 * mid-shift would be moving a sale into another drawer's takings and another
 * counter's receipt series. Setting up a tablet that has no counter yet is open
 * to anyone, or a new tablet could not ring up its first sale.
 */
export async function chooseCounter(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session.tenantId) redirect("/app/register");

  const wanted = formData.get("counter_id");
  if (typeof wanted !== "string") redirect("/app/register");

  const counters = await listCounters(session.tenantId);
  const counter = counters.find((item) => item.id === wanted && item.isActive);

  if (!counter) redirect("/app/register");

  const jar = await cookies();

  if (session.tenantRole !== "owner") {
    const current = jar.get(COUNTER_COOKIE)?.value ?? null;
    const settled = counters.some(
      (item) => item.id === current && item.isActive,
    );

    if (settled) redirect("/app/register");
  }

  // A year, path-wide, lax — the same terms as the rail and the theme. This is
  // a display preference, not a session.
  jar.set(COUNTER_COOKIE, counter.id, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
  });

  redirect("/app/register");
}
