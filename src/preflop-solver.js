/** Browser-scale heads-up preflop push/fold CFR+ solver. */

import { compareScores, createDeck, evaluate7, handsOverlap } from "./cards.js";
import { expandRange, summarizeRange } from "./range.js";
import {
  CancelledSolveError,
  EPSILON,
  XorShift32,
  accumulateAverage,
  averageRow,
  cumulativeWeights,
  serializeRangeSummary,
  strategyFromRegrets,
  updateRegretRow,
  weightedIndex,
} from "./solver-support.js";

function validatePreflopConfig(raw = {}) {
  const smallBlind = Number(raw.smallBlind ?? 0.5);
  const bigBlind = Number(raw.bigBlind ?? 1);
  const ante = Number(raw.ante ?? 0);
  const stack = Number(raw.stack ?? 15);
  const iterations = Math.floor(Number(raw.iterations ?? 150_000));
  const averagingDelay = Math.max(0, Math.floor(Number(raw.averagingDelay ?? Math.min(2_000, iterations / 10))));
  const evaluationSamples = Math.max(1_000, Math.floor(Number(raw.evaluationSamples ?? 20_000)));
  if (!(smallBlind > 0)) throw new Error("Small blind must be positive.");
  if (!(bigBlind > smallBlind)) throw new Error("Big blind must exceed the small blind.");
  if (!(ante >= 0)) throw new Error("Ante cannot be negative.");
  if (!(stack > bigBlind)) throw new Error("Effective stack must exceed the big blind.");
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Iterations must be a positive integer.");
  const sbRange = String(raw.sbRange ?? raw.oopRange ?? "random").trim();
  const bbRange = String(raw.bbRange ?? raw.ipRange ?? "random").trim();
  if (!sbRange || !bbRange) throw new Error("Both preflop ranges are required.");
  return {
    street: "preflop",
    board: [],
    smallBlind,
    bigBlind,
    ante,
    stack,
    iterations,
    averagingDelay,
    evaluationSamples,
    sbRange,
    bbRange,
    seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) >>> 0 : 20260810,
    progressEvery: Math.max(250, Math.floor(Number(raw.progressEvery ?? 5_000))),
  };
}

function category(combo) {
  if (combo.classLabel.length === 2) return "Pocket pair";
  return combo.classLabel.endsWith("s") ? "Suited" : "Offsuit";
}

function validDealWeight(solver) {
  let total = 0;
  for (const sb of solver.sbCombos) for (const bb of solver.bbCombos) {
    if (!handsOverlap(sb, bb)) total += sb.weight * bb.weight;
  }
  return total;
}

function sampleDeal(solver, rng = solver.rng) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sb = weightedIndex(solver.sbDistribution.cumulative, solver.sbDistribution.total, rng.next());
    const bb = weightedIndex(solver.bbDistribution.cumulative, solver.bbDistribution.total, rng.next());
    if (!handsOverlap(solver.sbCombos[sb], solver.bbCombos[bb])) return [sb, bb];
  }
  let target = rng.next() * solver.validDealWeight;
  for (let sb = 0; sb < solver.sbCombos.length; sb += 1) for (let bb = 0; bb < solver.bbCombos.length; bb += 1) {
    if (handsOverlap(solver.sbCombos[sb], solver.bbCombos[bb])) continue;
    target -= solver.sbCombos[sb].weight * solver.bbCombos[bb].weight;
    if (target <= 0) return [sb, bb];
  }
  throw new Error("No compatible private-card deal could be sampled.");
}

function sampleShowdown(solver, sbIndex, bbIndex, rng = solver.rng) {
  const sb = solver.sbCombos[sbIndex];
  const bb = solver.bbCombos[bbIndex];
  const deck = createDeck([...sb.cards, ...bb.cards]);
  const board = [];
  for (let index = 0; index < 5; index += 1) {
    const chosen = index + Math.floor(rng.next() * (deck.length - index));
    [deck[index], deck[chosen]] = [deck[chosen], deck[index]];
    board.push(deck[index]);
  }
  const result = compareScores(evaluate7([...sb.cards, ...board]), evaluate7([...bb.cards, ...board]));
  return result * solver.config.stack;
}

function averages(solver) {
  return {
    sbRoot: solver.sbCombos.map((_, index) => averageRow(solver.sbSum, solver.sbRegret, index * 2, 2)),
    bbVsJam: solver.bbCombos.map((_, index) => averageRow(solver.bbSum, solver.bbRegret, index * 2, 2)),
  };
}

