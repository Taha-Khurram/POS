"use client";

import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

/**
 * One IntersectionObserver shared by every Reveal on the page — dozens of
 * separate observers would each carry their own callback queue for no gain.
 */
let sharedObserver: IntersectionObserver | null = null;

function getObserver() {
  if (sharedObserver) return sharedObserver;

  sharedObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        // Reveal is one-way: stop paying for it once it has played.
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
  );

  return sharedObserver;
}

type RevealProps<T extends ElementType> = {
  as?: T;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Stagger offset in milliseconds. */
  delay?: number;
  /** Vertical travel in px (negative rises from below the final position). */
  y?: number;
  /** Horizontal travel in px. */
  x?: number;
  /** Starting scale, e.g. 0.96 for a subtle zoom-in. */
  scale?: number;
  /** Starting blur in px. */
  blur?: number;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className" | "style">;

export function Reveal<T extends ElementType = "div">({
  as,
  children,
  className,
  style,
  delay = 0,
  y = 30,
  x = 0,
  scale = 1,
  blur = 8,
  ...rest
}: RevealProps<T>) {
  const ref = useRef<HTMLElement | null>(null);
  const Tag = (as ?? "div") as ElementType;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer support, or the visitor asked for less motion: show it now.
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      node.classList.add("is-in");
      return;
    }

    const observer = getObserver();
    observer.observe(node);
    return () => observer.unobserve(node);
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      className={className}
      style={
        {
          "--reveal-delay": `${delay}ms`,
          "--reveal-y": `${y}px`,
          "--reveal-x": `${x}px`,
          "--reveal-scale": scale,
          "--reveal-blur": `${blur}px`,
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}
