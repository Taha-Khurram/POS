"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "./use-in-view";

type TiltProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Maximum rotation in degrees at the corners. */
  max?: number;
  /** Lift toward the viewer while hovered, in px. */
  lift?: number;
  /** Also publish --mx / --my for a `.spotlight` glow. */
  spotlight?: boolean;
};

/**
 * Pointer-driven 3D tilt. Writes transforms straight to the node inside a
 * single rAF so we never re-render React on pointer move.
 */
export function Tilt({
  children,
  className,
  style,
  max = 7,
  lift = 0,
  spotlight = true,
}: TiltProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();

  const apply = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const node = ref.current;
      if (!node || reduced) return;

      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        node.style.transform = `perspective(1100px) rotateX(${
          (0.5 - py) * max * 2
        }deg) rotateY(${(px - 0.5) * max * 2}deg) translate3d(0, ${-lift}px, 0)`;

        if (spotlight) {
          node.style.setProperty("--mx", `${px * 100}%`);
          node.style.setProperty("--my", `${py * 100}%`);
        }
      });
    },
    [max, lift, spotlight, reduced],
  );

  const reset = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    cancelAnimationFrame(frame.current);
    node.style.transform =
      "perspective(1100px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)";
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <div
      ref={ref}
      onPointerMove={apply}
      onPointerLeave={reset}
      className={className}
      style={{
        transformStyle: "preserve-3d",
        transition: "transform 0.5s var(--ease-out-soft)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
