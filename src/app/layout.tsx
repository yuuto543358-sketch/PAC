import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "PERSONAL AI COMPANY",
  description: "AIの力で、個人の可能性を最大化する。あなた専属のAI企業。",
  applicationName: "PERSONAL AI COMPANY",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AI COMPANY",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1118" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
