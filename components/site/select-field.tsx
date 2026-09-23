"use client";

import { useId, useState } from "react";

import { Select, type SelectOption } from "@/components/pos/select-field";

/**
 * The console's dropdown, dressed for the marketing site.
 *
 * The listbox itself is `Select` — the keyboard contract, the type-ahead and
 * the drop-up measuring are the same code, not a second copy — and `.site-select`
 * in `globals.css` repaints the trigger as a `.field`. The native `<select>` it
 * replaces could not hold the plan's pitch under its name, and on Windows drew
 * a grey system list under a violet form.
 *
 * It posts through a hidden input carrying the starting value, so a form
 * submitted before the bundle lands still sends a plan rather than nothing.
 */
export function SiteSelectField({
  name,
  label,
  defaultValue,
  options,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: readonly SelectOption[];
  placeholder?: string;
}) {
  const id = useId();
  const [chosen, setChosen] = useState(defaultValue);

  return (
    <div>
      <span className="label" id={`${id}-label`}>
        {label}
      </span>

      <input type="hidden" name={name} value={chosen} />

      <Select
        id={id}
        value={chosen}
        onChange={setChosen}
        options={options}
        placeholder={placeholder}
        labelledBy={`${id}-label`}
        className="site-select"
      />
    </div>
  );
}
