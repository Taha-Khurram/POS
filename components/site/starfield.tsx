"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  /** 0 = distant (barely moves), 1 = near (full parallax). */
  depth: number;
  twinkle: number;
  phase: number;
};

const STAR_COUNT = 190;

/** Ceiling on a mote's opacity. See the note on the component. */
const MOTE_ALPHA = 0.42;

/**
 * Drifting field of motes with pointer + scroll parallax. Canvas rather than
 * DOM because ~190 independently twinkling nodes is more than compositing
 * wants.
 *
 * It was literally a starfield when the site was violet-black. On paper the
 * same drift reads as dust in a shaft of light, so the specks are brand violet
 * rather than white — and much fainter, because a dark speck on a white page
 * carries roughly three times the weight of a light one on black.
 */
export function Starfield({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let frame = 0;

    // Pointer and scroll contribute separately, then combine into the target
    // the renderer eases toward.
    const pointer = { x: 0, y: 0 };
    let scrollShift = 0;
    const eased = { x: 0, y: 0 };

    const seed = () => {
      stars = Array.from({ length: STAR_COUNT }, () => {
        const depth = Math.random();
        return {
          x: Math.random(),
          y: Math.random(),
          r: 0.35 + depth * 1.25,
          depth,
          twinkle: 0.35 + Math.random() * 0.65,
          phase: Math.random() * Math.PI * 2,
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      // Ease toward the combined target so movement never snaps.
      const targetX = pointer.x;
      const targetY = pointer.y + scrollShift;
      eased.x += (targetX - eased.x) * 0.045;
      eased.y += (targetY - eased.y) * 0.045;

      for (const star of stars) {
        const shift = 6 + star.depth * 34;
        const x = star.x * width + eased.x * shift;
        const y = star.y * height + eased.y * shift;

        const flicker = reduced
          ? 0.7
          : 0.45 + 0.55 * Math.abs(Math.sin(time * 0.0006 + star.phase));

        context.beginPath();
        context.arc(x, y, star.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(59, 40, 204, ${
          star.twinkle * flicker * (0.3 + star.depth * 0.7) * MOTE_ALPHA
        })`;
        context.fill();

        // Brightest few get a soft bloom.
        if (star.depth > 0.86) {
          const glow = context.createRadialGradient(x, y, 0, x, y, star.r * 9);
          glow.addColorStop(0, "rgba(111, 82, 220, 0.16)");
          glow.addColorStop(1, "rgba(111, 82, 220, 0)");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, star.r * 9, 0, Math.PI * 2);
          context.fill();
        }
      }

      frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    const onScroll = () => {
      // Scroll drifts the field downward as the hero leaves.
      scrollShift = Math.min(window.scrollY / window.innerHeight, 1) * 1.4;
    };

    seed();
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
    />
  );
}
