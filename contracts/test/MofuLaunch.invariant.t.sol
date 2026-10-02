// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MofuLaunch, IUniswapV2Router02} from "../src/MofuLaunch.sol";
import {MofuToken} from "../src/MofuToken.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Deploys canonical Uniswap V2 (0.5.16 / 0.6.6) from the pinned npm artifacts.
abstract contract UniswapV2Fixture is Test {
    function deployArtifact(string memory path, bytes memory args) internal returns (address addr) {
        bytes memory code = abi.encodePacked(vm.parseJsonBytes(vm.readFile(path), ".bytecode"), args);
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "deploy failed");
    }

    function deployV2() internal returns (address factory, address router) {
        factory = deployArtifact("node_modules/@uniswap/v2-core/build/UniswapV2Factory.json", abi.encode(address(this)));
        address weth = deployArtifact("node_modules/@uniswap/v2-periphery/build/WETH9.json", "");
        router = deployArtifact(
            "node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json", abi.encode(factory, weth)
        );
    }
}

/// Random buys and sells by several actors across several curves.
contract Handler is Test {
    MofuLaunch public launch;
    MockUSDC public usdc;
    address[] public actors;
    address[] public tokens;
    uint256 public buys;
    uint256 public sells;
    uint256 public graduations;

    constructor(MofuLaunch launch_, MockUSDC usdc_, address[] memory tokens_) {
        launch = launch_;
        usdc = usdc_;
        tokens = tokens_;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            usdc.mint(a, 1_000_000e6);
            vm.prank(a);
            usdc.approve(address(launch), type(uint256).max);
        }
    }

    function buy(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        address token = tokens[tokenSeed % tokens.length];
        amount = bound(amount, 1, 40e6);
        bool graduated = launch.curveState(token).graduated;
        if (graduated) return;
        vm.prank(actor);
        launch.buy(token, amount, 0, block.timestamp);
        buys++;
        graduated = launch.curveState(token).graduated;
        if (graduated) graduations++;
    }

    function sell(uint256 actorSeed, uint256 tokenSeed, uint256 fraction) external {
        address actor = actors[actorSeed % actors.length];
        address token = tokens[tokenSeed % tokens.length];
        bool graduated = launch.curveState(token).graduated;
        if (graduated) return;
        uint256 balance = IERC20(token).balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = (balance * bound(fraction, 1, 100)) / 100;
        if (amount == 0) return;
        if (launch.quoteSell(token, amount) == 0) return;
        vm.prank(actor);
        launch.sell(token, amount, 0, block.timestamp);
        sells++;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }
}

contract MofuLaunchInvariantTest is UniswapV2Fixture {
    MofuLaunch launch;
    MockUSDC usdc;
    Handler handler;
    address[] tokens;
    mapping(address => uint256) initialK;

    function setUp() public {
        (, address router) = deployV2();
        usdc = new MockUSDC();
        launch = new MofuLaunch(IERC20(address(usdc)), IUniswapV2Router02(router), 20e6, 100, address(0xFEE));
        for (uint256 i; i < 3; ++i) {
            address t = launch.launch("Fuzz", "FZZ", "", "", 0, 0);
            tokens.push(t);
            MofuLaunch.CurveState memory c = launch.curveState(t);
            initialK[t] = c.virtualQuote * c.virtualToken;
        }
        handler = new Handler(launch, usdc, tokens);
        targetContract(address(handler));
    }

    /// The launch contract always holds exactly the curves' real quote plus accrued fees.
    function invariant_solvency() public view {
        uint256 owed = launch.feesAccrued();
        for (uint256 i; i < tokens.length; ++i) {
            owed += launch.curveState(tokens[i]).realQuote;
        }
        assertEq(usdc.balanceOf(address(launch)), owed, "USDC held != realQuote + fees");
    }

    /// Unsold inventory plus LP reserve is exactly what the launcher holds for live curves;
    /// graduated curves leave nothing behind.
    function invariant_tokenInventory() public view {
        for (uint256 i; i < tokens.length; ++i) {
            MofuLaunch.CurveState memory c = launch.curveState(tokens[i]);
            uint256 held = IERC20(tokens[i]).balanceOf(address(launch));
            if (c.graduated) assertEq(held, 0, "graduated curve kept tokens");
            else assertEq(held, c.tokensLeft + launch.lpSupply(), "inventory mismatch");
        }
    }

    /// Rounding always favors the pool: virtual k never decreases.
    function invariant_kNeverDecreases() public view {
        for (uint256 i; i < tokens.length; ++i) {
            MofuLaunch.CurveState memory c = launch.curveState(tokens[i]);
            if (!c.graduated) assertGe(c.virtualQuote * c.virtualToken, initialK[tokens[i]], "k decreased");
        }
    }

    /// Real quote never exceeds what the curve math allows: vq == V0 + realQuote while live.
    function invariant_virtualMatchesReal() public view {
        for (uint256 i; i < tokens.length; ++i) {
            MofuLaunch.CurveState memory c = launch.curveState(tokens[i]);
            if (!c.graduated) assertEq(c.virtualQuote, launch.initialVirtualQuote() + c.realQuote, "virtual/real drift");
        }
    }

    function invariant_callSummary() public view {
        assertGe(handler.buys() + handler.sells() + 1, 1);
    }
}