function profileValue(solver, strategies, samples, seed) {
  const rng = new XorShift32(seed);
  const sbFold = -(solver.config.smallBlind + solver.config.ante);
  const bbFold = solver.config.bigBlind + solver.config.ante;
  let sum = 0;
  let sum2 = 0;
  for (let index = 0; index < samples; index += 1) {
    const [sb, bb] = sampleDeal(solver, rng);
    const showdown = sampleShowdown(solver, sb, bb, rng);
    const jam = strategies.bbVsJam[bb][0] * bbFold + strategies.bbVsJam[bb][1] * showdown;
    const value = strategies.sbRoot[sb][0] * sbFold + strategies.sbRoot[sb][1] * jam;
    sum += value;
    sum2 += value * value;
  }
  const mean = sum / samples;
  return { value: mean, standardError: Math.sqrt(Math.max(0, sum2 / samples - mean * mean) / samples) };
}

function bestResponseSb(solver, strategies, samples, seed) {
  const rng = new XorShift32(seed);
  const scores = new Float64Array(solver.sbCombos.length * 2);
  const sbFold = -(solver.config.smallBlind + solver.config.ante);
  const bbFold = solver.config.bigBlind + solver.config.ante;
  for (let index = 0; index < samples; index += 1) {
    const [sb, bb] = sampleDeal(solver, rng);
    const showdown = sampleShowdown(solver, sb, bb, rng);
    scores[sb * 2] += sbFold;
    scores[sb * 2 + 1] += strategies.bbVsJam[bb][0] * bbFold + strategies.bbVsJam[bb][1] * showdown;
  }
  const actions = new Uint8Array(solver.sbCombos.length);
  for (let sb = 0; sb < actions.length; sb += 1) actions[sb] = scores[sb * 2 + 1] > scores[sb * 2] ? 1 : 0;
  const evalRng = new XorShift32(seed ^ 0x9e3779b9);
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const [sb, bb] = sampleDeal(solver, evalRng);
    if (actions[sb] === 0) total += sbFold;
    else {
      const showdown = sampleShowdown(solver, sb, bb, evalRng);
      total += strategies.bbVsJam[bb][0] * bbFold + strategies.bbVsJam[bb][1] * showdown;
    }
  }
  return { value: total / samples, actions };
}

function bestResponseBb(solver, strategies, samples, seed) {
  const rng = new XorShift32(seed);
  const scores = new Float64Array(solver.bbCombos.length * 2);
  const bbLossOnFold = -(solver.config.bigBlind + solver.config.ante);
  for (let index = 0; index < samples; index += 1) {
    const [sb, bb] = sampleDeal(solver, rng);
    const reach = strategies.sbRoot[sb][1];
    const showdownForSb = sampleShowdown(solver, sb, bb, rng);
    scores[bb * 2] += reach * bbLossOnFold;
    scores[bb * 2 + 1] += reach * -showdownForSb;
  }
  const actions = new Uint8Array(solver.bbCombos.length);
  for (let bb = 0; bb < actions.length; bb += 1) actions[bb] = scores[bb * 2 + 1] > scores[bb * 2] ? 1 : 0;
  const evalRng = new XorShift32(seed ^ 0x85ebca6b);
  const sbFoldForBb = solver.config.smallBlind + solver.config.ante;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const [sb, bb] = sampleDeal(solver, evalRng);
    let value = strategies.sbRoot[sb][0] * sbFoldForBb;
    if (actions[bb] === 0) value += strategies.sbRoot[sb][1] * bbLossOnFold;
    else value += strategies.sbRoot[sb][1] * -sampleShowdown(solver, sb, bb, evalRng);
    total += value;
  }
  return { value: total / samples, actions };
}

function evaluate(solver, strategies) {
  const samples = solver.config.evaluationSamples;
  const profile = profileValue(solver, strategies, samples, solver.config.seed ^ 0x243f6a88);
  const brSb = bestResponseSb(solver, strategies, samples, solver.config.seed ^ 0xb7e15162);
  const brBb = bestResponseBb(solver, strategies, samples, solver.config.seed ^ 0xdeadbeef);
  const nashConv = Math.max(0, brSb.value - profile.value + (brBb.value + profile.value));
  return {
    profileValueOop: profile.value,
    profileValueIp: -profile.value,
    profileStandardError: profile.standardError,
    bestResponseValueOop: brSb.value,
    bestResponseValueIp: brBb.value,
    nashConv,
    exploitability: nashConv / 2,
    exact: false,
    evaluationSamples: samples,
    method: "Monte Carlo information-consistent best-response estimate",
  };
}

