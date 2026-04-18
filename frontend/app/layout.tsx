import type { Metadata, Viewport } from "next";
import { Noto_Sans, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

import { Providers } from "./providers";
import { Sidebar } from "@/components/shell/sidebar";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loupe — AI proof reviewer",
  description:
    "A loupe for your proofs. An open-source AI proof reviewer by MorphMind.",
  applicationName: "Loupe",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    other: [
      { rel: "icon", url: "/android-chrome-192.png", sizes: "192x192" },
      { rel: "icon", url: "/android-chrome-512.png", sizes: "512x512" },
    ],
  },
  openGraph: {
    title: "Loupe — AI proof reviewer",
    description:
      "A loupe for your proofs. An open-source AI proof reviewer by MorphMind.",
    images: ["/brand/social/og-card-1200x630.png"],
    siteName: "Loupe",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loupe — AI proof reviewer",
    description: "A loupe for your proofs.",
    images: ["/brand/social/og-card-1200x630.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#065F46",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${notoSans.variable} ${jetbrainsMono.variable} ${sourceSerif.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