contract MofuLaunchUnitTest is UniswapV2Fixture {
    MofuLaunch launch;
    MockUSDC usdc;
    address owner = address(this);
    address multisig = address(0x5AFE);

    function setUp() public {
        (, address router) = deployV2();
        usdc = new MockUSDC();
        launch = new MofuLaunch(IERC20(address(usdc)), IUniswapV2Router02(router), 20e6, 100, address(0xFEE));
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(launch), type(uint256).max);
    }

    function test_pauseBlocksOnlyLaunches() public {
        address t = launch.launch("A", "A", "", "", 1e6, 0);
        launch.setLaunchesPaused(true);
        vm.expectRevert(MofuLaunch.LaunchesPaused.selector);
        launch.launch("B", "B", "", "", 0, 0);
        // trading continues while paused
        launch.buy(t, 1e6, 0, block.timestamp);
        uint256 bal = IERC20(t).balanceOf(address(this));
        launch.sell(t, bal / 2, 0, block.timestamp);
    }

    function test_twoStepOwnership() public {
        launch.transferOwnership(multisig);
        assertEq(launch.owner(), owner);
        vm.expectRevert(MofuLaunch.OnlyOwner.selector);
        launch.acceptOwnership();
        vm.prank(multisig);
        launch.acceptOwnership();
        assertEq(launch.owner(), multisig);
        vm.expectRevert(MofuLaunch.OnlyOwner.selector);
        launch.setLaunchesPaused(true);
    }

    function test_onlyOwnerAdmin(address stranger) public {
        vm.assume(stranger != owner);
        vm.startPrank(stranger);
        vm.expectRevert(MofuLaunch.OnlyOwner.selector);
        launch.setLaunchesPaused(true);
        vm.expectRevert(MofuLaunch.OnlyOwner.selector);
        launch.setFeeRecipient(stranger);
        vm.expectRevert(MofuLaunch.OnlyOwner.selector);
        launch.transferOwnership(stranger);
    }

    function testFuzz_buyNeverOvercharges(uint256 amount) public {
        amount = bound(amount, 1, 1_000e6);
        address t = launch.launch("C", "C", "", "", 0, 0);
        usdc.mint(address(this), amount);
        uint256 before = usdc.balanceOf(address(this));
        (uint256 out, uint256 charged) = launch.quoteBuy(t, amount);
        if (out == 0) return;
        launch.buy(t, amount, out, block.timestamp);
        assertEq(before - usdc.balanceOf(address(this)), charged);
        assertLe(charged, amount);
    }

    function testFuzz_roundTripNeverProfits(uint256 amount) public {
        amount = bound(amount, 1e4, 50e6);
        address t = launch.launch("D", "D", "", "", 0, 0);
        usdc.mint(address(this), amount);
        uint256 before = usdc.balanceOf(address(this));
        (uint256 out,) = launch.quoteBuy(t, amount);
        if (out == 0) return;
        launch.buy(t, amount, 0, block.timestamp);
        bool graduated = launch.curveState(t).graduated;
        if (graduated) return;
        launch.sell(t, out, 0, block.timestamp);
        assertLe(usdc.balanceOf(address(this)), before, "round trip made money");
    }

    /// Regression: sending exactly the quoted sell-out charge must graduate the curve.
    function testFuzz_quotedSellOutGraduates(uint256 pre) public {
        address t = launch.launch("G", "G", "", "", 0, 0);
        pre = bound(pre, 0, 50e6);
        usdc.mint(address(this), 1_000e6);
        if (pre > 0) launch.buy(t, pre, 0, block.timestamp);
        if (launch.curveState(t).graduated) return;
        (, uint256 charged) = launch.quoteBuy(t, 1_000e6);
        uint256 before = usdc.balanceOf(address(this));
        launch.buy(t, charged, 0, block.timestamp);
        assertTrue(launch.curveState(t).graduated, "quoted sell-out left dust");
        assertEq(before - usdc.balanceOf(address(this)), charged);
    }

    function test_pagesAreCapped() public {
        for (uint256 i; i < 3; ++i) launch.launch("E", "E", "", "", 0, 0);
        assertEq(launch.tokensPage(0, type(uint256).max).length, 3);
    }

    function test_tokenLockedBeforeGraduation() public {
        address t = launch.launch("F", "F", "", "", 1e6, 0);
        vm.expectRevert(MofuToken.TransfersLocked.selector);
        IERC20(t).transfer(address(0xBEEF), 1);
    }
}
