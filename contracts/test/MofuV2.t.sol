// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {MofuFactoryV2, MofuTokenV2, MofuPool} from "../src/MofuV2.sol";

contract MockQuote is ERC20 {
    uint8 private immutable dec;
    constructor(uint8 dec_) ERC20("USD Coin", "USDC") { dec = dec_; }
    function decimals() public view override returns (uint8) { return dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MofuV2Test is Test {
    // 18-decimal quote and a 0.000001 start price give the same economics as v1 while
    // keeping integer curve math precise.
    uint256 constant START = 1e12;
    MockQuote quote;
    MofuFactoryV2 factory;
    address creator = address(0xC0FFEE);
    address treasury = address(0xFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        quote = new MockQuote(18);
        factory = new MofuFactoryV2(treasury);
        quote.mint(address(this), 10_000_000e18);
        quote.mint(alice, 10_000_000e18);
        quote.mint(bob, 10_000_000e18);
    }

    function launch(bool rewardMode) internal returns (MofuTokenV2 token) {
        vm.prank(creator);
        token = MofuTokenV2(factory.createToken("Soft Bun", "SOFT", "ipfs://soft.png", "A soft launch", address(quote), START, rewardMode));
    }

    function buyOut(MofuTokenV2 token) internal {
        quote.approve(address(token), type(uint256).max);
        uint256 whole = token.curveSupplyWhole();
        token.buy(whole, token.buyCost(whole));
    }

    function testMetadataSupplyAndCurveSplit() public {
        MofuTokenV2 token = launch(false);
        assertEq(token.creator(), creator);
        assertEq(token.imageURI(), "ipfs://soft.png");
        assertEq(token.description(), "A soft launch");
        assertEq(token.totalSupply(), 1_000_000e18);
        assertEq(token.balanceOf(address(token)), 1_000_000e18);
        assertEq(token.curveSupplyWhole() + token.liquidityReserveWhole(), 1_000_000);
        assertEq(factory.tokenCount(), 1);
        assertFalse(token.rewardMode());
    }

    function testReadsQuoteDecimals() public {
        MockQuote six = new MockQuote(6);
        vm.prank(creator);
        MofuTokenV2 token = MofuTokenV2(factory.createToken("Six", "SIX", "ipfs://s", "", address(six), 1, false));
        assertEq(token.quoteDecimals(), 6);
    }

    function testStandardBuySellAndFeeSplit() public {
        MofuTokenV2 token = launch(false);
        uint256 cost = token.quoteBuy(10_000);
        uint256 fee = cost / 100;
        quote.approve(address(token), type(uint256).max);
        token.buy(10_000, cost + fee);
        assertEq(token.soldWhole(), 10_000);
        assertEq(quote.balanceOf(creator), (fee * 7_000) / 10_000);
        assertEq(quote.balanceOf(treasury), fee - (fee * 7_000) / 10_000);
        assertEq(token.balanceOf(address(this)), 10_000e18);

        uint256 gross = token.quoteSell(4_000);
        uint256 net = gross - gross / 100;
        token.sell(4_000, net);
        assertEq(token.soldWhole(), 6_000);
        assertEq(token.balanceOf(address(this)), 6_000e18);
    }

    function testSlippageGuards() public {
        MofuTokenV2 token = launch(false);
        vm.expectRevert("slippage");
        token.buy(1_000, 0);
        quote.approve(address(token), type(uint256).max);
        token.buy(1_000, token.buyCost(1_000));
        vm.expectRevert("slippage");
        token.sell(1_000, type(uint256).max);
    }

    function testGraduationSeedsLockedPool() public {
        MofuTokenV2 token = launch(false);
        uint256 seed = token.quoteBuy(token.curveSupplyWhole());
        buyOut(token);
        assertTrue(token.graduated());
        assertEq(quote.balanceOf(address(token)), 0);
        MofuPool pool = MofuPool(token.pool());
        (uint256 q, uint256 t) = pool.reserves();
        assertEq(q, seed);
        assertEq(t, token.liquidityReserveWhole() * 1e18);
        assertTrue(pool.locked());
        assertEq(token.curveRaised(), 0);
        assertEq(token.balanceOf(address(token)), 0);
        vm.expectRevert("locked");
        pool.sync();
        // Curve is closed once the pool is live.
        vm.expectRevert("graduated");
        token.quoteBuy(1);
        vm.expectRevert("graduated");
        token.quoteSell(1);
        vm.expectRevert("graduated");
        token.buy(1, type(uint256).max);
        vm.expectRevert("graduated");
        token.sell(1, 0);
    }

    function testPoolSwapsBothDirections() public {
        MofuTokenV2 token = launch(false);
        buyOut(token);
        MofuPool pool = MofuPool(token.pool());

        quote.approve(address(pool), type(uint256).max);
        uint256 quoteBefore = quote.balanceOf(address(this));
        uint256 tokenBefore = token.balanceOf(address(this));
        vm.expectRevert("slippage");
        pool.swapQuoteForToken(1_000e18, type(uint256).max);
        uint256 out = pool.swapQuoteForToken(1_000e18, 0);
        assertGt(out, 1e18);
        assertEq(quote.balanceOf(address(this)), quoteBefore - 1_000e18);
        assertEq(token.balanceOf(address(this)), tokenBefore + out);

        token.approve(address(pool), type(uint256).max);
        vm.expectRevert("slippage");
        pool.swapTokenForQuote(out, type(uint256).max);
        uint256 back = pool.swapTokenForQuote(out, 0);
        assertGt(back, 900e18);
        assertEq(quote.balanceOf(address(this)), quoteBefore - 1_000e18 + back);
        assertEq(token.balanceOf(address(this)), tokenBefore);
    }

    function testRewardLaunchAccumulatesAndClaims() public {
        MofuTokenV2 token = launch(true);
        assertTrue(token.rewardMode());
        quote.approve(address(token), type(uint256).max);
        token.buy(5_000, token.buyCost(5_000));
        // First buy has no prior holder, so its reward share goes to protocol.
        assertEq(token.rewardPool(), 0);

        token.buy(5_000, token.buyCost(5_000));
        assertGt(token.rewardPool(), 0);
        uint256 waiting = token.withdrawable(address(this));
        assertGt(waiting, 0);
        assertEq(token.claim(), waiting);
        assertGt(quote.balanceOf(creator), 0); // reward launches still pay the creator a share
    }

    function testRewardSettlesOnTransfer() public {
        MofuTokenV2 token = launch(true);
        quote.approve(address(token), type(uint256).max);
        token.buy(10_000, token.buyCost(10_000));
        token.buy(10_000, token.buyCost(10_000));
        uint256 earned = token.withdrawable(address(this));
        assertGt(earned, 0);
        // Sending tokens does not remove already-earned rewards, and the recipient does
        // not retroactively earn fees paid before the transfer.
        token.transfer(alice, token.balanceOf(address(this)));
        assertEq(token.withdrawable(address(this)), earned);
        assertEq(token.withdrawable(alice), 0);
        assertEq(token.balanceOf(alice), 20_000e18);
    }

    function testOutgoingTransferKeepsFutureDividends() public {
        MofuTokenV2 token = launch(true);
        quote.approve(address(token), type(uint256).max);
        token.buy(10_000, token.buyCost(10_000));
        token.buy(10_000, token.buyCost(10_000));
        token.transfer(alice, 10_000e18);
        token.claim();
        uint256 accumulator = token.magnifiedPerShare();
        vm.startPrank(bob);
        quote.approve(address(token), type(uint256).max);
        token.buy(1_000, token.buyCost(1_000));
        vm.stopPrank();
        uint256 expected = 10_000 * (token.magnifiedPerShare() - accumulator);
        assertGt(expected, 0);
        assertEq(token.claim(), expected, "outgoing transfer must preserve future rewards");
    }

    function testClaimDecrementsOutstandingRewardPool() public {
        MofuTokenV2 token = launch(true);
        quote.approve(address(token), type(uint256).max);
        token.buy(10_000, token.buyCost(10_000));
        token.buy(10_000, token.buyCost(10_000));
        uint256 outstanding = token.rewardPool();
        uint256 claimed = token.claim();
        assertEq(token.rewardPool(), outstanding - claimed);
        assertGe(quote.balanceOf(address(token)), token.curveRaised() + token.rewardPool());
    }

    function testSixDecimalSplitSellRemainsSolvent() public {
        MockQuote six = new MockQuote(6);
        MofuTokenV2 token = MofuTokenV2(factory.createToken("Six", "SIX", "", "", address(six), 1, false));
        six.mint(address(this), 1_000_000);
        six.approve(address(token), type(uint256).max);
        token.buy(2, token.buyCost(2));
        token.sell(1, 0);
        assertLe(token.quoteSell(1), token.curveRaised(), "remaining liability exceeds reserve");
        token.sell(1, 0);
        assertEq(token.soldWhole(), 0);
        assertEq(token.curveRaised(), 0);
        assertEq(six.balanceOf(address(token)), 0);
    }

    function testFuzzSixDecimalSplitRoundTrip(uint32 amount, uint32 split) public {
        MockQuote six = new MockQuote(6);
        MofuTokenV2 token = MofuTokenV2(factory.createToken("Six", "SIX", "", "", address(six), 1, false));
        uint256 whole = bound(amount, 2, token.curveSupplyWhole() - 1);
        uint256 part = bound(split, 1, whole - 1);
        six.mint(address(this), 1_000_000_000);
        six.approve(address(token), type(uint256).max);
        token.buy(whole, token.buyCost(whole));
        token.sell(part, 0);
        token.sell(whole - part, 0);
        assertEq(token.curveRaised(), 0);
        assertEq(six.balanceOf(address(token)), 0);
    }

    function testPairWithAnotherMofuToken() public {
        MofuTokenV2 base = launch(false);
        vm.prank(creator);
        MofuTokenV2 paired = MofuTokenV2(factory.createToken("Pair", "PAIR", "ipfs://p", "", address(base), 1e18, false));
        assertEq(address(paired.quote()), address(base));
        buyOut(base);
        // Pairing with an already-launched token works through the ERC-20 interface.
        base.approve(address(paired), type(uint256).max);
        paired.buy(1_000, paired.buyCost(1_000));
        assertEq(paired.balanceOf(address(this)), 1_000e18);
    }

    function testFuzzCurveIsMonotonic(uint32 a, uint32 b) public {
        MofuTokenV2 token = launch(false);
        uint256 first = bound(a, 1_000, 300_000);
        uint256 second = bound(b, 1_000, 300_000);
        uint256 c1 = token.quoteBuy(first);
        uint256 c2 = token.quoteBuy(first + second) - c1;
        assertGt(c1, 0);
        assertGt(c2, 0);
        // Buying later tokens costs proportionally at least as much as earlier ones.
        assertGe(c2 * first, c1 * second);
    }
}
