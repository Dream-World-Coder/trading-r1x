/**
 * test/TradeReasoningMarket.test.ts
 * ==================================
 * Comprehensive test suite for the TradeReasoningMarket smart contract.
 * Run: npx hardhat test
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TradeReasoningMarket, MockERC20 } from "../typechain-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USDC = (amount: number) => ethers.parseUnits(String(amount), 6);
const ONE_DAY = 86_400;
const ONE_WEEK = 7 * ONE_DAY;

function randomHash(): `0x${string}` {
  return ethers.keccak256(ethers.randomBytes(32)) as `0x${string}`;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, alice, bob, carol] = await ethers.getSigners();

  // Deploy mock USDC
  const MockERC20F = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20F.deploy("USD Coin", "USDC", 6)) as MockERC20;
  await usdc.waitForDeployment();

  // Mint 10,000 USDC to each test user
  for (const user of [alice, bob, carol]) {
    await usdc.mint(user.address, USDC(10_000));
  }

  // Deploy market
  const MarketF = await ethers.getContractFactory("TradeReasoningMarket");
  const market = (await MarketF.deploy(
    await usdc.getAddress(),
  )) as TradeReasoningMarket;
  await market.waitForDeployment();

  // Approve market to spend USDC for each user
  for (const user of [alice, bob, carol]) {
    await usdc.connect(user).approve(await market.getAddress(), USDC(10_000));
  }

  return { market, usdc, owner, alice, bob, carol };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("TradeReasoningMarket", () => {
  // ── registerTrace ───────────────────────────────────────────────────────────

  describe("registerTrace()", () => {
    it("registers a new trace and emits TraceRegistered", async () => {
      const { market, alice } = await deployFixture();
      const hash = randomHash();
      const cid = "bafybeig_test_cid_001";

      await expect(
        market.connect(alice).registerTrace(hash, cid, ONE_DAY, ONE_WEEK),
      )
        .to.emit(market, "TraceRegistered")
        .withArgs(
          hash,
          cid,
          alice.address,
          await time.latest().then((t) => t + ONE_DAY),
        );

      const trace = await market.getTrace(hash);
      expect(trace.creator).to.equal(alice.address);
      expect(trace.ipfsCid).to.equal(cid);
      expect(trace.resolved).to.be.false;
    });

    it("reverts on duplicate hash", async () => {
      const { market, alice } = await deployFixture();
      const hash = randomHash();
      await market
        .connect(alice)
        .registerTrace(hash, "cid1", ONE_DAY, ONE_WEEK);
      await expect(
        market.connect(alice).registerTrace(hash, "cid2", ONE_DAY, ONE_WEEK),
      ).to.be.revertedWithCustomError(market, "TraceAlreadyRegistered");
    });

    it("reverts on zero waging window", async () => {
      const { market, alice } = await deployFixture();
      await expect(
        market.connect(alice).registerTrace(randomHash(), "cid", 0, ONE_WEEK),
      ).to.be.revertedWithCustomError(market, "InvalidDeadlines");
    });
  });

  // ── placeWager ──────────────────────────────────────────────────────────────

  describe("placeWager()", () => {
    async function traceWithWagingOpen(
      market: TradeReasoningMarket,
      alice: HardhatEthersSigner,
    ) {
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      return hash;
    }

    it("accepts a PROFIT wager and updates profitPool", async () => {
      const { market, usdc, alice, bob } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);

      await expect(market.connect(bob).placeWager(hash, true, USDC(100)))
        .to.emit(market, "WagerPlaced")
        .withArgs(hash, bob.address, USDC(100), true);

      const trace = await market.getTrace(hash);
      expect(trace.profitPool).to.equal(USDC(100));
      expect(trace.lossPool).to.equal(0n);
    });

    it("accepts a LOSS wager and updates lossPool", async () => {
      const { market, alice, carol } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);

      await market.connect(carol).placeWager(hash, false, USDC(50));
      const trace = await market.getTrace(hash);
      expect(trace.lossPool).to.equal(USDC(50));
    });

    it("reverts when waging deadline passed", async () => {
      const { market, alice, bob } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await time.increase(ONE_DAY + 1);

      await expect(
        market.connect(bob).placeWager(hash, true, USDC(10)),
      ).to.be.revertedWithCustomError(market, "WagingClosed");
    });

    it("reverts on duplicate wager from same address", async () => {
      const { market, alice, bob } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);
      await market.connect(bob).placeWager(hash, true, USDC(10));
      await expect(
        market.connect(bob).placeWager(hash, false, USDC(10)),
      ).to.be.revertedWithCustomError(market, "AlreadyWagered");
    });

    it("reverts on wager below minimum", async () => {
      const { market, alice, bob } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);
      await expect(
        market.connect(bob).placeWager(hash, true, USDC(0.5)),
      ).to.be.revertedWithCustomError(market, "WagerBelowMinimum");
    });

    it("reverts on wager above maximum", async () => {
      const { market, alice, bob } = await deployFixture();
      // Mint more for this test
      const { usdc } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);
      await expect(
        market.connect(bob).placeWager(hash, true, USDC(10_001)),
      ).to.be.revertedWithCustomError(market, "WagerAboveMaximum");
    });

    it("pulls USDC from wagerer", async () => {
      const { market, usdc, alice, bob } = await deployFixture();
      const hash = await traceWithWagingOpen(market, alice);
      const before = await usdc.balanceOf(bob.address);
      await market.connect(bob).placeWager(hash, true, USDC(200));
      const after = await usdc.balanceOf(bob.address);
      expect(before - after).to.equal(USDC(200));
    });
  });

  // ── resolveTrace ────────────────────────────────────────────────────────────

  describe("resolveTrace()", () => {
    async function resolveScenario() {
      const { market, usdc, owner, alice, bob, carol } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await market.connect(bob).placeWager(hash, true, USDC(300)); // bet profit
      await market.connect(carol).placeWager(hash, false, USDC(100)); // bet loss
      await time.increase(ONE_DAY + 1); // close waging
      return { market, usdc, owner, alice, bob, carol, hash };
    }

    it("owner can resolve and emits TraceResolved", async () => {
      const { market, owner, hash } = await resolveScenario();
      await expect(market.connect(owner).resolveTrace(hash, true))
        .to.emit(market, "TraceResolved")
        .withArgs(hash, true, USDC(300), USDC(100));
      const trace = await market.getTrace(hash);
      expect(trace.resolved).to.be.true;
      expect(trace.wasProfitable).to.be.true;
    });

    it("non-owner cannot resolve", async () => {
      const { market, alice, hash } = await resolveScenario();
      await expect(
        market.connect(alice).resolveTrace(hash, true),
      ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });

    it("cannot resolve twice", async () => {
      const { market, owner, hash } = await resolveScenario();
      await market.connect(owner).resolveTrace(hash, true);
      await expect(
        market.connect(owner).resolveTrace(hash, false),
      ).to.be.revertedWithCustomError(market, "TraceAlreadyResolved");
    });
  });

  // ── claimWinnings ───────────────────────────────────────────────────────────

  describe("claimWinnings()", () => {
    async function resolvedScenario(profitable: boolean) {
      const { market, usdc, owner, alice, bob, carol } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      // bob bets profit 300 USDC, carol bets loss 100 USDC
      await market.connect(bob).placeWager(hash, true, USDC(300));
      await market.connect(carol).placeWager(hash, false, USDC(100));
      await time.increase(ONE_DAY + 1);
      await market.connect(owner).resolveTrace(hash, profitable);
      return { market, usdc, owner, alice, bob, carol, hash };
    }

    it("profitable: bob claims correct payout", async () => {
      const { market, usdc, bob, hash } = await resolvedScenario(true);
      const before = await usdc.balanceOf(bob.address);

      await expect(market.connect(bob).claimWinnings(hash)).to.emit(
        market,
        "WinningsClaimed",
      );

      const after = await usdc.balanceOf(bob.address);
      const payout = after - before;

      // bob staked 300, carol staked 100
      // fee = 100 * 2% = 2 USDC; distributable = 98 USDC
      // bob share = 300/300 * 98 = 98 USDC
      // total payout = 300 + 98 = 398 USDC
      expect(payout).to.equal(USDC(398));
    });

    it("not-profitable: carol claims correct payout", async () => {
      const { market, usdc, carol, hash } = await resolvedScenario(false);
      const before = await usdc.balanceOf(carol.address);
      await market.connect(carol).claimWinnings(hash);
      const after = await usdc.balanceOf(carol.address);
      const payout = after - before;

      // carol staked 100; loser pool = 300
      // fee = 300 * 2% = 6; distributable = 294
      // carol share = 100/100 * 294 = 294; total = 100 + 294 = 394
      expect(payout).to.equal(USDC(394));
    });

    it("loser cannot claim", async () => {
      const { market, bob, hash } = await resolvedScenario(false); // bob bet profit, trace not profitable → bob loses
      await expect(
        market.connect(bob).claimWinnings(hash),
      ).to.be.revertedWithCustomError(market, "NothingToClaim");
    });

    it("cannot claim twice", async () => {
      const { market, bob, hash } = await resolvedScenario(true);
      await market.connect(bob).claimWinnings(hash);
      await expect(
        market.connect(bob).claimWinnings(hash),
      ).to.be.revertedWithCustomError(market, "AlreadyClaimed");
    });

    it("cannot claim before resolution", async () => {
      const { market, usdc, owner, alice, bob } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await market.connect(bob).placeWager(hash, true, USDC(100));
      await time.increase(ONE_DAY + 1);
      // NOT resolved yet
      await expect(
        market.connect(bob).claimWinnings(hash),
      ).to.be.revertedWithCustomError(market, "TraceNotResolved");
    });

    it("both-profit edge case: everyone gets refunded", async () => {
      const { market, usdc, owner, alice, bob, carol } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await market.connect(bob).placeWager(hash, true, USDC(200));
      await market.connect(carol).placeWager(hash, true, USDC(100));
      await time.increase(ONE_DAY + 1);
      await market.connect(owner).resolveTrace(hash, true);

      // No losers → both get exact stake back
      const bobBefore = await usdc.balanceOf(bob.address);
      await market.connect(bob).claimWinnings(hash);
      expect((await usdc.balanceOf(bob.address)) - bobBefore).to.equal(
        USDC(200),
      );
    });
  });

  // ── previewPayout ────────────────────────────────────────────────────────────

  describe("previewPayout()", () => {
    it("returns correct preview matching actual payout", async () => {
      const { market, usdc, owner, alice, bob, carol } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await market.connect(carol).placeWager(hash, false, USDC(100)); // 100 in loss pool

      // Preview for bob: 300 on profit side
      const preview = await market.previewPayout(hash, true, USDC(300));

      // Place the wager + resolve + claim, check actual matches preview
      await market.connect(bob).placeWager(hash, true, USDC(300));
      await time.increase(ONE_DAY + 1);
      await market.connect(owner).resolveTrace(hash, true);

      const before = await usdc.balanceOf(bob.address);
      await market.connect(bob).claimWinnings(hash);
      const actual = (await usdc.balanceOf(bob.address)) - before;

      expect(actual).to.equal(preview);
    });
  });

  // ── withdrawProtocolFees ──────────────────────────────────────────────────────

  describe("withdrawProtocolFees()", () => {
    it("accumulates 2% fee and allows owner withdrawal", async () => {
      const { market, usdc, owner, alice, bob, carol } = await deployFixture();
      const hash = randomHash();
      await market.connect(alice).registerTrace(hash, "cid", ONE_DAY, ONE_WEEK);
      await market.connect(bob).placeWager(hash, true, USDC(300));
      await market.connect(carol).placeWager(hash, false, USDC(100));
      await time.increase(ONE_DAY + 1);
      await market.connect(owner).resolveTrace(hash, true);
      await market.connect(bob).claimWinnings(hash);

      // Protocol fee: 2% of 100 = 2 USDC
      expect(await market.protocolFeeBalance()).to.equal(USDC(2));

      const before = await usdc.balanceOf(owner.address);
      await market.connect(owner).withdrawProtocolFees(owner.address);
      const after = await usdc.balanceOf(owner.address);
      expect(after - before).to.equal(USDC(2));
      expect(await market.protocolFeeBalance()).to.equal(0n);
    });
  });
});
