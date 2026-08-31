/**
 * Transparent low-stakes loose-passive population model used by Beat Fish.
 *
 * This is deliberately a training archetype, not solver output and not a claim
 * about every low-stakes player. The key contract is easy to reason about:
 * every exact combo is either in the fish's range or it is not, and the same
 * range is filtered from preflop to river by blockers and observed actions.
 */

import {
  compareScores,
  createDeck,
  evaluate5,
  evaluate7,
  rankValue,
  suitIndex,
} from "./cards.js";
import { expandRange } from "./range.js";

export const FISH_PROFILE = Object.freeze({
  id: "line-aware-live-recreational-v9",
  label: "Line-aware low-stakes live recreational",
  description:
    "Understands position, sizing, dead money, and its own prior action, but has no balanced/GTO range construction: enters too wide, calls too much, gets mildly attached to recognizable premiums and good-looking suited broadways, and bluffs only in recognizable population lines rather than at equilibrium frequencies.",
  tendencies: Object.freeze([
    "Shows a high participation rate with much less raising",
    "Enters too many pots and calls opens or isolation raises too wide",
    "Uses wider value reraises against late opens, steals, and dead money",
    "Respects early opens and larger reraises more than late or small ones",
    "Does not release AK or suited AQ preflop after voluntarily building a pot",
    "Gives KJs, QJs, and JTs one extra call against a small reraise after entering, but releases them to larger 3-bets and every 4-bet",
    "Splits exact QQ and JJ combos between calls and 4-bets instead of treating either pair as a pure 4-bet",
    "Peels one extra small postflop bet with missed AK/AQ, but releases them to ordinary pressure",
    "Never turns TT or 99 into a 4-bet",
    "Checks medium showdown value instead of converting it into a balance bluff",
    "Judges every exact combo by the obvious hand, draw, kicker, board danger, and price it can see",
    "Calls pairs less often as the bet and street get larger",
    "Chases obvious flush and straight draws too often",
    "Stabs too much when checked to heads-up and over-bluffs some heads-up donk-bet lines",
    "Uses strong draws as occasional flop semi-bluff raises, but turn raises after prior aggression stay almost pure value",
    "Multiway donks, river stabs after passive action, and check-back-flop then raise-turn lines are strongly under-bluffed",
    "Can find the conspicuous nut-flush-blocker river bluff after carrying aggression through earlier streets",
    "Large river aggression remains heavily value-weighted outside those narrow blocker lines",
  ]),
});

const RANKS = "23456789TJQKA";
const CATEGORY_STRENGTH = Object.freeze([0.12, 0.38, 0.72, 0.80, 0.86, 0.90, 0.96, 0.99, 1]);
const CATEGORY_LABELS = Object.freeze([
  "high card",
  "one pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
]);
const STICKY_PREFLOP_PREMIUMS = new Set(["AKs", "AKo", "AQs"]);
const SHINY_SUITED_HANDS = new Set(["AJs", "ATs", "KQs", "KJs", "KTs", "QJs", "QTs", "JTs"]);
const SHINY_SMALL_RERAISE_CONTINUES = new Set(["KJs", "QJs", "JTs"]);
const RECOGNIZABLE_BIG_ACES = new Set(["AKs", "AKo", "AQs", "AQo"]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rankCharacterValue(rank) {
  return RANKS.indexOf(String(rank).toUpperCase()) + 2;
}

function classShape(classLabel) {
  const high = rankCharacterValue(classLabel[0]);
  const low = rankCharacterValue(classLabel[1]);
  const pair = classLabel.length === 2;
  const suited = classLabel.endsWith("s");
  const gap = pair ? 0 : Math.max(0, high - low - 1);
  return { high, low, pair, suited, gap };
}

/** A transparent 0..1 ordering used by the trainer's hero-facing preflop hints. */
export function preflopHandStrength(classLabel) {
  const { high, low, pair, suited, gap } = classShape(classLabel);
  if (pair) return clamp(0.45 + ((high - 2) / 12) * 0.55);

  let score = 0.08 + ((high - 2) / 12) * 0.46 + ((low - 2) / 12) * 0.20;
  if (suited) score += 0.075;
  if (gap === 0) score += 0.07;
  else if (gap === 1) score += 0.035;
  else score -= Math.min(0.13, gap * 0.018);
  if (high === 14) score += 0.07;
  if (high >= 12 && low >= 10) score += 0.07;
  return clamp(score);
}

function evaluateBest(cards) {
  if (cards.length === 5) return evaluate5(cards);
  if (cards.length === 7) return evaluate7(cards);
  if (cards.length !== 6) throw new Error("evaluateBest expects five, six, or seven cards.");
  let best = -1;
  for (let omitted = 0; omitted < cards.length; omitted += 1) {
    const five = cards.filter((_, index) => index !== omitted);
    best = Math.max(best, evaluate5(five));
  }
  return best;
}

/** Score the best hand that exists right now, without dealing future streets. */
export function currentHandScore(holeCards, board) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    throw new Error("Current hand scoring needs exactly two hole cards.");
  }
  if (!Array.isArray(board) || board.length < 3 || board.length > 5) {
    throw new Error("Current hand scoring needs a flop, turn, or river board.");
  }
  return evaluateBest([...holeCards, ...board]);
}

function scoreCategory(score) {
  return Math.floor(score / 15 ** 5);
}

function rankVariants(rank) {
  return rank === 14 ? [14, 1] : [rank];
}

function straightDrawType(holeCards, board) {
  const cards = [...holeCards, ...board];
  const rawRanks = [...new Set(cards.map(rankValue))];
  const ranks = new Set(rawRanks);
  if (ranks.has(14)) ranks.add(1);
  const boardRanks = new Set(board.flatMap((card) => rankVariants(rankValue(card))));
  const holeRanks = new Set(holeCards.flatMap((card) => rankVariants(rankValue(card))));
  let oneMissingWindows = 0;
  for (let start = 1; start <= 10; start += 1) {
    let missing = 0;
    let holeContributes = false;
    for (let rank = start; rank < start + 5; rank += 1) {
      if (!ranks.has(rank)) missing += 1;
      if (holeRanks.has(rank) && !boardRanks.has(rank)) holeContributes = true;
    }
    if (missing === 1 && holeContributes) oneMissingWindows += 1;
  }
  if (oneMissingWindows >= 2) return "open-ended";
  if (oneMissingWindows === 1) return "gutshot";
  return null;
}

function boardHasFourToStraight(board) {
  const ranks = new Set(board.flatMap((card) => rankVariants(rankValue(card))));
  for (let start = 1; start <= 10; start += 1) {
    let present = 0;
    for (let rank = start; rank < start + 5; rank += 1) {
      if (ranks.has(rank)) present += 1;
    }
    if (present >= 4) return true;
  }
  return false;
}

