import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IconChevron } from "@/components/pos/icons";
import { requirePlatform } from "@/lib/platform/access";
import { listPlans } from "@/lib/platform/console";

import { ActivateForm } from "./activate-form";

export const metadata: Metadata = {
  title: "Activate a shop",
  description: "Turn a closed deal into a working shop and a link to send.",
};

/**
 * Direct activation — the path most shops arrive by.
 *
 * Billing-only, and it 404s a support account rather than drawing a form that
 * refuses on submit. A screen that lets somebody fill in eleven fields and then
 * says they were never allowed is worse than one that was never there.
 *
 * Plans that are off sale are still offered here, marked. The reason is real:
 * a tier withdrawn from `/pricing` is one you occasionally still honour for a
 * shop that was promised it last month.
 */
export default async function NewClientPage() {
  const session = await requirePlatform();
  if (session.platformRole !== "super_admin") notFound();

  const plans = await listPlans();

  return (
    <div className="space-y-4">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-graphite-500 hover:text-graphite-900"
      >
        <IconChevron className="h-3.5 w-3.5 rotate-90" />
        All clients
      </Link>

      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Activate a shop
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          The shop, its subscription and a one-time link — in one go, without
          leaving the chat you closed the deal in.
        </p>
      </header>

      <ActivateForm plans={plans} />
    </div>
  );
}
