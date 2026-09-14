import type { ReactNode } from "react";

/** Header copy animates on load, so entrances are plain CSS delays. */
const entrance = (delay: number) => ({
  animation: `fade-up 1s var(--ease-out-soft) ${delay}ms both`,
});

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** Buttons or links rendered under the lede. */
  children?: ReactNode;
};

/**
 * Shared masthead for every route except the home page, which carries its own
 * full-bleed hero. Repeats the hero's ambient stack at a shorter height so the
 * fixed nav always sits over the same kind of backdrop.
 */
export function PageHeader({ eyebrow, title, lede, children }: PageHeaderProps) {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_-25%,#12132b_0%,#08080f_50%,#03060e_100%)]" />
        <div className="stars absolute inset-0 opacity-70" />
        <div className="glow left-1/2 top-[-5rem] h-72 w-[42rem] -translate-x-1/2 animate-breathe bg-iris-600/22" />
        <div className="glow left-[18%] top-[38%] h-32 w-32 bg-iris-300/25 blur-[54px]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950" />
      </div>

      <div className="shell pt-32 pb-14 sm:pt-40 sm:pb-16">
        <div className="mx-auto max-w-3xl text-center">
          {eyebrow ? (
            <p className="eyebrow" style={entrance(60)}>
              {eyebrow}
            </p>
          ) : null}

          <h1 className="heading mt-3" style={entrance(140)}>
            {title}
          </h1>

          {lede ? (
            <p className="lede mx-auto mt-5 max-w-xl" style={entrance(260)}>
              {lede}
            </p>
          ) : null}

          {children ? (
            <div
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
              style={entrance(380)}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
