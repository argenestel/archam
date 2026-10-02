// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Morpho Blue IOracle for TESTNET markets of valueless test assets.
/// The owner posts a price; reads revert once it is older than `maxAge`, which pauses
/// borrowing and liquidations instead of using a stale value. Mainnet markets must use a
/// reviewed feed-backed oracle (e.g. Morpho's Chainlink oracle), never this contract.
contract MofuTestnetOracle {
    /// @notice 1 collateral base unit priced in loan base units, scaled by 1e36 (Morpho convention).
    uint256 private _price;
    uint256 public updatedAt;
    uint256 public immutable maxAge;
    address public owner;
    string public description;

    event PriceUpdated(uint256 price, uint256 updatedAt);

    constructor(uint256 price_, uint256 maxAge_, string memory description_) {
        require(block.chainid == 5042002 || block.chainid == 1337, "TESTNET ONLY");
        require(price_ > 0 && maxAge_ > 0, "bad params");
        owner = msg.sender;
        maxAge = maxAge_;
        description = description_;
        _set(price_);
    }

    function price() external view returns (uint256) {
        require(block.timestamp - updatedAt <= maxAge, "stale price");
        return _price;
    }

    function latestPrice() external view returns (uint256 value, uint256 timestamp, bool fresh) {
        return (_price, updatedAt, block.timestamp - updatedAt <= maxAge);
    }

    function setPrice(uint256 price_) external {
        require(msg.sender == owner, "only owner");
        require(price_ > 0, "bad price");
        _set(price_);
    }

    function transferOwnership(address next) external {
        require(msg.sender == owner, "only owner");
        owner = next;
    }

    function _set(uint256 price_) internal {
        _price = price_;
        updatedAt = block.timestamp;
        emit PriceUpdated(price_, block.timestamp);
    }
}
