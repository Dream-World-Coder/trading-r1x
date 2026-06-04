/**
 * app/providers.tsx
 * ==================
 * Wraps the app with Wagmi + React Query context.
 * Must be a Client Component ("use client").
 *
 * Usage in app/layout.tsx:
 *   import { Providers } from "./providers";
 *   export default function RootLayout({ children }) {
 *     return <html><body><Providers>{children}</Providers></body></html>;
 *   }
 */

"use client";

import { ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "../wagmi.config";

export function Providers({ children }: { children: ReactNode }) {
    // QueryClient is created inside state so it is stable across re-renders
    // but does not persist between different users on the server.
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        // Cache IPFS data for 5 minutes (it is immutable)
                        staleTime: 5 * 60 * 1_000,
                        retry: 2,
                    },
                },
            }),
    );

    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
}
