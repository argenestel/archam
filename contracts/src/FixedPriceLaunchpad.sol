// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Experimental fixed-price sale escrow, NOT audited or deployed.
/// @dev Built from upstream OpenZeppelin primitives. Not an AMM or a lending market.
/// Only standard non-rebasing, non-fee ERC20s are supported. Native USDC is not ERC20 USDC.
contract FixedPriceLaunchpad is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable paymentToken;
    IERC20 public immutable saleToken;
    uint256 public immutable start;
    uint256 public immutable end;
    uint256 public immutable softCap;
    uint256 public immutable hardCap;
    // Sale base units per payment base unit, scaled by 1e18. Configure decimals explicitly.
    uint256 public immutable rate;
    uint256 public totalRaised;
    uint256 public totalAllocated;
    uint256 public totalClaimed;
    bool public cancelled;
    bool public proceedsWithdrawn;
    mapping(address => uint256) public contributions;
    mapping(address => uint256) public allocations;

    event Contributed(address indexed buyer, uint256 payment, uint256 allocation);
    event Claimed(address indexed buyer, uint256 tokens);
    event Refunded(address indexed buyer, uint256 payment);
    event Cancelled();
    event ProceedsWithdrawn(uint256 amount);
    event UnsoldWithdrawn(uint256 amount);
    error InvalidSale();
    error SaleNotOpen();
    error InvalidAmount();
    error InsufficientInventory();
    error UnsupportedToken();
    error NotSettled();
    error NothingToClaim();

    constructor(address owner_, IERC20 payment_, IERC20 sale_, uint256 start_, uint256 end_, uint256 softCap_, uint256 hardCap_, uint256 rate_) Ownable(owner_) {
        if (address(payment_) == address(0) || address(sale_) == address(0) || address(payment_) == address(sale_) || start_ < block.timestamp || end_ <= start_ || softCap_ == 0 || hardCap_ < softCap_ || rate_ == 0) revert InvalidSale();
        if (address(payment_).code.length == 0 || address(sale_).code.length == 0 || Math.mulDiv(hardCap_, rate_, 1e18) == 0) revert InvalidSale();
        paymentToken = payment_; saleToken = sale_;
        start = start_; end = end_; softCap = softCap_; hardCap = hardCap_; rate = rate_;
    }

    function successful() public view returns (bool) {
        return !cancelled && block.timestamp >= end && totalRaised >= softCap;
    }

    /// @dev Owner must pre-fund the ENTIRE hard-cap inventory before contributions open.
    function contribute(uint256 amount) external nonReentrant {
        if (cancelled || block.timestamp < start || block.timestamp >= end) revert SaleNotOpen();
        if (amount == 0 || amount > hardCap - totalRaised) revert InvalidAmount();
        uint256 allocation = Math.mulDiv(amount, rate, 1e18);
        if (allocation == 0) revert InvalidAmount();
        if (saleToken.balanceOf(address(this)) < Math.mulDiv(hardCap, rate, 1e18)) revert InsufficientInventory();
        uint256 previousBalance = paymentToken.balanceOf(address(this));
        contributions[msg.sender] += amount;
        allocations[msg.sender] += allocation;
        totalRaised += amount;
        totalAllocated += allocation;
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        if (paymentToken.balanceOf(address(this)) - previousBalance != amount) revert UnsupportedToken();
        emit Contributed(msg.sender, amount, allocation);
    }

    /// @notice Cancellation always preserves the right to a full refund.
    function cancel() external onlyOwner {
        if (block.timestamp >= end || cancelled) revert NotSettled();
        cancelled = true;
        emit Cancelled();
    }

    function claim() external nonReentrant {
        if (!successful()) revert NotSettled();
        uint256 amount = allocations[msg.sender];
        if (amount == 0) revert NothingToClaim();
        allocations[msg.sender] = 0;
        contributions[msg.sender] = 0;
        totalClaimed += amount;
        saleToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function refund() external nonReentrant {
        if (!cancelled && (block.timestamp < end || totalRaised >= softCap)) revert NotSettled();
        uint256 amount = contributions[msg.sender];
        if (amount == 0) revert NothingToClaim();
        contributions[msg.sender] = 0;
        allocations[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    function withdrawProceeds() external onlyOwner nonReentrant {
        if (!successful() || proceedsWithdrawn) revert NotSettled();
        proceedsWithdrawn = true;
        paymentToken.safeTransfer(owner(), totalRaised);
        emit ProceedsWithdrawn(totalRaised);
    }

    /// @dev Retains every unclaimed successful allocation. Failed-sale inventory is reclaimable.
    function withdrawUnsold() external onlyOwner nonReentrant {
        if (!cancelled && block.timestamp < end) revert NotSettled();
        uint256 reserved = successful() ? totalAllocated - totalClaimed : 0;
        uint256 amount = saleToken.balanceOf(address(this)) - reserved;
        if (amount == 0) revert NothingToClaim();
        saleToken.safeTransfer(owner(), amount);
        emit UnsoldWithdrawn(amount);
    }
}
