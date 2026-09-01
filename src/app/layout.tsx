import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { ScrollToTop } from "@/components/ScrollToTop";

export const metadata: Metadata = {
  title: "Modaya — AI Video Editor",
  description: "Upload your footage. Tell AI how to edit it. Modaya handles the cuts, captions and pacing — no timeline, no manual editing.",
  keywords: "AI video editor, automatic video editing, AI cuts, auto captions, podcast editing, YouTube editing, short form video",
  metadataBase: new URL("https://modaya-pro-v1.vercel.app"),
  openGraph: {
    title: "Modaya — AI Video Editor",
    description: "Upload your footage. Tell AI how to edit it. No timeline. No manual cuts.",
    url: "https://modaya-pro-v1.vercel.app",
    siteName: "Modaya",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Modaya — AI Video Editor",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Modaya — AI Video Editor",
    description: "Upload your footage. Tell AI how to edit it. No timeline. No manual cuts.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,100..900;1,100..900&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#050505" />
      </head>
      <body style={{ background: '#050505', color: '#F5F7FA', margin: 0, padding: 0, fontFamily: "'Inter Tight', sans-serif", WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', textRendering: 'optimizeLegibility' }}>
        <ScrollToTop />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
