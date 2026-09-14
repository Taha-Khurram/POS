import type { Metadata } from "next";

import { IconEmployees } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Staff",
};

export default async function EmployeesPage() {
  await requireSession();

  return (
    <ModulePlaceholder
      title="Staff"
      lede="Who is on the counter, what they sold, and what they are allowed to do."
      icon={IconEmployees}
      arriving="Part 5 — week of 29 September"
      bullets={[
        "PIN login per cashier — no extra Supabase seats.",
        "Per-shift takings, over and short.",
        "Permissions for discounts, returns, and opening the drawer.",
      ]}
    />
  );
}
