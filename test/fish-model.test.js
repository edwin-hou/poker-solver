import test from "node:test";
import assert from "node:assert/strict";

import {
  createFishRange,
  filterFishRange,
  fishActionForCombo,
  fishDecisionForCombo,
  fishPerceptionForCombo,
  fishRangeBucket,
  observeFishAction,
  parseCard,
  parseCards,
  summarizeFishRange,
} from "../src/index.js";

function firstClass(range, label) {
  return range.find((entry) => entry.classLabel === label);
}

function exactCombo(range, text) {
  const cards = new Set(parseCards(text, { exact: 2 }));
  return range.find((entry) => entry.cards.every((card) => cards.has(card)));
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

test("a 150bb shove narrows sticky preflop continues to exact premium combos", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const context = {
    type: "preflop-vs-open",
    position: "BB",
    openerPosition: "BTN",
    openBb: 150,
    priorAction: "limped",
    allIn: true,
  };
  const expectedCalls = { AA: 6, KK: 6, QQ: 5, JJ: 2, AKs: 4, AKo: 8 };
  for (const [classLabel, count] of Object.entries(expectedCalls)) {
    const combos = prior.filter((combo) => combo.classLabel === classLabel);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, context) === "call").length, count);
  }
  assert.ok(prior.filter((combo) => combo.classLabel === "TT")
    .every((combo) => fishActionForCombo(combo, context) === "fold"));
  assert.match(
    fishDecisionForCombo(firstClass(prior, "AA"), context).reason,
    /strong enough to call the 150bb all-in/,
  );
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

test("low-stakes fish mixes exact QQ/JJ combos while never 4-betting TT or 99", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const aa = firstClass(prior, "AA");
  const kk = firstClass(prior, "KK");
  const qq = firstClass(prior, "QQ");
  const queens = prior.filter((combo) => combo.classLabel === "QQ");
  const jacks = prior.filter((combo) => combo.classLabel === "JJ");
  const tt = firstClass(prior, "TT");
  const nines = firstClass(prior, "99");
  assert.ok(aa && kk && qq && tt && nines && queens.length === 6 && jacks.length === 6);

  const facingSmallThreeBet = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 16,
    priorAction: "opened",
  };
  assert.equal(fishActionForCombo(aa, facingSmallThreeBet), "raise");
  assert.equal(fishActionForCombo(kk, facingSmallThreeBet), "raise");
  assert.equal(queens.filter((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "raise").length, 3);
  assert.equal(queens.filter((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "call").length, 3);
  assert.equal(jacks.filter((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "raise").length, 2);
  assert.equal(jacks.filter((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "call").length, 4);
  assert.equal(fishActionForCombo(tt, facingSmallThreeBet), "call");
  assert.equal(fishActionForCombo(nines, facingSmallThreeBet), "call");
  assert.match(fishDecisionForCombo(queens.find((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "raise"), facingSmallThreeBet).reason, /deterministic visualization/);
  assert.match(fishDecisionForCombo(jacks.find((combo) => fishActionForCombo(combo, facingSmallThreeBet) === "call"), facingSmallThreeBet).reason, /suits themselves have no strategic significance/);

  const facingLargeThreeBet = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 20,
    priorAction: "opened",
  };
  assert.equal(queens.filter((combo) => fishActionForCombo(combo, facingLargeThreeBet) === "raise").length, 1);
  assert.equal(jacks.filter((combo) => fishActionForCombo(combo, facingLargeThreeBet) === "raise").length, 0);
  assert.notEqual(fishActionForCombo(tt, facingLargeThreeBet), "raise");
  assert.notEqual(fishActionForCombo(nines, facingLargeThreeBet), "raise");

  const facingFourBet = { type: "preflop-vs-fourbet", fourBetBb: 35 };
  assert.equal(fishActionForCombo(aa, facingFourBet), "raise");
  assert.equal(fishActionForCombo(kk, facingFourBet), "raise");
  assert.equal(fishActionForCombo(qq, facingFourBet), "call");
  assert.equal(fishActionForCombo(tt, facingFourBet), "call");
  assert.equal(prior.filter((combo) => combo.classLabel === "99" && fishActionForCombo(combo, facingFourBet) === "call").length, 3);
  assert.notEqual(fishActionForCombo(nines, facingFourBet), "raise");
});

test("recreational first-in raises include mixed trashy favorites without becoming any-two-card opens", () => {
  const range = createFishRange();
  const raiseCounts = Object.fromEntries(["UTG", "HJ", "CO", "BTN", "SB"].map((position) => [
    position,
    range.filter((combo) => fishActionForCombo(combo, {
      type: "sixmax-unopened",
      position,
      openBb: 4,
    }) === "raise").length,
  ]));

  assert.deepEqual(raiseCounts, { UTG: 125, HJ: 180, CO: 258, BTN: 412, SB: 296 });
  assert.ok(raiseCounts.UTG < raiseCounts.HJ && raiseCounts.HJ < raiseCounts.CO && raiseCounts.CO < raiseCounts.BTN);

  const aceJack = firstClass(range, "AJs");
  const suitedConnector = firstClass(range, "65s");
  const trash = firstClass(range, "72o");
  assert.equal(fishActionForCombo(aceJack, { type: "sixmax-unopened", position: "UTG" }), "raise");
  assert.equal(fishActionForCombo(suitedConnector, { type: "sixmax-unopened", position: "BTN" }), "raise");
  assert.equal(fishActionForCombo(trash, { type: "sixmax-unopened", position: "BTN" }), "fold");

  const utgContext = { type: "sixmax-unopened", position: "UTG" };
  const mixedClasses = { "22": [1, 5], A5s: [1, 3], T9s: [2, 2] };
  for (const [classLabel, [raises, passive]] of Object.entries(mixedClasses)) {
    const combos = range.filter((combo) => combo.classLabel === classLabel);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, utgContext) === "raise").length, raises);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, utgContext) === "limp").length, passive);
  }
  const mixedDeuces = range.filter((combo) => combo.classLabel === "22");
  assert.match(fishDecisionForCombo(mixedDeuces.find((combo) => fishActionForCombo(combo, utgContext) === "raise"), utgContext).reason, /deterministic population split/);
  assert.match(fishDecisionForCombo(mixedDeuces.find((combo) => fishActionForCombo(combo, utgContext) === "limp"), utgContext).reason, /passive part of the recreational population/);
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

