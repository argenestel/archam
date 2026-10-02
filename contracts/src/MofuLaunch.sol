// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MofuToken} from "./MofuToken.sol";

interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function addLiquidity(address, address, uint256, uint256, uint256, uint256, address, uint256)
        external
        returns (uint256, uint256, uint256);
}

interface IUniswapV2Factory {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}

interface IUniswapV2Pair {
    function mint(address to) external returns (uint256 liquidity);
}

/// @title Mofu launch curves
/// @notice Anyone can launch a fixed-supply token that trades against a quote stablecoin on a
/// virtual-reserve constant-product curve. When the sale inventory sells out, the raised
/// quote and the reserved LP inventory are added to Uniswap V2 and the LP tokens are burned.
/// Trades, positions and trader totals are kept onchain so the app needs no indexer.
/// @dev Unaudited. Supports only a standard, non-rebasing, non-fee quote token.
contract MofuLaunch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Curve {
        address creator;
        uint40 createdAt;
        uint40 lastTradeAt;
        bool graduated;
        uint256 virtualQuote; // includes real quote raised
        uint256 virtualToken; // includes unsold inventory
        uint256 realQuote; // quote held for this curve
        uint256 tokensLeft; // unsold sale inventory
        uint256 volume; // quote volume, before fees
        uint32 trades;
        address pair;
        string image;
        string description;
    }

    struct Trade {
        address token;
        address trader;
        uint40 time;
        bool isBuy;
        uint128 quoteAmount;
        uint128 tokenAmount;
    }

    struct Position {
        uint128 spent; // quote paid on buys, including fees
        uint128 received; // quote received on sells, after fees
        uint128 bought;
        uint128 sold;
    }

    struct TraderStats {
        uint128 volume;
        uint128 spent;
        uint128 received;
        uint32 trades;
        uint32 launches;
        uint40 firstTradeAt;
    }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant SALE_SUPPLY = 793_100_000 ether;
    uint256 public constant VIRTUAL_TOKEN = 1_073_000_000 ether;
    uint256 public constant TOTAL_SUPPLY = SALE_SUPPLY + ((VIRTUAL_TOKEN - SALE_SUPPLY) * SALE_SUPPLY) / VIRTUAL_TOKEN;
    uint256 public constant MAX_FEE_BPS = 200;

    IERC20 public immutable quote;
    IUniswapV2Router02 public immutable router;
    uint256 public immutable initialVirtualQuote;
    uint256 public immutable feeBps;
    /// @notice Tokens reserved for liquidity, matching the final curve price.
    uint256 public immutable lpSupply;
    uint256 public constant MAX_PAGE = 200;

    address public feeRecipient;
    address public owner;
    address public pendingOwner;
    /// @notice Blocks new launches only. Trading, selling and graduation are never pausable.
    bool public launchesPaused = true;
    uint256 public feesAccrued;

    address[] public tokens;
    Trade[] public trades;
    address[] public traders;
    mapping(address => Curve) public curves;
    mapping(address => uint256[]) internal tokenTradeIds;
    mapping(address => mapping(address => Position)) public positions;
    mapping(address => address[]) internal traderTokens;
    mapping(address => TraderStats) public stats;

    event Launched(address indexed token, address indexed creator, string name, string symbol);
    event Traded(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 virtualQuote,
        uint256 virtualToken
    );
    event Graduated(address indexed token, address indexed pair, uint256 quoteAmount, uint256 tokenAmount);

    error Expired();
    error Slippage();
    error UnknownToken();
    error AlreadyGraduated();
    error InvalidAmount();
    error InvalidMetadata();
    error OnlyOwner();
    error LaunchesPaused();

    event LaunchesPausedSet(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeRecipientSet(address indexed recipient);

    constructor(
        IERC20 quote_,
        IUniswapV2Router02 router_,
        uint256 initialVirtualQuote_,
        uint256 feeBps_,
        address feeRecipient_
    ) {
        require(address(quote_) != address(0) && address(router_) != address(0), "zero address");
        require(initialVirtualQuote_ > 0 && feeBps_ <= MAX_FEE_BPS && feeRecipient_ != address(0), "bad params");
        quote = quote_;
        router = router_;
        initialVirtualQuote = initialVirtualQuote_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        owner = msg.sender;
        lpSupply = TOTAL_SUPPLY - SALE_SUPPLY;
    }

    // ---------------------------------------------------------------- launch

    function launch(
        string calldata name,
        string calldata symbol,
        string calldata image,
        string calldata description,
        uint256 initialBuy,
        uint256 minTokensOut
    ) external nonReentrant returns (address token) {
        if (launchesPaused) revert LaunchesPaused();
        _validate(name, symbol, image, description);
        token = address(new MofuToken(name, symbol, SALE_SUPPLY + lpSupply));
        _init(token, image, description);
        emit Launched(token, msg.sender, name, symbol);
        if (initialBuy > 0) _buy(token, initialBuy, minTokensOut);
    }

    // ---------------------------------------------------------------- trading

    function buy(address token, uint256 quoteIn, uint256 minTokensOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        return _buy(token, quoteIn, minTokensOut);
    }

    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        if (block.timestamp > deadline) revert Expired();
        Curve storage c = _live(token);
        if (tokensIn == 0) revert InvalidAmount();
        uint256 gross = (c.virtualQuote * tokensIn) / (c.virtualToken + tokensIn);
        uint256 fee = (gross * feeBps) / 10_000;
        quoteOut = gross - fee;
        if (quoteOut < minQuoteOut || quoteOut == 0) revert Slippage();
        c.virtualQuote -= gross;
        c.virtualToken += tokensIn;
        c.realQuote -= gross;
        c.tokensLeft += tokensIn;
        feesAccrued += fee;
        MofuToken(token).pull(msg.sender, tokensIn);
        quote.safeTransfer(msg.sender, quoteOut);
        _record(c, token, false, gross, tokensIn, quoteOut);
    }

    function _buy(address token, uint256 quoteIn, uint256 minTokensOut) internal returns (uint256 tokensOut) {
        Curve storage c = _live(token);
        if (quoteIn == 0) revert InvalidAmount();
        uint256 fee = (quoteIn * feeBps) / 10_000;
        uint256 net = quoteIn - fee;
        tokensOut = (c.virtualToken * net) / (c.virtualQuote + net);
        if (tokensOut >= c.tokensLeft) {
            // Final buy: take only the quote needed for the remaining inventory.
            tokensOut = c.tokensLeft;
            net = _ceilDiv(c.virtualQuote * tokensOut, c.virtualToken - tokensOut);
            uint256 charged = _sellOutCharge(net);
            if (charged < quoteIn) quoteIn = charged;
            fee = quoteIn - net;
        }
        if (tokensOut < minTokensOut || tokensOut == 0) revert Slippage();
        quote.safeTransferFrom(msg.sender, address(this), quoteIn);
        c.virtualQuote += net;
        c.virtualToken -= tokensOut;
        c.realQuote += net;
        c.tokensLeft -= tokensOut;
        feesAccrued += fee;
        IERC20(token).safeTransfer(msg.sender, tokensOut);
        _record(c, token, true, net, tokensOut, quoteIn);
        if (c.tokensLeft == 0) _graduate(token, c);
    }

    function _record(Curve storage c, address token, bool isBuy, uint256 curveQuote, uint256 amount, uint256 paid)
        internal
    {
        c.volume += curveQuote;
        c.trades += 1;
        c.lastTradeAt = uint40(block.timestamp);
        trades.push(Trade(token, msg.sender, uint40(block.timestamp), isBuy, uint128(curveQuote), uint128(amount)));
        tokenTradeIds[token].push(trades.length - 1);
        Position storage p = positions[msg.sender][token];
        if (p.bought == 0 && p.sold == 0) traderTokens[msg.sender].push(token);
        TraderStats storage s = stats[msg.sender];
        _touchTrader(msg.sender);
        if (isBuy) {
            p.spent += uint128(paid);
            p.bought += uint128(amount);
            s.spent += uint128(paid);
        } else {
            p.received += uint128(paid);
            p.sold += uint128(amount);
            s.received += uint128(paid);
        }
        s.volume += uint128(curveQuote);
        s.trades += 1;
        emit Traded(token, msg.sender, isBuy, curveQuote, amount, c.virtualQuote, c.virtualToken);
    }

    function _graduate(address token, Curve storage c) internal {
        c.graduated = true;
        MofuToken(token).graduate();
        uint256 quoteAmount = c.realQuote;
        c.realQuote = 0;
        // Mint directly on the pair. Anyone may pre-create the pair and donate quote to it,
        // which would make Router02.addLiquidity divide by a zero token reserve and block
        // graduation. The token cannot reach the pair before graduation, so the pair holds
        // no LP supply and a direct mint always succeeds; any donation simply joins the pool.
        IUniswapV2Factory factory = IUniswapV2Factory(router.factory());
        address pair = factory.getPair(token, address(quote));
        if (pair == address(0)) pair = factory.createPair(token, address(quote));
        c.pair = pair;
        IERC20(token).safeTransfer(pair, lpSupply);
        quote.safeTransfer(pair, quoteAmount);
        IUniswapV2Pair(pair).mint(DEAD);
        uint256 leftover = IERC20(token).balanceOf(address(this));
        if (leftover > 0) IERC20(token).safeTransfer(DEAD, leftover);
        emit Graduated(token, pair, quoteAmount, lpSupply);
    }

    // ---------------------------------------------------------------- admin

    function withdrawFees() external {
        uint256 amount = feesAccrued;
        require(amount > 0, "no fees");
        feesAccrued = 0;
        quote.safeTransfer(feeRecipient, amount);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @dev Also the recovery path if a recipient ends up on the USDC blocklist: withdrawFees
    /// reverts atomically, so accrued fees stay put until a new recipient is set.
    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "zero address");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function setLaunchesPaused(bool paused) external onlyOwner {
        launchesPaused = paused;
        emit LaunchesPausedSet(paused);
    }

    /// @notice Two-step handover: the new owner (e.g. a multisig) must accept.
    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- views

    struct CurveState {
        bool graduated;
        uint256 virtualQuote;
        uint256 virtualToken;
        uint256 realQuote;
        uint256 tokensLeft;
    }

    /// @notice Compact numeric state of one curve (no strings), for indexers and tests.
    function curveState(address token) external view returns (CurveState memory) {
        Curve storage c = curves[token];
        return CurveState(c.graduated, c.virtualQuote, c.virtualToken, c.realQuote, c.tokensLeft);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function tradeCount() external view returns (uint256) {
        return trades.length;
    }

    function traderCount() external view returns (uint256) {
        return traders.length;
    }

    function tokenTradeCount(address token) external view returns (uint256) {
        return tokenTradeIds[token].length;
    }

    /// @notice Quote a buy. Returns tokens out and the quote actually charged (capped buys charge less).
    function quoteBuy(address token, uint256 quoteIn) external view returns (uint256 tokensOut, uint256 charged) {
        Curve storage c = curves[token];
        if (c.creator == address(0) || c.graduated || quoteIn == 0) return (0, 0);
        uint256 fee = (quoteIn * feeBps) / 10_000;
        uint256 net = quoteIn - fee;
        tokensOut = (c.virtualToken * net) / (c.virtualQuote + net);
        charged = quoteIn;
        if (tokensOut >= c.tokensLeft) {
            tokensOut = c.tokensLeft;
            net = _ceilDiv(c.virtualQuote * tokensOut, c.virtualToken - tokensOut);
            uint256 sellOut = _sellOutCharge(net);
            if (sellOut < charged) charged = sellOut;
        }
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 quoteOut) {
        Curve storage c = curves[token];
        if (c.creator == address(0) || c.graduated || tokensIn == 0) return 0;
        uint256 gross = (c.virtualQuote * tokensIn) / (c.virtualToken + tokensIn);
        return gross - (gross * feeBps) / 10_000;
    }

    /// @notice Newest-first page of all tokens.
    function tokensPage(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = tokens.length;
        if (offset >= n) return page;
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 size = n - offset < limit ? n - offset : limit;
        page = new address[](size);
        for (uint256 i; i < size; ++i) page[i] = tokens[n - 1 - offset - i];
    }

    /// @notice Newest-first page of trades, either global (token == 0) or for one token.
    function tradesPage(address token, uint256 offset, uint256 limit)
        external
        view
        returns (Trade[] memory page, uint256[] memory ids)
    {
        uint256 n = token == address(0) ? trades.length : tokenTradeIds[token].length;
        if (offset >= n) return (page, ids);
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 size = n - offset < limit ? n - offset : limit;
        page = new Trade[](size);
        ids = new uint256[](size);
        for (uint256 i; i < size; ++i) {
            uint256 index = n - 1 - offset - i;
            uint256 id = token == address(0) ? index : tokenTradeIds[token][index];
            ids[i] = id;
            page[i] = trades[id];
        }
    }

    function tradersPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory accounts, TraderStats[] memory values)
    {
        uint256 n = traders.length;
        if (offset >= n) return (accounts, values);
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 size = n - offset < limit ? n - offset : limit;
        accounts = new address[](size);
        values = new TraderStats[](size);
        for (uint256 i; i < size; ++i) {
            accounts[i] = traders[offset + i];
            values[i] = stats[accounts[i]];
        }
    }

    function positionsOf(address trader)
        external
        view
        returns (address[] memory held, Position[] memory values, uint256[] memory balances)
    {
        held = traderTokens[trader];
        values = new Position[](held.length);
        balances = new uint256[](held.length);
        for (uint256 i; i < held.length; ++i) {
            values[i] = positions[trader][held[i]];
            balances[i] = IERC20(held[i]).balanceOf(trader);
        }
    }

    // ---------------------------------------------------------------- internal

    function _validate(string calldata name, string calldata symbol, string calldata image, string calldata d)
        internal
        pure
    {
        uint256 n = bytes(name).length;
        uint256 m = bytes(symbol).length;
        if (n == 0 || n > 32 || m == 0 || m > 10 || bytes(image).length > 256 || bytes(d).length > 280) {
            revert InvalidMetadata();
        }
    }

    function _init(address token, string calldata image, string calldata description) internal {
        Curve storage c = curves[token];
        c.creator = msg.sender;
        c.createdAt = uint40(block.timestamp);
        c.virtualQuote = initialVirtualQuote;
        c.virtualToken = VIRTUAL_TOKEN;
        c.tokensLeft = SALE_SUPPLY;
        c.image = image;
        c.description = description;
        tokens.push(token);
        _touchTrader(msg.sender);
        stats[msg.sender].launches += 1;
    }

    function _live(address token) internal view returns (Curve storage c) {
        c = curves[token];
        if (c.creator == address(0)) revert UnknownToken();
        if (c.graduated) revert AlreadyGraduated();
    }

    function _touchTrader(address account) internal {
        if (stats[account].firstTradeAt == 0) {
            stats[account].firstTradeAt = uint40(block.timestamp);
            traders.push(account);
        }
    }

    /// @dev Smallest gross amount whose fee-adjusted net still covers `net`, so that sending
    /// the quoted charge back into `buy` always reaches the sell-out branch.
    function _sellOutCharge(uint256 net) internal view returns (uint256) {
        return _ceilDiv(net * 10_000, 10_000 - feeBps);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
