// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {CurveToken, CurveLaunchpad} from "../src/CurveLaunchpad.sol";

contract CurveLaunchpadTest is Test {
    CurveToken token;
    function setUp() public {
        token = new CurveToken("Mofu", "MOFU", "A test token", "m", address(this));
        vm.deal(address(this), 10_000 ether);
    }
    receive() external payable {}
    function testRegistryAndNoPremint() public {
        CurveLaunchpad pad = new CurveLaunchpad();
        address created = pad.createToken("Mofu", "MOFU", "", "m");
        assertEq(pad.tokenCount(), 1);
        assertEq(pad.tokens(0), created);
        assertEq(CurveToken(created).creator(), address(this));
        assertEq(CurveToken(created).totalSupply(), 0);
    }
    function testLegacyCoinCannotGraduate() public {
        CurveLaunchpad pad = new CurveLaunchpad();
        address created = pad.createToken("Legacy", "LEG", "", "m");
        (bool ok,) = created.call(abi.encodeWithSignature("graduated()"));
        assertFalse(ok);
    }
    function testBuySellAndRefund() public {
        uint256 cost = token.quoteBuy(1000);
        token.buy{value: cost + 1 ether}(1000, cost + 1 ether, block.timestamp);
        assertEq(address(token).balance, cost);
        assertEq(token.balanceOf(address(this)), 1000 ether);
        assertEq(token.quoteSell(1000), cost);
        token.sell(1000, cost, block.timestamp);
        assertEq(token.totalSupply(), 0);
        assertEq(address(token).balance, 0);
    }
    function testSlippageAndDeadline() public {
        uint256 cost = token.quoteBuy(100);
        vm.expectRevert("Price moved");
        token.buy{value: cost}(100, cost - 1, block.timestamp);
        vm.warp(100);
        vm.expectRevert("Expired");
        token.buy{value: cost}(100, cost, 99);
        token.buy{value: cost}(100, cost, 100);
        vm.expectRevert("Price moved");
        token.sell(100, cost + 1, 100);
    }
    function testCap() public {
        uint256 cost = token.quoteBuy(1_000_000);
        token.buy{value: cost}(1_000_000, cost, block.timestamp);
        vm.expectRevert("Cap exceeded"); token.quoteBuy(1);
        token.sell(1_000_000, cost, block.timestamp);
        assertEq(address(token).balance, 0);
    }
    function testCannotSellOthersTokens() public {
        uint256 cost = token.quoteBuy(100);
        token.buy{value: cost}(100, cost, block.timestamp);
        vm.prank(address(2)); vm.expectRevert();
        token.sell(100, 0, block.timestamp);
    }
    function testReentryBlockedDuringRefund() public {
        ReenteringTrader trader = new ReenteringTrader(token);
        uint256 cost = token.quoteBuy(100);
        trader.enter{value: cost + 1 ether}();
        assertTrue(trader.blocked());
        assertEq(token.balanceOf(address(trader)), 100 ether);
        assertEq(address(token).balance, cost);
    }
    function testRejectedPaymentRollsBackBurn() public {
        RejectingTrader trader = new RejectingTrader(token);
        uint256 cost = token.quoteBuy(100);
        trader.enter{value: cost}();
        vm.expectRevert("Payment failed");
        trader.exit();
        assertEq(token.balanceOf(address(trader)), 100 ether);
        assertEq(address(token).balance, cost);
    }
    function testFuzzReserveSolvency(uint32 a, uint32 b, uint32 sellAmount) public {
        uint256 first = bound(a, 1, 500_000);
        uint256 second = bound(b, 1, 500_000);
        uint256 cost = token.quoteBuy(first);
        token.buy{value: cost}(first, cost, block.timestamp);
        cost = token.quoteBuy(second);
        token.buy{value: cost}(second, cost, block.timestamp);
        uint256 sold = bound(sellAmount, 1, first + second);
        token.sell(sold, 0, block.timestamp);
        assertEq(address(token).balance, token.reserveAt(first + second - sold));
        assertEq(token.totalSupply(), (first + second - sold) * 1 ether);
    }
}

contract ReenteringTrader {
    CurveToken token;
    bool public blocked;
    constructor(CurveToken token_) { token = token_; }
    function enter() external payable { token.buy{value: msg.value}(100, msg.value, block.timestamp); }
    receive() external payable {
        try token.sell(1, 0, block.timestamp) { blocked = false; }
        catch { blocked = true; }
    }
}

contract RejectingTrader {
    CurveToken token;
    constructor(CurveToken token_) { token = token_; }
    function enter() external payable { token.buy{value: msg.value}(100, msg.value, block.timestamp); }
    function exit() external { token.sell(100, 0, block.timestamp); }
    receive() external payable { revert("Reject native USDC"); }
}
