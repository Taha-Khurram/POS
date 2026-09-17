/**
 * Staff roles, and the shape of a Flo work email.
 *
 * No `server-only`, for the same reason `settings-options.ts` carries none: the
 * form that picks a role is a client component, the Server Action that writes
 * it has to agree with that list exactly, and the sign-in action has to
 * recognise a work address before it will let it through the preview gate.
 * One list, read from three sides.
 */

export type Option<T extends string> = {
  id: T;
  label: string;
  description?: string;
};

/**
 * What an owner may hire. The owner is not on the list — there is exactly one
 * per shop, it is the account that arranged Flo, and a screen that can mint a
 * second one is a screen that can hand somebody the plan and the prices.
 */
export const STAFF_ROLES = [
  {
    id: "cashier",
    label: "Cashier",
    description: "Bills at the counter. Sees today's total and nothing else.",
  },
  {
    id: "manager",
    label: "Store manager",
    description: "Bills too, plus returns, the drawer, and the day's reports.",
  },
] as const satisfies readonly Option<string>[];

export type StaffRole = (typeof STAFF_ROLES)[number]["id"];

export const isStaffRole = (value: unknown): value is StaffRole =>
  STAFF_ROLES.some((role) => role.id === value);

export const staffRoleLabel = (role: StaffRole): string =>
  STAFF_ROLES.find((item) => item.id === role)?.label ?? role;

// -----------------------------------------------------------------------------
// Work emails
// -----------------------------------------------------------------------------

/**
 * The domain every generated address sits under.
 *
 * Nothing is ever delivered to it — the account is created with the email
 * already confirmed, and Flo has no reason to write to a cashier. It is a
 * username that happens to be shaped like an address because that is what
 * Supabase signs people in with, and because `bilal@almadina.flopos.pk` is a
 * thing an owner can read off a screen and send on WhatsApp without explaining
 * what it is.
 *
 * The shop's own slug goes in the subdomain rather than the local part so two
 * shops that both hire a Bilal do not race for one address.
 */
export const STAFF_EMAIL_DOMAIN = "flopos.pk";

/** Local parts and subdomains: lower-case, no leading or trailing separator. */
const HANDLE_MAX = 20;
const SHOP_HANDLE_MAX = 16;

/**
 * A name to the part of an address that stands for it.
 *
 * Non-ASCII is dropped rather than transliterated. "محمد بلال" typed into the
 * name box would otherwise become an empty local part, so a handle that comes
 * out empty falls back to a word — the address is a login, and the roster shows
 * the real name beside it either way.
 */
function handle(value: string, max: number, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, max)
    .replace(/\.+$/g, "");

  return slug || fallback;
}

/**
 * The address Flo proposes for a new staff member.
 *
 * `suffix` is what the caller adds when the first attempt is taken — the second
 * Bilal at the same shop is `bilal2@…`, not a rejected form asking the owner to
 * be more creative about their staff's names.
 */
export function workEmail(
  staffName: string,
  shopName: string,
  suffix = 0,
): string {
  const person = handle(staffName, HANDLE_MAX, "staff");
  const shop = handle(shopName, SHOP_HANDLE_MAX, "shop");

  return `${person}${suffix > 0 ? suffix : ""}@${shop}.${STAFF_EMAIL_DOMAIN}`;
}

/**
 * Is this one of ours?
 *
 * Read by the sign-in action: the private-preview allow-list names one human
 * address, and every work email Flo has ever minted has to get past it without
 * being added to it one at a time.
 */
export const isWorkEmail = (email: string): boolean =>
  email.toLowerCase().endsWith(`.${STAFF_EMAIL_DOMAIN}`);

// -----------------------------------------------------------------------------
// Names and phones — checked here so the form and the action agree on what is
// too short rather than each having an opinion.
// -----------------------------------------------------------------------------

export const STAFF_NAME_MIN = 2;
export const STAFF_NAME_MAX = 60;

/** 03001234567, +923001234567, 0300-1234567 — all of them, and nothing else. */
export const PHONE_RE = /^[+\d][\d\s-]{6,19}$/;
