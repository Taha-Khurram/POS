"use client";

import { useEffect, useRef, useState } from "react";

import { IconAlert, IconCheck, IconClose, IconDrawer } from "@/components/pos/icons";
import { useToast } from "@/components/pos/toaster";
import { moneyFormatter, type Counter } from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import {
  parseCash,
  shiftClock,
  shiftLength,
  SHIFT_NOTE_MAX,
  writeVariance,
  type Shift,
} from "@/lib/pos/shift";
import { closeShift, openShift, type CloseResult } from "./shift-actions";

/**
 * The drawer, across the top of the register.
 *
 * A strip rather than a screen, because a shift is not a task — it is two
 * moments at either end of four hours of doing something else. It says one
 * thing when the drawer is open ("since 4:02 pm, Rs 2,000 float, Bilal") and
 * one thing when it is not, and both of those fit on one line.
 *
 * **It is a gate.** Nothing can be charged and no money can be given back
 * until a drawer is open, and both Server Actions refuse for themselves rather
 * than trusting the button. The reasoning is that a sale with a null
 * `shift_id` belongs to nobody's count — so every one of them is a hole in the
 * thing shifts exist to produce, and a shop that fills half its day with those
 * has the paperwork without the accountability. The cost is real and worth
 * naming: this is one more thing standing between a customer with cash and a
 * receipt, so the shut state says exactly what to do and takes one tap to
 * clear.
 *
 * **The expected figure is never on this strip.** Not while the drawer is
 * open, not in the closing sheet before the count is typed, and not at all for
 * a cashier without `can_close_shift`. A cashier who can see what should be in
 * the drawer is a cashier who can count to it, and the whole value of the
 * exercise is that the two numbers were arrived at independently.
 */