export class HoldemPreflopSolver {
  constructor(rawConfig) {
    this.config = validatePreflopConfig(rawConfig);
    this.sbCombos = expandRange(this.config.sbRange);
    this.bbCombos = expandRange(this.config.bbRange);
    for (const combo of this.sbCombos) combo.category = category(combo);
    for (const combo of this.bbCombos) combo.category = category(combo);
    this.sbRegret = new Float64Array(this.sbCombos.length * 2);
    this.sbSum = new Float64Array(this.sbCombos.length * 2);
    this.bbRegret = new Float64Array(this.bbCombos.length * 2);
    this.bbSum = new Float64Array(this.bbCombos.length * 2);
    this.sbDistribution = cumulativeWeights(this.sbCombos);
    this.bbDistribution = cumulativeWeights(this.bbCombos);
    this.rng = new XorShift32(this.config.seed);
    this.iteration = 0;
    this.validDealWeight = validDealWeight(this);
    if (this.validDealWeight <= EPSILON) throw new Error("The configured ranges have no compatible deals.");
  }

  trainIteration() {
    this.iteration += 1;
    const [sb, bb] = sampleDeal(this);
    const showdown = sampleShowdown(this, sb, bb);
    const sbStrategy = new Float64Array(2);
    const bbStrategy = new Float64Array(2);
    strategyFromRegrets(this.sbRegret, sb * 2, 2, sbStrategy);
    strategyFromRegrets(this.bbRegret, bb * 2, 2, bbStrategy);
    const sbFold = -(this.config.smallBlind + this.config.ante);
    const bbFoldForSb = this.config.bigBlind + this.config.ante;
    const jamValue = bbStrategy[0] * bbFoldForSb + bbStrategy[1] * showdown;
    const sbValues = [sbFold, jamValue];
    const sbNode = sbStrategy[0] * sbFold + sbStrategy[1] * jamValue;
    const bbValues = [-(this.config.bigBlind + this.config.ante), -showdown];
    const bbNode = bbStrategy[0] * bbValues[0] + bbStrategy[1] * bbValues[1];
    updateRegretRow(this.sbRegret, sb * 2, sbValues, sbNode, 1);
    updateRegretRow(this.bbRegret, bb * 2, bbValues, bbNode, sbStrategy[1]);
    const weight = Math.max(0, this.iteration - this.config.averagingDelay);
    if (weight > 0) {
      accumulateAverage(this.sbSum, sb * 2, sbStrategy, weight);
      accumulateAverage(this.bbSum, bb * 2, bbStrategy, weight);
    }
  }

  async train({ onProgress = null, isCancelled = null, yieldEvery = 5_000 } = {}) {
    const target = this.config.iterations;
    const batch = Math.max(100, Math.min(yieldEvery, this.config.progressEvery));
    while (this.iteration < target) {
      const stop = Math.min(target, this.iteration + batch);
      while (this.iteration < stop) this.trainIteration();
      if (isCancelled?.()) throw new CancelledSolveError();
      onProgress?.({ iteration: this.iteration, target, fraction: this.iteration / target });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return this;
  }

  averageStrategies() { return averages(this); }
  evaluate(strategies = this.averageStrategies()) { return evaluate(this, strategies); }

  result() {
    const strategies = this.averageStrategies();
    const evaluation = this.evaluate(strategies);
    const serialize = (combo) => ({
      key: combo.key,
      cards: combo.cards,
      classLabel: combo.classLabel,
      display: combo.display,
      weight: combo.weight,
      category: combo.category,
    });
    return {
      schemaVersion: 2,
      game: "heads-up two-card Texas Hold'em preflop push/fold",
      abstraction: {
        street: "preflop",
        players: 2,
        actions: ["fold", "jam", "call"],
        postflopModel: "five-card chance-sampled check-down equity",
      },
      config: {
        ...this.config,
        board: [],
        pot: this.config.smallBlind + this.config.bigBlind + 2 * this.config.ante,
      },
      iterations: this.iteration,
      ranges: {
        oop: serializeRangeSummary(summarizeRange(this.sbCombos)),
        ip: serializeRangeSummary(summarizeRange(this.bbCombos)),
        sb: serializeRangeSummary(summarizeRange(this.sbCombos)),
        bb: serializeRangeSummary(summarizeRange(this.bbCombos)),
      },
      compatibleDealWeight: this.validDealWeight,
      evaluation,
      nodes: [
        {
          id: "sb-root",
          label: "Preflop: SB first action",
          player: "SB",
          actionLabels: ["Fold", `Jam ${this.config.stack}bb`],
          combos: this.sbCombos.map(serialize),
          strategies: strategies.sbRoot,
        },
        {
          id: "bb-vs-jam",
          label: `Preflop: BB facing ${this.config.stack}bb jam`,
          player: "BB",
          actionLabels: ["Fold", "Call"],
          combos: this.bbCombos.map(serialize),
          strategies: strategies.bbVsJam,
        },
      ],
    };
  }
}

export async function solveHoldemPreflop(config, hooks = {}) {
  const solver = new HoldemPreflopSolver(config);
  await solver.train(hooks);
  return solver.result();
}

export { validatePreflopConfig };
