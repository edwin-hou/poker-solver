/** Shared configuration, regret-matching, and reporting helpers. */

import { compareScores, parseBoard } from "./cards.js";

export const EPSILON = 1e-12;

export class CancelledSolveError extends Error {
  constructor(message = "Solve cancelled") {
    super(message);
    this.name = "CancelledSolveError";
  }
}

export function parseBetSizes(value, pot, stack) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
  const sizes = [];
  for (const raw of source) {
    if (raw === "" || raw === null || raw === undefined) continue;
    const token = String(raw).trim().toLowerCase();
    const number = Number(token.replace(/[%px]/g, ""));
    if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid bet size: ${raw}`);
    let chips;
    if (token.endsWith("x") || token.endsWith("p")) chips = number * pot;
    else if (token.endsWith("%") || number > stack) chips = (number / 100) * pot;
    else chips = (number / 100) * pot;
    chips = Math.min(stack, chips);
    if (chips > EPSILON && !sizes.some((existing) => Math.abs(existing - chips) < 1e-9)) sizes.push(chips);
  }
  if (sizes.length === 0) throw new Error("Configure at least one legal bet size.");
  return sizes.sort((a, b) => a - b);
}

export function validateConfig(config) {
  const board = Array.isArray(config.board) ? config.board : parseBoard(config.board);
  if (board.length !== 5) throw new Error("This browser solver currently supports river boards with exactly five cards.");
  const pot = Number(config.pot);
  const stack = Number(config.stack);
  const iterations = Math.floor(Number(config.iterations));
  const averagingDelay = Math.max(0, Math.floor(Number(config.averagingDelay ?? Math.min(2_000, iterations / 10))));
  if (!Number.isFinite(pot) || pot <= 0) throw new Error("Pot must be a positive number.");
  if (!Number.isFinite(stack) || stack <= 0) throw new Error("Effective stack must be a positive number.");
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Iterations must be a positive integer.");
  const oopBetSizes = parseBetSizes(config.oopBetSizes ?? [75], pot, stack);
  const ipBetSizes = parseBetSizes(config.ipBetSizes ?? [75], pot, stack);
  const oopRangeText = String(config.oopRange ?? "").trim();
  const ipRangeText = String(config.ipRange ?? "").trim();
  if (!oopRangeText || !ipRangeText) throw new Error("Both ranges are required.");
  return {
    board,
    pot,
    stack,
    iterations,
    averagingDelay,
    oopBetSizes,
    ipBetSizes,
    oopRange: oopRangeText,
    ipRange: ipRangeText,
    seed: Number.isFinite(Number(config.seed)) ? Number(config.seed) >>> 0 : 20260808,
    progressEvery: Math.max(250, Math.floor(Number(config.progressEvery ?? 5_000))),
  };
}

export class XorShift32 {
  constructor(seed) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  nextUint() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  next() {
    return this.nextUint() / 0x1_0000_0000;
  }
}

export function cumulativeWeights(combos) {
  const cumulative = new Float64Array(combos.length);
  let total = 0;
  for (let index = 0; index < combos.length; index += 1) {
    total += combos[index].weight;
    cumulative[index] = total;
  }
  return { cumulative, total };
}

export function weightedIndex(cumulative, total, random) {
  const target = random * total;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (target < cumulative[middle]) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function strategyFromRegrets(regrets, offset, actionCount, target) {
  let positiveTotal = 0;
  for (let action = 0; action < actionCount; action += 1) {
    const positive = Math.max(0, regrets[offset + action]);
    target[action] = positive;
    positiveTotal += positive;
  }
  if (positiveTotal > EPSILON) {
    for (let action = 0; action < actionCount; action += 1) target[action] /= positiveTotal;
  } else {
    const uniform = 1 / actionCount;
    for (let action = 0; action < actionCount; action += 1) target[action] = uniform;
  }
  return target;
}

export function averageRow(strategySum, regret, offset, actionCount) {
  let normalizer = 0;
  for (let action = 0; action < actionCount; action += 1) normalizer += strategySum[offset + action];
  const output = new Array(actionCount);
  if (normalizer > EPSILON) {
    for (let action = 0; action < actionCount; action += 1) output[action] = strategySum[offset + action] / normalizer;
    return output;
  }
  const scratch = new Float64Array(actionCount);
  strategyFromRegrets(regret, offset, actionCount, scratch);
  return [...scratch];
}

export function updateRegretRow(regrets, offset, actionValues, nodeValue, counterfactualReach) {
  if (counterfactualReach <= 0) return;
  for (let action = 0; action < actionValues.length; action += 1) {
    regrets[offset + action] = Math.max(
      0,
      regrets[offset + action] + counterfactualReach * (actionValues[action] - nodeValue),
    );
  }
}

export function accumulateAverage(sum, offset, strategy, realizationWeight) {
  if (realizationWeight <= 0) return;
  for (let action = 0; action < strategy.length; action += 1) {
    sum[offset + action] += realizationWeight * strategy[action];
  }
}

export function showdownUtility(scoreOop, scoreIp, pot, calledBet = 0) {
  const outcome = compareScores(scoreOop, scoreIp);
  return outcome * (pot / 2 + calledBet);
}

export function actionLabels(prefix, sizes) {
  return ["Check", ...sizes.map((size) => `${prefix} ${formatNumber(size)}`)];
}

export function responseLabels() {
  return ["Fold", "Call"];
}

export function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString();
}

export function serializeRangeSummary(summary) {
  return {
    comboCount: summary.comboCount,
    weightedCombos: summary.weightedCombos,
    byClass: Object.fromEntries(summary.byClass),
  };
}

