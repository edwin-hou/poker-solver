import test from "node:test";
import assert from "node:assert/strict";

import {
  createFishRange,
  filterFishRange,
  fishActionForCombo,
  fishRangeBucket,
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

test("preflop fish policy is deterministic with wide calls and value-heavy 3-bets", () => {
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

test("loose-passive blinds call 77 instead of manufacturing a light 3-bet", () => {
  const prior = createFishRange({ heroCards: parseCards("As Qd", { exact: 2 }) });
  const sevens = firstClass(prior, "77");
  assert.ok(sevens);
  assert.equal(fishActionForCombo(sevens, {
    type: "preflop-vs-open",
    position: "BB",
    openerPosition: "CO",
    openBb: 10 / 3,
  }), "call");
  assert.equal(fishActionForCombo(sevens, {
    type: "sixmax-vs-open",
    position: "BB",
    openerPosition: "BTN",
    openBb: 2.5,
    coldCallerCount: 1,
  }), "call");
});

test("low-stakes fish reraises are premium-heavy and never 4-bet TT or 99", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const aa = firstClass(prior, "AA");
  const kk = firstClass(prior, "KK");
  const qq = firstClass(prior, "QQ");
  const tt = firstClass(prior, "TT");
  const nines = firstClass(prior, "99");
  assert.ok(aa && kk && qq && tt && nines);

  const facingSmallThreeBet = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 16,
    priorAction: "opened",
  };
  assert.equal(fishActionForCombo(aa, facingSmallThreeBet), "raise");
  assert.equal(fishActionForCombo(kk, facingSmallThreeBet), "raise");
  assert.equal(fishActionForCombo(qq, facingSmallThreeBet), "raise");
  assert.equal(fishActionForCombo(tt, facingSmallThreeBet), "call");
  assert.equal(fishActionForCombo(nines, facingSmallThreeBet), "call");

  const facingLargeThreeBet = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 20,
    priorAction: "opened",
  };
  assert.notEqual(fishActionForCombo(tt, facingLargeThreeBet), "raise");
  assert.notEqual(fishActionForCombo(nines, facingLargeThreeBet), "raise");

  const facingFourBet = { type: "preflop-vs-fourbet", fourBetBb: 35 };
  assert.equal(fishActionForCombo(aa, facingFourBet), "raise");
  assert.equal(fishActionForCombo(kk, facingFourBet), "raise");
  assert.equal(fishActionForCombo(qq, facingFourBet), "call");
  assert.equal(fishActionForCombo(tt, facingFourBet), "fold");
  assert.equal(fishActionForCombo(nines, facingFourBet), "fold");
});

test("recognizable AK and suited AQ never fold preflop but do not become automatic reraises", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const premiums = ["AKs", "AKo", "AQs"].map((label) => firstClass(prior, label));
  assert.ok(premiums.every(Boolean));

  const largeColdThreeBet = {
    type: "preflop-vs-threebet",
    position: "BB",
    threeBettorPosition: "UTG",
    threeBetBb: 22,
    priorAction: "blind",
  };
  const largeFourBet = {
    type: "preflop-vs-fourbet",
    fourBetBb: 42,
    priorAction: "threebet",
  };

  for (const combo of premiums) {
    assert.equal(fishActionForCombo(combo, largeColdThreeBet), "call");
    assert.equal(fishActionForCombo(combo, largeFourBet), "call");
  }
});

