"use client";

import { useEffect, useState } from "react";
import { useInView, usePrefersReducedMotion } from "./use-in-view";

type CountUpProps = {
  to: number;
  /** Milliseconds for the whole run. */
  duration?: number;
  /** Held back so a row of counters doesn't all land at once. */
  delay?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUp({
  to,
  duration = 1600,
  delay = 0,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: CountUpProps) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Reduced motion renders the final value straight away — see `display`.
    if (!inView || reduced) return;

    let frame = 0;
    let start = 0;

    const tick = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      setValue(to * easeOutCubic(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [inView, to, duration, delay, reduced]);

  const display = reduced ? to : value;

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
