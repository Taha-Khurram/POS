import type { Metadata } from "next";

import { IconSettings } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  await requireSession();

  return (
    <ModulePlaceholder
      title="Settings"
      lede="Shop details, branches, receipt layout, and who can sign in."
      icon={IconSettings}
      arriving="Part 7 — week of 6 October"
      bullets={[
        "Receipt header, footer, and the 80 mm printer test page.",
        "Branch list and which register belongs to which counter.",
        "Your plan, your renewal date, and your invoices.",
      ]}
    />
  );
}
