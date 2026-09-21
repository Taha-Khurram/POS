"use client";

import { IconAlert, IconKey } from "@/components/pos/icons";
import { waLink } from "@/lib/platform/admin";
import type { AdminState } from "@/app/(admin)/admin/state";

import { CopyButton } from "./copy-button";

/**
 * The link, and the message to send it in.
 *
 * Shown once and only once. `invites.token_hash` is a sha256 and there is
 * nothing anywhere that can turn it back into a link — so this card is the one
 * moment the plaintext token exists outside the operator's screen, and it says
 * so plainly rather than letting somebody navigate away and come back for it.
 * Losing it is not a disaster: regenerating mints a new link and revokes this
 * one, which is the right behaviour anyway.
 *
 * The WhatsApp button is the primary control, not the copy button. The whole
 * sixty-second promise of this screen is that the deal you just closed in a
 * chat gets its link back into that same chat before the conversation moves on.
 */
export function InviteCard({ invite }: { invite: NonNullable<AdminState["invite"]> }) {
  return (
    <section className="pos-card border-orchid-300 p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
          <IconKey className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <h2 className="font-display text-[1rem] leading-tight font-bold">
            {invite.shopName} — their sign-up link
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-graphite-500">
            Send it now. It works once, and nothing can show it to you again.
          </p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={waLink(invite.phone, invite.message)}
          target="_blank"
          rel="noreferrer"
          className="pos-btn pos-btn-primary"
        >
          Send on WhatsApp
        </a>
        <CopyButton value={invite.message} label="Copy the message" />
        <CopyButton value={invite.link} label="Copy just the link" />
      </div>

      <p className="mt-3 truncate rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2 font-mono text-[0.75rem] text-graphite-700">
        {invite.link}
      </p>

      <p className="mt-3 flex items-start gap-2 text-[0.75rem] leading-snug text-graphite-500">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
        Anybody holding this link can create the owner account for this shop.
        Send it to the number you agreed the deal on and nowhere else.
      </p>
    </section>
  );
}
