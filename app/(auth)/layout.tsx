/**
 * The sign-in group. Deliberately no `Nav` and no `Footer`: the only thing to
 * do on this screen is sign in, and a marketing header full of exits is the
 * fastest way to lose someone who came here to open their till.
 *
 * It owns the full viewport rather than sitting inside a `main`, because the
 * page is a two-panel layout that runs edge to edge on a desktop.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <div className="min-h-dvh">{children}</div>;
}
