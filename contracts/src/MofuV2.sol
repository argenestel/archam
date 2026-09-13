// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "../lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice Mofu v2. Launch a fixed-supply token against any ERC-20 quote asset,
/// trade a linear bonding curve, then graduate into a permanently locked
/// constant-product pool. Reward launches share fees with holders.
/// Testnet software. Unaudited.
library MofuMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PRICE_MULTIPLE = 1_000;
    uint256 internal constant SUPPLY_WHOLE = 1_000_000;
    uint256 internal constant ACC_PRECISION = 1e18;
    uint256 internal constant FEE_BPS = 100; // 1% on every curve and pool trade

    /// @dev Curve supply for endPrice = startPrice * PRICE_MULTIPLE. The multiple is
    /// fixed, so this does not depend on the start price.
    function curveSupply() internal pure returns (uint256) {
        return (SUPPLY_WHOLE * 2 * PRICE_MULTIPLE) / (1 + 3 * PRICE_MULTIPLE);
    }

    /// @dev Cumulative quote for a whole-token supply, rounded up or down.
    function reserveAt(uint256 startPrice, uint256 supply, uint256 whole, bool up) internal pure returns (uint256) {
        uint256 diff = startPrice * (PRICE_MULTIPLE - 1);
        uint256 denom = 2 * supply;
        uint256 quad = diff * whole * whole;
        if (up) quad = (quad + denom - 1) / denom;
        else quad = quad / denom;
        return startPrice * whole + quad;
    }
}

/// @notice Permanently locked constant-product pool, created at graduation.
contract MofuPool {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IERC20 public immutable quote;
    uint256 public immutable feeBps;
    bool public locked;

    event Locked(uint256 quoteAmount, uint256 tokenAmount);
    event Swap(address indexed sender, bool quoteIn, uint256 amountIn, uint256 amountOut);

    constructor(address token_, address quote_) {
        token = IERC20(token_);
        quote = IERC20(quote_);
        feeBps = MofuTokenV2(token_).feeBps();
    }

    /// @dev Called once after the curated assets are transferred in. There are no LP
    /// tokens: liquidity cannot be removed by anyone.
    function sync() external {
        require(!locked, "locked");
        locked = true;
        emit Locked(quote.balanceOf(address(this)), token.balanceOf(address(this)));
    }

    function reserves() external view returns (uint256 quoteReserve, uint256 tokenReserve) {
        return (quote.balanceOf(address(this)), token.balanceOf(address(this)));
    }

    function swapQuoteForToken(uint256 quoteIn, uint256 minTokenOut) external returns (uint256 tokenOut) {
        require(locked, "not live");
        require(quoteIn > 0, "zero");
        uint256 fee = (quoteIn * feeBps) / MofuMath.BPS;
        uint256 net = quoteIn - fee;
        uint256 x = quote.balanceOf(address(this));
        uint256 y = token.balanceOf(address(this));
        tokenOut = y - (x * y) / (x + net);
        require(tokenOut > 0 && tokenOut <= y && tokenOut >= minTokenOut, "slippage");
        quote.safeTransferFrom(msg.sender, address(this), quoteIn);
        if (fee > 0) {
            quote.safeTransfer(address(token), fee);
            MofuTokenV2(address(token)).receiveFee(fee);
        }
        token.safeTransfer(msg.sender, tokenOut);
        emit Swap(msg.sender, true, quoteIn, tokenOut);
    }

    function swapTokenForQuote(uint256 tokenIn, uint256 minQuoteOut) external returns (uint256 quoteOut) {
        require(locked, "not live");
        require(tokenIn > 0, "zero");
        uint256 x = quote.balanceOf(address(this));
        uint256 y = token.balanceOf(address(this));
        uint256 gross = x - (x * y) / (y + tokenIn);
        uint256 fee = (gross * feeBps) / MofuMath.BPS;
        quoteOut = gross - fee;
        require(quoteOut > 0 && quoteOut <= x && quoteOut >= minQuoteOut, "slippage");
        token.safeTransferFrom(msg.sender, address(this), tokenIn);
        if (fee > 0) {
            quote.safeTransfer(address(token), fee);
            MofuTokenV2(address(token)).receiveFee(fee);
        }
        quote.safeTransfer(msg.sender, quoteOut);
        emit Swap(msg.sender, false, tokenIn, quoteOut);
    }
}

