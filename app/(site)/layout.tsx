import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";

/** The public marketing site: unchanged chrome, no auth. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
