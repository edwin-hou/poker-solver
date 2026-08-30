/**
 * Approximate six-max preflop chart engine.
 *
 * This module intentionally does not claim to solve the unrestricted preflop
 * game tree. It produces transparent, deterministic chart approximations from
 * position-, stack-, and action-specific lookup targets, then expands the
 * result into exact two-card combinations for the shared 13x13 workspace.
 */

import { handsOverlap } from "./cards.js";
import { HAND_CLASSES, expandRange, normalizeClassLabel, summarizeRange } from "./range.js";
import { CancelledSolveError, serializeRangeSummary } from "./solver-support.js";

export const PREFLOP_POSITIONS = Object.freeze(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
export const PREFLOP_LOOKUP_SPOTS = Object.freeze(["rfi", "vs-open", "vs-3bet"]);

const POSITION_INDEX = Object.freeze(
  Object.fromEntries(PREFLOP_POSITIONS.map((position, index) => [position, index])),
);
const RANK_VALUE = Object.freeze(
  Object.fromEntries([..."23456789TJQKA"].map((rank, index) => [rank, index + 2])),
);
const ALL_CLASSES = Object.freeze(HAND_CLASSES.flat());
const TOTAL_COMBOS = 1_326;
const ORDER_CACHE = new Map();

const RFI_TARGETS_100BB = Object.freeze({
  UTG: 0.175,
  HJ: 0.215,
  CO: 0.29,
  BTN: 0.47,
  SB: 0.64,
});

// [total continuation, aggressive continuation]. These are intentionally
// smooth lookup targets rather than copied proprietary charts.
const VS_OPEN_TARGETS = Object.freeze({
  HJ: { UTG: [0.11, 0.045] },
  CO: { UTG: [0.135, 0.05], HJ: [0.16, 0.055] },
  BTN: { UTG: [0.16, 0.065], HJ: [0.19, 0.075], CO: [0.25, 0.09] },
  SB: { UTG: [0.105, 0.065], HJ: [0.13, 0.075], CO: [0.175, 0.10], BTN: [0.24, 0.13] },
  BB: { UTG: [0.25, 0.07], HJ: [0.30, 0.08], CO: [0.39, 0.10], BTN: [0.56, 0.13], SB: [0.70, 0.15] },
});

const VS_THREE_BET_TARGETS_100BB = Object.freeze({
  UTG: [0.085, 0.035],
  HJ: [0.095, 0.04],
  CO: [0.11, 0.045],
  BTN: [0.14, 0.055],
  SB: [0.16, 0.065],
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizePosition(value, fallback) {
  const position = String(value ?? fallback).trim().toUpperCase();
  if (!(position in POSITION_INDEX)) throw new Error(`Unknown preflop position: ${value}`);
  return position;
}

export function normalizePreflopMode(value) {
  const mode = String(value ?? "lookup").trim().toLowerCase().replaceAll("_", "-");
  if (["lookup", "chart", "charts", "approx", "approximate"].includes(mode)) return "lookup";
  if (["push-fold", "pushfold", "jam", "cfr"].includes(mode)) return "push-fold";
  throw new Error(`Unknown preflop model: ${value}`);
}

export function validatePreflopLookupConfig(raw = {}) {
  const spot = String(raw.preflopSpot ?? raw.spot ?? "rfi").trim().toLowerCase();
  if (!PREFLOP_LOOKUP_SPOTS.includes(spot)) throw new Error(`Unknown preflop spot: ${spot}`);

  const heroPosition = normalizePosition(raw.heroPosition, spot === "rfi" ? "BTN" : "BB");
  const villainPosition = normalizePosition(raw.villainPosition, spot === "rfi" ? "BB" : "BTN");
  if (heroPosition === villainPosition) throw new Error("Hero and villain positions must be different.");
  if (spot === "rfi" && heroPosition === "BB") throw new Error("The big blind cannot open first in.");
  if (spot === "vs-open" && POSITION_INDEX[villainPosition] >= POSITION_INDEX[heroPosition]) {
    throw new Error("For a facing-open chart, the opener must act before the hero position.");
  }

  const stack = Number(raw.stack ?? raw.preflopStack ?? 100);
  const openSize = Number(raw.openSize ?? 2.5);
  if (!Number.isFinite(stack) || stack < 5 || stack > 500) {
    throw new Error("Preflop chart stack depth must be between 5bb and 500bb.");
  }
  if (!Number.isFinite(openSize) || openSize < 1.5 || openSize > 6) {
    throw new Error("Open size must be between 1.5bb and 6bb.");
  }

  const heroRange = String(raw.heroRange ?? raw.sbRange ?? raw.oopRange ?? "random").trim();
  const villainRange = String(raw.villainRange ?? raw.bbRange ?? raw.ipRange ?? "random").trim();
  if (!heroRange || !villainRange) throw new Error("Both lookup ranges are required.");

  return {
    street: "preflop",
    preflopMode: "lookup",
    preflopSpot: spot,
    heroPosition,
    villainPosition,
    stack,
    openSize,
    heroRange,
    villainRange,
    board: [],
    iterations: 0,
    averagingDelay: 0,
    evaluationSamples: 0,
    seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) >>> 0 : 20260812,
  };
}

function classFeatures(label) {
  const high = RANK_VALUE[label[0]];
  const low = RANK_VALUE[label[1]];
  const pair = label.length === 2;
  const suited = label.endsWith("s");
  const gap = pair ? 0 : Math.max(0, high - low - 1);
  return { high, low, pair, suited, gap };
}

function classComboCount(label) {
  if (label.length === 2) return 6;
  return label.endsWith("s") ? 4 : 12;
}

function playabilityScore(label) {
  const { high, low, pair, suited, gap } = classFeatures(label);
  if (pair) return 42 + high * 3.2;
  let score = high * 3 + low * 1.45;
  if (suited) score += 4.8;
  if (high === 14) score += 2.5;
  if (high === 13 && low >= 9) score += 1.5;
  if (gap === 0) score += high <= 11 ? 3.3 : 1.4;
  else if (gap === 1) score += high <= 12 ? 1.8 : 0.6;
  else score -= Math.min(9, gap * 1.55);
  if (low <= 5 && high >= 12 && !suited) score -= 2.2;
  return score;
}

function aggressionScore(label) {
  const features = classFeatures(label);
  let score = playabilityScore(label);
  if (features.pair) score += features.high >= 10 ? 9 : features.high >= 7 ? 3 : 0;
  if (features.high === 14) score += 5.5;
  if (features.high === 13 && features.low >= 10) score += 2.5;
  if (features.suited && features.high === 14 && features.low <= 5) score += 8.5;
  if (features.suited && features.high === 13 && features.low <= 8) score += 2.8;
  return score;
}

function orderedClasses(cacheKey, scoreFunction) {
  if (!ORDER_CACHE.has(cacheKey)) {
    ORDER_CACHE.set(
      cacheKey,
      Object.freeze(
        [...ALL_CLASSES].sort(
          (left, right) => scoreFunction(right) - scoreFunction(left) || right.localeCompare(left),
        ),
      ),
    );
  }
  return ORDER_CACHE.get(cacheKey);
}

function allocateTarget(targetFraction, scoreFunction, cacheKey) {
  const targetCombos = clamp(targetFraction, 0, 1) * TOTAL_COMBOS;
  const frequencies = new Map(ALL_CLASSES.map((label) => [label, 0]));
  let remaining = targetCombos;
  for (const label of orderedClasses(cacheKey, scoreFunction)) {
    if (remaining <= 0) break;
    const count = classComboCount(label);
    const frequency = clamp(remaining / count, 0, 1);
    frequencies.set(label, frequency);
    remaining -= frequency * count;
  }
  return frequencies;
}

function allocateSubsetTarget(capacityMap, targetFraction, scoreFunction, cacheKey) {
  const frequencies = new Map(ALL_CLASSES.map((label) => [label, 0]));
  const totalCapacity = ALL_CLASSES.reduce(
    (sum, label) => sum + (capacityMap.get(label) ?? 0) * classComboCount(label),
    0,
  );
  let remaining = Math.min(clamp(targetFraction, 0, 1) * TOTAL_COMBOS, totalCapacity);

  for (const label of orderedClasses(cacheKey, scoreFunction)) {
    if (remaining <= 0) break;
    const capacity = capacityMap.get(label) ?? 0;
    if (capacity <= 0) continue;
    const count = classComboCount(label);
    const allocatedCombos = Math.min(remaining, capacity * count);
    frequencies.set(label, allocatedCombos / count);
    remaining -= allocatedCombos;
  }
  return frequencies;
}

function rfiTarget(position, stack) {
  const base = RFI_TARGETS_100BB[position];
  const depthFactor = stack < 15 ? 0.82 : stack < 30 ? 0.90 : stack < 60 ? 0.96 : stack > 180 ? 1.035 : 1;
  return clamp(base * depthFactor, 0.07, 0.74);
}

function lookupVsOpenTargets(hero, villain, stack, openSize) {
  const direct = VS_OPEN_TARGETS[hero]?.[villain];
  const gap = Math.max(1, POSITION_INDEX[hero] - POSITION_INDEX[villain]);
  let continuation = direct?.[0] ?? 0.09 + gap * 0.035 + (hero === "BB" ? 0.13 : 0);
  let aggressive = direct?.[1] ?? 0.035 + gap * 0.012 + (hero === "SB" || hero === "BB" ? 0.02 : 0);

  const priceFactor = clamp((2.5 / openSize) ** 0.48, 0.72, 1.22);
  continuation *= priceFactor;
  aggressive *= clamp((2.5 / openSize) ** 0.18, 0.88, 1.10);

  if (stack < 25) {
    continuation *= 0.90;
    aggressive *= 1.18;
  } else if (stack > 160) {
    continuation *= 1.08;
    aggressive *= 0.96;
  }
  return [clamp(continuation, 0.05, 0.78), clamp(aggressive, 0.02, 0.24)];
}

function lookupVsThreeBetTargets(hero, villain, stack) {
  let [continuation, fourBet] = VS_THREE_BET_TARGETS_100BB[hero] ?? [0.12, 0.05];
  const pressure = POSITION_INDEX[villain] - POSITION_INDEX[hero];
  if (pressure >= 2) {
    continuation *= 1.10;
    fourBet *= 1.08;
  }
  if (villain === "BB" && ["BTN", "SB"].includes(hero)) {
    continuation *= 1.15;
    fourBet *= 1.12;
  }
  if (stack < 30) {
    continuation *= 0.92;
    fourBet *= 1.28;
  } else if (stack > 160) {
    continuation *= 1.14;
    fourBet *= 0.92;
  }
  return [clamp(continuation, 0.045, 0.28), clamp(fourBet, 0.018, 0.13)];
}

function buildStrategyTable(config) {
  const table = new Map();

  if (config.preflopSpot === "rfi") {
    const target = rfiTarget(config.heroPosition, config.stack);
    const continueMap = allocateTarget(target, playabilityScore, "playability");
    if (config.heroPosition !== "SB") {
      for (const label of ALL_CLASSES) {
        const open = continueMap.get(label) ?? 0;
        table.set(label, [1 - open, open]);
      }
      return table;
    }

    const raiseTarget = clamp(target * (config.stack < 30 ? 0.67 : 0.58), 0.24, 0.43);
    const raiseMap = allocateSubsetTarget(continueMap, raiseTarget, aggressionScore, "aggression");
    for (const label of ALL_CLASSES) {
      const totalContinue = continueMap.get(label) ?? 0;
      const raise = raiseMap.get(label) ?? 0;
      const limp = Math.max(0, totalContinue - raise);
      table.set(label, [Math.max(0, 1 - totalContinue), limp, raise]);
    }
    return table;
  }

  if (config.preflopSpot === "vs-open") {
    const [continueTarget, threeBetTarget] = lookupVsOpenTargets(
      config.heroPosition,
      config.villainPosition,
      config.stack,
      config.openSize,
    );
    const continueMap = allocateTarget(continueTarget, playabilityScore, "playability");
    const aggressiveMap = allocateSubsetTarget(continueMap, threeBetTarget, aggressionScore, "aggression");
    for (const label of ALL_CLASSES) {
      const continueFrequency = continueMap.get(label) ?? 0;
      const threeBet = aggressiveMap.get(label) ?? 0;
      const call = Math.max(0, continueFrequency - threeBet);
      table.set(label, [Math.max(0, 1 - continueFrequency), call, threeBet]);
    }
    return table;
  }

  const [continueTarget, fourBetTarget] = lookupVsThreeBetTargets(
    config.heroPosition,
    config.villainPosition,
    config.stack,
  );
  const continueMap = allocateTarget(continueTarget, playabilityScore, "playability");
  const aggressiveMap = allocateSubsetTarget(continueMap, fourBetTarget, aggressionScore, "aggression");
  for (const label of ALL_CLASSES) {
    const continueFrequency = continueMap.get(label) ?? 0;
    const fourBet = aggressiveMap.get(label) ?? 0;
    const call = Math.max(0, continueFrequency - fourBet);
    table.set(label, [Math.max(0, 1 - continueFrequency), call, fourBet]);
  }
  return table;
}

function actionLabels(config) {
  if (config.preflopSpot === "rfi") {
    if (config.heroPosition === "SB") return ["Fold", "Limp", `Raise ${config.openSize}bb`];
    return ["Fold", `Raise ${config.openSize}bb`];
  }
  if (config.preflopSpot === "vs-open") return ["Fold", "Call", "3-bet"];
  return ["Fold", "Call", "4-bet"];
}

/** Return the chart row for one 169-class hand without expanding all 1,326 combos. */
export function preflopLookupStrategyForClass(rawConfig = {}, classLabel) {
  const config = validatePreflopLookupConfig(rawConfig);
  const normalized = normalizeClassLabel(classLabel);
  const strategy = buildStrategyTable(config).get(normalized);
  if (!strategy) throw new Error(`Unknown preflop hand class: ${classLabel}`);
  return {
    classLabel: normalized,
    actionLabels: actionLabels(config),
    strategy: [...strategy],
    nodeLabel: nodeLabel(config),
    source: "Approximate six-max positional lookup baseline",
    exact: false,
  };
}

function nodeLabel(config) {
  if (config.preflopSpot === "rfi") return `${config.heroPosition} open first in · ${config.stack}bb`;
  if (config.preflopSpot === "vs-open") {
    return `${config.heroPosition} versus ${config.villainPosition} ${config.openSize}bb open`;
  }
  return `${config.heroPosition} versus ${config.villainPosition} 3-bet · ${config.stack}bb`;
}

function comboCategory(combo) {
  if (combo.classLabel.length === 2) return "Pocket pair";
  return combo.classLabel.endsWith("s") ? "Suited" : "Offsuit";
}

function compatibleDealWeight(heroCombos, villainCombos) {
  let total = 0;
  for (const hero of heroCombos) {
    for (const villain of villainCombos) {
      if (!handsOverlap(hero, villain)) total += hero.weight * villain.weight;
    }
  }
  return total;
}

function targetMetadata(config) {
  if (config.preflopSpot === "rfi") {
    const total = rfiTarget(config.heroPosition, config.stack);
    return {
      totalContinue: total,
      aggressive: config.heroPosition === "SB" ? clamp(total * 0.58, 0.24, 0.43) : total,
    };
  }
  if (config.preflopSpot === "vs-open") {
    const [totalContinue, aggressive] = lookupVsOpenTargets(
      config.heroPosition,
      config.villainPosition,
      config.stack,
      config.openSize,
    );
    return { totalContinue, aggressive };
  }
  const [totalContinue, aggressive] = lookupVsThreeBetTargets(
    config.heroPosition,
    config.villainPosition,
    config.stack,
  );
  return { totalContinue, aggressive };
}

function actualStrategyMetadata(heroCombos, strategies) {
  let totalWeight = 0;
  let continueWeight = 0;
  let aggressiveWeight = 0;
  for (let index = 0; index < heroCombos.length; index += 1) {
    const weight = heroCombos[index].weight;
    const strategy = strategies[index];
    totalWeight += weight;
    continueWeight += weight * (1 - strategy[0]);
    aggressiveWeight += weight * strategy[strategy.length - 1];
  }
  return {
    actualContinueFrequency: totalWeight > 0 ? continueWeight / totalWeight : 0,
    actualAggressiveFrequency: totalWeight > 0 ? aggressiveWeight / totalWeight : 0,
  };
}

export function buildPreflopLookupResult(rawConfig = {}) {
  const config = validatePreflopLookupConfig(rawConfig);
  const heroCombos = expandRange(config.heroRange);
  const villainCombos = expandRange(config.villainRange);
  const strategyTable = buildStrategyTable(config);
  const strategies = heroCombos.map((combo) => [...strategyTable.get(combo.classLabel)]);
  const labels = actionLabels(config);
  const target = targetMetadata(config);
  const actual = actualStrategyMetadata(heroCombos, strategies);
  const serialize = (combo) => ({
    key: combo.key,
    cards: combo.cards,
    classLabel: combo.classLabel,
    display: combo.display,
    weight: combo.weight,
    category: comboCategory(combo),
  });

  return {
    schemaVersion: 3,
    game: "approximate six-max two-card Texas Hold'em preflop chart",
    abstraction: {
      street: "preflop",
      mode: "lookup",
      exact: false,
      players: 6,
      spot: config.preflopSpot,
      source: "Original deterministic lookup model calibrated to common six-max cash-game range widths",
    },
    config: {
      ...config,
      board: [],
      pot: null,
    },
    iterations: 0,
    ranges: {
      oop: serializeRangeSummary(summarizeRange(heroCombos)),
      ip: serializeRangeSummary(summarizeRange(villainCombos)),
      hero: serializeRangeSummary(summarizeRange(heroCombos)),
      villain: serializeRangeSummary(summarizeRange(villainCombos)),
    },
    compatibleDealWeight: compatibleDealWeight(heroCombos, villainCombos),
    evaluation: {
      exact: false,
      approximate: true,
      exploitability: null,
      nashConv: null,
      profileValueOop: null,
      profileValueIp: null,
      method: "Approximate preflop lookup chart; EV and exploitability are not measured",
      evaluationSamples: 0,
    },
    lookup: {
      targetContinueFrequency: target.totalContinue,
      targetAggressiveFrequency: target.aggressive,
      ...actual,
      note: "Frequencies are positional chart approximations, not a solved unrestricted preflop equilibrium.",
    },
    nodes: [
      {
        id: "preflop-lookup-root",
        label: nodeLabel(config),
        player: config.heroPosition,
        actionLabels: labels,
        combos: heroCombos.map(serialize),
        strategies,
      },
    ],
  };
}

export async function solvePreflopLookup(config, hooks = {}) {
  if (hooks.isCancelled?.()) throw new CancelledSolveError();
  hooks.onProgress?.({ iteration: 1, target: 1, fraction: 1 });
  await Promise.resolve();
  if (hooks.isCancelled?.()) throw new CancelledSolveError();
  return buildPreflopLookupResult(config);
}
