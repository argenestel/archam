import test from "node:test";
import assert from "node:assert/strict";
import { money, sameFillContext } from "../app/market-safety.ts";

test("USDC display preserves one wei and all eighteen decimals", () => {
  assert.equal(money(1n), "0.000000000000000001");
  assert.equal(money(1234567890123456789n), "1.234567890123456789");
  assert.equal(money(1000000000000000000000000000000000001n), "1,000,000,000,000,000,000.000000000000000001");
  assert.equal(money(0n), "0");
});

test("a fill remains valid only for its original market, book, token and account", () => {
  const context = { factory: "0xFactory", book: "0xBook", token: "0xToken", account: "0xAccount" };
  assert.equal(sameFillContext(context, { ...context, token: "0xtoken" }), true);
  for (const key of Object.keys(context)) {
    assert.equal(sameFillContext(context, { ...context, [key]: "0xDifferent" }), false, key);
    assert.equal(sameFillContext(context, { ...context, [key]: "" }), false, `missing ${key}`);
  }
});
