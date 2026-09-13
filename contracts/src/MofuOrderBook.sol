// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface ICurveRegistry {
    function tokens(uint256 index) external view returns (address);
}

/// @notice Testnet explicit-fill spot orders for one immutable CurveLaunchpad registry.
/// Quantity is whole tokens; price is native USDC wei (18 decimals) per whole token.
/// Native settlements use pull payments. There are no fees, admins, or automatic matching.
contract MofuOrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant UNIT = 1 ether;
    uint256 public constant MAX_QUANTITY = 1_000_000;
    uint256 public constant MAX_EXPIRY = 30 days;
    address public immutable factory;
    uint256 public orderCount;

    struct Order {
        address maker;
        address token;
        bool isBuy;
        uint256 remaining;
        uint256 price;
        uint256 expiry;
    }

    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public credits;

    event OrderPosted(
        uint256 indexed id,
        address indexed maker,
        address indexed token,
        bool isBuy,
        uint256 quantity,
        uint256 price,
        uint256 expiry
    );
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 quantity, uint256 remaining);
    event OrderCancelled(uint256 indexed id);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(address factory_) {
        require(factory_.code.length > 0, "Invalid factory");
        factory = factory_;
    }

    function postOrder(uint256 tokenIndex, bool isBuy, uint256 quantity, uint256 price, uint256 expiry)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        require(quantity > 0 && quantity <= MAX_QUANTITY, "Invalid quantity");
        require(price > 0 && price <= type(uint256).max / quantity, "Invalid price");
        require(expiry > block.timestamp && expiry - block.timestamp <= MAX_EXPIRY, "Invalid expiry");
        address token = ICurveRegistry(factory).tokens(tokenIndex);
        require(token.code.length > 0, "Invalid token");
        require(msg.value == (isBuy ? quantity * price : 0), "Incorrect funds");
        id = orderCount++;
        orders[id] =
            Order({maker: msg.sender, token: token, isBuy: isBuy, remaining: quantity, price: price, expiry: expiry});
        if (!isBuy) IERC20(token).safeTransferFrom(msg.sender, address(this), quantity * UNIT);
        emit OrderPosted(id, msg.sender, token, isBuy, quantity, price, expiry);
    }

    function fillOrder(uint256 id, uint256 quantity) external payable nonReentrant {
        Order storage order = orders[id];
        require(quantity > 0 && quantity <= order.remaining, "Invalid quantity");
        require(block.timestamp < order.expiry, "Expired");
        uint256 cost = quantity * order.price;
        require(msg.value == (order.isBuy ? 0 : cost), "Incorrect funds");
        order.remaining -= quantity;
        if (order.isBuy) {
            credits[msg.sender] += cost;
            IERC20(order.token).safeTransferFrom(msg.sender, order.maker, quantity * UNIT);
        } else {
            credits[order.maker] += cost;
            IERC20(order.token).safeTransfer(msg.sender, quantity * UNIT);
        }
        emit OrderFilled(id, msg.sender, quantity, order.remaining);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order storage order = orders[id];
        require(order.maker == msg.sender, "Not maker");
        uint256 remaining = order.remaining;
        require(remaining > 0, "Order closed");
        order.remaining = 0;
        if (order.isBuy) credits[msg.sender] += remaining * order.price;
        else IERC20(order.token).safeTransfer(msg.sender, remaining * UNIT);
        emit OrderCancelled(id);
    }

    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "No credit");
        credits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Payment failed");
        emit Withdrawn(msg.sender, amount);
    }
}
