/**
 * Chance-sampled CFR+ solver for a single postflop street.
 *
 * Flop and turn solves model future public cards by sampling a complete
 * check-down runout at every CFR iteration. River solves continue to use the
 * exact enumerating engine in solver.js through solvePokerSpot().
 */

import {
  compareScores,
  createDeck,
  describeScore,
  evaluate5,
  evaluate7,
  handsOverlap,
  parseCards,
} from "./cards.js";
import { expandRange, summarizeRange } from "./range.js";
import {
  CancelledSolveError,
  EPSILON,
  XorShift32,
  accumulateAverage,
  actionLabels,
  averageRow,
  cumulativeWeights,
  formatNumber,
  parseBetSizes,
  responseLabels,
  serializeRangeSummary,
  strategyFromRegrets,
  updateRegretRow,
  weightedIndex,
} from "./solver-support.js";

const STREET_BOARD_COUNT = Object.freeze({ flop: 3, turn: 4, river: 5 });

function normalizeStreet(value) {
  const street = String(value ?? "flop").trim().toLowerCase();
  if (!(street in STREET_BOARD_COUNT)) {
    throw new Error("Postflop street must be flop, turn, or river.");
  }
  return street;
}

function evaluateBest(cards) {
  if (cards.length === 5) return evaluate5(cards);
  if (cards.length === 7) return evaluate7(cards);
  if (cards.length !== 6) throw new Error("evaluateBest expects five, six, or seven cards.");
  let best = -1;
  for (let omitted = 0; omitted < 6; omitted += 1) {
    const five = [];
    for (let index = 0; index < 6; index += 1) {
      if (index !== omitted) five.push(cards[index]);
    }
    best = Math.max(best, evaluate5(five));
  }
  return best;
}

function validatePostflopConfig(rawConfig) {
  const street = normalizeStreet(rawConfig.street);
  const board = Array.isArray(rawConfig.board)
    ? [...rawConfig.board]
    : parseCards(rawConfig.board, { exact: STREET_BOARD_COUNT[street] });
  if (board.length !== STREET_BOARD_COUNT[street]) {
    throw new Error(`${street[0].toUpperCase()}${street.slice(1)} solves require exactly ${STREET_BOARD_COUNT[street]} board cards.`);
  }
  if (new Set(board).size !== board.length) throw new Error("Duplicate board cards are not allowed.");

  const pot = Number(rawConfig.pot);
  const stack = Number(rawConfig.stack);
  const iterations = Math.floor(Number(rawConfig.iterations));
  const averagingDelay = Math.max(
    0,
    Math.floor(Number(rawConfig.averagingDelay ?? Math.min(2_000, iterations / 10))),
  );
  const evaluationSamples = Math.max(
    1_000,
    Math.floor(Number(rawConfig.evaluationSamples ?? Math.min(40_000, Math.max(8_000, iterations / 4)))),
  );
  if (!Number.isFinite(pot) || pot <= 0) throw new Error("Pot must be a positive number.");
  if (!Number.isFinite(stack) || stack <= 0) throw new Error("Effective stack must be a positive number.");
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Iterations must be a positive integer.");

  const oopRange = String(rawConfig.oopRange ?? "").trim();
  const ipRange = String(rawConfig.ipRange ?? "").trim();
  if (!oopRange || !ipRange) throw new Error("Both ranges are required.");

  return {
    street,
    board,
    pot,
    stack,
    iterations,
    averagingDelay,
    evaluationSamples,
    oopBetSizes: parseBetSizes(rawConfig.oopBetSizes ?? [50, 100], pot, stack),
    ipBetSizes: parseBetSizes(rawConfig.ipBetSizes ?? [50, 100], pot, stack),
    oopRange,
    ipRange,
    seed: Number.isFinite(Number(rawConfig.seed)) ? Number(rawConfig.seed) >>> 0 : 20260809,
    progressEvery: Math.max(250, Math.floor(Number(rawConfig.progressEvery ?? 5_000))),
  };
}

function madeHandCategory(combo, board) {
  const score = evaluateBest([...combo.cards, ...board]);
  return describeScore(score);
}

function showdownUtility(scoreOop, scoreIp, pot, calledBet = 0) {
  return compareScores(scoreOop, scoreIp) * (pot / 2 + calledBet);
}

