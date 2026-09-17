import Link from "next/link";

import { IconChevron, IconEmployees, IconPlus, IconUser } from "@/components/pos/icons";
import type { StaffMember } from "@/lib/pos/staff";
import { staffRoleLabel, type StaffRole } from "@/lib/pos/staff-options";
import { NewStaffForm } from "./new-staff-form";
import { StaffForm } from "./staff-form";

/**
 * The shop's people — a list, one person, or the hire form.
 *
 * Which of the three lives in the URL, the same way the counter editor's does:
 * the page stays a server component, the owner can send "fix Bilal's role" as a
 * link, and a tablet that lost the network mid-tap comes back to the screen it
 * was on.
 *
 * Everybody is in one list, including the owner and whoever is reading it, and
 * the badges say which is which. The earlier draft had a separate "You" card
 * that drew the owner's row — which is the same thing only while the owner is
 * the one looking, and introduced a manager to their boss as themselves the
 * moment one signed in. A card addressed to a person it never checked the
 * identity of is a card that will eventually be wrong; a badge read off
 * `viewerId` cannot be.
 */
export function StaffPanel({
  staff,
  selected,
  adding,
  shopName,
  viewerId,
  readOnly,
}: {
  staff: StaffMember[];
  /** The person being edited, if the URL names one of the shop's own. */
  selected: StaffMember | null;
  adding: boolean;
  shopName: string;
  /** Whose session this is, so one row can be marked as theirs. */
  viewerId: string;
  readOnly: boolean;
}) {
  if (!readOnly && adding) {
    return (
      <div className="space-y-4">
        <BackLink />
        <NewStaffForm shopName={shopName} />
      </div>
    );
  }

  if (!readOnly && selected) {
    return (
      <div className="space-y-4">
        <BackLink />
        <StaffForm staff={selected} />
      </div>
    );
  }

  // The owner is in the list but is not one of them: they are not an account
  // this screen made, and not one it can touch.
  const hired = staff.filter((member) => !member.isOwner).length;

  return (
    <div className="space-y-4">
      <section className="pos-card">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
              Everyone at {shopName}
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {hired === 0
                ? "The owner, and nobody else yet."
                : `The owner, and ${hired} ${hired === 1 ? "person" : "people"} with their own work email and password.`}
            </p>
          </div>

          {!readOnly ? (
            <Link
              href="/app/employees?new=1"
              className="pos-btn pos-btn-primary"
              scroll={false}
            >
              <IconPlus className="h-4 w-4" />
              Add staff
            </Link>
          ) : null}
        </header>

        <ul className="divide-y divide-orchid-100 border-t border-orchid-100">
          {staff.map((member) => (
            <li key={member.id}>
              <Row
                member={member}
                isViewer={member.id === viewerId}
                readOnly={readOnly}
              />
            </li>
          ))}
        </ul>

        {hired === 0 && !readOnly ? (
          <p className="border-t border-orchid-100 px-4 py-3 text-[0.8125rem] leading-relaxed text-graphite-700">
            Only your own account can sign in at the moment. Add a cashier and
            Flo makes them a work email and a password — you copy both and send
            them on WhatsApp.
          </p>
        ) : null}

        <p className="pos-hint border-t border-orchid-100 px-4 py-3">
          There is one owner per shop. This screen cannot make another, change
          that one, or remove it — prices, the plan and the reports belong to it
          alone.
        </p>
      </section>

      <section className="pos-card p-4">
        <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
          How staff sign in
        </h2>

        <ul className="mt-3 space-y-2.5">
          {NOTES.map((note) => (
            <li key={note} className="flex gap-2.5 text-[0.875rem] leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-orchid-300" />
              <span className="text-graphite-700">{note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const NOTES = [
  "Flo makes the work email from their name and the shop's — bilal@almadina.flopos.pk. Nothing is ever sent to it; it is a login, not an inbox.",
  "The password is shown once, when it is made. We keep a scrambled copy we cannot read back, so if it is lost the owner makes a new one rather than looks the old one up.",
  "Suspending shuts the account at the door, not just on this screen. A suspended cashier cannot sign in on any device, and switching it back on lets them in with the same password.",
  "What a cashier and a manager may actually do is set once for the whole shop on Settings → Roles & permissions, not per person.",
];

function BackLink() {
  return (
    <Link
      href="/app/employees"
      className="pos-btn pos-btn-quiet pos-btn-sm"
      scroll={false}
    >
      <IconChevron className="h-4 w-4 rotate-90" />
      All staff
    </Link>
  );
}

function Row({
  member,
  isViewer,
  readOnly,
}: {
  member: StaffMember;
  isViewer: boolean;
  readOnly: boolean;
}) {
  // The owner's row is never a link and never carries a sign-in badge: it is
  // not an account this screen manages, and "Can sign in" against it reads like
  // something that could be switched off.
  const openable = !readOnly && !member.isOwner;

  const body = (
    <>
      <span
        className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
          member.isOwner || member.isActive
            ? "bg-orchid-200 text-orchid-800"
            : "bg-orchid-50 text-graphite-500"
        }`}
      >
        {member.isOwner ? (
          <IconUser className="h-[18px] w-[18px]" />
        ) : (
          <IconEmployees className="h-[18px] w-[18px]" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-graphite-900">{member.name}</span>

          {isViewer ? <span className="pos-badge pos-badge-info">You</span> : null}

          {member.isOwner ? null : (
            <span
              className={`pos-badge ${member.isActive ? "pos-badge-good" : "pos-badge-warn"}`}
            >
              {member.isActive ? "Can sign in" : "Suspended"}
            </span>
          )}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-graphite-500">
          <span className="truncate font-mono">{member.email ?? "no work email"}</span>
          <span aria-hidden>·</span>
          <span>
            {member.isOwner ? "Owner" : staffRoleLabel(member.role as StaffRole)}
          </span>
        </span>
      </span>

      {openable ? (
        <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500" />
      ) : null}
    </>
  );

  // A manager gets the roster and no way into it. The action refuses them
  // anyway, but a row that opens an editor where every control is dead is worse
  // than a row that does not open.
  if (!openable) {
    return <span className="flex items-center gap-3 px-4 py-3">{body}</span>;
  }

  return (
    <Link
      href={`/app/employees?staff=${member.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-orchid-50"
      scroll={false}
    >
      {body}
    </Link>
  );
}
