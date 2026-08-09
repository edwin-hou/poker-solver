import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreflopLookupResult,
  solvePokerSpot,
  validatePreflopLookupConfig,
} from "../src/index.js";

function classStrategy(result, classLabel) {
  const node = result.nodes[0];
  const index = node.combos.findIndex((combo) => combo.classLabel === classLabel);
  assert.notEqual(index, -1, `${classLabel} should be present`);
  return node.strategies[index];
}

function assertNormalized(result) {
  for (const node of result.nodes) {
    for (const row of node.strategies) {
      assert.ok(row.every((value) => value >= 0 && value <= 1));
      assert.ok(Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    }
  }
}

test("BTN open-first-in lookup produces a complete approximate range chart", () => {
  const result = buildPreflopLookupResult({
    street: "preflop",
    preflopMode: "lookup",
    preflopSpot: "rfi",
    heroPosition: "BTN",
    villainPosition: "BB",
    stack: 100,
    openSize: 2.5,
    heroRange: "random",
    villainRange: "random",
  });

  assert.equal(result.abstraction.mode, "lookup");
  assert.equal(result.nodes[0].actionLabels.length, 2);
  assert.equal(result.ranges.hero.comboCount, 1_326);
  assert.equal(result.evaluation.exploitability, null);
  assert.ok(classStrategy(result, "AA")[1] > 0.99);
  assert.ok(classStrategy(result, "72o")[0] > 0.99);
  assertNormalized(result);
});

test("late-position blind defense is wider than early-position defense", () => {
  const bbVsBtn = buildPreflopLookupResult({
    preflopSpot: "vs-open",
    heroPosition: "BB",
    villainPosition: "BTN",
    stack: 100,
    openSize: 2.5,
  });
  const hjVsUtg = buildPreflopLookupResult({
    preflopSpot: "vs-open",
    heroPosition: "HJ",
    villainPosition: "UTG",
    stack: 100,
    openSize: 2.5,
  });

  assert.ok(bbVsBtn.lookup.targetContinueFrequency > hjVsUtg.lookup.targetContinueFrequency * 3);
  assert.deepEqual(bbVsBtn.nodes[0].actionLabels, ["Fold", "Call", "3-bet"]);
  assertNormalized(bbVsBtn);
});

test("lookup validation rejects impossible facing-open position order", () => {
  assert.throws(
    () => validatePreflopLookupConfig({ preflopSpot: "vs-open", heroPosition: "CO", villainPosition: "BTN" }),
    /opener must act before/i,
  );
});

test("unified dispatcher selects lookup mode without running CFR iterations", async () => {
  const result = await solvePokerSpot({
    street: "preflop",
    preflopMode: "lookup",
    preflopSpot: "vs-3bet",
    heroPosition: "CO",
    villainPosition: "BTN",
    stack: 100,
    openSize: 2.5,
  });
  assert.equal(result.iterations, 0);
  assert.equal(result.abstraction.spot, "vs-3bet");
  assert.deepEqual(result.nodes[0].actionLabels, ["Fold", "Call", "4-bet"]);
  assertNormalized(result);
});