function sampleCompatibleDeal(solver, rng = solver.rng) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const oopIndex = weightedIndex(
      solver.oopDistribution.cumulative,
      solver.oopDistribution.total,
      rng.next(),
    );
    const ipIndex = weightedIndex(
      solver.ipDistribution.cumulative,
      solver.ipDistribution.total,
      rng.next(),
    );
    if (!handsOverlap(solver.oopCombos[oopIndex], solver.ipCombos[ipIndex])) {
      return [oopIndex, ipIndex];
    }
  }

  let target = rng.next() * solver.validDealWeight;
  for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
    const oop = solver.oopCombos[oopIndex];
    for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
      const ip = solver.ipCombos[ipIndex];
      if (handsOverlap(oop, ip)) continue;
      target -= oop.weight * ip.weight;
      if (target <= 0) return [oopIndex, ipIndex];
    }
  }
  throw new Error("Failed to sample a compatible private-card deal.");
}

function sampleRunoutScores(solver, oopIndex, ipIndex, rng = solver.rng) {
  const oop = solver.oopCombos[oopIndex];
  const ip = solver.ipCombos[ipIndex];
  const excluded = [...solver.board, ...oop.cards, ...ip.cards];
  const deck = createDeck(excluded);
  const needed = 5 - solver.board.length;
  const runout = [];
  for (let index = 0; index < needed; index += 1) {
    const chosen = index + Math.floor(rng.next() * (deck.length - index));
    [deck[index], deck[chosen]] = [deck[chosen], deck[index]];
    runout.push(deck[index]);
  }
  const fullBoard = [...solver.board, ...runout];
  return [
    evaluate7([...oop.cards, ...fullBoard]),
    evaluate7([...ip.cards, ...fullBoard]),
  ];
}

function computeValidDealWeight(solver) {
  let total = 0;
  for (const oop of solver.oopCombos) {
    for (const ip of solver.ipCombos) {
      if (!handsOverlap(oop, ip)) total += oop.weight * ip.weight;
    }
  }
  return total;
}

function averageStrategies(solver) {
  const oopRoot = solver.oopCombos.map((_, index) =>
    averageRow(solver.oopRootSum, solver.oopRootRegret, index * solver.oopActions, solver.oopActions),
  );
  const ipAfterCheck = solver.ipCombos.map((_, index) =>
    averageRow(solver.ipAfterSum, solver.ipAfterRegret, index * solver.ipActions, solver.ipActions),
  );
  const ipVsOopBet = solver.config.oopBetSizes.map((_, betIndex) =>
    solver.ipCombos.map((__, comboIndex) =>
      averageRow(
        solver.ipVsOopSum[betIndex],
        solver.ipVsOopRegret[betIndex],
        comboIndex * 2,
        2,
      ),
    ),
  );
  const oopVsIpBet = solver.config.ipBetSizes.map((_, betIndex) =>
    solver.oopCombos.map((__, comboIndex) =>
      averageRow(
        solver.oopVsIpSum[betIndex],
        solver.oopVsIpRegret[betIndex],
        comboIndex * 2,
        2,
      ),
    ),
  );
  return { oopRoot, ipAfterCheck, ipVsOopBet, oopVsIpBet };
}

function sampledState(solver, rng) {
  const [oopIndex, ipIndex] = sampleCompatibleDeal(solver, rng);
  const [scoreOop, scoreIp] = sampleRunoutScores(solver, oopIndex, ipIndex, rng);
  return { oopIndex, ipIndex, scoreOop, scoreIp };
}

function profileDealValue(solver, strategies, state) {
  const { oopIndex, ipIndex, scoreOop, scoreIp } = state;
  const { pot, oopBetSizes, ipBetSizes } = solver.config;
  const noBet = showdownUtility(scoreOop, scoreIp, pot, 0);

  const ipAfter = strategies.ipAfterCheck[ipIndex];
  let checkValue = ipAfter[0] * noBet;
  for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
    const response = strategies.oopVsIpBet[betIndex][oopIndex];
    const branch =
      response[0] * (-pot / 2) +
      response[1] * showdownUtility(scoreOop, scoreIp, pot, ipBetSizes[betIndex]);
    checkValue += ipAfter[betIndex + 1] * branch;
  }

  const root = strategies.oopRoot[oopIndex];
  let value = root[0] * checkValue;
  for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
    const response = strategies.ipVsOopBet[betIndex][ipIndex];
    const branch =
      response[0] * (pot / 2) +
      response[1] * showdownUtility(scoreOop, scoreIp, pot, oopBetSizes[betIndex]);
    value += root[betIndex + 1] * branch;
  }
  return value;
}

