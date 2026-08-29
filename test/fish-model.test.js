import test from "node:test";
import assert from "node:assert/strict";

import {
  createFishRange,
  filterFishRange,
  fishActionForCombo,
  observeFishAction,
  parseCard,
  parseCards,
  summarizeFishRange,
} from "../src/index.js";

function firstClass(range, label) {
  return range.find((entry) => entry.classLabel === label);
}

test("fish prior is an exact blocker-aware set without probability weights", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  const range = createFishRange({ heroCards });
  assert.equal(range.length, 1_225);
  assert.ok(range.every((entry) => !("probability" in entry)));
  assert.ok(range.every((entry) => !entry.cards.includes(heroCards[0]) && !entry.cards.includes(heroCards[1])));
});

test("preflop fish policy is deterministic with wide calls and rare premium 3-bets", () => {
  const heroCards = [parseCard("2c"), parseCard("3d")];
  const prior = createFishRange({ heroCards });
  const context = { type: "preflop-vs-open", openBb: 3.3 };
  const aa = firstClass(prior, "AA");
  const suitedConnector = firstClass(prior, "76s");
  const trash = firstClass(prior, "72o");

  assert.ok(aa && suitedConnector && trash);
  assert.equal(fishActionForCombo(aa, context), "raise");
  assert.equal(fishActionForCombo(suitedConnector, context), "call");
  assert.equal(fishActionForCombo(trash, context), "fold");

  const called = observeFishAction(prior, context, "call", heroCards);
  assert.ok(called.some((entry) => entry.classLabel === "76s"));
  assert.ok(!called.some((entry) => entry.classLabel === "AA"));
  assert.ok(!called.some((entry) => entry.classLabel === "72o"));
  assert.ok(called.every((entry) => fishActionForCombo(entry, context) === "call"));
});

test("one binary range survives a full preflop-to-river action thread", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  let range = createFishRange({ heroCards });
  const initialCount = range.length;
  range = observeFishAction(range, { type: "preflop-vs-open", openBb: 3.3 }, "call", heroCards);
  const afterPreflop = range.length;

  const flop = parseCards("Qs Ts 7h", { exact: 3 });
  range = filterFishRange(range, [...heroCards, ...flop]);
  range = observeFishAction(range, { type: "postflop-first", board: flop }, "check", [...heroCards, ...flop]);
  range = observeFishAction(
    range,
    { type: "postflop-vs-bet", board: flop, betFraction: 0.33 },
    "call",
    [...heroCards, ...flop],
  );
  const afterFlop = range.length;

  const turn = parseCards("Qs Ts 7h 2c", { exact: 4 });
  range = filterFishRange(range, [...heroCards, ...turn]);
  range = observeFishAction(range, { type: "postflop-first", board: turn }, "check", [...heroCards, ...turn]);
  range = observeFishAction(
    range,
    { type: "postflop-vs-bet", board: turn, betFraction: 0.75 },
    "call",
    [...heroCards, ...turn],
  );
  const afterTurn = range.length;

  const river = parseCards("Qs Ts 7h 2c 3d", { exact: 5 });
  range = filterFishRange(range, [...heroCards, ...river]);
  range = observeFishAction(range, { type: "postflop-first", board: river }, "check", [...heroCards, ...river]);

  const blocked = new Set([...heroCards, ...river]);
  assert.ok(range.length > 0);
  assert.ok(initialCount > afterPreflop);
  assert.ok(afterPreflop >= afterFlop);
  assert.ok(afterFlop >= afterTurn);
  assert.ok(afterTurn >= range.length);
  assert.ok(range.every((entry) => !("probability" in entry)));
  assert.ok(range.every((entry) => !blocked.has(entry.cards[0]) && !blocked.has(entry.cards[1])));
});

test("river raises are face-up value while air folds", () => {
  const board = parseCards("Ac Ad 8h 2s 9c", { exact: 5 });
  const range = createFishRange({ board });
  const strong = firstClass(range, "A8s");
  const weak = firstClass(range, "43o");
  const context = { type: "postflop-vs-bet", board, betFraction: 0.75 };
  assert.ok(strong && weak);
  assert.equal(fishActionForCombo(strong, context), "raise");
  assert.equal(fishActionForCombo(weak, context), "fold");
});

test("range summaries report literal combo counts and hand-type buckets", () => {
  const board = parseCards("Qs Ts 7h", { exact: 3 });
  const range = createFishRange({ board });
  const summary = summarizeFishRange(range, board);
  const bucketTotal = Object.values(summary.bucketCounts).reduce((sum, count) => sum + count, 0);

  assert.equal(summary.comboCount, range.length);
  assert.equal(bucketTotal, range.length);
  assert.ok(summary.classCount > 0 && summary.classCount <= 169);
  assert.ok(summary.byClass.AA?.count > 0);
  assert.ok(summary.byClass.AA?.buckets.medium > 0);
});
