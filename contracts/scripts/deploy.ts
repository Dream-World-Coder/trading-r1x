/**
 * scripts/deploy.ts
 * ==================
 * Deploys MockUSDC (testnet only) and TradeReasoningMarket to Arc testnet.
 * Run:
 *   npx hardhat run scripts/deploy.ts --network arc_testnet
 *
 * On mainnet: pass the real USDC address to the constructor instead.
 */

import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Mock USDC Contract ───────────────────────────────────────────────────────
// Deploy this only on testnet so we have a faucet-mintable USDC.

const MOCK_USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function decimals() view returns (uint8)",
];

async function deployMockUSDC(deployer: any): Promise<string> {
  console.log("\n📦 Deploying MockUSDC…");
  const MockUSDC = await ethers.getContractFactory("MockERC20");
  const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const addr = await usdc.getAddress();
  console.log(`   ✅ MockUSDC deployed: ${addr}`);

  // Mint 1,000,000 USDC to deployer for testing
  const mintTx = await usdc.mint(
    deployer.address,
    ethers.parseUnits("1000000", 6),
  );
  await mintTx.wait();
  console.log(`   💰 Minted 1,000,000 USDC to ${deployer.address}`);

  return addr;
}

// ─── Main Deploy ──────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`\n🚀 Deploying to: ${network.name}`);
  console.log(`   Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`   Balance:  ${ethers.formatEther(balance)} ARC\n`);

  // 1. Deploy or use existing USDC
  let usdcAddress: string;
  if (network.name === "hardhat" || network.name === "arc_testnet") {
    usdcAddress = await deployMockUSDC(deployer);
  } else {
    // Mainnet: use real Circle USDC address
    usdcAddress = process.env.USDC_ADDRESS!;
    if (!usdcAddress) throw new Error("Set USDC_ADDRESS env for mainnet");
    console.log(`🪙 Using existing USDC at ${usdcAddress}`);
  }

  // 2. Deploy TradeReasoningMarket
  console.log("\n📦 Deploying TradeReasoningMarket…");
  const Market = await ethers.getContractFactory("TradeReasoningMarket");
  const market = await Market.deploy(usdcAddress);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log(`   ✅ TradeReasoningMarket deployed: ${marketAddress}`);

  // 3. Save addresses to file (imported by frontend and Python scripts)
  const deployment = {
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    TradeReasoningMarket: marketAddress,
    USDC: usdcAddress,
  };

  const outPath = path.join(__dirname, "../deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`\n💾 Addresses saved to deployment.json`);
  console.log(JSON.stringify(deployment, null, 2));

  // 4. Verify on block explorer (skipped on local hardhat)
  if (network.name !== "hardhat") {
    console.log("\n🔍 Verifying on block explorer…");
    await new Promise((r) => setTimeout(r, 15_000)); // wait for propagation
    try {
      await run("verify:verify", {
        address: marketAddress,
        constructorArguments: [usdcAddress],
      });
      console.log("   ✅ Verified");
    } catch (e: any) {
      console.log(`   ⚠️  Verification failed: ${e.message}`);
    }
  }

  console.log("\n🎉 Deployment complete!\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
