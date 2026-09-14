import { ChartCard } from "@/components/pos/chart-card";
import { IconCheck, IconStore } from "@/components/pos/icons";
import type { ShopProfile } from "@/lib/pos/shop";

/**
 * Store and location setup.
 *
 * The shop's own details come from the `tenants` and `branches` rows, so what
 * is on screen is what is in the database. Everything below them — currency,
 * clock, tax — has no column to live in yet and is rendered at its Pakistani
 * default, which is also the value Part 7 will seed the migration with.
 */

const SHOP_TYPES = [
  { id: "kiryana", label: "Kiryana / general store" },
  { id: "restaurant", label: "Restaurant / dhaba" },
  { id: "bakery", label: "Bakery / sweets" },
  { id: "pharmacy", label: "Pharmacy / medical store" },
  { id: "clothing", label: "Clothing / cloth house" },
  { id: "retail", label: "Retail — something else" },
  { id: "other", label: "Other" },
];

const CURRENCIES = [
  { id: "PKR", label: "Pakistani rupee — Rs" },
  { id: "AED", label: "UAE dirham — AED" },
  { id: "SAR", label: "Saudi riyal — SAR" },
  { id: "USD", label: "US dollar — $" },
];

// How the rupee is written on the receipt. Shops differ, and the one that
// prints "₨" on a thermal roll usually finds out the printer cannot.
const RUPEE_STYLES = [
  { id: "rs-prefix", label: "Rs 1,250" },
  { id: "symbol", label: "₨ 1,250" },
  { id: "suffix", label: "1,250 PKR" },
];

const TIMEZONES = [
  { id: "Asia/Karachi", label: "Pakistan — PKT (UTC+5)" },
  { id: "Asia/Dubai", label: "United Arab Emirates — GST (UTC+4)" },
  { id: "Asia/Riyadh", label: "Saudi Arabia — AST (UTC+3)" },
];

// A shop that shuts at 1 am wants that sale on the day it opened, not on the
// next one. Every report window is cut here.
const DAY_ENDS = [
  { id: "00:00", label: "Midnight" },
  { id: "01:00", label: "1:00 am" },
  { id: "02:00", label: "2:00 am" },
  { id: "03:00", label: "3:00 am" },
  { id: "04:00", label: "4:00 am" },
];

const TAX_RATES = [
  {
    id: "fbr-standard",
    name: "Sales tax (FBR)",
    rate: "18",
    applies: "Goods",
    note: "The standard rate on most retail goods.",
    isDefault: true,
  },
  {
    id: "pra-services",
    name: "Punjab services (PRA)",
    rate: "16",
    applies: "Services",
    note: "Provincial — Sindh, KP and Balochistan charge their own.",
    isDefault: false,
  },
  {
    id: "zero",
    name: "Zero-rated",
    rate: "0",
    applies: "Exempt goods",
    note: "Unprocessed food, most medicines, and anything else exempt.",
    isDefault: false,
  },
];

/** Save is dead on every card until Part 7. Saying so beats a button that lies. */
function SaveBar() {
  return (
    <>
      <p className="mr-auto text-[0.75rem] text-graphite-500">
        Not wired up yet — Part 7.
      </p>
      <button type="button" className="pos-btn pos-btn-primary" disabled>
        Save changes
      </button>
    </>
  );
}

