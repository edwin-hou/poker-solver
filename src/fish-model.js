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
  id: "low-stakes-loose-passive-fish-v5",
  label: "Basic low-stakes loose-passive fish",
  description:
    "Understands position, sizing, dead money, and its own prior action, but has no balanced/GTO range construction: enters too wide, calls too much, gets mildly attached to recognizable premiums, defaults to check/call, and keeps reraises value-heavy.",
  tendencies: Object.freeze([
    "Shows a high participation rate with much less raising",
    "Enters too many pots and calls opens or isolation raises too wide",
    "Uses wider value reraises against late opens, steals, and dead money",
    "Respects early opens and larger reraises more than late or small ones",
    "Does not release AK or suited AQ preflop after voluntarily building a pot",
    "Peels one extra small postflop bet with missed AK/AQ, but releases them to ordinary pressure",
    "Never turns TT or 99 into a 4-bet",
    "Checks medium showdown value instead of converting it into a balance bluff",
    "Calls pairs less often as the bet and street get larger",
    "Chases obvious flush and straight draws too often",
    "Raises strong made hands far more often than bluffs",
    "Large river aggression is heavily value-weighted",
  ]),
});

const RANKS = "23456789TJQKA";
const CATEGORY_STRENGTH = Object.freeze([0.12, 0.38, 0.72, 0.80, 0.86, 0.90, 0.96, 0.99, 1]);
const STICKY_PREFLOP_PREMIUMS = new Set(["AKs", "AKo", "AQs"]);
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

function scoreCategory(score) {
  return Math.floor(score / 15 ** 5);
}

function straightDrawType(cards) {
  const rawRanks = [...new Set(cards.map(rankValue))];
  const ranks = new Set(rawRanks);
  if (ranks.has(14)) ranks.add(1);
  let oneMissingWindows = 0;
  for (let start = 1; start <= 10; start += 1) {
    let missing = 0;
    for (let rank = start; rank < start + 5; rank += 1) {
      if (!ranks.has(rank)) missing += 1;
    }
    if (missing === 1) oneMissingWindows += 1;
  }
  if (oneMissingWindows >= 2) return "open-ended";
  if (oneMissingWindows === 1) return "gutshot";
  return null;
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
  for (const card of cards) suitCounts.set(suitIndex(card), (suitCounts.get(suitIndex(card)) ?? 0) + 1);
  const flushDraw = board.length < 5 && category < 5 && Math.max(...suitCounts.values()) === 4;
  const straightDraw = board.length < 5 && category < 4 ? straightDrawType(cards) : null;

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
    straightDraw,
    aceHigh: highCard.aceHigh,
    twoOvercards: highCard.twoOvercards,
    madeStrength: clamp(madeStrength),
    drawStrength: clamp(drawStrength, 0, 0.36),
    continueStrength: clamp(madeStrength + drawStrength * 0.85),
  };
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
  UTG: new Set(["AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs", "AQo", "KQs"]),
  HJ: new Set(["AA", "KK", "QQ", "JJ", "TT", "AKs", "AKo", "AQs", "AQo", "AJs", "KQs"]),
  CO: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "KQs", "KJs", "QJs"]),
  BTN: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "ATo", "KQs", "KQo", "KJs", "QJs", "JTs"]),
  SB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "KQs", "KJs", "QJs", "JTs"]),
  BB: new Set(["AA", "KK", "QQ", "JJ", "TT", "99", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo", "ATs", "KQs", "KJs", "QJs", "JTs"]),
});

