import Link from "next/link";

import {
  IconChevron,
  IconEmployees,
  IconPlus,
  IconUser,
} from "@/components/pos/icons";
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
 */
export function StaffPanel({
  staff,
  selected,
  adding,
  shopName,
  readOnly,
}: {
  staff: StaffMember[];
  /** The person being edited, if the URL names one of the shop's own. */
  selected: StaffMember | null;
  adding: boolean;
  shopName: string;
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

  // Everyone but the owner. The owner's own row is drawn separately below,
  // without controls — it is not a staff account and nothing on this screen may
  // touch it.
  const hired = staff.filter((member) => !member.isOwner);
  const owner = staff.find((member) => member.isOwner) ?? null;

  return (
    <div className="space-y-4">
      <section className="pos-card">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
              Staff accounts
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {hired.length === 0
                ? "Nobody yet. Add one and they can sign in at the counter."
                : `${hired.length} ${hired.length === 1 ? "person" : "people"}, each with their own work email and password.`}
            </p>
          </div>

          {!readOnly ? (
            <Link href="/app/employees?new=1" className="pos-btn pos-btn-primary" scroll={false}>
              <IconPlus className="h-4 w-4" />
              Add staff
            </Link>
          ) : null}
        </header>

        {hired.length === 0 ? (
          <p className="px-4 pb-5 text-[0.875rem] leading-relaxed text-graphite-700">
            Only your own account can sign in at the moment. Add a cashier and
            Flo makes them a work email and a password — you copy both and send
            them on WhatsApp.
          </p>
        ) : (
          <ul className="divide-y divide-orchid-100 border-t border-orchid-100">
            {hired.map((member) => (
              <li key={member.id}>
                <Row member={member} readOnly={readOnly} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {owner ? (
        <section className="pos-card p-4">
          <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
            You
          </h2>

          <div className="mt-2.5 flex items-center gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
              <IconUser className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-graphite-900">
                  {owner.name}
                </span>
                <span className="pos-badge pos-badge-info">Owner</span>
              </p>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                {owner.email ?? "—"}
              </p>
            </div>
          </div>

          <p className="pos-hint mt-3">
            There is one owner per shop and this screen cannot make another,
            change this one, or remove it. Everything else here — prices, the
            plan, the reports — is yours alone.
          </p>
        </section>
      ) : null}

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
  "Flo makes the work email from their name and your shop's — bilal@almadina.flopos.pk. Nothing is ever sent to it; it is a login, not an inbox.",
  "The password is shown once, when you make it. We keep a scrambled copy we cannot read back, so if it is lost you make a new one rather than look the old one up.",
  "Suspending shuts the account at the door, not just on this screen. A suspended cashier cannot sign in on any device, and switching it back on lets them in with the same password.",
  "What a cashier and a manager may actually do is set once for the whole shop on Settings → Roles & permissions, not per person.",
];

function BackLink() {
  return (
    <Link href="/app/employees" className="pos-btn pos-btn-quiet pos-btn-sm" scroll={false}>
      <IconChevron className="h-4 w-4 rotate-90" />
      All staff
    </Link>
  );
}

function Row({ member, readOnly }: { member: StaffMember; readOnly: boolean }) {
  const body = (
    <>
      <span
        className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
          member.isActive
            ? "bg-orchid-200 text-orchid-800"
            : "bg-orchid-50 text-graphite-500"
        }`}
      >
        <IconEmployees className="h-[18px] w-[18px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-graphite-900">
            {member.name}
          </span>
          <span
            className={`pos-badge ${member.isActive ? "pos-badge-good" : "pos-badge-warn"}`}
          >
            {member.isActive ? "Can sign in" : "Suspended"}
          </span>
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-graphite-500">
          <span className="truncate font-mono">{member.email ?? "no work email"}</span>
          <span aria-hidden>·</span>
          <span>{staffRoleLabel(member.role as StaffRole)}</span>
        </span>
      </span>

      {readOnly ? null : (
        <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500" />
      )}
    </>
  );

  // A manager gets the roster and no way into it. The action refuses them
  // anyway, but a row that opens an editor where every control is dead is worse
  // than a row that does not open.
  if (readOnly) {
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
