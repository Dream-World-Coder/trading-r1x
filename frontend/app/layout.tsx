/**
 * app/layout.tsx — Root Layout
 * Research-paper aesthetic: serif body, mono for data, light grid background
 */

import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--font-mono",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Trading-R1 | Reasoning Trace Market",
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
        <html lang="en" className={`${mono.variable}`}>
            <body className="bg-paper text-ink antialiased">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
