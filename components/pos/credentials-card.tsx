"use client";

import { useEffect, useRef, useState } from "react";

import { IconAlert, IconCheck, IconUser } from "@/components/pos/icons";

/**
 * The one moment the password exists.
 *
 * Nothing stores it — not `profiles`, not the audit entry, not this component
 * once the owner navigates away. So this card has one job and it is a physical
 * one: get two strings out of the screen and into WhatsApp without either of
 * them being mistyped.
 *
 * Hence the copy buttons and the big mono type rather than a sentence with the
 * password in it. Hence, too, the third button: an owner who is going to send
 * this on WhatsApp anyway is better served copying the whole message than
 * copying two fields and writing the covering line themselves at the counter.
 *
 * The warning is not decoration. An owner who closes this card assuming they
 * can come back for it later is an owner who has to reset the password of
 * somebody already standing at the till.
 *
 * Shared by `/app/employees` and `/admin/team` — a cashier's minted work
 * address and an operator's own email are handed over the same way, so they
 * are one card. `emailLabel` is the only thing that differs.
 */
export function CredentialsCard({
  name,
  email,
  password,
  emailLabel = "Work email",
}: {
  name: string;
  email: string;
  password: string;
  emailLabel?: string;
}) {
  return (
    <section className="pos-card border-orchid-300 bg-orchid-50/70 p-4">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
          <IconUser className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0">
          <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
            {name} can sign in now
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-graphite-500">
            Send these two lines to them. They sign in at flo-pos with exactly
            this — no email arrives, and there is nothing else to set up.
          </p>
        </div>
      </header>

      <div className="mt-3.5 space-y-2">
        <Field label={emailLabel} value={email} />
        <Field label="Password" value={password} mono />
      </div>

      <p className="mt-3 flex items-start gap-2 text-[0.75rem] leading-relaxed text-graphite-700">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
        <span>
          This is the only time the password is shown. We keep a scrambled copy
          we cannot read back, so if it is lost the fix is a new one from{" "}
          <strong className="font-semibold">New password</strong> on their card —
          which changes it for them too.
        </span>
      </p>

      <CopyButton
        className="pos-btn pos-btn-primary mt-3.5 w-full sm:w-auto"
        value={
          `Flo sign-in for ${name}\n\n` +
          `Email: ${email}\n` +
          `Password: ${password}\n\n` +
          `Sign in at flo-pos. Do not share this with anyone else.`
        }
        idle="Copy the whole message"
        done="Message copied"
      />
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-orchid-200 bg-paper-50 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[0.6875rem] font-semibold tracking-wide text-graphite-500 uppercase">
          {label}
        </span>
        <span
          className={`block truncate text-[0.9375rem] text-graphite-900 ${
            mono ? "font-mono tracking-wide" : ""
          }`}
        >
          {value}
        </span>
      </span>

      <CopyButton
        className="pos-btn pos-btn-soft pos-btn-sm flex-none"
        value={value}
        idle="Copy"
        done="Copied"
      />
    </div>
  );
}

/**
 * Copy, and say so for a moment.
 *
 * `navigator.clipboard` needs a secure context and can be refused outright, so
 * the failure case selects the text instead of pretending it worked — an owner
 * who thinks the password is on their clipboard and pastes the last thing they
 * copied has sent a cashier somebody else's message.
 */
function CopyButton({
  value,
  idle,
  done,
  className,
}: {
  value: string;
  idle: string;
  done: string;
  className: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button type="button" onClick={copy} className={className}>
        {state === "done" ? <IconCheck className="h-4 w-4" /> : null}
        {state === "done" ? done : state === "failed" ? "Select it by hand" : idle}
      </button>

      {/* Announced rather than drawn — the label above already changed, and a
          second visible confirmation beside it is noise. */}
      <span className="sr-only" aria-live="polite">
        {state === "done" ? done : null}
      </span>
    </>
  );
}
