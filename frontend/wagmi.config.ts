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
// Replace RPC_URL and chain IDs when Arc publishes official testnet details.

export const arcTestnet = defineChain({
  id: 12_345, // placeholder — update when Arc publishes
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
          "https://rpc.arc-testnet.example.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url:
        process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ??
        "https://explorer.arc-testnet.example.com",
    },
  },
  testnet: true,
});

// ─── WalletConnect Project ID ─────────────────────────────────────────────────
// Get yours at https://cloud.walletconnect.com — required for mobile wallets.

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

// ─── Wagmi Config ─────────────────────────────────────────────────────────────

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected(), // MetaMask / browser wallet
    walletConnect({ projectId: WC_PROJECT_ID }),
  ],
  transports: {
    [arcTestnet.id]: http(),
  },
  ssr: true, // required for Next.js App Router
});

// ─── Contract Addresses (set after deployment) ────────────────────────────────

export const CONTRACT_ADDRESSES = {
  TradeReasoningMarket: (process.env.NEXT_PUBLIC_MARKET_CONTRACT ??
    "0x0") as `0x${string}`,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0x0") as `0x${string}`,
} as const;
