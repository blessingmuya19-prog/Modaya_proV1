import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { NotGenerationSection } from "@/components/landing/NotGenerationSection";
import { BeforeAfterSection } from "@/components/landing/BeforeAfterSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { AICapabilitiesSection } from "@/components/landing/AICapabilitiesSection";
import { HonestySection } from "@/components/landing/HonestySection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { FinalCTASection } from "@/components/landing/FinalCTASection";
import { Footer } from "@/components/landing/Footer";
import { INK } from "@/components/landing/kit";

export default function HomePage() {
  return (
    <div style={{ background: INK.bg, minHeight: "100vh", colorScheme: "dark" }}>
      <Navbar />
      <main>
        <HeroSection />
        <NotGenerationSection />
        <BeforeAfterSection />
        <HowItWorksSection />
        <AICapabilitiesSection />
        <HonestySection />
        <TestimonialsSection />
        <PricingSection />
        <FAQSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
