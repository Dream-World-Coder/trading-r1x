/**
 * app/layout.tsx — Root Layout
 */

import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trading-R1 Market | Bet on AI Reasoning",
  description:
    "A decentralised prediction market where AI reasoning traces are the product. Wager USDC on whether an AI's trading logic is profitable.",
  openGraph: {
    title: "Trading-R1 Market",
    description: "Wager USDC on AI reasoning traces, settled on Arc L1.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-slate-950 text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
