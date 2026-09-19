import { Hero } from "@/components/site/hero";
import { PreviewBand } from "@/components/site/preview-band";
import { RushCard } from "@/components/site/rush-card";
import { ProductTour } from "@/components/site/product-tour";
import { UnifiedPlatform } from "@/components/site/unified-platform";
import { Cta } from "@/components/site/cta";

export default function Page() {
  return (
    <>
      <Hero />
      <PreviewBand />
      <RushCard />
      <ProductTour />
      <UnifiedPlatform />
      <Cta />
    </>
  );
}
