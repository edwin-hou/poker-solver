/** Public API for the browser-based two-card Hold'em river solver. */

import { describeScore, evaluateHoldemCombo } from "./cards.js";
import { expandRange, summarizeRange } from "./range.js";
import { bestResponseIpSolver, bestResponseOopSolver, evaluateSolver, profileValueSolver } from "./evaluation.js";
import { trainIterationSolver } from "./solver-iteration.js";
import { averageStrategiesSolver, computeValidDealWeightSolver, sampleDealSolver, trainSolver } from "./solver-training.js";
import {
  EPSILON,
  XorShift32,
  actionLabels,
  cumulativeWeights,
  formatNumber,
  responseLabels,
  serializeRangeSummary,
  validateConfig,
} from "./solver-support.js";

export { CancelledSolveError, parseBetSizes, validateConfig } from "./solver-support.js";

export class HoldemRiverSolver {
  constructor(rawConfig) {
    this.config = validateConfig(rawConfig);
    this.board = this.config.board;
    this.oopCombos = expandRange(this.config.oopRange, this.board);
    this.ipCombos = expandRange(this.config.ipRange, this.board);
    if (this.oopCombos.length === 0) throw new Error("OOP range has no unblocked combinations on this board.");
    if (this.ipCombos.length === 0) throw new Error("IP range has no unblocked combinations on this board.");

    for (const combo of this.oopCombos) {
      combo.score = evaluateHoldemCombo(combo, this.board);
      combo.category = describeScore(combo.score);
    }
    for (const combo of this.ipCombos) {
      combo.score = evaluateHoldemCombo(combo, this.board);
      combo.category = describeScore(combo.score);
    }

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
    this.validDealWeight = this.computeValidDealWeight();
    if (this.validDealWeight <= EPSILON) throw new Error("The configured ranges contain no mutually compatible deals.");
  }

  computeValidDealWeight() { return computeValidDealWeightSolver(this); }
  sampleDeal() { return sampleDealSolver(this); }
  trainIteration() { return trainIterationSolver(this); }
  async train(options = {}) { return trainSolver(this, options); }
  averageStrategies() { return averageStrategiesSolver(this); }
  evaluate(strategies = this.averageStrategies()) { return evaluateSolver(this, strategies); }
  profileValue(strategies) { return profileValueSolver(this, strategies); }
  bestResponseOop(strategies) { return bestResponseOopSolver(this, strategies); }
  bestResponseIp(strategies) { return bestResponseIpSolver(this, strategies); }

  result() {
    const strategies = this.averageStrategies();
    const evaluation = this.evaluate(strategies);
    const nodes = [
      {
        id: "oop-root",
        label: "OOP first action",
        player: "OOP",
        actionLabels: actionLabels("Bet", this.config.oopBetSizes),
        combos: this.oopCombos,
        strategies: strategies.oopRoot,
      },
      {
        id: "ip-after-check",
        label: "IP after OOP checks",
        player: "IP",
        actionLabels: actionLabels("Bet", this.config.ipBetSizes),
        combos: this.ipCombos,
        strategies: strategies.ipAfterCheck,
      },
      ...this.config.oopBetSizes.map((size, index) => ({
        id: `ip-vs-oop-bet-${index}`,
        label: `IP facing OOP bet ${formatNumber(size)}`,
        player: "IP",
        actionLabels: responseLabels(),
        combos: this.ipCombos,
        strategies: strategies.ipVsOopBet[index],
      })),
      ...this.config.ipBetSizes.map((size, index) => ({
        id: `oop-vs-ip-bet-${index}`,
        label: `OOP facing IP bet ${formatNumber(size)}`,
        player: "OOP",
        actionLabels: responseLabels(),
        combos: this.oopCombos,
        strategies: strategies.oopVsIpBet[index],
      })),
    ];

    return {
      schemaVersion: 1,
      game: "heads-up two-card Texas Hold'em river",
      abstraction: {
        street: "river",
        raises: false,
        terminalActions: ["check", "bet", "fold", "call"],
      },
      config: {
        ...this.config,
        board: [...this.board],
      },
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
          score: combo.score,
          category: combo.category,
        })),
      })),
    };
  }
}

export async function solveHoldemRiver(config, hooks = {}) {
  const solver = new HoldemRiverSolver(config);
  await solver.train(hooks);
  return solver.result();
}
