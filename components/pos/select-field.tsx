"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { IconCheck, IconChevron } from "./icons";
import { useDismiss } from "./use-dismiss";

/** Clear air between the open menu and the edge of the window. A list that
 *  ends flush against the bottom of the screen reads as cut off. */
const MENU_GUTTER = 12;

/** The tallest a menu ever gets — `.pos-select-menu`'s 17rem, in pixels. */
const MENU_MAX = 272;

export type SelectOption = {
  id: string;
  label: string;
  /** A second line inside the row. The native `<option>` cannot hold one, and
   *  it is the whole reason a few of these lists are not native. */
  description?: string;
  /** A figure parked at the right edge of the row — a count, usually. The
   *  filter menu says how many items each stock state actually has, which is
   *  the difference between picking a filter and guessing at one. */
  meta?: React.ReactNode;
};

/**
 * The console's dropdown, as a controlled listbox.
 *
 * A listbox rather than a `<select>`, for the reason the dashboard's period
 * filter is one: the native control is drawn by the platform, so the same form
 * is a grey box on Windows, a blue pill on macOS, and on Android a sheet that
 * covers the field you were reading. Seven of them on one screen is seven
 * chances for the console to stop looking like one product.
 *
 * What it buys beyond the paint: a tick on the chosen row, a second line of
 * caption under it — "Rs 1,250" wants to say *why* it is the safe one — and a
 * count at the right edge. A native `<option>` can hold none of that.
 *
 * Keyboard is the full listbox contract: arrows and Home/End move the active
 * row, Enter or Space commits it, Escape closes without changing anything, and
 * typing a letter jumps to the next option starting with it. Focus never leaves
 * the trigger — the active row is named through `aria-activedescendant`, which
 * is what a screen reader announces.
 *
 * This is the piece for state somebody else owns: the product sheet's every
 * field is controlled, and the catalog's filters are React state the table
 * re-filters off. `SelectField` below wraps it for a form.
 */
export function Select({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Choose…",
  id: given,
  labelledBy,
  label,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  /** Shown when `value` matches nothing — an empty option list, usually. */
  placeholder?: string;
  id?: string;
  /** The id of the element naming this control, when there is a visible one. */
  labelledBy?: string;
  /** The accessible name, when there is not. */
  label?: string;
  className?: string;
}) {
  const auto = useId();
  const id = given ?? auto;
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();

  const selectedIndex = options.findIndex((option) => option.id === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));

  // Type-ahead. A ref rather than state: it is read inside the keydown that
  // wrote it, and re-rendering on every keystroke would only cost frames.
  const typed = useRef({ buffer: "", at: 0 });

  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Arrowing past the bottom of a scrolled list has to move the list. `block:
  // "nearest"` so a row already on screen is left exactly where it is.
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Which way the popup hangs, and how tall it may be.
   *
   * It is absolutely positioned, so a list taller than the room under the
   * trigger does not simply hang over the page — it lengthens the document and
   * hands the console a scrollbar that was not there a moment ago, which on a
   * filter bar near the foot of a screen is most of the time. So measure the
   * room on both sides when it opens: drop upwards when that is where the
   * space is, and cap the height at whatever is actually there.
   */
  const [drop, setDrop] = useState({ up: false, max: MENU_MAX });

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;

      const below = window.innerHeight - rect.bottom - MENU_GUTTER;
      const above = rect.top - MENU_GUTTER;
      // Only flip when down genuinely cannot hold the list and up holds more
      // of it — a menu that jumps sides for a few pixels is worse than a
      // short one.
      const up = below < Math.min(MENU_MAX, above);

      setDrop({ up, max: Math.max(0, Math.min(MENU_MAX, up ? above : below)) });
    };

    place();
    window.addEventListener("resize", place);
    // Captured, because the thing that moved the trigger may be any scroller
    // between it and the document — a sheet's body, the till's line list.
    window.addEventListener("scroll", place, true);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, ref]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };

  const commit = (index: number) => {
    if (!options[index]) return;
    onChange(options[index].id);
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
        if (!open) {
          show();
          return;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
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
        else show();
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
    <div className={`pos-select-wrap ${className}`} ref={ref}>
      <button
        type="button"
        id={`${id}-trigger`}
        className="pos-select"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}-trigger` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span
          className={`min-w-0 flex-1 truncate ${current ? "" : "text-graphite-500"}`}
        >
          {current?.label ?? placeholder}
        </span>

        <IconChevron className="pos-select-caret h-3.5 w-3.5" />
      </button>

      {open ? (
        <div
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          className="pos-menu pos-select-menu"
          data-drop={drop.up ? "up" : "down"}
          style={{ maxHeight: drop.max }}
        >
          {options.map((option, index) => {
            const selected = option.id === value;

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
                    <span className="pos-option-note">{option.description}</span>
                  ) : null}
                </span>

                {option.meta !== undefined && option.meta !== null ? (
                  <span className="pos-option-meta">{option.meta}</span>
                ) : null}

                {selected ? <IconCheck className="h-4 w-4 flex-none" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same dropdown, wired for a form.
 *
 * It owns the value and posts it through a hidden input, so a form submitted
 * before hydration still carries what was stored rather than nothing — the
 * field simply cannot be changed until the bundle lands. That is the right
 * trade in Settings and the wrong one at the register, which is why the
 * register's controls are still native.
 */
export function SelectField({
  name,
  label,
  value,
  options,
  hint,
  disabled = false,
  onChange,
}: {
  name: string;
  label: string;
  /** Uncontrolled from the caller's side: this is the starting value, and the
   *  hidden input is what the Server Action reads. */
  value: string;
  options: readonly SelectOption[];
  hint?: React.ReactNode;
  disabled?: boolean;
  /** For a caller that has to react to the choice without owning it — the
   *  product sheet narrows its category list off the department. */
  onChange?: (next: string) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState(value);

  return (
    <div className="block">
      <span className="pos-label" id={`${id}-label`}>
        {label}
      </span>

      {/* The form's actual value. Inside the same disabled fieldset as the
          trigger, so a read-only card posts nothing at all rather than a
          value the server would then have to refuse. */}
      <input type="hidden" name={name} value={chosen} disabled={disabled} />

      <Select
        id={id}
        value={chosen}
        onChange={(next) => {
          setChosen(next);
          onChange?.(next);
        }}
        options={options}
        disabled={disabled}
        labelledBy={`${id}-label`}
      />

      {hint ? <p className="pos-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * A controlled dropdown with a label above it, for a form whose state the page
 * already holds. The product sheet's six fields are all this: the barcode
 * lookup fills them, so nothing here can be uncontrolled.
 */
export function SelectRow({
  label,
  value,
  onChange,
  options,
  hint,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly SelectOption[];
  hint?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();

  return (
    <div className="block">
      <span className="pos-label" id={`${id}-label`}>
        {label}
      </span>

      <Select
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        labelledBy={`${id}-label`}
      />

      {hint ? <p className="pos-hint">{hint}</p> : null}
    </div>
  );
}
