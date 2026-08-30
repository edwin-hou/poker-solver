import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeck,
  createFishRange,
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
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "limped",
    random: seededRandom(42),
  });
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
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "limped",
    random: seededRandom(9),
  });

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

test("raised-pot practice includes an early open, cold call, and position-aware squeeze responses", () => {
  const heroCards = parseCards("Qs Jd", { exact: 2 });
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "raised",
    random: seededRandom(12),
  });
  const early = scenario.opponents.filter((opponent) => ["utg", "hj", "co"].includes(opponent.id));
  const opener = scenario.opponents.find((opponent) => opponent.id === scenario.openerId);
  const caller = early.find((opponent) => opponent.preflopAction === "call");

  assert.equal(scenario.kind, "raised");
  assert.equal(early.filter((opponent) => opponent.preflopAction === "raise").length, 1);
  assert.equal(early.filter((opponent) => opponent.preflopAction === "call").length, 1);
  assert.ok(early.some((opponent) => opponent.preflopAction === "fold"));
  assert.equal(scenario.startingPot, 30);
  assert.ok(opener);
  assert.ok(caller);

  for (const target of [scenario.smallTarget, scenario.largeTarget]) {
    for (const opponent of [opener, caller]) {
      assert.equal(fishActionForCombo(opponent.combo, {
        type: "preflop-vs-threebet",
        position: opponent.position,
        threeBettorPosition: "BTN",
        threeBetBb: target / 3,
      }), "call");
    }
  }
});

test("3-bet practice realizes an early re-raise and keeps both BTN 4-bet sizes multiway", () => {
  const heroCards = parseCards("7s 6s", { exact: 2 });
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "threebet",
    random: seededRandom(23),
  });
  const opener = scenario.opponents.find((opponent) => opponent.id === scenario.openerId);
  const threeBettor = scenario.opponents.find((opponent) => opponent.id === scenario.threeBettorId);
  const early = scenario.opponents.filter((opponent) => ["utg", "hj", "co"].includes(opponent.id));

  assert.equal(scenario.kind, "threebet");
  assert.equal(early.filter((opponent) => opponent.preflopAction === "raise").length, 2);
  assert.ok(early.some((opponent) => opponent.preflopAction === "fold"));
  assert.equal(scenario.startingPot, 60);
  assert.ok(opener);
  assert.ok(threeBettor);
  assert.equal(fishActionForCombo(opener.combo, {
    type: "preflop-vs-threebet",
    position: opener.position,
    threeBettorPosition: threeBettor.position,
    threeBetBb: scenario.threeBetAmount / 3,
  }), "call");

  for (const target of [scenario.smallTarget, scenario.largeTarget]) {
    for (const opponent of [opener, threeBettor]) {
      assert.equal(fishActionForCombo(opponent.combo, {
        type: "preflop-vs-fourbet",
        position: opponent.position,
        fourBettorPosition: "BTN",
        fourBetBb: target / 3,
      }), "call");
    }
  }
});

test("early-seat model exposes every legal fold, limp, raise, call, and re-raise bucket", () => {
  const heroCards = parseCards("As Kd", { exact: 2 });
  const range = createFishRange({ heroCards });
  const contexts = [
    {
      context: { type: "sixmax-unopened", position: "UTG", openBb: 4 },
      actions: ["fold", "limp", "raise"],
    },
    {
      context: { type: "sixmax-after-limp", position: "HJ", openBb: 4 },
      actions: ["fold", "limp", "raise"],
    },
    {
      context: { type: "sixmax-vs-open", position: "CO", openerPosition: "UTG", openBb: 4 },
      actions: ["fold", "call", "raise"],
    },
    {
      context: { type: "preflop-vs-threebet", position: "UTG", threeBettorPosition: "BTN", threeBetBb: 16 },
      actions: ["fold", "call", "raise"],
    },
    {
      context: { type: "preflop-vs-fourbet", position: "CO", fourBettorPosition: "BTN", fourBetBb: 35 },
      actions: ["fold", "call", "raise"],
    },
  ];

  for (const { context, actions } of contexts) {
    const partitions = partitionFishRange(range, context, heroCards);
    assert.equal(actions.reduce((sum, action) => sum + partitions[action].length, 0), range.length);
    assert.ok(actions.every((action) => partitions[action].length > 0));
  }
});

test("multiway equity samples compatible exact combos from every active marginal range", () => {
  const heroCards = parseCards("As Kd", { exact: 2 });
  const board = parseCards("Qs Ts 7h", { exact: 3 });
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "raised",
    random: seededRandom(17),
  });
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
  const scenario = createSixHandedPracticeScenario({
    heroCards,
    scenarioKind: "limped",
    random: seededRandom(5),
  });
  const board = createDeck([
    ...heroCards,
    ...scenario.opponents.flatMap((opponent) => opponent.combo.cards),
  ]).slice(0, 3);
  const context = { type: "postflop-multiway-first", board };

  assert.ok(scenario.opponents.every((opponent) => fishActionForCombo(opponent.combo, context) === "check"));
});
