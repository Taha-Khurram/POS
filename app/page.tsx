import { Nav } from "@/components/site/nav";
import { Hero } from "@/components/site/hero";
import { LogoMarquee } from "@/components/site/logo-marquee";
import { RushCard } from "@/components/site/rush-card";
import { UnifiedPlatform } from "@/components/site/unified-platform";
import { Capabilities } from "@/components/site/capabilities";
import { Foundation } from "@/components/site/foundation";
import { Cta } from "@/components/site/cta";
import { Footer } from "@/components/site/footer";

export default function Page() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <LogoMarquee />
        <RushCard />
        <UnifiedPlatform />
        <Capabilities />
        <Foundation />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
