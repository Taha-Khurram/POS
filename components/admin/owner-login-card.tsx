"use client";

import { IconAlert, IconKey } from "@/components/pos/icons";
import { waLink } from "@/lib/platform/admin";
import type { AdminState } from "@/app/(admin)/admin/state";

import { CopyButton } from "./copy-button";

/**
 * The owner's username and password, and the message to send them in.
 *
 * Shown once and only once. GoTrue keeps a hash of the password and nothing
 * anywhere can turn it back — so this card is the one moment the plaintext
 * exists outside the operator's screen, and it says so plainly rather than
 * letting somebody navigate away and come back for it. Losing it is not a
 * disaster: New password on the record mints another, and the old one stops
 * working.
 *
 * The WhatsApp button is the primary control, not the copy buttons. The deal
 * was closed in a chat, and the login has to get back into that same chat
 * before the conversation moves on.
 */
export function OwnerLoginCard({
  credentials,
  shopName,
}: {
  credentials: NonNullable<AdminState["credentials"]>;
  shopName?: string;
}) {
  const message = credentials.message ?? "";

  return (
    <section className="pos-card border-orchid-300 p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
          <IconKey className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <h2 className="font-display text-[1rem] leading-tight font-bold">
            {shopName ? `${shopName} — ` : ""}the owner&rsquo;s login
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-graphite-500">
            Send it now. Nothing can show you this password again.
          </p>
        </div>
      </header>

      <dl className="mt-4 space-y-2">
        <Line label="Username" value={credentials.email} />
        <Line label="Password" value={credentials.password} />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {message ? (
          <a
            href={waLink(credentials.phone ?? "", message)}
            target="_blank"
            rel="noreferrer"
            className="pos-btn pos-btn-primary"
          >
            Send on WhatsApp
          </a>
        ) : null}
        {message ? <CopyButton value={message} label="Copy the message" /> : null}
        <CopyButton value={credentials.password} label="Copy the password" />
      </div>

      <p className="mt-3 flex items-start gap-2 text-[0.75rem] leading-snug text-graphite-500">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
        Anybody holding these two lines can open this shop&rsquo;s till and its
        books. Send them to the number you agreed the deal on and nowhere else.
      </p>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2">
      <dt className="w-20 flex-none text-[0.75rem] text-graphite-500">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-[0.875rem] text-graphite-900 select-all">
        {value}
      </dd>
    </div>
  );
}
