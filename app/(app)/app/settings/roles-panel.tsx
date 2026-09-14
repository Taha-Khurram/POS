import { ChartCard } from "@/components/pos/chart-card";
import {
  IconCheck,
  IconEmployees,
  IconRegister,
  IconSettings,
  IconUser,
  type IconProps,
} from "@/components/pos/icons";
import type { ShopProfile } from "@/lib/pos/shop";

/**
 * User roles and permissions.
 *
 * Two kinds of people, on purpose, and the split is in the schema rather than
 * in this screen: `profiles` holds the owner and manager, who are real auth
 * users; cashiers get a PIN on the staff table and never touch auth at all.
 * That keeps a paid shop at one or two monthly active users instead of eight,
 * and it is also the only thing that lets a cashier switch mid-rush on a
 * tablet with no signal.
 *
 * So "create an account" means two different things here, and the screen says
 * which is which rather than pretending there is one kind of person.
 */

type Level = "cashier" | "manager" | "admin";

const LEVELS: {
  id: Level;
  name: string;
  icon: (props: IconProps) => React.ReactElement;
  signIn: string;
  summary: string;
}[] = [
  {
    id: "cashier",
    name: "Cashier",
    icon: IconRegister,
    signIn: "4-digit PIN at the register",
    summary:
      "Sells, takes payment, prints. Cannot see a margin, change a price, or open the drawer on its own.",
  },
  {
    id: "manager",
    name: "Store manager",
    icon: IconEmployees,
    signIn: "Email and password",
    summary:
      "Everything a cashier does, plus discounts, returns, and the drawer count at close.",
  },
  {
    id: "admin",
    name: "Admin",
    icon: IconSettings,
    signIn: "Email and password",
    summary:
      "The owner. Prices, staff, tax, the plan, and every report. Nothing is hidden from this level.",
  },
];

/** `true` yes, `false` no, `"limit"` — allowed up to a ceiling set below. */
const PERMISSIONS: {
  group: string;
  rows: { label: string; on: [boolean | "limit", boolean | "limit", boolean] }[];
}[] = [
  {
    group: "At the counter",
    rows: [
      { label: "Ring up a sale and print a receipt", on: [true, true, true] },
      { label: "Take a payment against a khata", on: [true, true, true] },
      { label: "Put a sale on khata (udhaar)", on: ["limit", true, true] },
      { label: "Give a discount", on: ["limit", "limit", true] },
      { label: "Void a line before the receipt prints", on: [true, true, true] },
      { label: "Cancel a printed receipt or take a return", on: [false, true, true] },
      { label: "Open the drawer without a sale", on: [false, true, true] },
    ],
  },
  {
    group: "End of shift",
    rows: [
      { label: "Open a shift and count the opening float", on: [true, true, true] },
      { label: "Count the drawer and close the shift", on: [false, true, true] },
      { label: "See the over-or-short on a closed shift", on: [false, true, true] },
    ],
  },
  {
    group: "Stock and customers",
    rows: [
      { label: "Add or edit items", on: [false, true, true] },
      { label: "Change a selling price", on: [false, false, true] },
      { label: "Receive stock and record wastage", on: [false, true, true] },
      { label: "Set a customer's khata limit", on: [false, "limit", true] },
    ],
  },
  {
    group: "The office",
    rows: [
      { label: "See today's sales total", on: [true, true, true] },
      { label: "See profit, margins, and full reports", on: [false, true, true] },
      { label: "Add or remove staff", on: [false, false, true] },
      { label: "Change shop settings, tax, and the receipt", on: [false, false, true] },
      { label: "See the plan, invoices, and renewal", on: [false, false, true] },
    ],
  },
];

/** A tick, a dash, or the word — never colour alone, same rule as the badges. */
function Allowed({ value }: { value: boolean | "limit" }) {
  if (value === "limit") {
    return (
      <span className="pos-badge pos-badge-warn">
        To a limit
      </span>
    );
  }

  return value ? (
    <IconCheck className="mx-auto h-4 w-4 text-signal-good" />
  ) : (
    <span className="text-graphite-500" aria-label="No">
      —
    </span>
  );
}

