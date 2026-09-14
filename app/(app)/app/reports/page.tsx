import type { Metadata } from "next";

import { IconReports } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Reports",
};

export default async function ReportsPage() {
  await requireSession();

  return (
    <ModulePlaceholder
      title="Reports"
      lede="The numbers you take to your accountant, and the ones you check before ordering stock."
      icon={IconReports}
      arriving="Part 6 — week of 6 October"
      bullets={[
        "Daily and monthly sales, exportable to Excel.",
        "Profit by item and by category, once purchase prices are in.",
        "Sales tax summary, ready for the day FBR invoicing lands.",
      ]}
    />
  );
}
