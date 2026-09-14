import type { Metadata } from "next";

import { IconInventory } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Products & stock",
};

export default async function InventoryPage() {
  await requireSession();

  return (
    <ModulePlaceholder
      title="Products & stock"
      lede="Your item list, purchase prices, and what is running low."
      icon={IconInventory}
      arriving="Part 3 — week of 22 September"
      bullets={[
        "Bulk import from the Excel sheet you already keep.",
        "Low-stock alerts set per item, not one number for the whole shop.",
        "Purchase price per item — the column the profit figures on the dashboard are waiting for.",
      ]}
    />
  );
}
