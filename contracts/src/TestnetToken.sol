// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless, freely faucet-minted TEST token. Never use in production.
contract TestnetToken is ERC20 {
    uint8 private immutable precision;
    uint256 public immutable faucetAmount;
    mapping(address => bool) public claimed;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 initialSupply_, uint256 faucetAmount_) ERC20(name_, symbol_) {
        require(block.chainid == 5042002 || block.chainid == 1337, "TESTNET ONLY");
        require(decimals_ <= 18 && faucetAmount_ > 0, "Invalid parameters");
        precision = decimals_;
        faucetAmount = faucetAmount_;
        _mint(msg.sender, initialSupply_);
    }
    function decimals() public view override returns (uint8) { return precision; }
    function faucet() external {
        require(!claimed[msg.sender], "Already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, faucetAmount);
    }
}
