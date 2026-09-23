"use client";

import { useState } from "react";

import { IconAlert } from "@/components/pos/icons";

/**
 * The payment screenshot itself, drawn where the decision is made.
 *
 * Matching a transfer against a bank statement is a job done with two things
 * side by side, so the proof is shown inline rather than behind a link that
 * opens a tab and hides the sheet it came from. A PDF goes in a frame, because
 * an `<img>` cannot draw one; either way "Open full size" is there for the
 * reference number printed too small to read.
 *
 * `src` is `/admin/orders/[id]/proof`, which signs a fresh private-bucket link
 * on every request — so this never goes stale, and it is never a URL anybody
 * outside the console can open.
 */
export function ProofPreview({
  src,
  kind,
  label = "Payment proof",
}: {
  src: string;
  kind: "image" | "pdf";
  label?: string;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="pos-label mb-0">{label}</span>
        <a href={src} target="_blank" rel="noreferrer" className="pos-btn pos-btn-quiet pos-btn-sm">
          Open full size
        </a>
      </figcaption>

      {broken ? (
        <p className="pos-note pos-note-warn flex items-start gap-2">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none" />
          The file could not be shown here. Try Open full size — if that fails too,
          it is missing from storage and they should upload it again.
        </p>
      ) : kind === "pdf" ? (
        <iframe
          src={src}
          title={label}
          className="h-[28rem] w-full rounded-xl border border-orchid-100 bg-paper-50"
        />
      ) : (
        <a href={src} target="_blank" rel="noreferrer" className="block">
          {/* A plain <img>, not next/image: the source is a redirect to a
              signed private-bucket URL that changes on every load, which the
              image optimiser can neither cache nor fetch without the cookie. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            onError={() => setBroken(true)}
            className="max-h-[28rem] w-full rounded-xl border border-orchid-100 bg-paper-50 object-contain"
          />
        </a>
      )}
    </figure>
  );
}
