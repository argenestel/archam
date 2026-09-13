// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CurveToken, CurveLaunchpad} from "../src/CurveLaunchpad.sol";
import {MofuOrderBook} from "../src/MofuOrderBook.sol";

contract MofuOrderBookTest is Test {
    MofuOrderBook book;
    CurveLaunchpad factory;
    CurveToken token;
    address maker = address(0xA11CE);
    address taker = address(0xB0B);
    uint256 constant PRICE = 0.01 ether;

    function setUp() public {
        vm.warp(100);
        factory = new CurveLaunchpad();
        token = CurveToken(factory.createToken("Mofu", "MOFU", "", ""));
        book = new MofuOrderBook(address(factory));
        vm.deal(maker, 100_000 ether);
        vm.deal(taker, 100_000 ether);
        vm.startPrank(maker);
        uint256 cost = token.quoteBuy(500_000);
        token.buy{value: cost}(500_000, cost, block.timestamp);
        token.approve(address(book), type(uint256).max);
        assertTrue(token.transfer(taker, 250_000 ether));
        vm.stopPrank();
        vm.prank(taker);
        token.approve(address(book), type(uint256).max);
    }

    function post(bool buy, uint256 quantity) internal returns (uint256 id) {
        vm.prank(maker);
        return book.postOrder{value: buy ? quantity * PRICE : 0}(0, buy, quantity, PRICE, block.timestamp + 1 days);
    }

    function testAskPartialFillCancelWithdraw() public {
        uint256 id = post(false, 100);
        assertEq(token.balanceOf(address(book)), 100 ether);
        vm.prank(taker);
        book.fillOrder{value: 40 * PRICE}(id, 40);
        assertEq(book.credits(maker), 40 * PRICE);
        assertEq(token.balanceOf(taker), 250_040 ether);
        vm.prank(maker);
        book.cancelOrder(id);
        assertEq(token.balanceOf(address(book)), 0);
        assertEq(token.balanceOf(maker), 249_960 ether);
        uint256 before = maker.balance;
        vm.prank(maker);
        book.withdraw();
        assertEq(maker.balance, before + 40 * PRICE);
        assertEq(address(book).balance, 0);
    }

    function testBidPartialFillCancelWithdraw() public {
        uint256 id = post(true, 100);
        vm.prank(taker);
        book.fillOrder(id, 40);
        assertEq(token.balanceOf(maker), 250_040 ether);
        assertEq(book.credits(taker), 40 * PRICE);
        vm.prank(maker);
        book.cancelOrder(id);
        assertEq(book.credits(maker), 60 * PRICE);
        vm.prank(maker);
        book.withdraw();
        vm.prank(taker);
        book.withdraw();
        assertEq(address(book).balance, 0);
    }

    function testExpiryAndAuthorization() public {
        uint256 id = post(false, 10);
        vm.prank(taker);
        vm.expectRevert("Not maker");
        book.cancelOrder(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(taker);
        vm.expectRevert("Expired");
        book.fillOrder{value: PRICE}(id, 1);
        vm.prank(maker);
        book.cancelOrder(id);
        vm.prank(maker);
        vm.expectRevert("Order closed");
        book.cancelOrder(id);
    }

    function testBoundsAndRegistry() public {
        vm.expectRevert("Invalid factory");
        new MofuOrderBook(address(1));
        vm.expectRevert("Invalid quantity");
        book.postOrder(0, false, 0, PRICE, 200);
        vm.expectRevert("Invalid quantity");
        book.postOrder(0, false, 1_000_001, PRICE, 200);
        vm.expectRevert("Invalid price");
        book.postOrder(0, false, 1, 0, 200);
        vm.expectRevert("Invalid price");
        book.postOrder(0, false, 2, type(uint256).max, 200);
        vm.expectRevert("Invalid expiry");
        book.postOrder(0, false, 1, PRICE, 100);
        vm.expectRevert("Invalid expiry");
        book.postOrder(0, false, 1, PRICE, 100 + 30 days + 1);
        vm.expectRevert();
        book.postOrder(1, false, 1, PRICE, 200);
        assertEq(book.orderCount(), 0);
    }

    function testExactFundsAndMissingApproval() public {
        vm.startPrank(maker);
        vm.expectRevert("Incorrect funds");
        book.postOrder{value: PRICE - 1}(0, true, 1, PRICE, 200);
        vm.expectRevert("Incorrect funds");
        book.postOrder{value: PRICE + 1}(0, true, 1, PRICE, 200);
        vm.expectRevert("Incorrect funds");
        book.postOrder{value: 1}(0, false, 1, PRICE, 200);
        token.approve(address(book), 0);
        vm.expectRevert();
        book.postOrder(0, false, 1, PRICE, 200);
        vm.stopPrank();
        assertEq(book.orderCount(), 0);
        uint256 id = post(true, 10);
        vm.startPrank(taker);
        vm.expectRevert("Incorrect funds");
        book.fillOrder{value: 1}(id, 1);
        token.approve(address(book), 0);
        vm.expectRevert();
        book.fillOrder(id, 1);
        vm.stopPrank();
        (,,, uint256 remaining,,) = book.orders(id);
        assertEq(remaining, 10);
        assertEq(book.credits(taker), 0);
    }

    function testClosedAndUnknownOrders() public {
        uint256 id = post(false, 1);
        vm.startPrank(taker);
        vm.expectRevert("Incorrect funds");
        book.fillOrder{value: PRICE + 1}(id, 1);
        vm.expectRevert("Incorrect funds");
        book.fillOrder{value: PRICE - 1}(id, 1);
        vm.expectRevert("Invalid quantity");
        book.fillOrder(id, 0);
        vm.expectRevert("Invalid quantity");
        book.fillOrder(id, 2);
        book.fillOrder{value: PRICE}(id, 1);
        vm.expectRevert("Invalid quantity");
        book.fillOrder(id, 1);
        vm.expectRevert("Invalid quantity");
        book.fillOrder(999, 1);
        vm.expectRevert("No credit");
        book.withdraw();
        vm.stopPrank();
    }

    function testRejectedAndReentrantWithdrawal() public {
        BookRecipient receiver = new BookRecipient(book);
        receiver.post{value: PRICE}();
        receiver.cancel();
        vm.expectRevert("Payment failed");
        receiver.claim();
        assertEq(book.credits(address(receiver)), PRICE);
        receiver.allow();
        receiver.claim();
        assertTrue(receiver.blocked());
        assertEq(book.credits(address(receiver)), 0);
        assertEq(address(book).balance, 0);
    }

    function testFuzzConservation(bool buy, uint32 amountSeed, uint32 fillSeed) public {
        uint256 amount = bound(amountSeed, 1, 250_000);
        uint256 filled = bound(fillSeed, 1, amount);
        uint256 id = post(buy, amount);
        vm.prank(taker);
        book.fillOrder{value: buy ? 0 : filled * PRICE}(id, filled);
        if (amount > filled) {
            vm.prank(maker);
            book.cancelOrder(id);
        }
        assertEq(address(book).balance, book.credits(maker) + book.credits(taker));
        assertEq(token.balanceOf(address(book)), 0);
        assertEq(token.balanceOf(maker) + token.balanceOf(taker), 500_000 ether);
        assertEq(book.credits(taker), buy ? filled * PRICE : 0);
        assertEq(book.credits(maker), buy ? (amount - filled) * PRICE : filled * PRICE);
    }

    function testFuzzSplitFullFill(bool buy, uint32 amountSeed, uint32 splitSeed) public {
        uint256 amount = bound(amountSeed, 2, 250_000);
        uint256 split = bound(splitSeed, 1, amount - 1);
        uint256 id = post(buy, amount);
        vm.startPrank(taker);
        book.fillOrder{value: buy ? 0 : split * PRICE}(id, split);
        book.fillOrder{value: buy ? 0 : (amount - split) * PRICE}(id, amount - split);
        vm.stopPrank();
        (,,, uint256 remaining,,) = book.orders(id);
        assertEq(remaining, 0);
        assertEq(address(book).balance, amount * PRICE);
        assertEq(book.credits(buy ? taker : maker), amount * PRICE);
        assertEq(token.balanceOf(address(book)), 0);
    }

    receive() external payable {}
}

contract BookRecipient {
    MofuOrderBook book;
    bool accepting;
    bool public blocked;

    constructor(MofuOrderBook book_) {
        book = book_;
    }

    function post() external payable {
        book.postOrder{value: msg.value}(0, true, 1, msg.value, block.timestamp + 1);
    }

    function cancel() external {
        book.cancelOrder(0);
    }

    function claim() external {
        book.withdraw();
    }

    function allow() external {
        accepting = true;
    }

    receive() external payable {
        require(accepting, "Rejected");
        try book.withdraw() {
            blocked = false;
        } catch {
            blocked = true;
        }
    }
}
