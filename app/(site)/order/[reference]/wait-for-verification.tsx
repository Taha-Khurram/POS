"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Long enough not to hammer anything from a tab left open all night. */
const EVERY_MS = 30_000;

/**
 * Re-reads the order while it waits, so a buyer watching the page sees it turn
 * to "Payment confirmed" without knowing to reload.
 *
 * `router.refresh()` re-renders the server page in place; once the status has
 * moved on, the page stops drawing this component and the polling stops with
 * it. A hidden tab does not poll, and catches up the moment it is looked at.
 */
export function WaitForVerification() {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  return (
    <p className="mt-5 text-[0.8125rem] text-mist-400" aria-live="polite">
      This page checks again every 30 seconds. You can close it — the login comes on WhatsApp either way.
    </p>
  );
}
