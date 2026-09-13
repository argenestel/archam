// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply token. No owner, additional minting, tax, or upgrade mechanism.
contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient)
        ERC20(name_, symbol_)
    {
        require(bytes(name_).length > 0 && bytes(name_).length <= 64, "Invalid name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "Invalid symbol");
        require(supply_ > 0, "Invalid supply");
        _mint(recipient, supply_);
    }
}