test("good-looking suited hands remain sticky at declining exact frequencies versus reraises", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const shiny = Object.fromEntries(["KJs", "QJs", "JTs"].map((label) => [
    label,
    prior.filter((combo) => combo.classLabel === label),
  ]));
  const offsuit = ["KJo", "QJo"].map((label) => firstClass(prior, label));
  assert.ok([...Object.values(shiny).flat(), ...offsuit].every(Boolean));

  const smallSqueeze = {
    type: "preflop-vs-threebet",
    position: "CO",
    threeBettorPosition: "BTN",
    threeBetBb: 16,
    priorAction: "cold-called",
    openerPosition: "HJ",
    coldCallerCount: 1,
  };
  const mediumSqueeze = { ...smallSqueeze, threeBetBb: 18 };
  const fourBet = {
    type: "preflop-vs-fourbet",
    position: "CO",
    fourBettorPosition: "BTN",
    fourBetBb: 35,
    priorAction: "threebet",
  };

  const expectedCounts = {
    KJs: { small: 4, medium: 3, fourBet: 3 },
    QJs: { small: 4, medium: 2, fourBet: 2 },
    JTs: { small: 4, medium: 2, fourBet: 1 },
  };
  for (const [label, combos] of Object.entries(shiny)) {
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, smallSqueeze) === "call").length, expectedCounts[label].small);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, mediumSqueeze) === "call").length, expectedCounts[label].medium);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, fourBet) === "call").length, expectedCounts[label].fourBet);
  }
  const calledKingJack = shiny.KJs.find((combo) => fishActionForCombo(combo, fourBet) === "call");
  assert.match(fishDecisionForCombo(calledKingJack, fourBet).reason, /already investing.*good-looking suited hand/);
  assert.ok(offsuit.every((combo) => fishActionForCombo(combo, smallSqueeze) === "fold"));
});

