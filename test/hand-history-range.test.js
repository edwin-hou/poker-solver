import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeFishHandHistory,
  createFishRange,
  fishActionForCombo,
  fishDecisionForCombo,
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

  assert.deepEqual(
    result.streetSnapshots.map((snapshot) => snapshot.street),
    ["preflop", "flop", "turn", "river"],
  );
  assert.deepEqual(
    result.streetSnapshots.map((snapshot) => snapshot.board.length),
    [0, 3, 4, 5],
  );
  assert.deepEqual(
    result.streetSnapshots.map((snapshot) => snapshot.lastFishAction),
    ["call", "call", "call", "check"],
  );
  assert.deepEqual(
    result.streetSnapshots.map((snapshot) => snapshot.lastFishContext?.type),
    ["preflop-vs-open", "postflop-vs-bet", "postflop-vs-bet", "postflop-first"],
  );
  assert.deepEqual(
    result.streetSnapshots.map((snapshot) => snapshot.eventCount),
    [1, 4, 7, 9],
  );
  for (let index = 1; index < result.streetSnapshots.length; index += 1) {
    const prior = new Set(result.streetSnapshots[index - 1].range.map((combo) => combo.cards.join("-")));
    assert.ok(result.streetSnapshots[index].range.every((combo) => prior.has(combo.cards.join("-"))));
  }
  const riverSnapshot = result.streetSnapshots.at(-1);
  assert.equal(riverSnapshot.summary.comboCount, result.summary.comboCount);
  assert.deepEqual(riverSnapshot.range, result.range);
  assert.ok(result.streetSnapshots.every((snapshot) =>
    snapshot.range.every((combo) => !("probability" in combo))));
});

test("hand-history estimator reports unsupported lines rather than inventing a range", () => {
  const result = analyzeFishHandHistory({
    heroCards: "As Kd",
    history: "Fish calls $10",
  });
  assert.ok(result.warnings.some((warning) => /no earlier hero raise/i.test(warning)));
  assert.equal(result.range.length, 1_225);
});

test("hand-history estimator uses the 4-bet context and retains sticky premiums that call", () => {
  const result = analyzeFishHandHistory({
    heroCards: "2c 3d",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
    history: `Hero raises to $10
Fish raises to $35
Hero raises to $126
Fish calls $126`,
  });

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.events.map((event) => event.action), ["raise", "call"]);
  assert.ok(result.range.some((combo) => combo.classLabel === "AKo"));
  assert.ok(result.range.some((combo) => combo.classLabel === "AQs"));
  assert.ok(result.range.every((combo) =>
    fishActionForCombo(combo, {
      type: "preflop-vs-fourbet",
      fourBetBb: 42,
      priorAction: "threebet",
    }) === "call"));
});

test("hand-history estimator keeps 77 in a paired-board call-check-call line", () => {
  const result = analyzeFishHandHistory({
    heroCards: "As Qd",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
    history: `Hero raises to $10
Fish calls $10
Flop: Kc Kd 8h
Fish checks
Hero bets $8
Fish calls $8`,
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.range.filter((combo) => combo.classLabel === "77").length, 6);
  const flopSnapshot = result.streetSnapshots.find((snapshot) => snapshot.street === "flop");
  assert.equal(flopSnapshot.lastFishAction, "call");
  assert.equal(flopSnapshot.lastFishContext.type, "postflop-vs-bet");
  assert.ok(flopSnapshot.range.every((combo) =>
    fishActionForCombo(combo, flopSnapshot.lastFishContext) === "call"));
});

test("hand-history estimator treats small heads-up donks as bluffier than large donks", () => {
  const common = {
    heroCards: "Qh Qd",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
  };
  const small = analyzeFishHandHistory({
    ...common,
    history: `Hero raises to $10
Fish calls $10
Flop: 9c 6d 2s
Fish bets $5`,
  });
  const large = analyzeFishHandHistory({
    ...common,
    history: `Hero raises to $10
Fish calls $10
Flop: 9c 6d 2s
Fish bets $20`,
  });

  assert.equal(small.warnings.length, 0);
  assert.equal(large.warnings.length, 0);
  assert.ok(small.range.some((combo) => combo.classLabel === "A5o"));
  assert.ok(!large.range.some((combo) => combo.classLabel === "A5o"));
  assert.ok(small.streetSnapshots.at(-1).lastFishContext.donk);
});

test("hand-history estimator carries an actual blocker bluff through all three streets", () => {
  const result = analyzeFishHandHistory({
    heroCards: "Qc Qd",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
    history: `Hero raises to $10
Fish calls $10
Flop: Ks 7s 2s
Hero checks
Fish bets $5
Hero calls $5
Turn: 9d
Hero checks
Fish bets $10
Hero calls $10
River: 3c
Hero checks
Fish bets $80`,
  });

  assert.equal(result.warnings.length, 0);
  const blocker = result.range.find((combo) => combo.display === "As5h");
  const river = result.streetSnapshots.at(-1);
  assert.ok(blocker, "the literal ace-of-spades blocker bluff should survive the threaded line");
  assert.equal(river.lastFishContext.barrelCount, 2);
  assert.equal(fishDecisionForCombo(blocker, river.lastFishContext).intent, "bluff");
});

test("passive river stabs stay value-only instead of inheriting generic missed draws", () => {
  const result = analyzeFishHandHistory({
    heroCards: "Qc Qd",
    heroName: "Hero",
    fishName: "Fish",
    bigBlind: 3,
    startingPot: 6,
    history: `Hero raises to $10
Fish calls $10
Flop: Ks 7s 2s
Hero checks
Fish checks
Turn: 9d
Hero checks
Fish checks
River: 3c
Hero checks
Fish bets $20`,
  });

  assert.equal(result.warnings.length, 0);
  const river = result.streetSnapshots.at(-1);
  assert.ok(river.lastFishContext.passiveRiverStab);
  assert.ok(result.range.length > 0);
  assert.ok(result.range.every((combo) =>
    fishDecisionForCombo(combo, river.lastFishContext).intent === "value"));
});