function chooseBinaryActions(scoreRows, comboCount) {
  return scoreRows.map((scores) => {
    const actions = new Uint8Array(comboCount);
    for (let comboIndex = 0; comboIndex < comboCount; comboIndex += 1) {
      actions[comboIndex] = scores[comboIndex * 2 + 1] > scores[comboIndex * 2] ? 1 : 0;
    }
    return actions;
  });
}

function chooseActions(scores, comboCount, actionCount) {
  const actions = new Uint16Array(comboCount);
  for (let comboIndex = 0; comboIndex < comboCount; comboIndex += 1) {
    const offset = comboIndex * actionCount;
    let best = 0;
    for (let action = 1; action < actionCount; action += 1) {
      if (scores[offset + action] > scores[offset + best]) best = action;
    }
    actions[comboIndex] = best;
  }
  return actions;
}

function estimateProfile(solver, strategies, samples, seed) {
  const rng = new XorShift32(seed);
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = profileDealValue(solver, strategies, sampledState(solver, rng));
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / samples;
  const variance = Math.max(0, sumSquares / samples - mean * mean);
  return { value: mean, standardError: Math.sqrt(variance / samples) };
}

function estimateBestResponseOop(solver, strategies, samples, seed) {
  const { pot, oopBetSizes, ipBetSizes } = solver.config;
  const responseScores = ipBetSizes.map(() => new Float64Array(solver.oopCombos.length * 2));
  let rng = new XorShift32(seed);

  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const ipAfter = strategies.ipAfterCheck[state.ipIndex];
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const reach = ipAfter[betIndex + 1];
      const offset = state.oopIndex * 2;
      responseScores[betIndex][offset] += reach * (-pot / 2);
      responseScores[betIndex][offset + 1] +=
        reach * showdownUtility(state.scoreOop, state.scoreIp, pot, ipBetSizes[betIndex]);
    }
  }
  const responseActions = chooseBinaryActions(responseScores, solver.oopCombos.length);

  const rootScores = new Float64Array(solver.oopCombos.length * solver.oopActions);
  rng = new XorShift32(seed ^ 0x6a09e667);
  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const ipAfter = strategies.ipAfterCheck[state.ipIndex];
    const noBet = showdownUtility(state.scoreOop, state.scoreIp, pot, 0);
    let checkValue = ipAfter[0] * noBet;
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const call = responseActions[betIndex][state.oopIndex] === 1;
      const responseValue = call
        ? showdownUtility(state.scoreOop, state.scoreIp, pot, ipBetSizes[betIndex])
        : -pot / 2;
      checkValue += ipAfter[betIndex + 1] * responseValue;
    }

    const offset = state.oopIndex * solver.oopActions;
    rootScores[offset] += checkValue;
    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const response = strategies.ipVsOopBet[betIndex][state.ipIndex];
      rootScores[offset + betIndex + 1] +=
        response[0] * (pot / 2) +
        response[1] * showdownUtility(state.scoreOop, state.scoreIp, pot, oopBetSizes[betIndex]);
    }
  }
  const rootActions = chooseActions(rootScores, solver.oopCombos.length, solver.oopActions);

  rng = new XorShift32(seed ^ 0xbb67ae85);
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const rootAction = rootActions[state.oopIndex];
    if (rootAction === 0) {
      const ipAfter = strategies.ipAfterCheck[state.ipIndex];
      let value = ipAfter[0] * showdownUtility(state.scoreOop, state.scoreIp, pot, 0);
      for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
        const call = responseActions[betIndex][state.oopIndex] === 1;
        const branch = call
          ? showdownUtility(state.scoreOop, state.scoreIp, pot, ipBetSizes[betIndex])
          : -pot / 2;
        value += ipAfter[betIndex + 1] * branch;
      }
      total += value;
    } else {
      const betIndex = rootAction - 1;
      const response = strategies.ipVsOopBet[betIndex][state.ipIndex];
      total +=
        response[0] * (pot / 2) +
        response[1] * showdownUtility(state.scoreOop, state.scoreIp, pot, oopBetSizes[betIndex]);
    }
  }
  return { value: total / samples, rootActions, responseActions };
}

