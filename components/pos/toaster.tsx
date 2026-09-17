"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { IconAlert, IconCheck, IconClose } from "./icons";
import type { NoticeTone } from "@/lib/pos/notices";

/**
 * The counter's short-lived messages.
 *
 * A toast is for something that just happened and needs no answer — the sale
 * recorded, the ceiling saved, the cashier added. It is the opposite of the
 * bell, which is for something standing that has not been dealt with yet, and
 * the two deliberately share one vocabulary of tones so a warning reads the
 * same wherever it lands.
 *
 * Mounted once, by the console shell, so every screen under `/app` has it —
 * including the register. That matters more than it sounds: the till is the one
 * screen where nobody is looking at the form they just submitted, so a message
 * that only exists inside a card's footer is a message the cashier never sees.
 * The footer messages stay where they are; this is the copy that reaches
 * somebody whose eyes are on the customer.
 *
 * Bottom of the screen on purpose. The top corners are where the bill total and
 * the payment button live on a tablet, and a toast that covers either is a
 * toast that costs a sale.
 */

export type ToastTone = NoticeTone | "good";

export type Toast = {
  id: number;
  title: string;
  detail: string | null;
  tone: ToastTone;
};

type ToastInput = {
  title: string;
  detail?: string | null;
  tone?: ToastTone;
};

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** How long each tone stays. Bad news waits longer, because the person it is
 *  for is usually mid-transaction and looks up a beat later. */
const LIFETIME: Record<ToastTone, number> = {
  good: 4000,
  info: 4000,
  warn: 7000,
  bad: 9000,
};

/** Three is the whole stack. A fourth pushes the first off the bottom of a
 *  tablet in portrait, and a queue nobody can read is not a queue. */
const MAX = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Monotonic and per-mount. `Date.now()` collides when two land in the same
  // millisecond — which is exactly what a save that both succeeds and revalidates
  // does.
  const next = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    next.current += 1;

    const toast: Toast = {
      id: next.current,
      title: input.title,
      detail: input.detail ?? null,
      tone: input.tone ?? "good",
    };

    setToasts((current) => [...current, toast].slice(-MAX));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}

      {/* `polite`, not `assertive`: a cashier using a screen reader is in the
          middle of a sale, and an alert that interrupts the line they are on is
          worse than one that waits for the gap. */}
      <div className="pos-toaster" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Raise a toast. Returns a no-op outside the console, so a component that is
 * shared with the marketing site can call it without knowing where it is.
 */
export function useToast() {
  const push = useContext(ToastContext);
  return useCallback(
    (toast: ToastInput) => {
      push?.(toast);
    },
    [push],
  );
}

/**
 * Say it once when a Server Action comes back.
 *
 * Keyed on the timestamp the action stamps rather than on the state object: a
 * `revalidatePath` re-renders the form, and a hook watching the object would
 * announce the same save a second time. Two saves in a row are two different
 * timestamps, so they are two toasts.
 */
export function useActionToast(
  state: { error: string | null; savedAt: number | null },
  { saved, failed }: { saved: string; failed?: string },
) {
  const toast = useToast();
  const said = useRef<string | null>(null);

  useEffect(() => {
    const key = state.error
      ? `error:${state.error}`
      : state.savedAt
        ? `saved:${state.savedAt}`
        : null;

    if (!key || key === said.current) return;
    said.current = key;

    if (state.error) {
      toast({ title: failed ?? "That did not save", detail: state.error, tone: "bad" });
      return;
    }

    toast({ title: saved, tone: "good" });
  }, [state.error, state.savedAt, saved, failed, toast]);
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), LIFETIME[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  const bad = toast.tone === "bad" || toast.tone === "warn";

  return (
    <div className="pos-toast" data-tone={toast.tone}>
      <span className="pos-toast-mark" aria-hidden>
        {bad ? <IconAlert className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-semibold text-graphite-900">
          {toast.title}
        </span>
        {toast.detail ? (
          <span className="mt-0.5 block text-[0.75rem] leading-snug text-graphite-500">
            {toast.detail}
          </span>
        ) : null}
      </span>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="pos-icon-btn h-7 w-7 flex-none"
        aria-label="Dismiss"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * The bell's standing worries, said out loud once.
 *
 * Only for the ones that are actually wrong — a shut till, a payment past due,
 * an empty shelf. The renewal in twelve days is not news and does not interrupt
 * anybody.
 *
 * Once per set, per tab: the signature the layout computed is kept in
 * `sessionStorage`, so navigating between screens does not re-announce the same
 * thing, and a fresh tab in the morning does say it again. It is deliberately
 * not the cookie the bell marks as seen — looking at the bell should clear the
 * badge, not arrange for the shop to never be told again.
 */
export function NoticeToasts({
  notices,
  signature,
}: {
  notices: { id: string; title: string; detail: string; tone: NoticeTone }[];
  signature: string;
}) {
  const toast = useToast();

  const urgent = useMemo(
    () => notices.filter((notice) => notice.tone !== "info"),
    [notices],
  );

  useEffect(() => {
    if (urgent.length === 0) return;

    const key = `flo_said_${signature}`;

    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private mode, or storage switched off. Saying it again is the harmless
      // half of this, so carry on rather than swallowing the message.
    }

    for (const notice of urgent) {
      toast({ title: notice.title, detail: notice.detail, tone: notice.tone });
    }
  }, [urgent, signature, toast]);

  return null;
}
