import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeFishHandHistory,
  createFishRange,
  fishActionForCombo,
  fishRangeContinuingVsOpenSizes,
  preflopLookupStrategyForClass,
} from "../src/index.js";

test("BTN six-max lookup folds 94o and opens premiums", () => {
  const config = {
    preflopSpot: "rfi",
    heroPosition: "BTN",
    villainPosition: "BB",
    stack: 150,
    openSize: 10 / 3,
  };
  assert.deepEqual(preflopLookupStrategyForClass(config, "94o").strategy, [1, 0]);
  assert.deepEqual(preflopLookupStrategyForClass(config, "AA").strategy, [0, 1]);
});

test("curated trainer hands continue against both displayed open sizes", () => {
  const curated = fishRangeContinuingVsOpenSizes(createFishRange(), [10 / 3, 5]);
  assert.ok(curated.length > 0);
  assert.ok(curated.every((combo) => [10 / 3, 5].every((openBb) =>
    fishActionForCombo(combo, { type: "preflop-vs-open", openBb }) !== "fold")));
});

test("hand-history estimator threads one exact binary range from preflop through river", () => {
  const result = analyzeFishHandHistory({
    heroCards: "As Kd",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
    history: `Hero raises $7 to $10
Fish calls $10
Flop: Qs Ts 7h
Fish checks
Hero bets $8
Fish calls $8
Turn: 2c
Fish checks
Hero bets $22
Fish calls $22
River: 3d
Fish checks`,
  });

  assert.equal(result.street, "river");
  assert.equal(result.board.length, 5);
  assert.equal(result.lastFishAction, "check");
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.action),
    ["call", "board", "check", "call", "board", "check", "call", "board", "check"],
  );
  assert.ok(result.range.length > 0 && result.range.length < 1_225);
  assert.equal(result.summary.comboCount, result.range.length);
  assert.ok(result.range.every((combo) => !("probability" in combo)));
  const blocked = new Set([...result.heroCards, ...result.board]);
  assert.ok(result.range.every((combo) => combo.cards.every((card) => !blocked.has(card))));
});

test("hand-history estimator reports unsupported lines rather than inventing a range", () => {
  const result = analyzeFishHandHistory({
    heroCards: "As Kd",
    history: "Fish calls $10",
  });
  assert.ok(result.warnings.some((warning) => /no earlier hero raise/i.test(warning)));
  assert.equal(result.range.length, 1_225);
});