export function ShiftBar({
  counter,
  shift,
  settings,
  canSeeVariance,
}: {
  counter: Counter;
  /** Whichever shift this till is in. Null means the register cannot charge:
   *  the strip becomes the way through rather than a note beside it. */
  shift: Shift | null;
  settings: ShopSettings;
  /** `can_close_shift`. Anybody may count the drawer; only somebody with this
   *  is shown the over-or-short. The action decides for itself — this only
   *  changes what the sheet promises before they press the button. */
  canSeeVariance: boolean;
}) {
  const money = moneyFormatter(settings);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState<Extract<CloseResult, { ok: true }> | null>(null);

  if (!shift) {
    return (
      <>
        <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-signal-warn/40 bg-signal-warn/5 px-3.5 py-2.5">
          <IconDrawer className="h-4 w-4 flex-none text-signal-warn" />

          <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-graphite-900">
            No drawer open on {counter.name}.
            <span className="ml-1 font-normal text-graphite-700">
              Nothing can be charged until one is — a sale has to land in a
              till somebody has counted into. It takes one tap and the cash you
              are starting with.
            </span>
          </p>

          <button
            type="button"
            onClick={() => setOpening(true)}
            className="pos-btn pos-btn-sm pos-btn-primary flex-none"
          >
            Open the drawer
          </button>
        </div>

        {opening ? (
          <OpenSheet
            counter={counter}
            settings={settings}
            onClose={() => setOpening(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-orchid-100 bg-paper-50 px-3.5 py-2.5">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-orchid-100 text-orchid-800">
          <IconDrawer className="h-4 w-4" />
        </span>

        <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug">
          <span className="font-medium text-graphite-900">
            {shift.openedBy}&rsquo;s drawer
          </span>
          <span className="text-graphite-500">
            {" "}
            · open since {shiftClock(shift.openedAt, settings.timezone)} (
            {shiftLength(shift.openedAt, null)}) · float{" "}
            {money(shift.openingFloat)}
          </span>
        </p>

        <button
          type="button"
          onClick={() => setClosing(true)}
          className="pos-btn pos-btn-sm pos-btn-soft flex-none"
        >
          Count and close
        </button>
      </div>

      {closing ? (
        <CloseSheet
          shift={shift}
          counter={counter}
          settings={settings}
          canSeeVariance={canSeeVariance}
          onClose={() => setClosing(false)}
          onDone={(result) => {
            setClosing(false);
            setDone(result);
          }}
        />
      ) : null}

      {done ? (
        <CloseDone
          result={done}
          settings={settings}
          onClose={() => setDone(null)}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The float going in.
 *
 * One field, because it is the only thing that is true at the start and
 * unknowable afterwards: a drawer that started with Rs 2,000 in change and a
 * drawer that started empty are Rs 2,000 apart at 11 pm, and by then nobody
 * remembers which. Everything else about a shift — what it took, how many
 * bills, what was refunded — the console can work out for itself.
 */
function OpenSheet({
  counter,
  settings,
  onClose,
}: {
  counter: Counter;
  settings: ShopSettings;
  onClose: () => void;
}) {
  const money = moneyFormatter(settings);
  const toast = useToast();

  const [given, setGiven] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const float = parseCash(given);
  const ready = float !== null && !busy;

  const open = async () => {
    if (!ready) return;

    setBusy(true);
    setFailure(null);

    const result = await openShift({
      counterId: counter.id,
      float,
      note,
    }).catch(() => ({
      ok: false as const,
      error: "We could not reach Flo to open the drawer. Check the connection.",
    }));

    setBusy(false);

    if (!result.ok) {
      setFailure(result.error);
      return;
    }

    toast({
      title: `${counter.name} is open`,
      detail: `Starting with ${money(float)} in the drawer.`,
      tone: "good",
    });

    onClose();
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Open the drawer on ${counter.name}`}
        className="pos-sheet outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.target instanceof HTMLButtonElement) return;
          event.preventDefault();
          void open();
        }}
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconDrawer className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Open the drawer
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">{counter.name}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-icon-btn disabled:opacity-50"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          <label className="block">
            <span className="pos-label">Cash going in — the float</span>
            <input
              ref={fieldRef}
              className="pos-field text-right text-[1.125rem] font-semibold tabular-nums"
              value={given}
              onChange={(event) => setGiven(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
            />
            <p className="pos-hint">
              The change you are starting with. Count it now — at 11 pm nobody
              remembers whether the drawer began with two thousand in it or
              nothing, and that is the whole difference between a count that
              balances and one that does not.
            </p>
          </label>

          <label className="block">
            <span className="pos-label">Anything worth noting</span>
            <input
              className="pos-field"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, SHIFT_NOTE_MAX))}
              placeholder="Took over from Asif, drawer already had 500…"
              autoComplete="off"
            />
          </label>

          {failure ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-signal-bad/40 bg-signal-bad/5 p-3 text-[0.8125rem] leading-relaxed text-graphite-700"
            >
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-bad" />
              {failure}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-btn pos-btn-quiet disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void open()}
            disabled={!ready}
            className="pos-btn pos-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Opening…" : "Start the shift"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Counting it out.
 *
 * The field is empty and the expected figure is nowhere on this screen. That is
 * the entire design: the count and the takings have to be arrived at
 * independently or the exercise is theatre, and a cashier who is shown
 * "Rs 12,480 expected" above an empty box will type Rs 12,480.
 *
 * What the variance turns out to be is said on the next screen, and only to
 * somebody with `can_close_shift`. The row records it either way — withholding
 * a figure from a screen is not the same as not writing it down, and a shop
 * that cannot go back and read what a drawer was short by has no accountability
 * at all.
 */
function CloseSheet({
  shift,
  counter,
  settings,
  canSeeVariance,
  onClose,
  onDone,
}: {
  shift: Shift;
  counter: Counter;
  settings: ShopSettings;
  canSeeVariance: boolean;
  onClose: () => void;
  onDone: (result: Extract<CloseResult, { ok: true }>) => void;
}) {
  const money = moneyFormatter(settings);

  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const amount = parseCash(counted);
  const ready = amount !== null && !busy;

  const close = async () => {
    if (!ready) return;

    setBusy(true);
    setFailure(null);

    const result = await closeShift({
      shiftId: shift.id,
      counted: amount,
      note,
    }).catch(() => ({
      ok: false as const,
      error: "We could not reach Flo to close the drawer. Check the connection.",
    }));

    setBusy(false);

    if (!result.ok) {
      setFailure(result.error);
      return;
    }

    onDone(result);
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Count the drawer on ${counter.name}`}
        className="pos-sheet outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.target instanceof HTMLButtonElement) return;
          event.preventDefault();
          void close();
        }}
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconDrawer className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Count the drawer
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {counter.name} · {shift.openedBy} ·{" "}
              {shiftLength(shift.openedAt, null)} so far
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-icon-btn disabled:opacity-50"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          <label className="block">
            <span className="pos-label">
              Every note and coin in the drawer, including the float
            </span>
            <input
              ref={fieldRef}
              className="pos-field text-right text-[1.125rem] font-semibold tabular-nums"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
            />
            <p className="pos-hint">
              Count it before you look at anything else. Flo works out what
              should be there from the shift&rsquo;s own bills — the point of
              the exercise is that the two numbers are arrived at separately,
              which is why this screen does not show you the answer first.
            </p>
          </label>

          <p className="rounded-xl bg-orchid-50 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-graphite-700">
            The float of {money(shift.openingFloat)} is part of it. Card
            payments are not — they never went into the drawer.
          </p>

          <label className="block">
            <span className="pos-label">Anything worth noting</span>
            <input
              className="pos-field"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, SHIFT_NOTE_MAX))}
              placeholder="Paid the water man 200 out of the till…"
              autoComplete="off"
            />
            <p className="pos-hint">
              Money that left the drawer for anything other than change is the
              usual reason a count comes up short. Say so here and the
              difference has an explanation attached to it.
            </p>
          </label>

          {!canSeeVariance ? (
            <p className="text-[0.75rem] leading-relaxed text-graphite-500">
              The difference goes to the owner rather than back to this screen.
              Your count is recorded exactly as you type it.
            </p>
          ) : null}

          {failure ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-signal-bad/40 bg-signal-bad/5 p-3 text-[0.8125rem] leading-relaxed text-graphite-700"
            >
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-bad" />
              {failure}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-btn pos-btn-quiet disabled:opacity-60"
          >
            Keep it open
          </button>

          <button
            type="button"
            onClick={() => void close()}
            disabled={!ready}
            className="pos-btn pos-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Closing…" : "Close the shift"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * What the count came to.
 *
 * The variance is the headline where there is one to show, and it is worded
 * rather than signed: "Rs 300 short" and "Rs 300 over" are opposite kinds of
 * problem, and a minus in front of a rupee figure reads as a negative amount of
 * money instead of as a direction. Exact gets its own word, because it is what
 * everybody is hoping for and deserves to look different from "Rs 0 over".
 *
 * A cashier without `can_close_shift` gets the same screen without the
 * variance, and is told plainly that it went to the owner rather than being
 * shown a blank where a figure should be.
 */
function CloseDone({
  result,
  settings,
  onClose,
}: {
  result: Extract<CloseResult, { ok: true }>;
  settings: ShopSettings;
  onClose: () => void;
}) {
  const money = moneyFormatter(settings);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const variance = result.overShort === null ? null : writeVariance(result.overShort);
  const exact = variance?.word === "exact";

  return (
    <div className="pos-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="The drawer is closed"
        className="pos-sheet outline-none"
      >
        <header className="flex items-center gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span
            className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
              variance === null || exact
                ? "bg-signal-good/15 text-signal-good"
                : "bg-signal-warn/15 text-signal-warn"
            }`}
          >
            {variance === null || exact ? (
              <IconCheck className="h-[18px] w-[18px]" />
            ) : (
              <IconAlert className="h-[18px] w-[18px]" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Drawer closed
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {result.bills} {result.bills === 1 ? "bill" : "bills"} on this
              shift
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="space-y-3 px-4 py-5 sm:px-5">
          {variance ? (
            <p
              className={`rounded-2xl px-4 py-3.5 text-center ${
                exact ? "bg-signal-good/10" : "bg-signal-warn/10"
              }`}
            >
              <span className="block text-[0.75rem] font-medium text-graphite-500">
                {exact ? "The drawer balances" : `The drawer is ${variance.word}`}
              </span>
              <span
                className={`mt-1 block font-display text-[2rem] leading-none font-bold tracking-tight tabular-nums ${
                  exact ? "text-signal-good" : "text-signal-warn"
                }`}
              >
                {exact ? money(result.counted) : money(variance.amount)}
              </span>
            </p>
          ) : (
            <p className="rounded-2xl bg-orchid-50 px-4 py-3.5 text-center text-[0.8125rem] leading-relaxed text-graphite-700">
              Counted {money(result.counted)}. The difference against what the
              till took has gone to the owner.
            </p>
          )}

          <dl className="space-y-1 rounded-xl border border-orchid-100 px-3.5 py-3 text-[0.8125rem]">
            <Row label="Counted out of the drawer" value={money(result.counted)} />

            {result.expected !== null ? (
              <Row
                label="What the till says should be there"
                value={money(result.expected)}
              />
            ) : null}

            {/* Beside it whoever is looking, because it is the first thing
                anybody asks a short drawer: was something rung up as cash that
                actually went on the card? */}
            <Row label="Taken on card — not in the drawer" value={money(result.card)} />
          </dl>
        </div>

        <footer className="flex items-center justify-end border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-primary">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-graphite-500">{label}</dt>
      <dd className="tabular-nums text-graphite-900">{value}</dd>
    </div>
  );
}
