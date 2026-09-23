import { FloMark } from "@/components/site/flo-mark";

/**
 * The fallback every route group's `loading.tsx` renders while a page streams
 * in: the wordmark, breathing. It sits inside the group's layout, so the nav or
 * the console rail stays put and only the content area waits.
 *
 * Both cuts of the wordmark are drawn and CSS picks one, because the console's
 * night theme is a `data-theme` attribute on `.pos-root` and this is a server
 * component with no way to read it. Pure CSS otherwise — a loading state that
 * needs JavaScript to animate is one that shows nothing on the slow load it
 * exists for.
 */
export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <FloMark className="route-loading-mark route-loading-ink h-10 w-auto" priority />
      <FloMark
        className="route-loading-mark route-loading-white h-10 w-auto"
        priority
        tone="white"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}