/// @notice Fixed-supply launch token. Holds the entire supply until it is bought
/// from the curve or moved to the pool at graduation.
contract MofuTokenV2 is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MofuMath for uint256;

    uint256 public constant BPS = MofuMath.BPS;
    uint256 public constant UNIT = 1e18;
    uint256 public constant SUPPLY = MofuMath.SUPPLY_WHOLE * UNIT;
    uint256 public constant FEE_BPS = MofuMath.FEE_BPS;

    address public immutable creator;
    address public immutable treasury;
    IERC20 public immutable quote;
    uint8 public immutable quoteDecimals;
    string public imageURI;
    string public description;
    bool public immutable rewardMode;

    uint256 public immutable startPrice;
    uint256 public immutable endPrice;
    uint256 public immutable curveSupplyWhole;
    uint256 public immutable liquidityReserveWhole;

    // Fee split, in basis points of the trade fee. Always sums to BPS.
    uint256 public immutable creatorFeeBps;
    uint256 public immutable protocolFeeBps;

    uint256 public soldWhole;
    uint256 public curveRaised;
    address public pool;

    // Reward-launch dividends, scaled by ACC_PRECISION.
    uint256 public magnifiedPerShare;
    uint256 public rewardPool;
    mapping(address => int256) public magnifiedWithdrawn;
    mapping(address => uint256) public withdrawable;

    event Trade(address indexed trader, bool isBuy, uint256 tokens, uint256 quoteAmount, uint256 fee, uint256 sold);
    event FeeDistributed(uint256 creatorCut, uint256 protocolCut, uint256 rewardCut);
    event Graduated(address indexed pool, uint256 quoteSeed, uint256 tokenSeed);
    event RewardClaimed(address indexed account, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory imageURI_,
        string memory description_,
        address quote_,
        uint256 startPrice_,
        bool rewardMode_,
        address creator_,
        address treasury_
    ) ERC20(name_, symbol_) {
        require(bytes(name_).length > 0 && bytes(name_).length <= 64, "name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "symbol");
        require(bytes(description_).length <= 280, "description");
        require(quote_ != address(0) && creator_ != address(0) && treasury_ != address(0), "zero");
        require(startPrice_ > 0 && startPrice_ <= 1e30, "price");
        quote = IERC20(quote_);
        uint8 decimals_ = 18;
        try IERC20Metadata(quote_).decimals() returns (uint8 value) {
            decimals_ = value;
        } catch {}
        quoteDecimals = decimals_;
        startPrice = startPrice_;
        endPrice = startPrice_ * MofuMath.PRICE_MULTIPLE;
        curveSupplyWhole = MofuMath.curveSupply();
        liquidityReserveWhole = MofuMath.SUPPLY_WHOLE - curveSupplyWhole;
        imageURI = imageURI_;
        description = description_;
        rewardMode = rewardMode_;
        creator = creator_;
        treasury = treasury_;
        if (rewardMode_) {
            creatorFeeBps = 4_000;
            protocolFeeBps = 1_000; // remaining 5,000 bps goes to holders
        } else {
            creatorFeeBps = 7_000;
            protocolFeeBps = 3_000;
        }
        _mint(address(this), SUPPLY);
    }

    function feeBps() external pure returns (uint256) {
        return FEE_BPS;
    }

    function graduated() external view returns (bool) {
        return pool != address(0);
    }

    function circulating() public view returns (uint256) {
        uint256 held = balanceOf(address(this));
        if (pool != address(0)) held += balanceOf(pool);
        return totalSupply() - held;
    }

    function curveSoldOut() public view returns (bool) {
        return soldWhole >= curveSupplyWhole;
    }

    function quoteBuy(uint256 whole) public view returns (uint256) {
        require(pool == address(0), "graduated");
        require(whole > 0 && soldWhole + whole <= curveSupplyWhole, "curve");
        // Use one cumulative rounding convention in both directions so split
        // trades telescope and redemption liabilities never exceed curveRaised.
        uint256 from = MofuMath.reserveAt(startPrice, curveSupplyWhole, soldWhole, true);
        uint256 to = MofuMath.reserveAt(startPrice, curveSupplyWhole, soldWhole + whole, true);
        return to - from;
    }

    function quoteSell(uint256 whole) public view returns (uint256) {
        require(pool == address(0), "graduated");
        require(whole > 0 && whole <= soldWhole, "curve");
        uint256 from = MofuMath.reserveAt(startPrice, curveSupplyWhole, soldWhole, true);
        uint256 to = MofuMath.reserveAt(startPrice, curveSupplyWhole, soldWhole - whole, true);
        return from - to;
    }

    /// @notice Cost includes the trading fee.
    function buyCost(uint256 whole) external view returns (uint256) {
        uint256 cost = quoteBuy(whole);
        return cost + (cost * FEE_BPS) / BPS;
    }

    function buy(uint256 whole, uint256 maxCost) external nonReentrant returns (uint256 cost) {
        cost = quoteBuy(whole);
        uint256 fee = (cost * FEE_BPS) / BPS;
        uint256 total = cost + fee;
        require(total <= maxCost, "slippage");
        quote.safeTransferFrom(msg.sender, address(this), total);
        _distributeFee(fee);
        soldWhole += whole;
        curveRaised += cost;
        _transfer(address(this), msg.sender, whole * UNIT);
        emit Trade(msg.sender, true, whole, cost, fee, soldWhole);
        if (soldWhole == curveSupplyWhole) _graduate();
    }

    /// @notice Return is net of the trading fee.
    function sell(uint256 whole, uint256 minReturn) external nonReentrant returns (uint256 net) {
        uint256 gross = quoteSell(whole);
        uint256 fee = (gross * FEE_BPS) / BPS;
        net = gross - fee;
        require(net >= minReturn, "slippage");
        _transfer(msg.sender, address(this), whole * UNIT);
        soldWhole -= whole;
        curveRaised -= gross;
        _distributeFee(fee);
        quote.safeTransfer(msg.sender, net);
        emit Trade(msg.sender, false, whole, gross, fee, soldWhole);
    }

    function claim() external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = withdrawable[msg.sender];
        require(amount > 0, "nothing");
        withdrawable[msg.sender] = 0;
        rewardPool -= amount;
        quote.safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    /// @notice Called by the pool after the fee has been transferred into this contract.
    function receiveFee(uint256 amount) external {
        require(msg.sender == pool, "pool only");
        _distributeFee(amount);
    }

    function _distributeFee(uint256 amount) internal {
        if (amount == 0) return;
        uint256 creatorCut = (amount * creatorFeeBps) / BPS;
        uint256 rewardCut = rewardMode ? (amount * (BPS - creatorFeeBps - protocolFeeBps)) / BPS : 0;
        // Remainder stays with the protocol so the split always sums exactly.
        uint256 protocolCut = amount - creatorCut - rewardCut;
        if (creatorCut > 0) quote.safeTransfer(creator, creatorCut);
        uint256 holders = circulating();
        if (rewardCut > 0 && holders == 0) {
            protocolCut += rewardCut;
            rewardCut = 0;
        }
        if (protocolCut > 0) quote.safeTransfer(treasury, protocolCut);
        if (rewardCut > 0) {
            magnifiedPerShare += (rewardCut * MofuMath.ACC_PRECISION) / holders;
            rewardPool += rewardCut;
        }
        emit FeeDistributed(creatorCut, protocolCut, rewardCut);
    }

    function _settle(address account) internal {
        int256 owed = int256((balanceOf(account) * magnifiedPerShare) / MofuMath.ACC_PRECISION)
            - magnifiedWithdrawn[account];
        if (owed > 0) {
            magnifiedWithdrawn[account] += owed;
            withdrawable[account] += uint256(owed);
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        bool fromEligible = from != address(0) && from != address(this) && from != pool;
        bool toEligible = to != address(0) && to != address(this) && to != pool;
        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);
        super._update(from, to, value);
        // The sender's accrued rewards were settled above; its remaining tokens
        // must start earning from the current accumulator at their new balance.
        if (fromEligible) {
            magnifiedWithdrawn[from] = int256((balanceOf(from) * magnifiedPerShare) / MofuMath.ACC_PRECISION);
        }
        // Incoming tokens are marked as already settled at the current accumulator, so
        // fees distributed before they arrived are not paid out twice.
        if (toEligible) {
            magnifiedWithdrawn[to] = int256((balanceOf(to) * magnifiedPerShare) / MofuMath.ACC_PRECISION);
        }
    }

    function _graduate() internal {
        uint256 quoteSeed = curveRaised;
        uint256 tokenSeed = liquidityReserveWhole * UNIT;
        MofuPool created = new MofuPool(address(this), address(quote));
        pool = address(created);
        curveRaised = 0;
        if (quoteSeed > 0) quote.safeTransfer(pool, quoteSeed);
        _transfer(address(this), pool, tokenSeed);
        created.sync();
        emit Graduated(pool, quoteSeed, tokenSeed);
    }
}

/// @notice Registry for v2 launches. Quote assets are any ERC-20, so a launch can
/// be paired with USDC, EURC, another Mofu token, or an RWA/stock token on Arc.
contract MofuFactoryV2 {
    address public treasury;
    address[] public tokens;

    event TokenCreated(address indexed token, address indexed creator, address indexed quote, string name, string symbol, bool rewardMode);

    constructor(address treasury_) {
        require(treasury_ != address(0), "treasury");
        treasury = treasury_;
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata imageURI,
        string calldata description,
        address quote,
        uint256 startPrice,
        bool rewardMode
    ) external returns (address token) {
        token = address(new MofuTokenV2(name, symbol, imageURI, description, quote, startPrice, rewardMode, msg.sender, treasury));
        tokens.push(token);
        emit TokenCreated(token, msg.sender, quote, name, symbol, rewardMode);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }
}