function pairTier(combo, board, category) {
  if (category !== 1) return null;
  const holeRanks = combo.cards.map(rankValue);
  const boardRanks = board.map(rankValue);
  const uniqueBoard = [...new Set(boardRanks)].sort((a, b) => b - a);

  if (holeRanks[0] === holeRanks[1]) {
    if (holeRanks[0] > Math.max(...boardRanks)) return "overpair";
    return "underpair";
  }

  const matched = holeRanks.filter((rank) => boardRanks.includes(rank));
  if (!matched.length) return "board-pair";
  const matchedRank = Math.max(...matched);
  const index = uniqueBoard.indexOf(matchedRank);
  if (index === 0) return "top-pair";
  if (index === uniqueBoard.length - 1) return "bottom-pair";
  return "middle-pair";
}

function highCardInfo(combo, board) {
  const holeRanks = combo.cards.map(rankValue).sort((a, b) => b - a);
  const boardHigh = board.length ? Math.max(...board.map(rankValue)) : 0;
  return {
    aceHigh: holeRanks[0] === 14,
    twoOvercards: board.length > 0 && holeRanks[1] > boardHigh,
    high: holeRanks[0],
    low: holeRanks[1],
  };
}

function rankCounts(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(rankValue(card), (counts.get(rankValue(card)) ?? 0) + 1);
  return counts;
}

function pairedBoardShowdownTier(combo, board) {
  const holeRanks = combo.cards.map(rankValue);
  const boardCounts = rankCounts(board);
  const singletonRanks = [...boardCounts]
    .filter(([, count]) => count === 1)
    .map(([rank]) => rank)
    .sort((left, right) => right - left);

  if (holeRanks[0] === holeRanks[1]) {
    const pairRank = holeRanks[0];
    if (pairRank > Math.max(...board.map(rankValue))) return "overpair";
    if (!singletonRanks.length || pairRank > singletonRanks[0]) return "middle-pair";
    return "underpair";
  }

  if (holeRanks.some((rank) => singletonRanks.includes(rank))) return "middle-pair";
  return "board-pair";
}

export function postflopHandFeatures(combo, board) {
  const cards = [...combo.cards, ...board];
  const score = evaluateBest(cards);
  const category = scoreCategory(score);
  const rawPair = pairTier(combo, board, category);
  const highCard = highCardInfo(combo, board);
  const boardCounts = rankCounts(board);
  const boardPaired = [...boardCounts.values()].some((count) => count >= 2);
  const boardTrips = [...boardCounts.values()].some((count) => count >= 3);
  const boardPlays = board.length === 5 && compareScores(score, evaluate5(board)) === 0;
  const boardMadeShowdown = boardPlays
    || (category === 2 && boardPaired)
    || (category === 3 && boardTrips);
  const aggressionTier = category >= 2 && !boardMadeShowdown ? "strong" : category >= 1 ? "showdown" : "air";
  const pair = rawPair ?? (boardMadeShowdown ? pairedBoardShowdownTier(combo, board) : null);
  const holeRanks = combo.cards.map(rankValue);
  const unpairedPremium = RECOGNIZABLE_BIG_ACES.has(combo.classLabel)
    && holeRanks[0] !== holeRanks[1]
    && holeRanks.every((rank) => !boardCounts.has(rank));

  const suitCounts = new Map();
  const boardSuitCounts = new Map();
  const holeSuitCounts = new Map();
  for (const card of cards) suitCounts.set(suitIndex(card), (suitCounts.get(suitIndex(card)) ?? 0) + 1);
  for (const card of board) boardSuitCounts.set(suitIndex(card), (boardSuitCounts.get(suitIndex(card)) ?? 0) + 1);
  for (const card of combo.cards) holeSuitCounts.set(suitIndex(card), (holeSuitCounts.get(suitIndex(card)) ?? 0) + 1);
  const flushDrawSuit = board.length < 5 && category < 5
    ? [...suitCounts].find(([suit, count]) => count === 4 && (holeSuitCounts.get(suit) ?? 0) > 0)?.[0]
    : undefined;
  const flushDraw = flushDrawSuit !== undefined;
  const nutFlushDraw = flushDraw
    && combo.cards.some((card) => suitIndex(card) === flushDrawSuit && rankValue(card) === 14);
  const straightDraw = board.length < 5 && category < 4 ? straightDrawType(combo.cards, board) : null;
  const maxBoardSuitCount = board.length ? Math.max(...boardSuitCounts.values()) : 0;
  const fourFlushBoard = maxBoardSuitCount >= 4;
  const threeFlushBoard = maxBoardSuitCount >= 3;
  const fourStraightBoard = boardHasFourToStraight(board);

  let kickerTier = null;
  if (["top-pair", "middle-pair", "bottom-pair"].includes(pair)) {
    const matchedRanks = new Set(board.map(rankValue));
    const kicker = holeRanks.find((rank) => !matchedRanks.has(rank)) ?? Math.min(...holeRanks);
    kickerTier = kicker >= 12 ? "strong" : kicker >= 9 ? "medium" : "weak";
  }

  let madeStrength = CATEGORY_STRENGTH[category] ?? 0.12;
  if (aggressionTier === "showdown") {
    madeStrength = {
      overpair: 0.64,
      "top-pair": 0.58,
      "middle-pair": 0.46,
      "bottom-pair": 0.39,
      underpair: 0.34,
      "board-pair": 0.24,
    }[pair] ?? madeStrength;
  }

  let drawStrength = 0;
  if (flushDraw) drawStrength += 0.20;
  if (straightDraw === "open-ended") drawStrength += 0.16;
  else if (straightDraw === "gutshot") drawStrength += 0.08;

  return {
    category,
    pairTier: pair,
    aggressionTier,
    boardMadeShowdown,
    unpairedPremium,
    flushDraw,
    nutFlushDraw,
    straightDraw,
    kickerTier,
    boardPaired,
    threeFlushBoard,
    fourFlushBoard,
    fourStraightBoard,
    aceHigh: highCard.aceHigh,
    twoOvercards: highCard.twoOvercards,
    madeStrength: clamp(madeStrength),
    drawStrength: clamp(drawStrength, 0, 0.36),
    continueStrength: clamp(madeStrength + drawStrength * 0.85),
  };
}

function pairTierLabel(pairTier) {
  return ({
    overpair: "overpair",
    "top-pair": "top pair",
    "middle-pair": "middle pair",
    "bottom-pair": "bottom pair",
    underpair: "small pocket pair",
    "board-pair": "the board's pair",
  })[pairTier] ?? "one pair";
}

/**
 * Describe the hand the way this recreational archetype is likely to see it.
 * This deliberately uses obvious labels rather than range-vs-range equity.
 */
