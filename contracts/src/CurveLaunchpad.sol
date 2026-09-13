// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice Testnet-only linear bonding curve. Native USDC values use 18 decimals.
/// No admin, fees, reserve withdrawals, premint, or DEX graduation.
contract CurveToken is ERC20, ReentrancyGuard {
    uint256 public constant CAP = 1_000_000;
    uint256 public constant UNIT = 1 ether;
    address public immutable creator;
    string public description;
    string public icon;
    event Trade(address indexed trader, bool isBuy, uint256 tokens, uint256 usdc, uint256 supply);

    constructor(string memory name_, string memory symbol_, string memory description_, string memory icon_, address creator_)
        ERC20(name_, symbol_)
    {
        require(bytes(name_).length > 0 && bytes(name_).length <= 64, "Invalid name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "Invalid symbol");
        require(bytes(description_).length <= 280 && bytes(icon_).length <= 32, "Metadata too long");
        require(creator_ != address(0), "Invalid creator");
        creator = creator_;
        description = description_;
        icon = icon_;
    }

    /// @dev Cumulative reserve at a whole-token supply. Exact integer arithmetic.
    function reserveAt(uint256 supply) public pure returns (uint256) {
        require(supply <= CAP, "Cap exceeded");
        return supply * 1e12 + supply * supply * 5e8;
    }

    function quoteBuy(uint256 tokens) public view returns (uint256) {
        require(tokens > 0, "Zero amount");
        uint256 supply = totalSupply() / UNIT;
        require(tokens <= CAP - supply, "Cap exceeded");
        return reserveAt(supply + tokens) - reserveAt(supply);
    }

    function quoteSell(uint256 tokens) public view returns (uint256) {
        uint256 supply = totalSupply() / UNIT;
        require(tokens > 0 && tokens <= supply, "Invalid amount");
        return reserveAt(supply) - reserveAt(supply - tokens);
    }

    /// @param maxCost Maximum native USDC including allowed price movement, not gas.
    function buy(uint256 tokens, uint256 maxCost, uint256 deadline) external payable nonReentrant {
        require(block.timestamp <= deadline, "Expired");
        uint256 cost = quoteBuy(tokens);
        require(cost <= maxCost && msg.value >= cost && msg.value <= maxCost, "Price moved");
        _mint(msg.sender, tokens * UNIT);
        if (msg.value > cost) {
            (bool ok,) = payable(msg.sender).call{value: msg.value - cost}("");
            require(ok, "Refund failed");
        }
        emit Trade(msg.sender, true, tokens, cost, totalSupply() / UNIT);
    }

    function sell(uint256 tokens, uint256 minReturn, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "Expired");
        uint256 proceeds = quoteSell(tokens);
        require(proceeds >= minReturn, "Price moved");
        _burn(msg.sender, tokens * UNIT);
        (bool ok,) = payable(msg.sender).call{value: proceeds}("");
        require(ok, "Payment failed");
        emit Trade(msg.sender, false, tokens, proceeds, totalSupply() / UNIT);
    }
}

contract CurveLaunchpad {
    address[] public tokens;
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol);

    function createToken(string calldata name, string calldata symbol, string calldata description, string calldata icon)
        external returns (address token)
    {
        token = address(new CurveToken(name, symbol, description, icon, msg.sender));
        tokens.push(token);
        emit TokenCreated(token, msg.sender, name, symbol);
    }

    function tokenCount() external view returns (uint256) { return tokens.length; }
}
