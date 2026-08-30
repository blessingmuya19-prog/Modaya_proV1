import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { BeforeAfterSection } from "@/components/landing/BeforeAfterSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { AICapabilitiesSection } from "@/components/landing/AICapabilitiesSection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FinalCTASection } from "@/components/landing/FinalCTASection";
import { Footer } from "@/components/landing/Footer";

export default function HomePage() {
  return (
    <div style={{ background: '#050505', minHeight: '100vh', backgroundImage: 'radial-gradient(ellipse 100% 40% at 50% 0%, rgba(79,140,255,0.04) 0%, transparent 60%)' }}>
      <Navbar />
      <main>
        <HeroSection />
        <BeforeAfterSection />
        <HowItWorksSection />
        <AICapabilitiesSection />
        <UseCasesSection />
        <PricingSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
