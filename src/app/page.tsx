import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { BeforeAfterSection } from "@/components/landing/BeforeAfterSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { AICapabilitiesSection } from "@/components/landing/AICapabilitiesSection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FinalCTASection } from "@/components/landing/FinalCTASection";
import { Footer } from "@/components/landing/Footer";

export default function HomePage() {
  return (
    <div className="light-surface" style={{ background: "#F4F7FE", minHeight: "100vh" }}>
      <Navbar />
      <main>
        <HeroSection />
        <BeforeAfterSection />
        <HowItWorksSection />
        <AICapabilitiesSection />
        <UseCasesSection />
        <TestimonialsSection />
        <PricingSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
