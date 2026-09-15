/**
 * The frame every widget in the console sits in: a title, an optional line of
 * context, a slot for controls on the right, the body, and an optional ruled
 * footer.
 *
 * It exists so that eight widgets cannot drift into eight slightly different
 * paddings and heading sizes — the thing that makes a dashboard feel assembled
 * rather than designed. Nothing about it is chart-specific; the tables use it
 * too.
 */
export function ChartCard({
  title,
  caption,
  actions,
  footer,
  bleed = false,
  className = "",
  children,
}: {
  title: string;
  caption?: string;
  actions?: React.ReactNode;
  /** A ruled strip under the body. Settings puts its save bar here. */
  footer?: React.ReactNode;
  /** Let the body run to the card's edge — tables want this, charts don't. */
  bleed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`pos-card flex flex-col ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
            {title}
          </h2>
          {caption ? (
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">{caption}</p>
          ) : null}
        </div>

        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>

      <div className={bleed ? "flex-1" : "flex-1 px-4 pb-4"}>{children}</div>

      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
