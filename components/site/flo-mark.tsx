import Image from "next/image";

import logo from "@/public/flo-logo-white.png";

/**
 * The Flo logo — the full wordmark, recoloured white with a transparent
 * background, so it sits on the dark page without a plate behind it. The white
 * receipt inside the "o" is knocked out as negative space.
 *
 * Because this is the wordmark and not an icon, callers must not set a "Flo"
 * text label beside it, and should size it by height (`h-7 w-auto`) so the
 * aspect ratio holds.
 */
export function FloMark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image src={logo} alt="Flo" priority={priority} className={className} />
  );
}