test("low-stakes fish reraises react to opener position, dead money, sizing, and prior action", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const tt = firstClass(prior, "TT");
  const eights = firstClass(prior, "88");
  const qq = firstClass(prior, "QQ");
  const jj = firstClass(prior, "JJ");
  assert.ok(tt && eights && qq && jj);

  const versusUtg = {
    type: "sixmax-vs-open",
    position: "CO",
    openerPosition: "UTG",
    openBb: 4,
    coldCallerCount: 0,
  };
  assert.equal(fishActionForCombo(tt, versusUtg), "call");
  assert.equal(fishActionForCombo(tt, { ...versusUtg, coldCallerCount: 1 }), "raise");

  const versusButtonSteal = {
    type: "sixmax-vs-open",
    position: "BB",
    openerPosition: "BTN",
    openBb: 2.5,
    coldCallerCount: 0,
  };
  assert.equal(fishActionForCombo(eights, versusButtonSteal), "raise");
  assert.notEqual(fishActionForCombo(eights, { ...versusButtonSteal, openBb: 6 }), "raise");

  const openedFacingSmallLateThreeBet = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 16,
    priorAction: "opened",
  };
  const coldCallerFacingSame = { ...openedFacingSmallLateThreeBet, priorAction: "cold-called" };
  assert.equal(fishActionForCombo(jj, openedFacingSmallLateThreeBet), "raise");
  assert.equal(fishActionForCombo(jj, coldCallerFacingSame), "call");
  assert.equal(fishActionForCombo(qq, coldCallerFacingSame), "raise");
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

test("missed AK and AQ peel only unusually small postflop bets", () => {
  const flop = parseCards("9c 6d 2s", { exact: 3 });
  const range = createFishRange({ board: flop });
  const aceKing = firstClass(range, "AKo");
  const aceQueen = firstClass(range, "AQs");
  assert.ok(aceKing && aceQueen);

  for (const combo of [aceKing, aceQueen]) {
    assert.equal(
      fishActionForCombo(combo, { type: "postflop-vs-bet", board: flop, betFraction: 0.33 }),
      "call",
    );
    assert.equal(
      fishActionForCombo(combo, { type: "postflop-vs-bet", board: flop, betFraction: 0.50 }),
      "fold",
    );
  }

  const turn = parseCards("9c 6d 2s 3h", { exact: 4 });
  assert.equal(
    fishActionForCombo(aceKing, { type: "postflop-vs-bet", board: turn, betFraction: 0.20 }),
    "call",
  );
  assert.equal(
    fishActionForCombo(aceKing, { type: "postflop-vs-bet", board: turn, betFraction: 0.33 }),
    "fold",
  );
});

test("paired-board pocket pairs remain showdown value and never become two-pair bluffs", () => {
  const flop = parseCards("Kc Kd 8h", { exact: 3 });
  const range = createFishRange({ board: flop });
  const sevens = firstClass(range, "77");
  assert.ok(sevens);

  assert.equal(fishRangeBucket(sevens, flop), "medium");
  assert.equal(fishActionForCombo(sevens, { type: "postflop-first", board: flop }), "check");
  assert.equal(
    fishActionForCombo(sevens, { type: "postflop-vs-bet", board: flop, betFraction: 0.33 }),
    "call",
  );
  assert.equal(
    fishActionForCombo(sevens, { type: "postflop-vs-bet", board: flop, betFraction: 0.75 }),
    "fold",
  );

  const river = parseCards("Kc Kd 8h 2s 3c", { exact: 5 });
  assert.equal(fishActionForCombo(sevens, { type: "postflop-first", board: river }), "check");
  assert.notEqual(
    fishActionForCombo(sevens, { type: "postflop-vs-bet", board: river, betFraction: 0.75 }),
    "raise",
  );
});

test("genuine two pair still takes the fish model's face-up value line", () => {
  const board = parseCards("Qc 8d 2s", { exact: 3 });
  const range = createFishRange({ board });
  const queenEight = firstClass(range, "Q8s");
  assert.ok(queenEight);
  assert.equal(fishRangeBucket(queenEight, board), "strong");
  assert.equal(fishActionForCombo(queenEight, { type: "postflop-first", board }), "bet");
  assert.equal(
    fishActionForCombo(queenEight, { type: "postflop-vs-bet", board, betFraction: 0.75 }),
    "raise",
  );
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
