import type { Metadata } from "next";

import { IconSales } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sales history",
};

export default async function SalesHistoryPage() {
  await requireSession();

  return (
    <ModulePlaceholder
      title="Sales history"
      lede="Every receipt the counter has rung up, searchable by number, day, cashier, or customer."
      icon={IconSales}
      arriving="Part 2 — with the register"
      bullets={[
        "Filter by branch, shift, cashier, and payment method.",
        "Reprint or re-share any receipt on WhatsApp.",
        "Returns and held sales, with who authorised them.",
      ]}
    />
  );
}