export function fishPerceptionForCombo(combo, board = []) {
  if (!board.length) {
    const { pair, suited, gap } = classShape(combo.classLabel);
    const attachment = STICKY_PREFLOP_PREMIUMS.has(combo.classLabel)
      ? "recognizable premium"
      : SHINY_SUITED_HANDS.has(combo.classLabel)
        ? "good-looking suited hand"
      : pair
        ? "pocket pair"
        : suited && gap <= 1
          ? "playable suited connector"
          : suited
            ? "suited hand"
            : "two cards";
    return {
      label: `${combo.classLabel} · ${attachment}`,
      madeHand: attachment,
      draw: null,
      danger: "preflop action and price",
    };
  }

  const features = postflopHandFeatures(combo, board);
  let madeHand = CATEGORY_LABELS[features.category] ?? "made hand";
  if (features.aggressionTier === "showdown") {
    madeHand = pairTierLabel(features.pairTier);
    if (["top-pair", "middle-pair", "bottom-pair"].includes(features.pairTier) && features.kickerTier) {
      madeHand += ` with a ${features.kickerTier} kicker`;
    }
  } else if (features.category === 0 && features.unpairedPremium) {
    madeHand = "missed AK/AQ overcards";
  } else if (features.category === 0 && features.aceHigh) {
    madeHand = "ace high";
  }

  const draws = [];
  if (features.nutFlushDraw) draws.push("nut flush draw");
  else if (features.flushDraw) draws.push("flush draw");
  if (features.straightDraw === "open-ended") draws.push("open-ended straight draw");
  else if (features.straightDraw === "gutshot") draws.push("gutshot");

  const dangers = [];
  if (features.fourFlushBoard) dangers.push("four-flush board");
  else if (features.threeFlushBoard) dangers.push("three-flush board");
  if (features.fourStraightBoard) dangers.push("four-to-a-straight board");
  if (features.boardPaired) dangers.push("paired board");

  return {
    label: [madeHand, draws.length ? draws.join(" + ") : null].filter(Boolean).join(" + "),
    madeHand,
    draw: draws.length ? draws.join(" + ") : null,
    danger: dangers.length ? dangers.join(" and ") : "ordinary board texture",
    features,
  };
}

function fishDecision(action, perception, reason, details = {}) {
  return Object.freeze({
    action,
    perception: perception.label,
    reason,
    intent: details.intent ?? null,
    betFraction: details.betFraction ?? null,
  });
}

function preflopFishDecision(combo, context, action) {
  const perception = fishPerceptionForCombo(combo);
  const openBb = Number(context.openBb ?? context.threeBetBb ?? context.fourBetBb ?? 0);
  const mixedPairResponse = context.type === "preflop-vs-threebet"
    && ["QQ", "JJ"].includes(combo.classLabel)
    && ["raise", "call"].includes(action);
  if (mixedPairResponse) {
    return fishDecision(
      action,
      perception,
      action === "raise"
        ? `This exact ${combo.classLabel} combo represents the part of the recreational population that fast-plays the premium pair as a 4-bet. The suit assignment is only a deterministic visualization of player-to-player variation.`
        : `This exact ${combo.classLabel} combo represents the part of the recreational population that calls the 3-bet to see a flop rather than building a 4-bet pot. The suits themselves have no strategic significance.`,
    );
  }
  if (action === "raise") {
    return fishDecision(action, perception, "This looks like obvious value or a straightforward isolation spot, so the fish raises without constructing a balanced range.");
  }
  if (action === "call" && STICKY_PREFLOP_PREMIUMS.has(combo.classLabel)) {
    return fishDecision(action, perception, "The AK/AQ label is too recognizable to release preflop; the fish calls rather than finding a solver-style bluff reraise.");
  }
  if (action === "call" && SHINY_SUITED_HANDS.has(combo.classLabel)) {
    return fishDecision(action, perception, "The suited faces and connected ranks look especially playable, so the fish stretches to one more call when the price is not severe.");
  }
  if (action === "call") {
    const price = openBb >= 6.5 ? "expensive but still playable" : openBb >= 4.5 ? "a little expensive" : "affordable";
    return fishDecision(action, perception, `This hand looks ${price} and the fish would rather see cards than tighten its range.`);
  }
  if (action === "limp") {
    return fishDecision(action, perception, "The hand looks playable, but not strong enough to build a large pot, so the fish limps.");
  }
  if (action === "check") {
    return fishDecision(action, perception, "The fish takes the free option with a hand it would not raise.");
  }
  return fishDecision(action, perception, "Even through a loose recreational lens, this hand looks too weak for the action and price.");
}

function pairCallCap(features, street) {
  const caps = {
    overpair: { flop: 1.1, turn: 0.95, river: 0.75 },
    "top-pair": { flop: 1, turn: 0.85, river: 0.66 },
    "middle-pair": { flop: 0.72, turn: 0.56, river: 0.42 },
    "bottom-pair": { flop: 0.60, turn: 0.44, river: 0.32 },
    underpair: { flop: 0.42, turn: 0.30, river: 0.22 },
    "board-pair": { flop: 0.24, turn: 0.18, river: 0.12 },
  };
  let cap = caps[features.pairTier]?.[street] ?? 0;
  if (features.kickerTier === "strong") cap += 0.10;
  else if (features.kickerTier === "medium") cap += 0.04;
  else if (features.kickerTier === "weak") cap -= 0.08;
  if (features.fourFlushBoard || features.fourStraightBoard) cap -= 0.14;
  return Math.max(0, cap);
}

function drawCallCap(features, street) {
  if (street === "river") return 0;
  const flop = street === "flop";
  if (features.flushDraw && features.straightDraw === "open-ended") return flop ? 1.20 : 0.95;
  if (features.nutFlushDraw) return flop ? 1.05 : 0.85;
  if (features.flushDraw) return flop ? 0.92 : 0.72;
  if (features.straightDraw === "open-ended") return flop ? 0.82 : 0.62;
  if (features.straightDraw === "gutshot") return flop ? 0.40 : 0.27;
  return 0;
}

function raisesObviousValue(features, betFraction) {
  if (features.category >= 6) return true;
  if (features.category === 5) return !features.boardPaired || betFraction <= 0.75;
  if (features.category === 4) return !features.threeFlushBoard || betFraction <= 0.50;
  if ([2, 3].includes(features.category)) {
    return !features.fourFlushBoard && !features.fourStraightBoard;
  }
  return false;
}

function contextOpponentCount(context) {
  if (context.headsUp === true) return 1;
  return Math.max(1, Number(context.opponentCount ?? (context.type === "postflop-multiway-first" ? 2 : 1)));
}

function isHeadsUp(context) {
  return contextOpponentCount(context) === 1;
}

function dominantBoardSuit(board, minimum = 3) {
  const counts = new Map();
  for (const card of board) counts.set(suitIndex(card), (counts.get(suitIndex(card)) ?? 0) + 1);
  return [...counts].find(([, count]) => count >= minimum)?.[0] ?? null;
}

function hasNutFlushBlocker(combo, board) {
  const suit = dominantBoardSuit(board, 3);
  return suit !== null
    && combo.cards.some((card) => suitIndex(card) === suit && rankValue(card) === 14)
    && postflopHandFeatures(combo, board).category < 5;
}

function turnPairedBoard(board) {
  if (board.length !== 4) return false;
  const turnRank = rankValue(board[3]);
  return board.slice(0, 3).some((card) => rankValue(card) === turnRank);
}

function aceHighTurn(board) {
  return board.length === 4 && rankValue(board[3]) === 14;
}

function hasObviousDraw(features) {
  return features.flushDraw || Boolean(features.straightDraw);
}

function isStrongSemiBluff(features) {
  return (features.flushDraw && features.straightDraw === "open-ended")
    || (features.nutFlushDraw && Boolean(features.straightDraw));
}

