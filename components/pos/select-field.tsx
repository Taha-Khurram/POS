"use client";

import { useEffect, useId, useRef, useState } from "react";

import { IconCheck, IconChevron } from "./icons";
import { useDismiss } from "./use-dismiss";

export type SelectOption = {
  id: string;
  label: string;
  /** A second line inside the row. The native `<option>` cannot hold one, and
   *  it is the whole reason a few of these lists are not native. */
  description?: string;
};

/**
 * A labelled dropdown for the settings forms.
 *
 * A listbox rather than a `<select>`, for the reason the dashboard's period
 * filter is one: the native control is drawn by the platform, so the same form
 * is a grey box on Windows, a blue pill on macOS, and on Android a sheet that
 * covers the field you were reading. Seven of them on one screen is seven
 * chances for the console to stop looking like one product.
 *
 * What it buys beyond the paint: a tick on the chosen row, and a second line of
 * caption under it — "Rs 1,250" wants to say *why* it is the safe one, and a
 * native `<option>` cannot hold that.
 *
 * What it costs: this needs JavaScript. The value rides in a hidden input, so a
 * form submitted before hydration still carries what was stored rather than
 * nothing — the field simply cannot be changed until the bundle lands. That is
 * the right trade here and the wrong one at the register, which is why the
 * register's controls are still native.
 *
 * Keyboard is the full listbox contract: arrows and Home/End move the active
 * row, Enter or Space commits it, Escape closes without changing anything, and
 * typing a letter jumps to the next option starting with it. Focus never leaves
 * the trigger — the active row is named through `aria-activedescendant`, which
 * is what a screen reader announces.
 */
export function SelectField({
  name,
  label,
  value,
  options,
  hint,
  disabled = false,
}: {
  name: string;
  label: string;
  /** Uncontrolled from the caller's side: this is the starting value, and the
   *  hidden input is what the Server Action reads. */
  value: string;
  options: readonly SelectOption[];
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();

  const [chosen, setChosen] = useState(value);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === chosen),
  );
  const [active, setActive] = useState(selectedIndex);

  // Type-ahead. A ref rather than state: it is read inside the keydown that
  // wrote it, and re-rendering on every keystroke would only cost frames.
  const typed = useRef({ buffer: "", at: 0 });

  const current = options[selectedIndex];

  // Arrowing past the bottom of a scrolled list has to move the list. `block:
  // "nearest"` so a row already on screen is left exactly where it is.
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = (from: number) => {
    setActive(from);
    setOpen(true);
  };

  const commit = (index: number) => {
    setChosen(options[index].id);
    setActive(index);
    setOpen(false);
  };

  const jump = (key: string) => {
    const now = Date.now();
    // A second of quiet starts a new word, so "s" then "s" cycles through the
    // s-options rather than looking for "ss".
    typed.current.buffer =
      now - typed.current.at > 1000 ? key : typed.current.buffer + key;
    typed.current.at = now;

    const needle = typed.current.buffer.toLowerCase();
    const from = typed.current.buffer.length === 1 ? active + 1 : active;

    for (let step = 0; step < options.length; step += 1) {
      const index = (from + step) % options.length;
      if (options[index].label.toLowerCase().startsWith(needle)) {
        if (open) setActive(index);
        else commit(index);
        return;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        if (!open) {
          show(selectedIndex);
          return;
        }
        setActive(Math.min(last, Math.max(0, active + step)));
        return;
      }
      case "Home":
      case "End": {
        if (!open) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : last);
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (open) commit(active);
        else show(selectedIndex);
        return;
      }
      case "Tab": {
        // Leaving the field is not a cancel, but it is not a choice either —
        // close and keep whatever was already chosen.
        if (open) setOpen(false);
        return;
      }
      default: {
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          jump(event.key);
        }
      }
    }
  };

  return (
    <div className="block">
      <span className="pos-label" id={`${id}-label`}>
        {label}
      </span>

      <div className="pos-select-wrap" ref={ref}>
        {/* The form's actual value. Inside the same disabled fieldset as the
            trigger, so a read-only card posts nothing at all rather than a
            value the server would then have to refuse. */}
        <input type="hidden" name={name} value={chosen} disabled={disabled} />

        <button
          type="button"
          id={`${id}-trigger`}
          className="pos-select"
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-labelledby={`${id}-label ${id}-trigger`}
          aria-activedescendant={open ? `${id}-option-${active}` : undefined}
          onClick={() => (open ? setOpen(false) : show(selectedIndex))}
          onKeyDown={onKeyDown}
        >
          <span className="min-w-0 flex-1 truncate">{current?.label}</span>
          <IconChevron className="pos-select-caret h-3.5 w-3.5" />
        </button>

        {open ? (
          <div
            id={`${id}-list`}
            ref={listRef}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="pos-menu pos-select-menu"
          >
            {options.map((option, index) => {
              const selected = option.id === chosen;

              return (
                <div
                  key={option.id}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-active={index === active}
                  className="pos-option"
                  // Not a button: the trigger keeps focus for the whole
                  // interaction, so a row that could take it would only steal
                  // the keyboard back on the next arrow press.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => commit(index)}
                  onPointerEnter={() => setActive(index)}
                >
                  <span className="min-w-0 flex-1">
                    {option.label}
                    {option.description ? (
                      <span className="mt-0.5 block text-[0.75rem] leading-snug font-normal text-graphite-500">
                        {option.description}
                      </span>
                    ) : null}
                  </span>

                  {selected ? (
                    <IconCheck className="h-4 w-4 flex-none text-orchid-700" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {hint ? <p className="pos-hint">{hint}</p> : null}
    </div>
  );
}
