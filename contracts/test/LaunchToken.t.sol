// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    function testSupplyAndTransfers() public {
        LaunchToken token = new LaunchToken("Mofu", "MOFU", 1000 ether, address(this));
        assertEq(token.totalSupply(), 1000 ether);
        assertEq(token.balanceOf(address(this)), 1000 ether);
        assertEq(token.decimals(), 18);
        token.transfer(address(1), 10 ether);
        assertEq(token.balanceOf(address(1)), 10 ether);
    }
    function testRejectZeroSupply() public {
        vm.expectRevert("Invalid supply");
        new LaunchToken("Mofu", "MOFU", 0, address(this));
    }
    function testRejectZeroRecipient() public {
        vm.expectRevert();
        new LaunchToken("Mofu", "MOFU", 1, address(0));
    }
    function testRejectEmptyName() public {
        vm.expectRevert("Invalid name");
        new LaunchToken("", "MOFU", 1, address(this));
    }
    function testFuzzSupply(uint128 supply) public {
        vm.assume(supply > 0);
        LaunchToken token = new LaunchToken("Mofu", "MOFU", supply, address(this));
        assertEq(token.balanceOf(address(this)), supply);
    }
}