function isHeadsUpDonkBluff(features, street) {
  if (street === "river" || features.aggressionTier === "showdown") return false;
  if (features.flushDraw || features.straightDraw) return true;
  return street === "flop" && (features.twoOvercards || features.aceHigh);
}

function isMergedHeadsUpDonkValue(features) {
  return features.pairTier === "bottom-pair"
    || (features.pairTier === "top-pair" && features.kickerTier === "weak");
}

function isCheckedToStab(features, street) {
  if (street === "river" || features.aggressionTier === "showdown") return false;
  if (hasObviousDraw(features)) return true;
  return street === "flop" && (features.twoOvercards || features.aceHigh);
}

function isNarrowRiverBlockerBluff(combo, board, context, features) {
  return board.length === 5
    && isHeadsUp(context)
    && features.aggressionTier === "air"
    && hasNutFlushBlocker(combo, board)
    && Number(context.barrelCount ?? 0) >= 2
    && context.previousFishAction === "bet"
    && context.passiveRiverStab !== true;
}

function isPremiumThreeBet(classLabel) {
  return ["AA", "KK", "QQ", "AKs", "AKo"].includes(classLabel);
}

function callsOpen(classLabel, openBb) {
  const { high, low, pair, suited, gap } = classShape(classLabel);
  const mediumOpen = openBb >= 4.5;
  const veryLargeOpen = openBb >= 6.5;

  if (pair) return true;
  if (high === 14 && (suited || low >= (veryLargeOpen ? 9 : mediumOpen ? 8 : 5))) return true;

  if (suited) {
    if (high === 13 && low >= (veryLargeOpen ? 10 : mediumOpen ? 8 : 5)) return true;
    if (high === 12 && low >= (veryLargeOpen ? 10 : mediumOpen ? 9 : 6)) return true;
    if (high === 11 && low >= (veryLargeOpen ? 10 : mediumOpen ? 9 : 6)) return true;
    if (high === 10 && low >= (veryLargeOpen ? 9 : mediumOpen ? 8 : 6)) return true;
    if (gap <= 1 && low >= (veryLargeOpen ? 7 : mediumOpen ? 6 : 4)) return true;
    if (!mediumOpen && gap <= 2 && high <= 11 && low >= 5) return true;
  }

  if (!suited) {
    if (high === 13 && low >= (veryLargeOpen ? 11 : 10)) return true;
    if (high === 12 && low >= (veryLargeOpen ? 11 : 10)) return true;
    if (high === 11 && low >= 10) return true;
    if (high === 10 && low >= 9) return true;
    if (!mediumOpen && high === 9 && low >= 8) return true;
  }

  return false;
}

function actionUnopened(classLabel) {
  return onlineFishUnopenedAction(classLabel, { position: "CO", type: "sixmax-unopened" });
}

const OBVIOUS_OPEN_RAISES = Object.freeze({
  UTG: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "ATs", "KQs", "KJs", "QJs"]),
  HJ: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "A9s", "KQs", "KQo", "KJs", "KTs", "QJs", "QTs", "JTs"]),
  CO: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "A9s", "A8s", "KQs", "KQo", "KJs", "KJo", "KTs", "QJs", "QJo", "QTs", "JTs", "T9s"]),
  BTN: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "A9s", "A9o", "A8s", "A8o", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s", "KQs", "KQo", "KJs", "KJo", "KTs", "KTo", "K9s", "K8s", "QJs", "QJo", "QTs", "QTo", "Q9s", "JTs", "JTo", "J9s", "T9s", "98s", "87s", "76s", "65s"]),
  SB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "A9s", "A9o", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s", "KQs", "KQo", "KJs", "KJo", "KTs", "KTo", "K9s", "QJs", "QJo", "QTs", "JTs", "T9s"]),
  BB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "A9s", "A9o", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s", "KQs", "KQo", "KJs", "KJo", "KTs", "KTo", "K9s", "QJs", "QJo", "QTs", "JTs", "T9s"]),
});

const ISOLATION_RAISE_ADDITIONS = Object.freeze({
  UTG: new Set([]),
  HJ: new Set(["66", "A8s", "K9s", "J9s", "T9s"]),
  CO: new Set(["55", "A7s", "A9o", "K9s", "Q9s", "J9s", "98s"]),
  BTN: new Set(["44", "33", "A7o", "K9o", "Q9o", "J8s", "T8s", "98o", "86s", "75s"]),
  SB: new Set(["55", "A8s", "A9o", "K9s", "Q9s", "J9s", "T9s"]),
  BB: new Set(["55", "A8s", "A9o", "K9s", "Q9s", "J9s", "T9s"]),
});

const THREE_BET_VS_OPENER = Object.freeze({
  UTG: new Set(["AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs", "AQo"]),
  HJ: new Set(["AA", "KK", "QQ", "JJ", "TT", "AKs", "AKo", "AQs", "AQo", "AJs", "KQs"]),
  CO: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "KQs", "KJs"]),
  BTN: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "KQs", "KQo", "KJs", "QJs"]),
  SB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "KQs", "KQo", "KJs", "QJs"]),
  BB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "KQs", "KQo", "KJs", "QJs"]),
});

const SQUEEZE_ADDITIONS = Object.freeze({
  UTG: new Set(["TT", "AJs", "KQs"]),
  HJ: new Set(["99", "AJo", "KJs", "QJs"]),
  CO: new Set(["88", "ATs", "KQo", "QJs", "JTs"]),
  BTN: new Set(["88", "A9s", "KTs", "QTs", "JTs", "T9s"]),
  SB: new Set(["88", "A9s", "KTs", "QTs", "JTs"]),
  BB: new Set(["88", "A9s", "KTs", "QTs", "JTs"]),
});

const LARGE_OPEN_RERAISE_EXCLUSIONS = new Set([
  "77", "88", "A9s", "ATo", "AJo", "KQo", "KTs", "KJs", "QTs", "QJs", "JTs", "T9s",
]);

function isLatePosition(position) {
  return ["CO", "BTN", "SB", "BB"].includes(position);
}

function loosePassiveEntry(classLabel, position, afterLimp) {
  const { high, low, pair, suited, gap } = classShape(classLabel);
  const later = ["CO", "BTN", "SB", "BB"].includes(position);
  if (pair) return true;
  if (suited && high === 14) return true;
  if (!suited && high === 14 && low >= (later || afterLimp ? 5 : 8)) return true;
  if (suited && high === 13 && low >= (later || afterLimp ? 4 : 7)) return true;
  if (suited && high === 12 && low >= (later || afterLimp ? 6 : 8)) return true;
  if (suited && high === 11 && low >= (later || afterLimp ? 6 : 8)) return true;
  if (suited && high === 10 && low >= (later || afterLimp ? 6 : 8)) return true;
  if (suited && gap <= (afterLimp ? 2 : 1) && low >= (later || afterLimp ? 4 : 5)) return true;
  if (!suited && high === 13 && low >= (later || afterLimp ? 9 : 10)) return true;
  if (!suited && high === 12 && low >= (later || afterLimp ? 9 : 10)) return true;
  if (!suited && high === 11 && low >= 9) return true;
  if (!suited && high === 10 && low >= 9 && (later || afterLimp)) return true;
  return false;
}

