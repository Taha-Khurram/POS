import { Hero } from "@/components/site/hero";
import { LogoMarquee } from "@/components/site/logo-marquee";
import { RushCard } from "@/components/site/rush-card";
import { UnifiedPlatform } from "@/components/site/unified-platform";
import { Cta } from "@/components/site/cta";

export default function Page() {
  return (
    <>
      <Hero />
      <LogoMarquee />
      <RushCard />
      <UnifiedPlatform />
      <Cta />
    </>
  );
}
