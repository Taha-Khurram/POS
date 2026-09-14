"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Open/closed state for a popover that has to close the way people expect:
 * click anywhere else, or press Escape. Both listeners are only attached while
 * the thing is open, so a topbar with three of these costs nothing at rest.
 *
 * `pointerdown` rather than `click` — a menu that waits for mouseup stays open
 * under the finger on a touchscreen, which on a counter tablet reads as lag.
 */
export function useDismiss<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { ref, open, setOpen };
}