function onlineFishUnopenedAction(classLabel, context) {
  const position = context.position ?? "CO";
  const afterLimp = context.type === "sixmax-after-limp";
  const obviousRaises = OBVIOUS_OPEN_RAISES[position] ?? OBVIOUS_OPEN_RAISES.CO;
  const isolationAdds = ISOLATION_RAISE_ADDITIONS[position] ?? ISOLATION_RAISE_ADDITIONS.CO;
  if (obviousRaises.has(classLabel) || (afterLimp && isolationAdds.has(classLabel))) return "raise";
  return loosePassiveEntry(classLabel, position, afterLimp) ? "limp" : "fold";
}

function onlineFishFacingOpenAction(classLabel, context) {
  const openBb = Number(context.openBb ?? 4);
  const openerPosition = context.openerPosition ?? "CO";
  const position = context.position ?? "BB";
  const priorAction = context.priorAction ?? "none";
  const coldCallerCount = Math.max(0, Number(context.coldCallerCount ?? 0));

  if (priorAction === "limped") {
    const limpReraises = openBb >= 7
      ? new Set(["AA", "KK", "QQ", "AKs"])
      : new Set(["AA", "KK", "QQ", "JJ", "AKs", "AKo"]);
    if (limpReraises.has(classLabel)) return "raise";
    return callsOpen(classLabel, openBb) ? "call" : "fold";
  }

  const raises = new Set(THREE_BET_VS_OPENER[openerPosition] ?? THREE_BET_VS_OPENER.CO);
  if (coldCallerCount > 0) {
    for (const hand of SQUEEZE_ADDITIONS[openerPosition] ?? SQUEEZE_ADDITIONS.CO) raises.add(hand);
  }
  if (["SB", "BB"].includes(position) && isLatePosition(openerPosition)) {
    for (const hand of ["88", "A9s", "KTs", "QTs", "JTs"]) raises.add(hand);
  }
  if (openBb >= 5) {
    for (const hand of LARGE_OPEN_RERAISE_EXCLUSIONS) raises.delete(hand);
  }

  if (raises.has(classLabel)) return "raise";
  return callsOpen(classLabel, openBb) ? "call" : "fold";
}

const PAIR_MIX_ORDER = Object.freeze(["03", "12", "02", "13", "01", "23"]);

function pairMixIndex(combo) {
  const key = combo.cards.map(suitIndex).sort((a, b) => a - b).join("");
  return PAIR_MIX_ORDER.indexOf(key);
}

function mixedPairFourBet(combo, threeBetBb) {
  let mixesBySize = 0;
  if (combo.classLabel === "QQ") {
    mixesBySize = threeBetBb <= 16 ? 3 : threeBetBb < 20 ? 2 : 1;
  } else if (combo.classLabel === "JJ" && threeBetBb <= 16) {
    mixesBySize = 2;
  }

  const mixIndex = pairMixIndex(combo);
  return mixIndex >= 0 && mixIndex < mixesBySize;
}