test("150bb fish overcalls 3-bets with pairs and suited implied-odds hands without widening 4-bets", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const context = {
    type: "preflop-vs-threebet",
    position: "HJ",
    threeBettorPosition: "BTN",
    threeBetBb: 18,
    priorAction: "opened",
  };
  const expectedCalls = { "77": 5, "66": 4, "55": 3, A5s: 3, A4s: 2, T9s: 3, "98s": 2 };
  for (const [label, count] of Object.entries(expectedCalls)) {
    const combos = prior.filter((combo) => combo.classLabel === label);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, context) === "call").length, count);
    assert.ok(combos.every((combo) => fishActionForCombo(combo, context) !== "raise"));
  }
});

test("facing a normal 4-bet, the prior 3-bettor calls a sticky but still bounded fringe", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const normal = { type: "preflop-vs-fourbet", fourBetBb: 35, priorAction: "threebet" };
  const large = { ...normal, fourBetBb: 42 };
  const expected = {
    TT: [6, 3], "99": [3, 1], AQo: [8, 5], AJs: [4, 2], KQs: [4, 3], KJs: [3, 1],
  };
  for (const [label, [normalCalls, largeCalls]] of Object.entries(expected)) {
    const combos = prior.filter((combo) => combo.classLabel === label);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, normal) === "call").length, normalCalls);
    assert.equal(combos.filter((combo) => fishActionForCombo(combo, large) === "call").length, largeCalls);
    assert.ok(combos.every((combo) => fishActionForCombo(combo, normal) !== "raise"));
  }
});

