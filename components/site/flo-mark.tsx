/**
 * Flo mark — a receipt tape bending into a flow curve.
 */
export function FloMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Flo"
      className={className}
    >
      <defs>
        <linearGradient id="flo-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id="flo-mark-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="9.5" fill="url(#flo-mark-fill)" />
      <rect width="32" height="32" rx="9.5" fill="url(#flo-mark-sheen)" />

      <path
        d="M10 21.5c0-6.5 2.4-11 6.6-11 2 0 3.4.9 4.4 2.3"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M11.8 16.4h7.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
