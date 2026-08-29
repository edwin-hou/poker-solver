/**
 * Transparent loose-passive live $1/$2/$3 population model used by Beat Fish.
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
  id: "live-123-basic-fish-v2",
  label: "Basic loose-passive live $1/$2/$3 fish",
  description:
    "Understands the rules and obvious hand strength, but has no balanced/GTO range construction: enters too wide, calls too much, defaults to check/call, chases obvious draws, and gets value-heavy when raising.",
  tendencies: Object.freeze([
    "Enters too many pots and calls opens too wide",
    "Rarely 3-bets without an obvious premium",
    "Checks and calls medium-strength hands",
    "Chases obvious flush and straight draws too often",
    "Raises strong made hands far more often than bluffs",
    "Large river aggression is heavily value-weighted",
  ]),
});

const RANKS = "23456789TJQKA";
const CATEGORY_STRENGTH = Object.freeze([0.12, 0.38, 0.72, 0.80, 0.86, 0.90, 0.96, 0.99, 1]);

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

export function postflopHandFeatures(combo, board) {
  const cards = [...combo.cards, ...board];
  const score = evaluateBest(cards);
  const category = scoreCategory(score);
  const pair = pairTier(combo, board, category);
  const highCard = highCardInfo(combo, board);

  const suitCounts = new Map();
  for (const card of cards) suitCounts.set(suitIndex(card), (suitCounts.get(suitIndex(card)) ?? 0) + 1);
  const flushDraw = board.length < 5 && category < 5 && Math.max(...suitCounts.values()) === 4;
  const straightDraw = board.length < 5 && category < 4 ? straightDrawType(cards) : null;

  let madeStrength = CATEGORY_STRENGTH[category] ?? 0.12;
  if (category === 1) {
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
  const largeOpen = openBb >= 4.5;

  if (pair) return true;
  if (high === 14 && (suited || low >= (largeOpen ? 8 : 5))) return true;

  if (suited) {
    if (high === 13 && low >= (largeOpen ? 8 : 5)) return true;
    if (high === 12 && low >= (largeOpen ? 9 : 6)) return true;
    if (high === 11 && low >= (largeOpen ? 9 : 6)) return true;
    if (high === 10 && low >= (largeOpen ? 8 : 6)) return true;
    if (gap <= 1 && low >= (largeOpen ? 6 : 4)) return true;
    if (!largeOpen && gap <= 2 && high <= 11 && low >= 5) return true;
  }

  if (!suited) {
    if (high === 13 && low >= 10) return true;
    if (high === 12 && low >= 10) return true;
    if (high === 11 && low >= 10) return true;
    if (high === 10 && low >= 9) return true;
    if (!largeOpen && high === 9 && low >= 8) return true;
  }

  return false;
}

/**
 * Deterministic novice action rule. There is deliberately no mixed strategy:
 * for a given exact combo and public state this fish archetype takes one action.
 */
export function fishActionForCombo(combo, context = {}) {
  const type = context.type;

  if (type === "preflop-vs-open") {
    const openBb = clamp(Number(context.openBb ?? 3.3), 1.5, 8);
    if (isPremiumThreeBet(combo.classLabel)) return "raise";
    return callsOpen(combo.classLabel, openBb) ? "call" : "fold";
  }

  const board = context.board ?? [];
  const features = postflopHandFeatures(combo, board);
  const river = board.length === 5;

  if (type === "postflop-first") {
    // The passive default is check. Obvious monsters and huge combo draws are
    // the main hands this archetype decides it needs to "protect" by betting.
    if (features.category >= 2) return "bet";
    if (!river && features.flushDraw && features.straightDraw === "open-ended") return "bet";
    return "check";
  }

  if (type === "postflop-vs-bet") {
    const betFraction = clamp(Number(context.betFraction ?? 0.66), 0.15, 2);

    // Raises are simple and face-up: strong made hands, with essentially no
    // river bluff-raising. This is the most important exploitable tendency.
    if (river) {
      if (features.category >= 2) return "raise";
    } else if (features.category >= 2) {
      return "raise";
    }

    // Calling station behavior: private-card pairs hang on, obvious draws
    // chase too much, and small flop bets even get peeled by ace-high / overs.
    if (features.category === 1 && features.pairTier !== "board-pair") return "call";
    if (!river && (features.flushDraw || features.straightDraw)) {
      return betFraction <= 1 ? "call" : "fold";
    }
    if (!river && betFraction <= 0.36 && (features.aceHigh || features.twoOvercards)) return "call";
    return "fold";
  }

  if (type === "postflop-vs-raise") {
    if (river) {
      if (features.category >= 2) return "call";
      if (["overpair", "top-pair"].includes(features.pairTier)) return "call";
      return "fold";
    }
    if (features.category >= 2) return "call";
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
  if (features.category >= 2) return "strong";
  if (features.category === 1 && features.pairTier !== "board-pair") return "medium";
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