function estimateBestResponseIp(solver, strategies, samples, seed) {
  const { pot, oopBetSizes, ipBetSizes } = solver.config;
  const responseScores = oopBetSizes.map(() => new Float64Array(solver.ipCombos.length * 2));
  let rng = new XorShift32(seed);

  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const root = strategies.oopRoot[state.oopIndex];
    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const reach = root[betIndex + 1];
      const offset = state.ipIndex * 2;
      responseScores[betIndex][offset] += reach * (-pot / 2);
      responseScores[betIndex][offset + 1] +=
        reach * -showdownUtility(state.scoreOop, state.scoreIp, pot, oopBetSizes[betIndex]);
    }
  }
  const responseActions = chooseBinaryActions(responseScores, solver.ipCombos.length);

  const afterScores = new Float64Array(solver.ipCombos.length * solver.ipActions);
  rng = new XorShift32(seed ^ 0x3c6ef372);
  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const rootReach = strategies.oopRoot[state.oopIndex][0];
    const offset = state.ipIndex * solver.ipActions;
    afterScores[offset] += rootReach * -showdownUtility(state.scoreOop, state.scoreIp, pot, 0);
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const response = strategies.oopVsIpBet[betIndex][state.oopIndex];
      const p0Value =
        response[0] * (-pot / 2) +
        response[1] * showdownUtility(state.scoreOop, state.scoreIp, pot, ipBetSizes[betIndex]);
      afterScores[offset + betIndex + 1] += rootReach * -p0Value;
    }
  }
  const afterActions = chooseActions(afterScores, solver.ipCombos.length, solver.ipActions);

  rng = new XorShift32(seed ^ 0xa54ff53a);
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const state = sampledState(solver, rng);
    const root = strategies.oopRoot[state.oopIndex];
    let value = 0;

    const afterAction = afterActions[state.ipIndex];
    if (afterAction === 0) {
      value += root[0] * -showdownUtility(state.scoreOop, state.scoreIp, pot, 0);
    } else {
      const betIndex = afterAction - 1;
      const response = strategies.oopVsIpBet[betIndex][state.oopIndex];
      const p0Value =
        response[0] * (-pot / 2) +
        response[1] * showdownUtility(state.scoreOop, state.scoreIp, pot, ipBetSizes[betIndex]);
      value += root[0] * -p0Value;
    }

    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const call = responseActions[betIndex][state.ipIndex] === 1;
      const branch = call
        ? -showdownUtility(state.scoreOop, state.scoreIp, pot, oopBetSizes[betIndex])
        : -pot / 2;
      value += root[betIndex + 1] * branch;
    }
    total += value;
  }
  return { value: total / samples, afterActions, responseActions };
}

function evaluateSampled(solver, strategies) {
  const samples = solver.config.evaluationSamples;
  const profile = estimateProfile(solver, strategies, samples, solver.config.seed ^ 0x510e527f);
  const oopResponse = estimateBestResponseOop(
    solver,
    strategies,
    samples,
    solver.config.seed ^ 0x9b05688c,
  );
  const ipResponse = estimateBestResponseIp(
    solver,
    strategies,
    samples,
    solver.config.seed ^ 0x1f83d9ab,
  );
  const profileValueIp = -profile.value;
  const nashConv = Math.max(
    0,
    oopResponse.value - profile.value + (ipResponse.value - profileValueIp),
  );
  return {
    profileValueOop: profile.value,
    profileValueIp,
    profileStandardError: profile.standardError,
    bestResponseValueOop: oopResponse.value,
    bestResponseValueIp: ipResponse.value,
    nashConv,
    exploitability: nashConv / 2,
    exact: false,
    evaluationSamples: samples,
    method: "Monte Carlo information-consistent best-response estimate",
  };
}

export class HoldemPostflopSolver {
  constructor(rawConfig) {
    this.config = validatePostflopConfig(rawConfig);
    this.board = this.config.board;
    this.oopCombos = expandRange(this.config.oopRange, this.board);
    this.ipCombos = expandRange(this.config.ipRange, this.board);
    if (this.oopCombos.length === 0) throw new Error("OOP range has no unblocked combinations on this board.");
    if (this.ipCombos.length === 0) throw new Error("IP range has no unblocked combinations on this board.");

    for (const combo of this.oopCombos) combo.category = madeHandCategory(combo, this.board);
    for (const combo of this.ipCombos) combo.category = madeHandCategory(combo, this.board);

    this.oopActions = 1 + this.config.oopBetSizes.length;
    this.ipActions = 1 + this.config.ipBetSizes.length;
    this.oopRootRegret = new Float64Array(this.oopCombos.length * this.oopActions);
    this.oopRootSum = new Float64Array(this.oopCombos.length * this.oopActions);
    this.ipAfterRegret = new Float64Array(this.ipCombos.length * this.ipActions);
    this.ipAfterSum = new Float64Array(this.ipCombos.length * this.ipActions);
    this.ipVsOopRegret = this.config.oopBetSizes.map(() => new Float64Array(this.ipCombos.length * 2));
    this.ipVsOopSum = this.config.oopBetSizes.map(() => new Float64Array(this.ipCombos.length * 2));
    this.oopVsIpRegret = this.config.ipBetSizes.map(() => new Float64Array(this.oopCombos.length * 2));
    this.oopVsIpSum = this.config.ipBetSizes.map(() => new Float64Array(this.oopCombos.length * 2));

    this.oopDistribution = cumulativeWeights(this.oopCombos);
    this.ipDistribution = cumulativeWeights(this.ipCombos);
    this.rng = new XorShift32(this.config.seed);
    this.iteration = 0;
    this.validDealWeight = computeValidDealWeight(this);
    if (this.validDealWeight <= EPSILON) throw new Error("The configured ranges contain no mutually compatible deals.");
  }

