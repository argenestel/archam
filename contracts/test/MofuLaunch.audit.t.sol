// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MofuLaunch, IUniswapV2Router02} from "../src/MofuLaunch.sol";
import {UniswapV2Fixture, MockUSDC} from "./MofuLaunch.invariant.t.sol";

interface AuditPair {
    function sync() external;
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
}

interface AuditFactory {
    function createPair(address, address) external returns (address);
}

// Deliberately unsupported asset: demonstrates why the standard-quote assumption matters.
contract AuditTaxedQuote is ERC20 {
    constructor() ERC20("Unsupported quote", "TAX") {
        _mint(msg.sender, 1_000e6);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 tax = amount / 100;
            super._update(from, address(0), tax);
            super._update(from, to, amount - tax);
        } else {
            super._update(from, to, amount);
        }
    }
}

/// Evidence tests document current behavior; passing is NOT evidence that findings are fixed.
contract MofuLaunchAuditTest is UniswapV2Fixture {
    MofuLaunch launch;
    MockUSDC quote;
    address factory;
    address router;

    function setUp() public {
        (factory, router) = deployV2();
        quote = new MockUSDC();
        launch = new MofuLaunch(IERC20(address(quote)), IUniswapV2Router02(router), 20e6, 100, address(this));
        quote.mint(address(this), 10_000e6);
        quote.approve(address(launch), type(uint256).max);
    }

    function test_auditDeploymentStartsOpenAndPauseDoesNotDisableExistingCurves() public {
        assertFalse(launch.launchesPaused());
        vm.prank(address(0xBAD));
        address token = launch.launch("Early", "EARLY", "", "", 0, 0);
        launch.setLaunchesPaused(true);
        launch.buy(token, 1e6, 0, block.timestamp);
        assertGt(IERC20(token).balanceOf(address(this)), 0);
    }

    function test_auditActualSupplyDiffersFromAdvertisedConstant() public {
        address token = launch.launch("Supply", "SUP", "", "", 0, 0);
        uint256 actual = ERC20(token).totalSupply();
        assertEq(actual, launch.SALE_SUPPLY() + launch.lpSupply());
        assertLt(actual, launch.TOTAL_SUPPLY());
    }

    function test_auditQuoteDonationIsSurplusNotCurveMoneyOrFees() public {
        address token = launch.launch("Donation", "DON", "", "", 0, 0);
        quote.transfer(address(launch), 1e6);
        launch.buy(token, 1e6, 0, block.timestamp);
        launch.sell(token, IERC20(token).balanceOf(address(this)), 0, block.timestamp);
        launch.withdrawFees();
        assertEq(quote.balanceOf(address(launch)), launch.curveState(token).realQuote + 1e6);
    }

    function test_auditReturnedTokensDoNotRestoreSaleInventoryAndAreBurnedAtGraduation() public {
        address token = launch.launch("Returned", "RET", "", "", 1e6, 0);
        uint256 remaining = launch.curveState(token).tokensLeft;
        IERC20(token).transfer(address(launch), 1 ether);
        assertEq(launch.curveState(token).tokensLeft, remaining);
        assertEq(IERC20(token).balanceOf(address(launch)), remaining + launch.lpSupply() + 1 ether);
        launch.buy(token, 1_000e6, 0, block.timestamp);
        assertTrue(launch.curveState(token).graduated);
        assertEq(IERC20(token).balanceOf(address(launch)), 0);
        assertEq(IERC20(token).balanceOf(launch.DEAD()), 1 ether);
    }

    function test_auditPairDonationCanMateriallyChangeGraduationPrice() public {
        address token = launch.launch("Price", "PRC", "", "", 0, 0);
        address pair = AuditFactory(factory).createPair(token, address(quote));
        quote.transfer(pair, 1_000e6);
        AuditPair(pair).sync();
        launch.buy(token, 1_000e6, 0, block.timestamp);
        MofuLaunch.CurveState memory c = launch.curveState(token);
        (uint112 r0, uint112 r1,) = AuditPair(pair).getReserves();
        (uint256 tokenReserve, uint256 quoteReserve) = AuditPair(pair).token0() == token
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        assertTrue(c.graduated);
        assertGt(quoteReserve * c.virtualToken, 2 * c.virtualQuote * tokenReserve);
    }

    function test_auditUnsupportedTaxedQuoteBreaksSolvencyAssumption() public {
        AuditTaxedQuote taxed = new AuditTaxedQuote();
        MofuLaunch unsupported = new MofuLaunch(IERC20(address(taxed)), IUniswapV2Router02(router), 20e6, 100, address(this));
        taxed.approve(address(unsupported), type(uint256).max);
        address token = unsupported.launch("Unsupported", "UNSUP", "", "", 0, 0);
        unsupported.buy(token, 10e6, 0, block.timestamp);
        assertLt(taxed.balanceOf(address(unsupported)), unsupported.curveState(token).realQuote + unsupported.feesAccrued());
    }
}
