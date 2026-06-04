/**
 * hardhat.config.ts
 * ==================
 * Hardhat configuration for compiling and deploying to the Arc testnet.
 *
 * Install deps:
 *   npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox \
 *       @openzeppelin/contracts dotenv
 */

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ARC_RPC_URL =
  process.env.ARC_RPC_URL ?? "https://rpc.arc-testnet.example.com";
const ARC_EXPLORER_URL =
  process.env.ARC_EXPLORER_URL ?? "https://explorer.arc-testnet.example.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arc_testnet: {
      url: ARC_RPC_URL,
      chainId: 5042002, // Corrected Chain ID
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      arc_testnet: process.env.ARC_EXPLORER_API_KEY ?? "not-required",
    },
    customChains: [
      {
        network: "arc_testnet",
        chainId: 5042002, // Chain ID
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
