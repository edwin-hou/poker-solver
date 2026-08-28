import test from "node:test";
import assert from "node:assert/strict";

import {
  createFishRange,
  filterFishRange,
  fishActionProbabilities,
  observeFishAction,
  parseCard,
  parseCards,
  summarizeFishRange,
} from "../src/index.js";

function totalProbability(range) {
  return range.reduce((sum, entry) => sum + entry.probability, 0);
}

function classDensity(range, label) {
  const summary = summarizeFishRange(range);
  const comboCount = label.length === 2 ? 6 : label.endsWith("s") ? 4 : 12;
  return (summary.byClass[label] ?? 0) / comboCount;
}

test("fish prior is an exact blocker-aware distribution", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  const range = createFishRange({ heroCards });
  assert.equal(range.length, 1_225);
  assert.ok(Math.abs(totalProbability(range) - 1) < 1e-10);
  assert.ok(range.every((entry) => !entry.cards.includes(heroCards[0]) && !entry.cards.includes(heroCards[1])));
});

test("rare preflop aggression makes the posterior much stronger without deleting all weak hands", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  const prior = createFishRange({ heroCards });
  const context = { type: "preflop-vs-open", openBb: 3.3 };
  const raised = observeFishAction(prior, context, "raise", heroCards);
  const called = observeFishAction(prior, context, "call", heroCards);

  assert.ok(classDensity(raised, "AA") > classDensity(raised, "72o") * 8);
  assert.ok(classDensity(called, "72o") > 0);
  assert.ok(Math.abs(totalProbability(raised) - 1) < 1e-10);
  assert.ok(Math.abs(totalProbability(called) - 1) < 1e-10);
});

test("one posterior range survives a full preflop-to-river action thread", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  let range = createFishRange({ heroCards });
  range = observeFishAction(range, { type: "preflop-vs-open", openBb: 3.3 }, "call", heroCards);

  const flop = parseCards("Qs Ts 7h", { exact: 3 });
  range = filterFishRange(range, [...heroCards, ...flop]);
  range = observeFishAction(range, { type: "postflop-first", board: flop }, "check", [...heroCards, ...flop]);
  range = observeFishAction(
    range,
    { type: "postflop-vs-bet", board: flop, betFraction: 0.33 },
    "call",
    [...heroCards, ...flop],
  );

  const turn = parseCards("Qs Ts 7h 2c", { exact: 4 });
  range = filterFishRange(range, [...heroCards, ...turn]);
  range = observeFishAction(range, { type: "postflop-first", board: turn }, "check", [...heroCards, ...turn]);
  range = observeFishAction(
    range,
    { type: "postflop-vs-bet", board: turn, betFraction: 0.75 },
    "call",
    [...heroCards, ...turn],
  );

  const river = parseCards("Qs Ts 7h 2c 3d", { exact: 5 });
  range = filterFishRange(range, [...heroCards, ...river]);
  range = observeFishAction(range, { type: "postflop-first", board: river }, "check", [...heroCards, ...river]);

  const blocked = new Set([...heroCards, ...river]);
  assert.ok(range.length > 0);
  assert.ok(Math.abs(totalProbability(range) - 1) < 1e-10);
  assert.ok(range.every((entry) => entry.probability > 0 && Number.isFinite(entry.probability)));
  assert.ok(range.every((entry) => !blocked.has(entry.cards[0]) && !blocked.has(entry.cards[1])));
});

test("river raising is strongly value-weighted in the modeled fish population", () => {
  const board = parseCards("Ac Kd 8h 2s 9c", { exact: 5 });
  const strong = createFishRange({ board }).find((entry) => entry.classLabel === "AA");
  const weak = createFishRange({ board }).find((entry) => entry.classLabel === "43o");
  const context = { type: "postflop-vs-bet", board, betFraction: 0.75 };
  assert.ok(strong && weak);
  assert.ok(
    fishActionProbabilities(strong, context).raise > fishActionProbabilities(weak, context).raise * 4,
  );
});
