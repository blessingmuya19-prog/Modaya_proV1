import { Sidebar } from "@/components/dashboard/Sidebar";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { MobileTabBar } from "@/components/dashboard/MobileTabBar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F4F7FE', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <DashboardHeader />
        <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 0 }}>
          {children}
        </main>
        {/* Mobile tab bar — visible only on ≤640px via CSS class */}
        <MobileTabBar />
      </div>
    </div>
  );
}