test("low-stakes fish reraises react to opener position, dead money, sizing, and prior action", () => {
  const prior = createFishRange({ heroCards: parseCards("2c 3d", { exact: 2 }) });
  const tens = prior.filter((combo) => combo.classLabel === "TT");
  const kingQueenSuited = prior.filter((combo) => combo.classLabel === "KQs");
  const eights = firstClass(prior, "88");
  const queens = prior.filter((combo) => combo.classLabel === "QQ");
  const jacks = prior.filter((combo) => combo.classLabel === "JJ");
  assert.ok(tens.length === 6 && kingQueenSuited.length === 4 && eights && queens.length === 6 && jacks.length === 6);

  const versusUtg = {
    type: "sixmax-vs-open",
    position: "CO",
    openerPosition: "UTG",
    openBb: 4,
    coldCallerCount: 0,
  };
  assert.equal(tens.filter((combo) => fishActionForCombo(combo, versusUtg) === "raise").length, 2);
  assert.equal(tens.filter((combo) => fishActionForCombo(combo, versusUtg) === "call").length, 4);
  assert.equal(kingQueenSuited.filter((combo) => fishActionForCombo(combo, versusUtg) === "raise").length, 1);
  assert.equal(kingQueenSuited.filter((combo) => fishActionForCombo(combo, versusUtg) === "call").length, 3);
  const squeezed = { ...versusUtg, coldCallerCount: 1 };
  assert.equal(tens.filter((combo) => fishActionForCombo(combo, squeezed) === "raise").length, 3);
  assert.equal(kingQueenSuited.filter((combo) => fishActionForCombo(combo, squeezed) === "raise").length, 2);
  assert.match(fishDecisionForCombo(tens.find((combo) => fishActionForCombo(combo, squeezed) === "raise"), squeezed).reason, /occasional live recreational reraise/);

  const largeEarlyOpen = { ...versusUtg, openBb: 6 };
  assert.equal(tens.filter((combo) => fishActionForCombo(combo, largeEarlyOpen) === "raise").length, 1);
  assert.ok(kingQueenSuited.every((combo) => fishActionForCombo(combo, largeEarlyOpen) === "call"));

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
  assert.equal(jacks.filter((combo) => fishActionForCombo(combo, openedFacingSmallLateThreeBet) === "raise").length, 2);
  assert.ok(jacks.every((combo) => fishActionForCombo(combo, coldCallerFacingSame) === "call"));
  assert.equal(queens.filter((combo) => fishActionForCombo(combo, coldCallerFacingSame) === "raise").length, 3);
  assert.equal(queens.filter((combo) => fishActionForCombo(combo, coldCallerFacingSame) === "call").length, 3);
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

test("the fish perspective evaluates exact suits instead of assigning one action to a whole class", () => {
  const flop = parseCards("Qs 7s 2s", { exact: 3 });
  const range = createFishRange({ board: flop });
  const nutDrawAceKing = exactCombo(range, "As Kh");
  const noSpadeAceKing = exactCombo(range, "Ac Kh");
  const context = { type: "postflop-vs-bet", board: flop, betFraction: 0.75 };
  assert.ok(nutDrawAceKing && noSpadeAceKing);

  const drawDecision = fishDecisionForCombo(nutDrawAceKing, context);
  const overcardDecision = fishDecisionForCombo(noSpadeAceKing, context);
  assert.equal(drawDecision.action, "call");
  assert.match(drawDecision.perception, /nut flush draw/);
  assert.equal(overcardDecision.action, "fold");
  assert.match(overcardDecision.perception, /missed AK\/AQ/);
  assert.equal(fishActionForCombo(nutDrawAceKing, context), drawDecision.action);
  assert.ok(drawDecision.reason.length > 20);
});

test("board-only draw texture is scary but is not mistaken for the fish's own draw", () => {
  const turn = parseCards("Qs 7s 2s 3s", { exact: 4 });
  const range = createFishRange({ board: turn });
  const noSpade = exactCombo(range, "Jh Td");
  assert.ok(noSpade);

  const perception = fishPerceptionForCombo(noSpade, turn);
  assert.equal(perception.features.flushDraw, false);
  assert.match(perception.danger, /four-flush board/);
  assert.equal(
    fishActionForCombo(noSpade, { type: "postflop-vs-bet", board: turn, betFraction: 0.20 }),
    "fold",
  );
});

test("a shiny preflop premium is relabeled when it makes a real postflop hand", () => {
  const board = parseCards("9d Ks 3d Jd Ts", { exact: 5 });
  const range = createFishRange({ board });
  const aceQueen = exactCombo(range, "As Qs");
  assert.ok(aceQueen);

  const perception = fishPerceptionForCombo(aceQueen, board);
  assert.equal(perception.madeHand, "straight");
  assert.doesNotMatch(perception.label, /missed AK\/AQ/);
});

test("the fish distinguishes an affordable gutshot from an overpriced chase", () => {
  const flop = parseCards("9c 8d 2s", { exact: 3 });
  const range = createFishRange({ board: flop });
  const gutshot = exactCombo(range, "Jh 7h");
  assert.ok(gutshot);
  assert.match(fishPerceptionForCombo(gutshot, flop).draw, /gutshot/);
  assert.equal(
    fishActionForCombo(gutshot, { type: "postflop-vs-bet", board: flop, betFraction: 0.33 }),
    "call",
  );
  assert.equal(
    fishActionForCombo(gutshot, { type: "postflop-vs-bet", board: flop, betFraction: 0.50 }),
    "fold",
  );
});

test("obvious kicker quality changes how sticky the fish is with top pair", () => {
  const flop = parseCards("Ac 7d 2s", { exact: 3 });
  const range = createFishRange({ board: flop });
  const strongKicker = exactCombo(range, "Ah Qh");
  const weakKicker = exactCombo(range, "Ad 5d");
  const context = { type: "postflop-vs-bet", board: flop, betFraction: 0.95 };
  assert.ok(strongKicker && weakKicker);
  assert.match(fishPerceptionForCombo(strongKicker, flop).label, /strong kicker/);
  assert.match(fishPerceptionForCombo(weakKicker, flop).label, /weak kicker/);
  assert.equal(fishActionForCombo(strongKicker, context), "call");
  assert.equal(fishActionForCombo(weakKicker, context), "fold");
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

test("heads-up donk bluffs stay small while the same air checks multiway", () => {
  const board = parseCards("9c 6d 2s", { exact: 3 });
  const range = createFishRange({ board });
  const overcards = exactCombo(range, "Ah Kd");
  const weakTopPair = exactCombo(range, "9h 5d");
  assert.ok(overcards && weakTopPair);

  const smallHeadsUpDonk = {
    type: "postflop-first",
    board,
    headsUp: true,
    opponentCount: 1,
    donk: true,
    wasPreflopAggressor: false,
    betFraction: 0.33,
  };
  const decision = fishDecisionForCombo(overcards, smallHeadsUpDonk);
  assert.equal(decision.action, "bet");
  assert.equal(decision.intent, "bluff");
  assert.match(decision.reason, /heads-up donk/i);

  assert.equal(fishActionForCombo(overcards, { ...smallHeadsUpDonk, betFraction: 0.75 }), "check");
  assert.equal(fishActionForCombo(overcards, {
    ...smallHeadsUpDonk,
    type: "postflop-multiway-first",
    headsUp: false,
    opponentCount: 3,
  }), "check");
  assert.equal(fishDecisionForCombo(weakTopPair, smallHeadsUpDonk).intent, "value");
  assert.equal(fishActionForCombo(weakTopPair, smallHeadsUpDonk), "bet");
  assert.equal(fishActionForCombo(weakTopPair, {
    ...smallHeadsUpDonk,
    type: "postflop-multiway-first",
    headsUp: false,
    opponentCount: 3,
  }), "check");
});

test("small flop bets can trigger a draw raise but turn and multiway raises remain value-heavy", () => {
  const flop = parseCards("Qs 7s 2s", { exact: 3 });
  const turn = parseCards("Qs 7s 2s 9d", { exact: 4 });
  const range = createFishRange({ board: flop });
  const nutDraw = exactCombo(range, "As Kh");
  assert.ok(nutDraw);

  const headsUpFlop = fishDecisionForCombo(nutDraw, {
    type: "postflop-vs-bet",
    board: flop,
    betFraction: 0.33,
    headsUp: true,
    opponentCount: 1,
  });
  assert.equal(headsUpFlop.action, "raise");
  assert.equal(headsUpFlop.intent, "semi-bluff");

  assert.equal(fishActionForCombo(nutDraw, {
    type: "postflop-vs-bet",
    board: flop,
    betFraction: 0.33,
    headsUp: false,
    opponentCount: 3,
  }), "call");
  assert.equal(fishActionForCombo(nutDraw, {
    type: "postflop-vs-bet",
    board: turn,
    betFraction: 0.33,
    headsUp: true,
    opponentCount: 1,
    previousFishAction: "call",
  }), "call");
});

test("recognizable turn bluff triggers do not turn showdown value into a bluff", () => {
  const aceTurn = parseCards("9c 6d 2s Ah", { exact: 4 });
  const pairedTurn = parseCards("Qc 8d 2s 8h", { exact: 4 });
  const range = createFishRange({ board: aceTurn });
  const kingQueen = exactCombo(range, "Kh Qd");
  const sevens = exactCombo(range, "7c 7d");
  assert.ok(kingQueen && sevens);

  const aceBarrel = fishDecisionForCombo(kingQueen, {
    type: "postflop-first",
    board: aceTurn,
    checkedTo: true,
    inPosition: true,
    headsUp: true,
    wasPreflopAggressor: true,
    previousFishAction: "bet",
    betFraction: 0.66,
  });
  assert.equal(aceBarrel.action, "bet");
  assert.equal(aceBarrel.intent, "bluff");
  assert.match(aceBarrel.reason, /ace turn/i);

  const pairedTurnSevens = exactCombo(createFishRange({ board: pairedTurn }), "7c 7d");
  assert.ok(pairedTurnSevens);
  assert.equal(fishActionForCombo(pairedTurnSevens, {
    type: "postflop-first",
    board: pairedTurn,
    checkedTo: true,
    headsUp: true,
    previousFishAction: "bet",
  }), "check");
});

test("river blocker bluff requires carried aggression and a large size", () => {
  const river = parseCards("Ks 7s 2h 9d 3s", { exact: 5 });
  const range = createFishRange({ board: river });
  const blocker = exactCombo(range, "As Qh");
  assert.ok(blocker);

  const carriedLine = {
    type: "postflop-first",
    board: river,
    headsUp: true,
    checkedTo: true,
    inPosition: true,
    previousFishAction: "bet",
    barrelCount: 2,
    betFraction: 1.25,
  };
  const decision = fishDecisionForCombo(blocker, carriedLine);
  assert.equal(decision.action, "bet");
  assert.equal(decision.intent, "bluff");
  assert.match(decision.reason, /nut-blocker|blocker/i);

  assert.equal(fishActionForCombo(blocker, { ...carriedLine, betFraction: 0.50 }), "check");
  assert.equal(fishActionForCombo(blocker, { ...carriedLine, barrelCount: 0, passiveRiverStab: true }), "check");
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
