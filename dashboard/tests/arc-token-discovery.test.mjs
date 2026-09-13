import test from "node:test";
import assert from "node:assert/strict";
import {
  curatedArcTokens,
  mergeArcTokens,
  normalizeArcToken,
} from "../app/arc-token-discovery.ts";

test("normalizes only usable ERC-20 explorer records", () => {
  const token = normalizeArcToken({
    token: {
      address: "0x1111111111111111111111111111111111111111",
      checksum: "0x1111111111111111111111111111111111111111",
      name: "Arc Coin",
      symbol: "ARC",
      decimals: 18,
      standard: "erc20",
    },
  });

  assert.deepEqual(token, {
    address: "0x1111111111111111111111111111111111111111",
    name: "Arc Coin",
    symbol: "ARC",
    decimals: 18,
    image: "/token-images/default.svg",
    source: "arcscan",
  });
  assert.equal(normalizeArcToken({ token: { standard: "erc721" } }), undefined);
  assert.equal(normalizeArcToken({ token: { standard: "erc20", decimals: null } }), undefined);
  assert.equal(normalizeArcToken({ token: { standard: "erc20", decimals: 18, address: "0xnope" } }), undefined);
});

test("merges Arc assets without duplicate addresses", () => {
  const duplicate = {
    ...curatedArcTokens[0],
    name: "Duplicate USDC",
    address: curatedArcTokens[0].address.toLowerCase(),
  };
  const extra = {
    address: "0x2222222222222222222222222222222222222222",
    name: "Second Coin",
    symbol: "SECOND",
    decimals: 6,
    image: "https://example.com/second.png",
    source: "arcscan",
  };

  const merged = mergeArcTokens([duplicate, extra]);
  assert.equal(merged.length, curatedArcTokens.length + 1);
  assert.equal(merged[0].name, curatedArcTokens[0].name);
  assert.equal(merged.at(-1).address, extra.address);
});
