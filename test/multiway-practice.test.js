import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeck,
  createSixHandedPracticeScenario,
  estimateHeroMultiwayEquity,
  fishActionForCombo,
  parseCards,
  partitionFishRange,
} from "../src/index.js";

function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

test("six-handed practice deals five distinct opponents and preserves real blind commitments", () => {
  const heroCards = parseCards("As Kd", { exact: 2 });
  const scenario = createSixHandedPracticeScenario({ heroCards, random: seededRandom(42) });
  const dealt = [...heroCards, ...scenario.opponents.flatMap((opponent) => opponent.combo.cards)];
  const early = scenario.opponents.filter((opponent) => ["utg", "hj", "co"].includes(opponent.id));

  assert.deepEqual(scenario.opponents.map((opponent) => opponent.position), ["UTG", "HJ", "CO", "SB", "BB"]);
  assert.equal(new Set(dealt).size, dealt.length);
  assert.ok([1, 2].includes(early.filter((opponent) => !opponent.folded).length));
  assert.ok(early.some((opponent) => opponent.folded));
  assert.equal(scenario.heroCommitted, 1);
  assert.equal(scenario.opponents.find((opponent) => opponent.id === "sb").committed, 2);
  assert.equal(scenario.opponents.find((opponent) => opponent.id === "bb").committed, 3);
  assert.equal(scenario.startingPot, 6 + scenario.limperCount * 3);
  assert.ok(scenario.opponents.every((opponent) => opponent.range.every((combo) => !("probability" in combo))));
});

test("both isolation sizings create a genuinely multiway flop without curated premium 3-bets", () => {
  const heroCards = parseCards("Qs Jd", { exact: 2 });
  const scenario = createSixHandedPracticeScenario({ heroCards, random: seededRandom(9) });

  for (const target of [scenario.smallTarget, scenario.largeTarget]) {
    const actions = scenario.opponents
      .filter((opponent) => !opponent.folded)
      .map((opponent) => fishActionForCombo(opponent.combo, {
        type: "preflop-vs-open",
        openBb: target / 3,
      }));
    assert.ok(actions.filter((action) => action === "call").length >= 2);
    assert.ok(!actions.includes("raise"));
  }

  const bigBlindRange = scenario.opponents.find((opponent) => opponent.id === "bb").range;
  const smallResponses = partitionFishRange(
    bigBlindRange,
    { type: "preflop-vs-open", openBb: scenario.smallTarget / 3 },
    heroCards,
  );
  const largeResponses = partitionFishRange(
    bigBlindRange,
    { type: "preflop-vs-open", openBb: scenario.largeTarget / 3 },
    heroCards,
  );
  assert.ok(smallResponses.call.length > largeResponses.call.length);
  assert.ok(smallResponses.fold.length < largeResponses.fold.length);
});

test("multiway equity samples compatible exact combos from every active marginal range", () => {
  const heroCards = parseCards("As Kd", { exact: 2 });
  const board = parseCards("Qs Ts 7h", { exact: 3 });
  const scenario = createSixHandedPracticeScenario({ heroCards, random: seededRandom(17) });
  const ranges = scenario.opponents.filter((opponent) => !opponent.folded).map((opponent) => opponent.range);
  const equity = estimateHeroMultiwayEquity(heroCards, board, ranges, {
    samples: 100,
    random: seededRandom(31),
  });

  assert.ok(Number.isFinite(equity));
  assert.ok(equity >= 0 && equity <= 1);
  assert.ok(ranges.length >= 3, "the pre-isolation table should include limpers plus both blinds");
});

test("multiway players check through to the in-position practice decision", () => {
  const heroCards = parseCards("2c 3d", { exact: 2 });
  const scenario = createSixHandedPracticeScenario({ heroCards, random: seededRandom(5) });
  const board = createDeck([
    ...heroCards,
    ...scenario.opponents.flatMap((opponent) => opponent.combo.cards),
  ]).slice(0, 3);
  const context = { type: "postflop-multiway-first", board };

  assert.ok(scenario.opponents.every((opponent) => fishActionForCombo(opponent.combo, context) === "check"));
});
