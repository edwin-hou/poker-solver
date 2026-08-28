/**
 * Transparent loose-passive live $1/$2/$3 population model used by Beat Fish.
 *
 * This is deliberately a training model, not a solver or a claim about every
 * low-stakes player. The important contract is consistency: one weighted exact
 * combo range is carried from preflop to river and Bayesian-updated after every
 * observed fish action.
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
  id: "live-123-loose-passive-v1",
  label: "Loose-passive live $1/$2/$3",
  description:
    "Calls too many hands preflop, 3-bets too little, continues too many pairs and draws, and arrives at large river aggression under-bluffed.",
  tendencies: Object.freeze([
    "Wide preflop calls",
    "Low preflop 3-bet frequency",
    "Too many flop and turn calls",
    "Passive with medium-strength showdown value",
    "River raises strongly value-weighted",
  ]),
});

const EPSILON = 1e-12;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeProbabilities(probabilities) {
  const entries = Object.entries(probabilities);
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0);
  if (total <= EPSILON) {
    const uniform = 1 / entries.length;
    return Object.fromEntries(entries.map(([key]) => [key, uniform]));
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, Math.max(0, value) / total]));
}

export function preflopHandStrength(classLabel) {
  const high = rankCharacterValue(classLabel[0]);
  const low = rankCharacterValue(classLabel[1]);
  const pair = classLabel.length === 2;
  const suited = classLabel.endsWith("s");
  if (pair) return clamp(0.45 + ((high - 2) / 12) * 0.55);

  const gap = Math.max(0, high - low - 1);
  let score = 0.08 + ((high - 2) / 12) * 0.46 + ((low - 2) / 12) * 0.20;
  if (suited) score += 0.075;
  if (gap === 0) score += 0.07;
  else if (gap === 1) score += 0.035;
  else score -= Math.min(0.13, gap * 0.018);
  if (high === 14) score += 0.07;
  if (high >= 12 && low >= 10) score += 0.07;
  return clamp(score);
}

function rankCharacterValue(rank) {
  return "23456789TJQKA".indexOf(String(rank).toUpperCase()) + 2;
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

function straightDrawStrength(cards) {
  const ranks = [...new Set(cards.map(rankValue))];
  if (ranks.includes(14)) ranks.push(1);
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  let bestMissing = 5;
  for (let start = 1; start <= 10; start += 1) {
    const target = [start, start + 1, start + 2, start + 3, start + 4];
    const missing = target.filter((rank) => !unique.includes(rank)).length;
    bestMissing = Math.min(bestMissing, missing);
  }
  if (bestMissing === 1) return 0.18;
  if (bestMissing === 2) return 0.07;
  return 0;
}

export function postflopHandFeatures(combo, board) {
  const cards = [...combo.cards, ...board];
  const score = evaluateBest(cards);
  const category = scoreCategory(score);
  const madeByCategory = [0.10, 0.37, 0.62, 0.76, 0.82, 0.86, 0.92, 0.97, 1.0];
  let madeStrength = madeByCategory[category] ?? 0.10;

  if (category === 1) {
    const boardRanks = board.map(rankValue);
    const highBoard = Math.max(...boardRanks);
    const holeRanks = combo.cards.map(rankValue);
    if (holeRanks[0] === holeRanks[1] && holeRanks[0] > highBoard) madeStrength += 0.10;
    if (holeRanks.includes(highBoard)) madeStrength += 0.07;
  }

  let flushDraw = 0;
  if (board.length < 5 && category < 5) {
    const suitCounts = new Map();
    for (const card of cards) suitCounts.set(suitIndex(card), (suitCounts.get(suitIndex(card)) ?? 0) + 1);
    if (Math.max(...suitCounts.values()) >= 4) flushDraw = 0.20;
  }
  const straightDraw = board.length < 5 && category < 4 ? straightDrawStrength(cards) : 0;
  const drawStrength = clamp(flushDraw + straightDraw, 0, 0.30);

  return {
    category,
    madeStrength: clamp(madeStrength),
    drawStrength,
    continueStrength: clamp(madeStrength + drawStrength * 0.85),
  };
}

/**
 * Return P(action | exact fish combo, public state) for the modeled population.
 * Supported contexts:
 *   preflop-vs-open: fold / call / raise
 *   postflop-first:  check / bet
 *   postflop-vs-bet: fold / call / raise
 *   postflop-vs-raise: fold / call
 */
