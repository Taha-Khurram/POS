import type { Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { FloMark } from "@/components/site/flo-mark";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

export const viewport: Viewport = {
  themeColor: "#f4f5f8",
  colorScheme: "light",
};

/**
 * The client's product. Route protection is a layout-level check, not proxy
 * logic — `proxy.ts` stays a pure `updateSession` call so nothing sits between
 * creating the Supabase client and `getUser()`.
 *
 * The shop name and plan are read with the owner's own JWT rather than the
 * service role. That is deliberate: it means RLS is exercised on every request
 * to the register, so a broken policy shows up here immediately instead of
 * silently leaking somewhere else.
 */
export default async function RegisterLayout({ children }: LayoutProps<"/app">) {
  const session = await requireSession("/app");

  const supabase = createClient(await cookies());
  const { data: tenant } = await supabase
    .from("tenants")
    .select("shop_name, city")
    .maybeSingle();

  return (
    <div className="pos-root flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-paper-200 bg-paper-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <FloMark className="h-6 w-auto" />
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold leading-tight">
              {tenant?.shop_name ?? "Your shop"}
            </p>
            <p className="truncate text-[0.75rem] leading-tight text-graphite-500">
              {tenant?.city ?? session.email ?? "Flo register"}
            </p>
          </div>
        </div>

        <Link
          href="/app"
          className="rounded-xl border border-paper-300 px-3 py-2 text-[0.8125rem] font-medium text-graphite-700"
        >
          Register
        </Link>
      </header>

      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