const ISOLATION_RAISE_ADDITIONS = Object.freeze({
  UTG: new Set([]),
  HJ: new Set(["99", "AQo", "AJs", "KQs"]),
  CO: new Set(["88", "AQo", "AJo", "KQo", "QJs", "JTs"]),
  BTN: new Set(["77", "A9s", "AJo", "KQo", "KTs", "QTs", "T9s"]),
  SB: new Set(["88", "AQo", "AJo", "KQo", "KTs", "QJs"]),
  BB: new Set(["88", "AQo", "AJo", "KQo", "KTs", "QJs"]),
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

function onlineFishFacingThreeBetAction(classLabel, context) {
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
  if (!["TT", "99"].includes(classLabel) && fourBets.has(classLabel)) return "raise";

  // Recognizable premiums are psychologically difficult for this profile to
  // release preflop. This is a call-floor, not an excuse to widen its 4-bets.
  if (STICKY_PREFLOP_PREMIUMS.has(classLabel)) return "call";

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
 * Deterministic novice action rule. There is deliberately no mixed strategy:
 * for a given exact combo and public state this fish archetype takes one action.
 */
export function fishActionForCombo(combo, context = {}) {
  const type = context.type;

  if (type === "preflop-unopened") return actionUnopened(combo.classLabel);
  if (type === "sixmax-unopened" || type === "sixmax-after-limp") {
    return onlineFishUnopenedAction(combo.classLabel, context);
  }
  if (type === "sixmax-vs-open") return onlineFishFacingOpenAction(combo.classLabel, context);
  if (type === "preflop-vs-threebet") return onlineFishFacingThreeBetAction(combo.classLabel, context);
  if (type === "preflop-vs-fourbet") return onlineFishFacingFourBetAction(combo.classLabel, context);

  if (type === "preflop-vs-open") {
    return onlineFishFacingOpenAction(combo.classLabel, {
      position: "BB",
      openerPosition: "CO",
      ...context,
    });
  }

  const board = context.board ?? [];
  const features = postflopHandFeatures(combo, board);
  const river = board.length === 5;

  // Practice pots check through to the in-position hero. This keeps the
  // multiway tree focused on facing each hero sizing without inventing a
  // separate multi-opponent donk/raise equilibrium.
  if (type === "postflop-multiway-first") return "check";

  if (type === "postflop-first") {
    // The passive default is check. Obvious monsters and huge combo draws are
    // the main hands this archetype decides it needs to "protect" by betting.
    if (features.aggressionTier === "strong") return "bet";
    if (!river && features.flushDraw && features.straightDraw === "open-ended") return "bet";
    return "check";
  }

  if (type === "postflop-vs-bet") {
    const betFraction = clamp(Number(context.betFraction ?? 0.66), 0.15, 2);

    // Raises are simple and face-up: strong made hands, with essentially no
    // river bluff-raising. This is the most important exploitable tendency.
    if (features.aggressionTier === "strong") return "raise";

    // Calling-station behavior is still size- and street-sensitive. Medium
    // showdown value calls smaller bets but is never promoted into a bluff
    // merely because a paired board makes the evaluator say "two pair."
    const street = board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river";
    const pairCallCaps = {
      overpair: { flop: 1.1, turn: 0.95, river: 0.75 },
      "top-pair": { flop: 1, turn: 0.85, river: 0.66 },
      "middle-pair": { flop: 0.72, turn: 0.56, river: 0.42 },
      "bottom-pair": { flop: 0.60, turn: 0.44, river: 0.32 },
      underpair: { flop: 0.42, turn: 0.30, river: 0.22 },
      "board-pair": { flop: 0.24, turn: 0.18, river: 0.12 },
    };
    const pairCallCap = pairCallCaps[features.pairTier]?.[street] ?? 0;
    if (features.aggressionTier === "showdown" && betFraction <= pairCallCap) return "call";
    if (!river && (features.flushDraw || features.straightDraw)) {
      return betFraction <= 1 ? "call" : "fold";
    }
    if (features.unpairedPremium) {
      if (board.length === 3 && betFraction <= 0.42) return "call";
      if (board.length === 4 && betFraction <= 0.24 && features.twoOvercards) return "call";
    }
    if (board.length === 3 && betFraction <= 0.24 && (features.aceHigh || features.twoOvercards)) return "call";
    return "fold";
  }

  if (type === "postflop-vs-raise") {
    if (river) {
      if (features.aggressionTier === "strong") return "call";
      if (["overpair", "top-pair"].includes(features.pairTier)) return "call";
      return "fold";
    }
    if (features.aggressionTier === "strong") return "call";
    if (["overpair", "top-pair", "middle-pair"].includes(features.pairTier)) return "call";
    if (features.flushDraw || features.straightDraw === "open-ended") return "call";
    return "fold";
  }

  throw new Error(`Unknown fish action context: ${type}`);
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
