import Image from "next/image";

import inkLogo from "@/public/flo-logo-ink.png";
import whiteLogo from "@/public/flo-logo-white.png";

/**
 * The Flo logo — the full wordmark on a transparent background, with the
 * receipt inside the "o" knocked out as negative space.
 *
 * Two tones, because the wordmark is flat artwork and cannot adapt: `ink` is
 * the brand's deep violet and is what the lit site and the light counter want;
 * `white` is for the few places that are still dark under it — the console's
 * logo plate, and the same plate in the night theme. They are one file
 * recoloured, alpha for alpha, so the knockout is identical in both.
 *
 * Because this is the wordmark and not an icon, callers must not set a "Flo"
 * text label beside it, and should size it by height (`h-7 w-auto`) so the
 * aspect ratio holds.
 */
export function FloMark({
  className,
  priority = false,
  tone = "ink",
}: {
  className?: string;
  priority?: boolean;
  tone?: "ink" | "white";
}) {
  return (
    <Image
      src={tone === "white" ? whiteLogo : inkLogo}
      alt="Flo"
      priority={priority}
      className={className}
    />
  );
}
