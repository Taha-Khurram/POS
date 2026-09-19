"use client";

import { useTransition } from "react";

import { IconRegister } from "@/components/pos/icons";
import { Select } from "@/components/pos/select-field";
import type { Counter } from "@/lib/pos/counter";
import { chooseCounter } from "./choose-counter";

/**
 * Which counter this tablet is billing from, at the top of the register.
 *
 * The console's own listbox rather than a link to a separate screen: switching
 * counters is one decision and it should not cost the cashier the bill they
 * are looking at. Typing jumps to a counter by name — `Select` carries the
 * type-ahead — which is what a shop with six tills actually needs.
 *
 * It writes through `chooseCounter`, the same Server Action the first-run
 * picker submits, so the cookie is still only written after the id is checked
 * against the shop's open counters and the owner-only rule is still enforced
 * server-side. Rendering this control at all is the page's call.
 */
export function CounterSelect({
  counters,
  current,
}: {
  counters: Counter[];
  current: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <IconRegister
        className="h-4 w-4 flex-none text-graphite-500"
        aria-hidden
      />

      <Select
        className="w-52"
        value={current}
        label="Counter this tablet bills from"
        // The action redirects, so the field stays on the old counter until
        // the new page paints. Dead in between rather than ready to be asked
        // a second question it would then lose.
        disabled={pending}
        options={counters.map((counter) => ({
          id: counter.id,
          label: counter.name,
          description: counter.receiptPrefix,
        }))}
        onChange={(next) => {
          if (next === current) return;

          const form = new FormData();
          form.set("counter_id", next);

          startTransition(async () => {
            await chooseCounter(form);
          });
        }}
      />
    </div>
  );
}
