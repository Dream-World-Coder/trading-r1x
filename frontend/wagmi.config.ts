/**
 * wagmi.config.ts
 * ================
 * Chain definition and wagmi client config for the Arc L1 testnet.
 * Import `wagmiConfig` into your Next.js Providers wrapper.
 *
 * Docs: https://wagmi.sh/react/api/createConfig
 */

import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { injected, walletConnect } from "wagmi/connectors";

// ─── Arc Testnet Chain Definition ─────────────────────────────────────────────

export const arcTestnet = defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: {
        decimals: 18,
        name: "Arc",
        symbol: "ARC",
    },
    rpcUrls: {
        default: {
            http: [
                process.env.NEXT_PUBLIC_ARC_RPC_URL ??
                    "https://rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_96a9869e5695443d0ccf51e1e5676711343c3482715b38881f5a79c4154f2017",
            ],
        },
    },
    blockExplorers: {
        default: {
            name: "ArcScan",
            url:
                process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ??
                "https://testnet.arcscan.app",
        },
    },
    testnet: true,
});

// ─── WalletConnect Project ID ─────────────────────────────────────────────────

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

// ─── Wagmi Config ─────────────────────────────────────────────────────────────

export const wagmiConfig = createConfig({
    chains: [arcTestnet],
    connectors: [
        injected(), // MetaMask / browser wallet
        // Only initialize WalletConnect if a Project ID is provided
        ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID })] : []),
    ],
    transports: {
        [arcTestnet.id]: http(),
    },
    ssr: true, // required for Next.js App Router
});

// ─── Contract Addresses ───────────────────────────────────────────────────────

export const CONTRACT_ADDRESSES = {
    TradeReasoningMarket: (process.env.NEXT_PUBLIC_MARKET_CONTRACT ??
        "0xb25b94C6A080e1BAD6DaFc1A00A49821AA431c7c") as `0x${string}`,
    USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
        "0xE3400df21263e096E107D526742587a83901b9E2") as `0x${string}`,
} as const;
