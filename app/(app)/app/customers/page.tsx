import type { Metadata } from "next";

import { IconCustomers } from "@/components/pos/icons";
import { ModulePlaceholder } from "@/components/pos/module-placeholder";
import { requireModule } from "@/lib/pos/access";

export const metadata: Metadata = {
  title: "Customers & khata",
};

export default async function CustomersPage() {
  await requireModule("customers");

  return (
    <ModulePlaceholder
      title="Customers & khata"
      lede="Regulars, their balances, and the udhaar khata in the same place you keep it in the register book."
      icon={IconCustomers}
      arriving="Part 4 — week of 29 September"
      bullets={[
        "Running balance per customer, with every sale behind it.",
        "Urdu reminder composed for you, sent from your own WhatsApp number.",
        "Ageing, so you can see what has been owed since Eid.",
      ]}
    />
  );
}
