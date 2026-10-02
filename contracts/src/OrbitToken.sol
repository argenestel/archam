// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply launch token. Until graduation it can only move to or from the
/// launcher, so nobody can seed the AMM pair early or trade it off-curve.
contract OrbitToken is ERC20 {
    address public immutable launcher;
    bool public graduated;

    error TransfersLocked();
    error OnlyLauncher();

    constructor(string memory name_, string memory symbol_, uint256 supply) ERC20(name_, symbol_) {
        launcher = msg.sender;
        _mint(msg.sender, supply);
    }

    modifier onlyLauncher() {
        if (msg.sender != launcher) revert OnlyLauncher();
        _;
    }

    function graduate() external onlyLauncher {
        graduated = true;
    }

    /// @dev Lets the launcher take tokens a seller is selling in the same call, without a
    /// separate approval. Only the launcher can call it, and only for its own sell flow.
    function pull(address from, uint256 amount) external onlyLauncher {
        _transfer(from, launcher, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!graduated && from != address(0) && from != launcher && to != launcher) revert TransfersLocked();
        super._update(from, to, value);
    }
}