function onlineFishFacingThreeBetAction(combo, context) {
  const classLabel = combo.classLabel;
  const threeBetBb = Number(context.threeBetBb ?? 16);
  const small = threeBetBb <= 16;
  const veryLarge = threeBetBb >= 20;
  const priorAction = context.priorAction ?? "opened";
  const lateThreeBettor = isLatePosition(context.threeBettorPosition ?? "BTN");
  const fourBets = new Set(["AA", "KK"]);

  if (priorAction === "opened") {
    fourBets.add("QQ");
    fourBets.add("AKs");
    if (!veryLarge || lateThreeBettor) fourBets.add("AKo");
    if (small && lateThreeBettor) {
      fourBets.add("JJ");
      fourBets.add("AQs");
    }
  } else if (priorAction === "cold-called" && small && lateThreeBettor) {
    fourBets.add("QQ");
    fourBets.add("AKs");
  } else if (["blind", "none"].includes(priorAction) && small) {
    fourBets.add("QQ");
  }

  // The model can widen logically, but it does not discover solver-style
  // TT/99 4-bets. Those hands remain calls or folds in every context.
  if (["QQ", "JJ"].includes(classLabel) && fourBets.has(classLabel)) {
    return mixedPairFourBet(combo, threeBetBb) ? "raise" : "call";
  }
  if (!["TT", "99"].includes(classLabel) && fourBets.has(classLabel)) return "raise";

  // Recognizable premiums are psychologically difficult for this profile to
  // release preflop. This is a call-floor, not an excuse to widen its 4-bets.
  if (STICKY_PREFLOP_PREMIUMS.has(classLabel)) return "call";

  // This is intentionally narrow and price-sensitive. A fish who has already
  // entered can get attached to suited Broadway-looking cards versus the
  // trainer's 16bb squeeze, but the attachment disappears at 18bb+ and never
  // creates a light 4-bet.
  const voluntarilyEntered = ["opened", "cold-called"].includes(priorAction);
  if (small && voluntarilyEntered && SHINY_SMALL_RERAISE_CONTINUES.has(classLabel)) return "call";

  if (priorAction === "opened") {
    if (veryLarge) {
      return ["QQ", "JJ", "TT", "AKs", "AKo", "AQs"].includes(classLabel) ? "call" : "fold";
    }
    return ["QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "KQs"].includes(classLabel)
      ? "call"
      : "fold";
  }

  if (priorAction === "cold-called") {
    const calls = veryLarge
      ? ["QQ", "JJ", "TT", "AKs", "AKo", "AQs"]
      : ["QQ", "JJ", "TT", "99", "AKs", "AKo", "AQs", "AQo", "AJs", "KQs"];
    return calls.includes(classLabel) ? "call" : "fold";
  }

  const coldCalls = veryLarge
    ? ["QQ", "JJ", "AKs", "AKo"]
    : ["QQ", "JJ", "TT", "AKs", "AKo", "AQs", "KQs"];
  return coldCalls.includes(classLabel) ? "call" : "fold";
}

function onlineFishFacingFourBetAction(classLabel, context) {
  const veryLarge = Number(context.fourBetBb ?? 35) >= 40;
  const priorAction = context.priorAction ?? "threebet";

  if (priorAction === "threebet") {
    if (["AA", "KK"].includes(classLabel)) return "raise";
    if (STICKY_PREFLOP_PREMIUMS.has(classLabel)) return "call";
    const calls = veryLarge
      ? ["QQ", "AKs", "AKo"]
      : ["QQ", "JJ", "AKs", "AKo", "AQs"];
    return calls.includes(classLabel) ? "call" : "fold";
  }

  if (priorAction === "opened") {
    if (classLabel === "AA") return "raise";
    if (STICKY_PREFLOP_PREMIUMS.has(classLabel)) return "call";
    const calls = veryLarge
      ? ["KK", "QQ", "AKs"]
      : ["KK", "QQ", "AKs", "AKo"];
    return calls.includes(classLabel) ? "call" : "fold";
  }

  if (["AA", "KK"].includes(classLabel)) return "raise";
  if (STICKY_PREFLOP_PREMIUMS.has(classLabel)) return "call";
  if (!veryLarge && ["QQ", "AKs", "AKo"].includes(classLabel)) return "call";
  if (veryLarge && ["QQ", "AKs"].includes(classLabel)) return "call";
  return "fold";
}

/**
 * Play one exact combo from the fish's point of view. The result contains the
 * action plus the simple, visible thought process that produced it.
 */
export function fishDecisionForCombo(combo, context = {}) {
  const type = context.type;

  if (type === "preflop-unopened") {
    return preflopFishDecision(combo, context, actionUnopened(combo.classLabel));
  }
  if (type === "sixmax-unopened" || type === "sixmax-after-limp") {
    return preflopFishDecision(combo, context, onlineFishUnopenedAction(combo.classLabel, context));
  }
  if (type === "sixmax-vs-open") {
    return preflopFishDecision(combo, context, onlineFishFacingOpenAction(combo.classLabel, context));
  }
  if (type === "preflop-vs-threebet") {
    return preflopFishDecision(combo, context, onlineFishFacingThreeBetAction(combo, context));
  }
  if (type === "preflop-vs-fourbet") {
    return preflopFishDecision(combo, context, onlineFishFacingFourBetAction(combo.classLabel, context));
  }

  if (type === "preflop-vs-open") {
    const normalized = {
      position: "BB",
      openerPosition: "CO",
      ...context,
    };
    return preflopFishDecision(combo, normalized, onlineFishFacingOpenAction(combo.classLabel, normalized));
  }

  const board = context.board ?? [];
  const features = postflopHandFeatures(combo, board);
  const perception = fishPerceptionForCombo(combo, board);
  const river = board.length === 5;
  const street = board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river";
  const headsUp = isHeadsUp(context);
  const checkedTo = context.checkedTo === true || context.inPosition === true;
  const donk = context.donk === true || (!checkedTo && context.wasPreflopAggressor === false);
  const observedBetFraction = Number(context.betFraction);
  const hasObservedBetSize = Number.isFinite(observedBetFraction);
  const observedSmallBet = !hasObservedBetSize || observedBetFraction <= 0.50;
  const observedLargeBet = !hasObservedBetSize || observedBetFraction >= 0.90;

  if (type === "postflop-multiway-first") {
    // Multiway donks are one of the live pool's most under-bluffed actions.
    // Heads-up is deliberately routed through the looser donk/stab rules below.
    if (headsUp && donk && observedSmallBet && isHeadsUpDonkBluff(features, street)) {
      const intent = hasObviousDraw(features) ? "semi-bluff" : "bluff";
      return fishDecision(
        "bet",
        perception,
        intent === "semi-bluff"
          ? `Heads-up, the fish overuses a donk with ${perception.draw}; this is a real semi-bluff line, not value.`
          : "Heads-up donk bets are one of the population's bluff-heavy lines, so obvious overcards or ace high can stab once.",
        { intent, betFraction: 0.33 },
      );
    }
    if (features.aggressionTier === "strong" && raisesObviousValue(features, 0.50)) {
      return fishDecision("bet", perception, `The fish sees ${perception.madeHand} as obvious multiway value and bets before another card can kill the action.`, { intent: "value", betFraction: 0.33 });
    }
    if (!river && features.nutFlushDraw && features.straightDraw === "open-ended") {
      return fishDecision("bet", perception, "Only the nut combo draw survives the model's multiway bluff filter; ordinary draws check because action behind is dangerous.", { intent: "semi-bluff", betFraction: 0.33 });
    }
    if (headsUp && donk && observedSmallBet && isMergedHeadsUpDonkValue(features)) {
      return fishDecision("bet", perception, `The fish uses a small heads-up donk as a merged protection/value bet with ${perception.madeHand}; it is not turning the pair into a bluff.`, { intent: "value", betFraction: 0.33 });
    }
    if (features.aggressionTier === "showdown") {
      return fishDecision("check", perception, `The fish wants to show down ${perception.madeHand} and checks rather than turning it into a multiway bluff.`);
    }
    return fishDecision("check", perception, `With several players involved, a donk would be strongly value-weighted. ${perception.label} does not clear that threshold.`);
  }

  if (type === "postflop-first") {
    // Aggression depends on how this opportunity arose. Live players stab too
    // often when checked to or when donking heads-up, but their multiway donks
    // and river stabs after passive action remain extremely honest.
    if (features.aggressionTier === "strong" && raisesObviousValue(features, 0.50)) {
      return fishDecision("bet", perception, `The fish sees ${perception.madeHand} as obvious value and bets to get paid or protect it.`, { intent: "value", betFraction: headsUp ? 0.66 : 0.33 });
    }

    if (observedLargeBet && isNarrowRiverBlockerBluff(combo, board, context, features)) {
      return fishDecision(
        "bet",
        perception,
        "The fish carried aggression through two streets and now recognizes the ace-of-suit blocker. This narrow, conspicuous river jam is the model's main pure-bluff exception.",
        { intent: "bluff", betFraction: 1.25 },
      );
    }

    if (river) {
      if (features.aggressionTier === "showdown") {
        return fishDecision("check", perception, `The fish takes ${perception.madeHand} to showdown instead of inventing a river bluff.`);
      }
      return fishDecision("check", perception, context.passiveRiverStab
        ? "After passive earlier streets, the live population under-bluffs this river stab; air checks again."
        : "Without the narrow nut-blocker barrel story, the fish gives up its river air.");
    }

    const panicSpr = Number(context.spr ?? Infinity) < 2;
    if (panicSpr && (features.nutFlushDraw || features.straightDraw === "open-ended")) {
      return fishDecision("bet", perception, "With less than two pots behind, the fish shoves the obvious strong draw to avoid a difficult river decision.", { intent: "semi-bluff", betFraction: 1 });
    }

    const pairedTurnBluff = features.aggressionTier === "air"
      && turnPairedBoard(board)
      && context.previousFishAction === "bet";
    const aceTurnBarrel = features.aggressionTier === "air"
      && aceHighTurn(board)
      && context.wasPreflopAggressor
      && context.previousFishAction === "bet";
    if (checkedTo && headsUp && (isCheckedToStab(features, street) || pairedTurnBluff || aceTurnBarrel)) {
      const intent = hasObviousDraw(features) ? "semi-bluff" : "bluff";
      const sizingFits = street === "flop" ? observedSmallBet : !hasObservedBetSize || observedBetFraction <= 0.75;
      if (sizingFits && (street === "flop" || pairedTurnBluff || aceTurnBarrel || hasObviousDraw(features))) {
        const reason = pairedTurnBluff
          ? "The turn paired, reducing obvious value combinations; this is a population bluff trigger after the flop stab."
          : aceTurnBarrel
            ? "As the preflop raiser, the fish over-barrels the ace turn because the card looks like it belongs to its range."
            : `${perception.label} takes the common heads-up checked-to stab; this range is intentionally wider than a multiway lead range.`;
        return fishDecision("bet", perception, reason, { intent, betFraction: street === "flop" ? 0.33 : 0.66 });
      }
    }

    if (donk && headsUp && observedSmallBet && isHeadsUpDonkBluff(features, street)) {
      const intent = hasObviousDraw(features) ? "semi-bluff" : "bluff";
      return fishDecision("bet", perception, `This is a heads-up donk, a line live players bluff much more often than its multiway version. ${perception.label} is the fish's obvious candidate.`, { intent, betFraction: 0.33 });
    }

    if (donk && headsUp && observedSmallBet && isMergedHeadsUpDonkValue(features)) {
      return fishDecision("bet", perception, `The small heads-up donk is a merged protection/value bet with ${perception.madeHand}; the fish is not converting showdown value into a bluff.`, { intent: "value", betFraction: 0.33 });
    }

    if (!headsUp && isStrongSemiBluff(features) && checkedTo) {
      return fishDecision("bet", perception, "The draw is strong enough to stab when checked to, but weaker multiway draws remain checks.", { intent: "semi-bluff", betFraction: 0.33 });
    }
    if (features.aggressionTier === "showdown") {
      return fishDecision("check", perception, `The fish wants to show down ${perception.madeHand}; it does not convert that hand into a bluff.`);
    }
    if (features.aggressionTier === "strong") {
      return fishDecision("check", perception, `The fish likes ${perception.madeHand}, but ${perception.danger} makes it cautious enough to check.`);
    }
    return fishDecision("check", perception, "Nothing looks strong enough to lead, so the passive default is to check.");
  }

  if (type === "postflop-vs-bet") {
    const betFraction = clamp(Number(context.betFraction ?? 0.66), 0.15, 2);

    // Raises remain value-heavy. The narrow exception is a visible strong draw
    // raising a small flop bet heads-up; turn raises after earlier aggression,
    // multiway raises, and river raises do not receive generic bluff combos.
    if (features.aggressionTier === "strong") {
      if (raisesObviousValue(features, betFraction)) {
        return fishDecision("raise", perception, `The fish sees ${perception.madeHand} as obvious value and raises without looking for a balanced bluff.`, { intent: "value" });
      }
      return fishDecision("call", perception, `The fish likes ${perception.madeHand}, but ${perception.danger} makes a call feel safer than a raise.`);
    }

    const flopSemiBluffRaise = street === "flop"
      && betFraction <= 0.50
      && (isStrongSemiBluff(features) || (headsUp && features.nutFlushDraw));
    if (flopSemiBluffRaise) {
      return fishDecision(
        "raise",
        perception,
        headsUp
          ? `The small flop bet triggers one of the fish's few credible bluff raises: ${perception.draw} looks strong enough to play fast.`
          : "Multiway, only the nut combo draw is allowed to take the rare semi-bluff raise; ordinary draws call or fold.",
        { intent: "semi-bluff" },
      );
    }

    // Calling-station behavior is still size- and street-sensitive. Medium
    // showdown value calls smaller bets but is never promoted into a bluff
    // merely because a paired board makes the evaluator say "two pair."
    const madeCap = pairCallCap(features, street);
    const drawCap = drawCallCap(features, street);
    if (features.aggressionTier === "showdown" && betFraction <= Math.max(madeCap, drawCap)) {
      return fishDecision("call", perception, `The fish sees ${perception.label} and the ${Math.round(betFraction * 100)}% pot price still feels affordable.`);
    }
    if (!river && drawCap > 0) {
      if (betFraction <= drawCap) {
        return fishDecision("call", perception, `The fish chases ${perception.draw} because the ${Math.round(betFraction * 100)}% pot price feels affordable.`);
      }
      return fishDecision("fold", perception, `The fish notices ${perception.draw}, but even a sticky chaser finds the ${Math.round(betFraction * 100)}% pot price too large.`);
    }
    if (features.unpairedPremium) {
      if (board.length === 3 && betFraction <= 0.42) {
        return fishDecision("call", perception, "The recognizable AK/AQ label earns one extra small flop peel, even though it missed.");
      }
      if (board.length === 4 && betFraction <= 0.24 && features.twoOvercards) {
        return fishDecision("call", perception, "Two big overcards earn one last tiny turn peel; ordinary pressure would end the attachment.");
      }
    }
    if (board.length === 3 && betFraction <= 0.24 && (features.aceHigh || features.twoOvercards)) {
      return fishDecision("call", perception, "The flop bet is tiny enough for the fish to peel obvious overcards once.");
    }
    if (features.aggressionTier === "showdown") {
      return fishDecision("fold", perception, `The fish would like to show down ${perception.madeHand}, but the price is beyond what that visible hand can justify.`);
    }
    return fishDecision("fold", perception, "The hand has no obvious pair or affordable draw, so the fish lets it go.");
  }

  if (type === "postflop-vs-raise") {
    const raiseFraction = clamp(Number(context.raiseFraction ?? 0.66), 0.15, 3);
    if (river) {
      if (features.aggressionTier === "strong") {
        return fishDecision("call", perception, `The fish cannot release ${perception.madeHand}, but does not invent a thin river reraise.`);
      }
      const cap = pairCallCap(features, street) * 0.55;
      if (["overpair", "top-pair"].includes(features.pairTier) && raiseFraction <= cap) {
        return fishDecision("call", perception, `The raise is small enough for the fish to pay off with ${perception.madeHand}.`);
      }
      return fishDecision("fold", perception, "A river raise looks heavily value-weighted, so the fish finally releases its bluff-catcher.");
    }
    if (features.aggressionTier === "strong") {
      return fishDecision("call", perception, `The fish is not folding ${perception.madeHand}, but passively calls instead of building a balanced reraising range.`);
    }
    const continueCap = Math.max(pairCallCap(features, street) * 0.75, drawCallCap(features, street) * 0.75);
    if (raiseFraction <= continueCap && (features.aggressionTier === "showdown" || drawCallCap(features, street) > 0)) {
      return fishDecision("call", perception, `The fish remains attached to ${perception.label} because the raise still looks affordable.`);
    }
    return fishDecision("fold", perception, "The raise makes the visible pair or draw feel too expensive, so the fish gives it up.");
  }

  throw new Error(`Unknown fish action context: ${type}`);
}

/**
 * Deterministic novice action rule. There is deliberately no mixed strategy:
 * for a given exact combo and public state this fish archetype takes one action.
 */
export function fishActionForCombo(combo, context = {}) {
  return fishDecisionForCombo(combo, context).action;
}

/** All unblocked exact combos are initially possible; there are no weights. */
export function createFishRange({ heroCards = [], board = [] } = {}) {
  return expandRange("random", [...heroCards, ...board]).map((combo) => ({ ...combo }));
}

export function filterFishRange(range, blockedCards = []) {
  const blocked = new Set(blockedCards);
  const filtered = range.filter(
    (entry) => !blocked.has(entry.cards[0]) && !blocked.has(entry.cards[1]),
  );
  if (!filtered.length) throw new Error("Fish range has no possible exact combos.");
  return filtered;
}

/** Keep only combos whose deterministic fish rule matches the observed action. */
export function observeFishAction(range, context, observedAction, blockedCards = []) {
  const unblocked = filterFishRange(range, blockedCards);
  const filtered = unblocked.filter((entry) => fishActionForCombo(entry, context) === observedAction);
  if (!filtered.length) {
    throw new Error(`No fish combos take ${observedAction} in this modeled spot.`);
  }
  return filtered;
}

/**
 * Split a binary range into the exact, mutually exclusive actions this model
 * takes in a spot. No combo is copied into multiple actions and no frequency
 * or probability is attached to an entry.
 */
export function partitionFishRange(range, context, blockedCards = []) {
  const partitions = {};
  for (const entry of filterFishRange(range, blockedCards)) {
    const action = fishActionForCombo(entry, context);
    (partitions[action] ??= []).push(entry);
  }
  return partitions;
}

/** Curate a hidden opponent hand that continues against every listed open. */
export function fishRangeContinuingVsOpenSizes(range, openBbs = [10 / 3, 5], blockedCards = []) {
  const unblocked = filterFishRange(range, blockedCards);
  const continuing = unblocked.filter((entry) => openBbs.every((openBb) =>
    fishActionForCombo(entry, { type: "preflop-vs-open", openBb }) !== "fold"));
  if (!continuing.length) throw new Error("No fish combos continue against every requested open size.");
  return continuing;
}

/** Pick one hidden exact combo uniformly from the current binary range. */
export function sampleFishCombo(range, random = Math.random) {
  if (!range.length) throw new Error("Cannot sample from an empty fish range.");
  const index = Math.min(range.length - 1, Math.floor(clamp(random(), 0, 0.999999999999) * range.length));
  return range[index];
}

/** Kept as a convenience for the trainer; the result is deterministic. */
export function sampleFishAction(combo, context) {
  return fishActionForCombo(combo, context);
}

export function fishRangeBucket(combo, board = []) {
  if (!board.length) {
    const strength = preflopHandStrength(combo.classLabel);
    const { pair, suited, gap } = classShape(combo.classLabel);
    if (isPremiumThreeBet(combo.classLabel) || strength >= 0.80) return "strong";
    if (pair || strength >= 0.58) return "medium";
    if (suited || gap <= 1) return "draw";
    return "weak";
  }

  const features = postflopHandFeatures(combo, board);
  if (features.aggressionTier === "strong") return "strong";
  if (features.aggressionTier === "showdown" && features.pairTier !== "board-pair") return "medium";
  if (features.flushDraw || features.straightDraw) return "draw";
  return "weak";
}

export function fishRangeBucketLabels(board = []) {
  if (!board.length) {
    return Object.freeze({
      strong: "Premium / obvious value",
      medium: "Pairs & strong high cards",
      draw: "Suited / connected",
      weak: "Loose marginal hands",
    });
  }
  return Object.freeze({
    strong: "Two pair+",
    medium: "One-pair showdown value",
    draw: "Flush / straight draws",
    weak: "Air / overcards",
  });
}

export function summarizeFishRange(range, board = []) {
  const byClass = new Map();
  const bucketCounts = { strong: 0, medium: 0, draw: 0, weak: 0 };

  for (const entry of range) {
    const bucket = fishRangeBucket(entry, board);
    bucketCounts[bucket] += 1;
    const current = byClass.get(entry.classLabel) ?? {
      count: 0,
      buckets: { strong: 0, medium: 0, draw: 0, weak: 0 },
    };
    current.count += 1;
    current.buckets[bucket] += 1;
    byClass.set(entry.classLabel, current);
  }

  return {
    comboCount: range.length,
    classCount: byClass.size,
    byClass: Object.fromEntries(byClass),
    bucketCounts,
  };
}

export function cloneFishRange(range) {
  return range.map((entry) => ({
    ...entry,
    cards: [...entry.cards],
  }));
}

function sampleRunout(board, heroCards, villainCards, random) {
  const deck = createDeck([...board, ...heroCards, ...villainCards]);
  const needed = 5 - board.length;
  const runout = [];
  for (let index = 0; index < needed; index += 1) {
    const chosen = index + Math.floor(random() * (deck.length - index));
    [deck[index], deck[chosen]] = [deck[chosen], deck[index]];
    runout.push(deck[index]);
  }
  return [...board, ...runout];
}

/** Estimate hero showdown equity treating every surviving combo as equally possible. */
export function estimateHeroEquity(heroCards, board, fishRange, { samples = 320, random = Math.random } = {}) {
  if (!fishRange.length) throw new Error("Cannot estimate equity against an empty fish range.");

  if (board.length === 5) {
    let equity = 0;
    for (const villain of fishRange) {
      const result = compareScores(
        evaluate7([...heroCards, ...board]),
        evaluate7([...villain.cards, ...board]),
      );
      equity += result > 0 ? 1 : result === 0 ? 0.5 : 0;
    }
    return clamp(equity / fishRange.length);
  }

  const trials = Math.max(40, Math.floor(samples));
  let equity = 0;
  for (let index = 0; index < trials; index += 1) {
    const villain = sampleFishCombo(fishRange, random);
    const fullBoard = sampleRunout(board, heroCards, villain.cards, random);
    const result = compareScores(
      evaluate7([...heroCards, ...fullBoard]),
      evaluate7([...villain.cards, ...fullBoard]),
    );
    equity += result > 0 ? 1 : result === 0 ? 0.5 : 0;
  }
  return clamp(equity / trials);
}

/** Estimate hero's share of a multiway showdown from independent per-seat marginal ranges. */
export function estimateHeroMultiwayEquity(
  heroCards,
  board,
  opponentRanges,
  { samples = 420, random = Math.random } = {},
) {
  const ranges = opponentRanges.filter((range) => range?.length);
  if (!ranges.length) throw new Error("Cannot estimate multiway equity without an opponent range.");
  const trials = Math.max(80, Math.floor(samples));
  let equity = 0;
  let completed = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const blocked = new Set([...heroCards, ...board]);
    const villains = [];
    let compatible = true;
    for (const range of ranges) {
      const available = range.filter((combo) => combo.cards.every((card) => !blocked.has(card)));
      if (!available.length) {
        compatible = false;
        break;
      }
      const villain = sampleFishCombo(available, random);
      villains.push(villain);
      villain.cards.forEach((card) => blocked.add(card));
    }
    if (!compatible) continue;

    const deck = createDeck([...blocked]);
    const fullBoard = [...board];
    while (fullBoard.length < 5) {
      const chosen = Math.floor(random() * deck.length);
      fullBoard.push(deck.splice(chosen, 1)[0]);
    }
    const heroScore = evaluate7([...heroCards, ...fullBoard]);
    const villainScores = villains.map((villain) => evaluate7([...villain.cards, ...fullBoard]));
    const bestVillain = villainScores.reduce((best, score) => compareScores(score, best) > 0 ? score : best);
    const versusBest = compareScores(heroScore, bestVillain);
    if (versusBest > 0) equity += 1;
    else if (versusBest === 0) {
      const tiedVillains = villainScores.filter((score) => compareScores(score, heroScore) === 0).length;
      equity += 1 / (tiedVillains + 1);
    }
    completed += 1;
  }
  if (!completed) throw new Error("No compatible multiway deals could be sampled from these ranges.");
  return clamp(equity / completed);
}