export function fishActionProbabilities(combo, context = {}) {
  const type = context.type;
  if (type === "preflop-vs-open") {
    const strength = preflopHandStrength(combo.classLabel);
    const openBb = Number(context.openBb ?? 3.3);
    const pricePenalty = clamp((openBb - 2.5) * 0.035, 0, 0.16);
    let raise = 0.012 + Math.max(0, strength - 0.70) * 0.38;
    if (strength > 0.93) raise += 0.10;
    raise = clamp(raise, 0.008, 0.22);
    let continueRate = clamp(0.24 + strength * 0.70 - pricePenalty, 0.10, 0.96);
    if (strength < 0.22) continueRate *= 0.72;
    const call = clamp(continueRate - raise, 0.03, 0.90);
    return normalizeProbabilities({ fold: 1 - call - raise, call, raise });
  }

  const board = context.board ?? [];
  const features = postflopHandFeatures(combo, board);
  const river = board.length === 5;

  if (type === "postflop-first") {
    let bet = 0.055 + features.drawStrength * 0.28 + Math.max(0, features.madeStrength - 0.60) * 0.34;
    if (river && features.madeStrength < 0.55) bet *= 0.48;
    if (river && features.madeStrength > 0.82) bet += 0.10;
    bet = clamp(bet, 0.025, 0.42);
    return { check: 1 - bet, bet };
  }

  if (type === "postflop-vs-bet") {
    const betFraction = clamp(Number(context.betFraction ?? 0.66), 0.15, 2.0);
    const sizePenalty = clamp((betFraction - 0.33) * 0.18, 0, 0.22);
    let continueRate = 0.16 + features.continueStrength * 0.79 - sizePenalty;
    if (!river && features.drawStrength > 0.12) continueRate += 0.08;
    continueRate = clamp(continueRate, 0.055, 0.97);

    let raise = 0.012 + Math.max(0, features.madeStrength - 0.72) * 0.30;
    if (!river) raise += features.drawStrength * 0.07;
    if (river && features.madeStrength < 0.78) raise *= 0.18;
    raise = clamp(raise, 0.004, Math.min(0.28, continueRate * 0.55));
    const call = Math.max(0.02, continueRate - raise);
    return normalizeProbabilities({ fold: 1 - call - raise, call, raise });
  }

  if (type === "postflop-vs-raise") {
    const thresholdShift = river ? 0.10 : 0;
    let call = 0.08 + features.continueStrength * 0.78 - thresholdShift;
    if (!river && features.drawStrength > 0.12) call += 0.08;
    call = clamp(call, 0.03, 0.94);
    return { fold: 1 - call, call };
  }

  throw new Error(`Unknown fish action context: ${type}`);
}

export function createFishRange({ heroCards = [], board = [] } = {}) {
  const combos = expandRange("random", [...heroCards, ...board]);
  const raw = combos.map((combo) => ({ ...combo, probability: 1 }));
  return normalizeFishRange(raw);
}

export function normalizeFishRange(range) {
  const total = range.reduce((sum, entry) => sum + Math.max(0, Number(entry.probability) || 0), 0);
  if (total <= EPSILON) throw new Error("Fish range has no probability mass.");
  return range.map((entry) => ({
    ...entry,
    probability: Math.max(0, Number(entry.probability) || 0) / total,
  }));
}

export function filterFishRange(range, blockedCards = []) {
  const blocked = new Set(blockedCards);
  const filtered = range.filter(
    (entry) => !blocked.has(entry.cards[0]) && !blocked.has(entry.cards[1]),
  );
  return normalizeFishRange(filtered);
}

export function observeFishAction(range, context, observedAction, blockedCards = []) {
  const blocked = new Set(blockedCards);
  const updated = [];
  for (const entry of range) {
    if (blocked.has(entry.cards[0]) || blocked.has(entry.cards[1])) continue;
    const likelihood = fishActionProbabilities(entry, context)[observedAction] ?? 0;
    if (likelihood <= 0) continue;
    updated.push({ ...entry, probability: entry.probability * likelihood });
  }
  return normalizeFishRange(updated);
}

export function sampleFishCombo(range, random = Math.random) {
  const target = clamp(random(), 0, 0.999999999999);
  let cursor = 0;
  for (const entry of range) {
    cursor += entry.probability;
    if (target <= cursor) return entry;
  }
  return range[range.length - 1];
}

export function sampleFishAction(combo, context, random = Math.random) {
  const probabilities = fishActionProbabilities(combo, context);
  const target = clamp(random(), 0, 0.999999999999);
  let cursor = 0;
  for (const [action, probability] of Object.entries(probabilities)) {
    cursor += probability;
    if (target <= cursor) return action;
  }
  return Object.keys(probabilities).at(-1);
}

export function summarizeFishRange(range) {
  const byClass = new Map();
  for (const entry of range) {
    byClass.set(entry.classLabel, (byClass.get(entry.classLabel) ?? 0) + entry.probability);
  }
  const classes = [...byClass.entries()]
    .map(([classLabel, probability]) => ({ classLabel, probability }))
    .sort((a, b) => b.probability - a.probability || a.classLabel.localeCompare(b.classLabel));
  const effectiveCombos = 1 / range.reduce((sum, entry) => sum + entry.probability ** 2, 0);
  return {
    comboCount: range.length,
    effectiveCombos,
    byClass: Object.fromEntries(classes.map((entry) => [entry.classLabel, entry.probability])),
    topClasses: classes.slice(0, 12),
  };
}

export function cloneFishRange(range) {
  return range.map((entry) => ({
    ...entry,
    cards: [...entry.cards],
  }));
}

function sampleWeightedEntry(range, random) {
  return sampleFishCombo(range, random);
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

/** Estimate hero showdown equity against the current posterior fish range. */
export function estimateHeroEquity(heroCards, board, fishRange, { samples = 320, random = Math.random } = {}) {
  if (board.length === 5) {
    let equity = 0;
    for (const villain of fishRange) {
      const result = compareScores(
        evaluate7([...heroCards, ...board]),
        evaluate7([...villain.cards, ...board]),
      );
      equity += villain.probability * (result > 0 ? 1 : result === 0 ? 0.5 : 0);
    }
    return clamp(equity);
  }

  const trials = Math.max(40, Math.floor(samples));
  let equity = 0;
  for (let index = 0; index < trials; index += 1) {
    const villain = sampleWeightedEntry(fishRange, random);
    const fullBoard = sampleRunout(board, heroCards, villain.cards, random);
    const result = compareScores(
      evaluate7([...heroCards, ...fullBoard]),
      evaluate7([...villain.cards, ...fullBoard]),
    );
    equity += result > 0 ? 1 : result === 0 ? 0.5 : 0;
  }
  return clamp(equity / trials);
}