  trainIteration() {
    this.iteration += 1;
    const [oopIndex, ipIndex] = sampleCompatibleDeal(this);
    const [scoreOop, scoreIp] = sampleRunoutScores(this, oopIndex, ipIndex);
    const { pot, oopBetSizes, ipBetSizes, averagingDelay } = this.config;

    const oopStrategy = new Float64Array(this.oopActions);
    const ipStrategy = new Float64Array(this.ipActions);
    strategyFromRegrets(this.oopRootRegret, oopIndex * this.oopActions, this.oopActions, oopStrategy);
    strategyFromRegrets(this.ipAfterRegret, ipIndex * this.ipActions, this.ipActions, ipStrategy);

    const noBetShowdown = showdownUtility(scoreOop, scoreIp, pot, 0);
    const oopRootActionValues = new Float64Array(this.oopActions);
    const ipAfterActionValues = new Float64Array(this.ipActions);
    const oopResponseStrategies = [];
    const oopResponseValues = [];
    const ipResponseStrategies = [];
    const ipResponseValues = [];

    ipAfterActionValues[0] = -noBetShowdown;
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const response = new Float64Array(2);
      strategyFromRegrets(this.oopVsIpRegret[betIndex], oopIndex * 2, 2, response);
      const foldValue = -pot / 2;
      const callValue = showdownUtility(scoreOop, scoreIp, pot, ipBetSizes[betIndex]);
      const nodeValue = response[0] * foldValue + response[1] * callValue;
      oopResponseStrategies.push(response);
      oopResponseValues.push({ foldValue, callValue, nodeValue });
      ipAfterActionValues[betIndex + 1] = -nodeValue;
    }

