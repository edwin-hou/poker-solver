/** Training passes around the HoldemRiverSolver state arrays. */

import { handsOverlap } from "./cards.js";
import { CancelledSolveError, averageRow, weightedIndex } from "./solver-support.js";

export function computeValidDealWeightSolver(solver) {
    let total = 0;
    for (const oop of solver.oopCombos) {
      for (const ip of solver.ipCombos) {
        if (!handsOverlap(oop, ip)) total += oop.weight * ip.weight;
      }
    }
    return total;
  }

export function sampleDealSolver(solver) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const oopIndex = weightedIndex(
        solver.oopDistribution.cumulative,
        solver.oopDistribution.total,
        solver.rng.next(),
      );
      const ipIndex = weightedIndex(
        solver.ipDistribution.cumulative,
        solver.ipDistribution.total,
        solver.rng.next(),
      );
      if (!handsOverlap(solver.oopCombos[oopIndex], solver.ipCombos[ipIndex])) return [oopIndex, ipIndex];
    }
    // Extremely blocker-heavy ranges: exact weighted fallback.
    let target = solver.rng.next() * solver.validDealWeight;
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

export async function trainSolver(solver, { onProgress = null, isCancelled = null, yieldEvery = 5_000 } = {}) {
    const target = solver.config.iterations;
    const batchSize = Math.max(100, Math.min(yieldEvery, solver.config.progressEvery));
    while (solver.iteration < target) {
      const stop = Math.min(target, solver.iteration + batchSize);
      while (solver.iteration < stop) solver.trainIteration();
      if (isCancelled?.()) throw new CancelledSolveError();
      onProgress?.({
        iteration: solver.iteration,
        target,
        fraction: solver.iteration / target,
      });
      // Let a Web Worker receive cancellation messages and paint progress.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return this;
  }

export function averageStrategiesSolver(solver) {
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

