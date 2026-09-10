"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Options = {
  /** Fraction of the element that must be visible before firing. */
  threshold?: number;
  /** Shrink the trigger area so animations start a beat after entry. */
  rootMargin?: string;
};

/**
 * Fires once when the element scrolls into view. Used by animations that need
 * to *run code* on entry (counters, chart draws) rather than just swap a class.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.25,
  rootMargin = "0px 0px -8% 0px",
}: Options = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    // Defensive fallback: reveal on the next frame rather than never.
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        observer.disconnect();
      },
      { threshold, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, threshold, rootMargin]);

  return { ref, inView };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Reads the visitor's motion preference, SSR-safe. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    // The server can't know; assume motion is fine and correct on hydration.
    () => false,
  );
}