    let checkValue = 0;
    for (let action = 0; action < this.ipActions; action += 1) {
      checkValue += ipStrategy[action] * -ipAfterActionValues[action];
    }
    oopRootActionValues[0] = checkValue;

    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const response = new Float64Array(2);
      strategyFromRegrets(this.ipVsOopRegret[betIndex], ipIndex * 2, 2, response);
      const winOnFold = pot / 2;
      const valueOnCall = showdownUtility(scoreOop, scoreIp, pot, oopBetSizes[betIndex]);
      const nodeValueOop = response[0] * winOnFold + response[1] * valueOnCall;
      ipResponseStrategies.push(response);
      ipResponseValues.push({
        foldValueIp: -winOnFold,
        callValueIp: -valueOnCall,
        nodeValueIp: -nodeValueOop,
      });
      oopRootActionValues[betIndex + 1] = nodeValueOop;
    }

    let oopRootValue = 0;
    for (let action = 0; action < this.oopActions; action += 1) {
      oopRootValue += oopStrategy[action] * oopRootActionValues[action];
    }
    let ipAfterValue = 0;
    for (let action = 0; action < this.ipActions; action += 1) {
      ipAfterValue += ipStrategy[action] * ipAfterActionValues[action];
    }

    updateRegretRow(
      this.oopRootRegret,
      oopIndex * this.oopActions,
      oopRootActionValues,
      oopRootValue,
      1,
    );
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const values = oopResponseValues[betIndex];
      updateRegretRow(
        this.oopVsIpRegret[betIndex],
        oopIndex * 2,
        [values.foldValue, values.callValue],
        values.nodeValue,
        ipStrategy[betIndex + 1],
      );
    }

    updateRegretRow(
      this.ipAfterRegret,
      ipIndex * this.ipActions,
      ipAfterActionValues,
      ipAfterValue,
      oopStrategy[0],
    );
    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const values = ipResponseValues[betIndex];
      updateRegretRow(
        this.ipVsOopRegret[betIndex],
        ipIndex * 2,
        [values.foldValueIp, values.callValueIp],
        values.nodeValueIp,
        oopStrategy[betIndex + 1],
      );
    }

    const linearWeight = Math.max(0, this.iteration - averagingDelay);
    if (linearWeight > 0) {
      accumulateAverage(this.oopRootSum, oopIndex * this.oopActions, oopStrategy, linearWeight);
      for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
        accumulateAverage(
          this.oopVsIpSum[betIndex],
          oopIndex * 2,
          oopResponseStrategies[betIndex],
          linearWeight * oopStrategy[0],
        );
      }
      accumulateAverage(this.ipAfterSum, ipIndex * this.ipActions, ipStrategy, linearWeight);
      for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
        accumulateAverage(
          this.ipVsOopSum[betIndex],
          ipIndex * 2,
          ipResponseStrategies[betIndex],
          linearWeight,
        );
      }
    }
  }

  async train({ onProgress = null, isCancelled = null, yieldEvery = 5_000 } = {}) {
    const target = this.config.iterations;
    const batchSize = Math.max(100, Math.min(yieldEvery, this.config.progressEvery));
    while (this.iteration < target) {
      const stop = Math.min(target, this.iteration + batchSize);
      while (this.iteration < stop) this.trainIteration();
      if (isCancelled?.()) throw new CancelledSolveError();
      onProgress?.({ iteration: this.iteration, target, fraction: this.iteration / target });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return this;
  }

  averageStrategies() {
    return averageStrategies(this);
  }

  evaluate(strategies = this.averageStrategies()) {
    return evaluateSampled(this, strategies);
  }

  result() {
    const strategies = this.averageStrategies();
    const evaluation = this.evaluate(strategies);
    const streetLabel = `${this.config.street[0].toUpperCase()}${this.config.street.slice(1)}`;
    const nodes = [
      {
        id: "oop-root",
        label: `${streetLabel}: OOP first action`,
        player: "OOP",
        actionLabels: actionLabels("Bet", this.config.oopBetSizes),
        combos: this.oopCombos,
        strategies: strategies.oopRoot,
      },
      {
        id: "ip-after-check",
        label: `${streetLabel}: IP after OOP checks`,
        player: "IP",
        actionLabels: actionLabels("Bet", this.config.ipBetSizes),
        combos: this.ipCombos,
        strategies: strategies.ipAfterCheck,
      },
      ...this.config.oopBetSizes.map((size, index) => ({
        id: `ip-vs-oop-bet-${index}`,
        label: `${streetLabel}: IP facing OOP bet ${formatNumber(size)}`,
        player: "IP",
        actionLabels: responseLabels(),
        combos: this.ipCombos,
        strategies: strategies.ipVsOopBet[index],
      })),
      ...this.config.ipBetSizes.map((size, index) => ({
        id: `oop-vs-ip-bet-${index}`,
        label: `${streetLabel}: OOP facing IP bet ${formatNumber(size)}`,
        player: "OOP",
        actionLabels: responseLabels(),
        combos: this.oopCombos,
        strategies: strategies.oopVsIpBet[index],
      })),
    ];

    return {
      schemaVersion: 2,
      game: `heads-up two-card Texas Hold'em ${this.config.street}`,
      abstraction: {
        street: this.config.street,
        raises: false,
        futureStreetModel: "chance-sampled check-down runouts",
        terminalActions: ["check", "bet", "fold", "call"],
      },
      config: { ...this.config, board: [...this.board] },
      iterations: this.iteration,
      ranges: {
        oop: serializeRangeSummary(summarizeRange(this.oopCombos)),
        ip: serializeRangeSummary(summarizeRange(this.ipCombos)),
      },
      compatibleDealWeight: this.validDealWeight,
      evaluation,
      nodes: nodes.map((node) => ({
        ...node,
        combos: node.combos.map((combo) => ({
          key: combo.key,
          cards: combo.cards,
          classLabel: combo.classLabel,
          display: combo.display,
          weight: combo.weight,
          category: combo.category,
        })),
      })),
    };
  }
}

export async function solveHoldemPostflop(config, hooks = {}) {
  const solver = new HoldemPostflopSolver(config);
  await solver.train(hooks);
  return solver.result();
}

export { validatePostflopConfig };
