import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import AnalyticsConsent from "./components/AnalyticsConsent";
import "./globals.css";

/**
 * Google Analytics 4 measurement ID (`G-XXXXXXXXXX`).
 *
 * Analytics is completely off while this is unset, so a fresh checkout, a local
 * dev server and preview builds stay tag-free until the variable is configured
 * - see README -> Analytics (Google Analytics 4).
 */
const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim() ?? "";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geometric, slightly quirky display face used for the "LetsPoly" wordmark.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "LetsPoly · Interactive Polyhedron Construction",
  description:
    "Build, fold and print polyhedron templates — interactive 3D models, folding transitions and 2D nets.",
};

/** Mobile-first viewport: full width at 1× zoom, dark browser UI chrome. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/*
          Rendered client-side only, and only when a measurement ID exists:
          the GA tag must never be in the server HTML, because it may only run
          after the visitor consents.
        */}
        {gaId ? <AnalyticsConsent gaId={gaId} /> : null}
      </body>
    </html>
  );
}
