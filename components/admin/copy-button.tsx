"use client";

import { useState } from "react";

import { IconCheck, IconCopy } from "@/components/pos/icons";

/**
 * Copy something to the clipboard and say so.
 *
 * The invite link is the one thing in this console that has to make it into
 * somebody else's WhatsApp exactly as it is, and a "copy" button with no
 * feedback is a button people press three times and then select the text by
 * hand anyway.
 *
 * `navigator.clipboard` needs a secure context, which `http://` on a phone on
 * the same wifi is not — so a failure falls back to selecting the text and
 * saying what to do, rather than silently doing nothing.
 */
export function CopyButton({
  value,
  label = "Copy",
  copied = "Copied",
  className = "pos-btn pos-btn-soft pos-btn-sm",
}: {
  value: string;
  label?: string;
  copied?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };

  return (
    <button type="button" onClick={copy} className={className}>
      {state === "done" ? (
        <IconCheck className="h-3.5 w-3.5" />
      ) : (
        <IconCopy className="h-3.5 w-3.5" />
      )}
      {state === "done" ? copied : state === "failed" ? "Select it and copy" : label}
    </button>
  );
}