export function RolesPanel({
  shop,
  ownerEmail,
  ownerRole,
}: {
  shop: ShopProfile;
  ownerEmail: string | null;
  ownerRole: string | null;
}) {
  return (
    <div className="space-y-4">
      <ChartCard
        title="Access levels"
        caption="Three of them, and only two need an email address."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {LEVELS.map((level) => (
            <div
              key={level.id}
              className="rounded-xl border border-azure-100 p-3.5"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-azure-50 text-azure-700">
                <level.icon className="h-[18px] w-[18px]" />
              </span>

              <h3 className="mt-2.5 font-display text-[0.875rem] font-bold text-graphite-900">
                {level.name}
              </h3>
              <p className="mt-0.5 text-[0.75rem] font-medium text-azure-700">
                {level.signIn}
              </p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-graphite-700">
                {level.summary}
              </p>
            </div>
          ))}
        </div>

        <p className="pos-hint mt-3.5">
          A cashier is not an account you pay for. The PIN is checked on the
          tablet itself, so switching cashiers mid-rush works with the internet
          down — and your bill stays at one or two signed-in users however many
          people stand at the counter.
        </p>
      </ChartCard>

      <ChartCard
        title="What each level can do"
        caption="The register enforces this on the device; the server enforces it again."
        footer={
          <>
            <p className="mr-auto text-[0.75rem] text-graphite-500">
              Not wired up yet — Part 3 builds the staff table, Part 7 this screen.
            </p>
            <button type="button" className="pos-btn pos-btn-primary" disabled>
              Save changes
            </button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="pos-table">
            <thead>
              <tr>
                <th>Permission</th>
                {LEVELS.map((level) => (
                  <th key={level.id} className="text-center">
                    {level.name}
                  </th>
                ))}
              </tr>
            </thead>

            {PERMISSIONS.map((section) => (
              <tbody key={section.group}>
                <tr>
                  <th
                    colSpan={4}
                    className="!bg-azure-100/55 !text-azure-800"
                  >
                    {section.group}
                  </th>
                </tr>

                {section.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="text-graphite-700">{row.label}</td>
                    {row.on.map((value, index) => (
                      <td key={LEVELS[index].id} className="text-center">
                        <Allowed value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="pos-label">Cashier discount ceiling</span>
            <input className="pos-field" defaultValue="5" inputMode="decimal" />
            <p className="pos-hint">Per cent off one line, and off the bill.</p>
          </label>

          <label className="block">
            <span className="pos-label">Manager discount ceiling</span>
            <input className="pos-field" defaultValue="15" inputMode="decimal" />
          </label>

          <label className="block">
            <span className="pos-label">Cashier khata ceiling</span>
            <input className="pos-field" defaultValue="2000" inputMode="decimal" />
            <p className="pos-hint">
              Rupees a cashier may put on a customer&apos;s book unasked.
            </p>
          </label>
        </div>
      </ChartCard>

      <ChartCard
        title="People"
        caption={`Who can get into ${shop.shopName} today.`}
        footer={
          <>
            <button type="button" className="pos-btn pos-btn-soft" disabled>
              Add a cashier PIN
            </button>
            <button type="button" className="pos-btn pos-btn-primary" disabled>
              Invite a manager
            </button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="pos-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Signs in with</th>
                <th>Level</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-azure-800 font-display text-[0.75rem] font-bold text-white">
                      {(shop.ownerName.trim()[0] ?? "F").toUpperCase()}
                    </span>
                    <span>
                      <span className="block font-medium text-graphite-900">
                        {shop.ownerName}
                      </span>
                      <span className="block text-[0.75rem] text-graphite-500">
                        You
                      </span>
                    </span>
                  </span>
                </td>
                <td className="text-graphite-700">{ownerEmail ?? "—"}</td>
                <td>
                  <span className="pos-badge pos-badge-info">
                    <IconUser className="h-3 w-3" />
                    {ownerRole === "manager" ? "Store manager" : "Admin"}
                  </span>
                </td>
                <td className="text-right">
                  <span className="pos-badge pos-badge-good">Active</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="pos-hint">
          A manager is invited by email and the link expires; a cashier never
          gets one — you set their PIN here and they use it on the tablet.
        </p>
      </ChartCard>
    </div>
  );
}
