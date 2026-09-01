import test from "node:test";
import assert from "node:assert/strict";

import {
  POSTFLOP_BET_SIZES,
  POSTFLOP_RAISE_SIZES,
  availablePostflopBetSizes,
  fractionForBetChoice,
  heroAllInTarget,
  postflopBetAmount,
  postflopRaiseTarget,
} from "../src/index.js";

test("trainer exposes standard postflop sizes while preserving one-third pot", () => {
  assert.deepEqual(
    POSTFLOP_BET_SIZES.map(({ id, fraction }) => [id, fraction]),
    [
      ["bet33", 0.33],
      ["bet50", 0.50],
      ["bet67", 0.67],
      ["bet75", 0.75],
      ["bet100", 1.00],
      ["bet150", 1.50],
    ],
  );
  assert.equal(fractionForBetChoice("bet33"), 0.33);
  assert.equal(fractionForBetChoice("bet100"), 1);
  assert.equal(fractionForBetChoice("bet150"), 1.5);
  assert.equal(fractionForBetChoice("unknown"), null);
});

test("all-in and raise targets use the actual remaining hero stack", () => {
  assert.equal(heroAllInTarget({ heroCommitted: 18, heroStack: 432 }), 450);
  assert.equal(postflopBetAmount(90, 0.33, 200), 30);
  assert.equal(postflopBetAmount(300, 1, 80), 80);
  assert.equal(postflopBetAmount(100, 1.5, 400), 150);

  assert.deepEqual(POSTFLOP_RAISE_SIZES.map((size) => postflopRaiseTarget({
    heroCommitted: 0,
    heroStack: 400,
    opponentCommitted: 30,
    multiplier: size.multiplier,
  })), [75, 90, 120]);
  assert.equal(postflopRaiseTarget({
    heroCommitted: 0,
    heroStack: 65,
    opponentCommitted: 30,
    multiplier: 4,
  }), 65);
});

test("available bet sizes include exact chip amounts without duplicating all in", () => {
  assert.deepEqual(
    availablePostflopBetSizes(100, 400).map(({ id, amount }) => [id, amount]),
    [
      ["bet33", 33],
      ["bet50", 50],
      ["bet67", 67],
      ["bet75", 75],
      ["bet100", 100],
      ["bet150", 150],
    ],
  );
  assert.deepEqual(
    availablePostflopBetSizes(100, 120).map(({ id, amount }) => [id, amount]),
    [
      ["bet33", 33],
      ["bet50", 50],
      ["bet67", 67],
      ["bet75", 75],
      ["bet100", 100],
    ],
  );
});
