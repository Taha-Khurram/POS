import type { Metadata } from "next";
import Link from "next/link";

import { FloMark } from "@/components/site/flo-mark";
import { requirePlatformAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  // The console must not be discoverable. The 404 for non-admins is the real
  // control; this just keeps it out of any crawler that gets a session.
  robots: { index: false, follow: false },
};

/**
 * Your console. Gated on the `platform_role` claim and returning `notFound()`
 * to everyone else, so a tenant who guesses the URL sees the same 404 as a
 * typo — not a 403 that confirms the route exists (§3.7).
 *
 * The dark marketing design system is reused wholesale here: `.panel`, `.rim`,
 * `.field`, `.btn-primary`. It suits a dashboard opened on a laptop and costs
 * no new CSS. `/app` is the one place that gets its own visual language.
 */
const SECTIONS = [{ label: "Overview", href: "/admin" }];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requirePlatformAdmin();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-ink-950/80 backdrop-blur-xl">
        <div className="shell flex h-16 items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center">
              <FloMark className="h-7 w-auto" />
            </Link>
            <nav className="hidden items-center gap-7 sm:flex">
              {SECTIONS.map((section) => (
                <Link key={section.href} href={section.href} className="nav-link">
                  {section.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="text-right">
            <p className="text-[0.8125rem] font-medium text-mist-200">
              {session.email}
            </p>
            <p className="eyebrow text-[0.6875rem]">
              {session.platformRole === "super_admin" ? "Super admin" : "Support"}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
