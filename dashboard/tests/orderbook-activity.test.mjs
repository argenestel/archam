import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_ORDERS, summarizeDemoOrders } from "../scripts/create-orderbook-activity.mjs";

test("MOFU demo activity has balanced visible depth", () => {
  const summary = summarizeDemoOrders();
  assert.equal(summary.askQuantity, 540n);
  assert.equal(summary.bidQuantity, 540n);
  assert.equal(DEMO_ORDERS.filter(order => order.isBuy).length, 3);
  assert.equal(DEMO_ORDERS.filter(order => !order.isBuy).length, 3);
  assert.deepEqual(
    DEMO_ORDERS.filter(order => !order.isBuy).map(order => order.price),
    [1800000000000000n, 2400000000000000n, 3000000000000000n],
  );
  assert.deepEqual(
    DEMO_ORDERS.filter(order => order.isBuy).map(order => order.price),
    [1200000000000000n, 900000000000000n, 600000000000000n],
  );
});