export function StorePanel({
  shop,
  maxBranches,
}: {
  shop: ShopProfile;
  maxBranches: number | null;
}) {
  return (
    <div className="space-y-4">
      <ChartCard
        title="Shop details"
        caption="What prints at the top of every receipt."
        footer={<SaveBar />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="pos-label">Shop name</span>
            <input className="pos-field" defaultValue={shop.shopName} />
          </label>

          <label className="block">
            <span className="pos-label">Owner</span>
            <input className="pos-field" defaultValue={shop.ownerName} />
          </label>

          <label className="block">
            <span className="pos-label">Phone</span>
            <input className="pos-field" defaultValue={shop.phone} inputMode="tel" />
            <p className="pos-hint">
              The number khata reminders go out from on WhatsApp.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">Email</span>
            <input
              className="pos-field"
              type="email"
              defaultValue={shop.email ?? ""}
              placeholder="shop@example.com"
            />
          </label>

          <label className="block">
            <span className="pos-label">City</span>
            <input className="pos-field" defaultValue={shop.city} />
          </label>

          <label className="block">
            <span className="pos-label">Shop type</span>
            <select className="pos-field" defaultValue={shop.shopType}>
              {SHOP_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              Sets the register&apos;s default units — plates for a dhaba, kilos
              for a kiryana.
            </p>
          </label>
        </div>
      </ChartCard>

      <ChartCard
        title="Counters and locations"
        caption="Every register belongs to one of these."
        footer={
          <>
            <p className="mr-auto text-[0.75rem] text-graphite-500">
              {maxBranches === null
                ? "Your plan does not cap branches."
                : `Your plan allows ${maxBranches} ${maxBranches === 1 ? "branch" : "branches"} — ${shop.branches.length} in use.`}
            </p>
            <button type="button" className="pos-btn pos-btn-soft" disabled>
              Add a counter
            </button>
          </>
        }
      >
        <ul className="space-y-2">
          {shop.branches.map((branch) => (
            <li
              key={branch.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-azure-100 px-3.5 py-3"
            >
              <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-azure-50 text-azure-700">
                <IconStore className="h-4 w-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-semibold text-graphite-900">
                  {branch.name}
                </span>
                <span className="block truncate text-[0.75rem] text-graphite-500">
                  {[branch.address, branch.city, branch.phone]
                    .filter(Boolean)
                    .join(" · ") || "No address on file"}
                </span>
              </span>

              {branch.isPrimary ? (
                <span className="pos-badge pos-badge-info">Main counter</span>
              ) : null}
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard
        title="Currency and clock"
        caption="How money is written, and where the day is cut."
        footer={<SaveBar />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="pos-label">Currency</span>
            <select className="pos-field" defaultValue="PKR">
              {CURRENCIES.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="pos-label">Written as</span>
            <select className="pos-field" defaultValue="rs-prefix">
              {RUPEE_STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              Most 80 mm thermal printers cannot draw ₨. Rs is safe everywhere.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">Timezone</span>
            <select className="pos-field" defaultValue="Asia/Karachi">
              {TIMEZONES.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              Pakistan has not observed daylight saving since 2009, so the
              offset never moves.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">The sales day ends at</span>
            <select className="pos-field" defaultValue="00:00">
              {DAY_ENDS.map((end) => (
                <option key={end.id} value={end.id}>
                  {end.label}
                </option>
              ))}
            </select>
            <p className="pos-hint">
              A dhaba that shuts at 1 am wants that sale on the day it opened.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">The week starts on</span>
            <select className="pos-field" defaultValue="monday">
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
              <option value="saturday">Saturday</option>
            </select>
          </label>

          <label className="block">
            <span className="pos-label">Financial year starts</span>
            <select className="pos-field" defaultValue="07-01">
              <option value="07-01">1 July — Pakistan</option>
              <option value="01-01">1 January</option>
              <option value="04-01">1 April</option>
            </select>
          </label>
        </div>
      </ChartCard>

      <ChartCard
        title="Tax"
        caption="Set once here, and every new item picks it up."
        footer={<SaveBar />}
      >
        <fieldset>
          <legend className="pos-label">Your shelf prices</legend>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-azure-100 px-3.5 py-3">
              <input
                type="radio"
                name="tax-mode"
                value="inclusive"
                defaultChecked
                className="mt-0.5 h-4 w-4 flex-none accent-azure-700"
              />
              <span>
                <span className="block text-[0.875rem] font-semibold text-graphite-900">
                  Already include tax
                </span>
                <span className="block text-[0.75rem] text-graphite-500">
                  Rs 100 on the shelf is Rs 100 at the till. What almost every
                  shop here does.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-azure-100 px-3.5 py-3">
              <input
                type="radio"
                name="tax-mode"
                value="exclusive"
                className="mt-0.5 h-4 w-4 flex-none accent-azure-700"
              />
              <span>
                <span className="block text-[0.875rem] font-semibold text-graphite-900">
                  Have tax added at the till
                </span>
                <span className="block text-[0.75rem] text-graphite-500">
                  The receipt shows the tax as its own line.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="pos-label">NTN</span>
            <input
              className="pos-field"
              defaultValue={shop.ntn ?? ""}
              placeholder="0000000-0"
            />
          </label>

          <label className="block">
            <span className="pos-label">STRN</span>
            <input
              className="pos-field"
              defaultValue={shop.strn ?? ""}
              placeholder="Leave empty if you have none"
            />
            <p className="pos-hint">
              Most kiryana shops are not sales-tax registered. An empty STRN
              simply keeps it off the receipt.
            </p>
          </label>
        </div>

        <div className="mt-5">
          <p className="pos-label">Tax rates</p>

          <div className="overflow-x-auto">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Rate</th>
                  <th>Applies to</th>
                  <th className="text-center">New items</th>
                </tr>
              </thead>
              <tbody>
                {TAX_RATES.map((tax) => (
                  <tr key={tax.id}>
                    <td>
                      <span className="block font-medium text-graphite-900">
                        {tax.name}
                      </span>
                      <span className="block text-[0.75rem] text-graphite-500">
                        {tax.note}
                      </span>
                    </td>
                    <td className="pos-num text-right">{tax.rate}%</td>
                    <td>{tax.applies}</td>
                    <td className="text-center">
                      <input
                        type="radio"
                        name="default-tax"
                        defaultChecked={tax.isDefault}
                        className="h-4 w-4 accent-azure-700"
                        aria-label={`Use ${tax.name} for new items`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="pos-hint flex items-start gap-1.5">
            <IconCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-azure-600" />
            An item added to stock takes the rate ticked here unless you give it
            its own. These three are starting points — check them against what
            your accountant actually files.
          </p>

          <button type="button" className="pos-btn pos-btn-soft pos-btn-sm mt-3" disabled>
            Add a tax rate
          </button>
        </div>
      </ChartCard>
    </div>
  );
}
