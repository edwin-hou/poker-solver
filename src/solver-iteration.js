/** One chance-sampled simultaneous CFR+ update. */

import { handsOverlap } from "./cards.js";
import { accumulateAverage, showdownUtility, strategyFromRegrets, updateRegretRow } from "./solver-support.js";

export function trainIterationSolver(solver) {
    solver.iteration += 1;
    const [oopIndex, ipIndex] = solver.sampleDeal();
    const oopCombo = solver.oopCombos[oopIndex];
    const ipCombo = solver.ipCombos[ipIndex];
    const { pot, oopBetSizes, ipBetSizes, averagingDelay } = solver.config;

    const oopStrategy = new Float64Array(solver.oopActions);
    const ipStrategy = new Float64Array(solver.ipActions);
    strategyFromRegrets(
      solver.oopRootRegret,
      oopIndex * solver.oopActions,
      solver.oopActions,
      oopStrategy,
    );
    strategyFromRegrets(
      solver.ipAfterRegret,
      ipIndex * solver.ipActions,
      solver.ipActions,
      ipStrategy,
    );

    const noBetShowdown = showdownUtility(oopCombo.score, ipCombo.score, pot, 0);
    const oopRootActionValues = new Float64Array(solver.oopActions);
    const ipAfterActionValues = new Float64Array(solver.ipActions);
    const oopResponseStrategies = [];
    const oopResponseValues = [];
    const ipResponseStrategies = [];
    const ipResponseValues = [];

    ipAfterActionValues[0] = -noBetShowdown;
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const response = new Float64Array(2);
      strategyFromRegrets(
        solver.oopVsIpRegret[betIndex],
        oopIndex * 2,
        2,
        response,
      );
      const foldValue = -pot / 2;
      const callValue = showdownUtility(oopCombo.score, ipCombo.score, pot, ipBetSizes[betIndex]);
      const nodeValue = response[0] * foldValue + response[1] * callValue;
      oopResponseStrategies.push(response);
      oopResponseValues.push({ foldValue, callValue, nodeValue });
      ipAfterActionValues[betIndex + 1] = -nodeValue;
    }

    let checkValue = 0;
    for (let action = 0; action < solver.ipActions; action += 1) {
      checkValue += ipStrategy[action] * -ipAfterActionValues[action];
    }
    oopRootActionValues[0] = checkValue;

    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const response = new Float64Array(2);
      strategyFromRegrets(
        solver.ipVsOopRegret[betIndex],
        ipIndex * 2,
        2,
        response,
      );
      const p0WinOnFold = pot / 2;
      const p0ValueOnCall = showdownUtility(oopCombo.score, ipCombo.score, pot, oopBetSizes[betIndex]);
      const p0NodeValue = response[0] * p0WinOnFold + response[1] * p0ValueOnCall;
      ipResponseStrategies.push(response);
      ipResponseValues.push({
        foldValueP1: -p0WinOnFold,
        callValueP1: -p0ValueOnCall,
        nodeValueP1: -p0NodeValue,
      });
      oopRootActionValues[betIndex + 1] = p0NodeValue;
    }

    let oopRootValue = 0;
    for (let action = 0; action < solver.oopActions; action += 1) {
      oopRootValue += oopStrategy[action] * oopRootActionValues[action];
    }

    let ipAfterValue = 0;
    for (let action = 0; action < solver.ipActions; action += 1) {
      ipAfterValue += ipStrategy[action] * ipAfterActionValues[action];
    }

    // Player 0 regrets.
    updateRegretRow(
      solver.oopRootRegret,
      oopIndex * solver.oopActions,
      oopRootActionValues,
      oopRootValue,
      1,
    );
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      const values = oopResponseValues[betIndex];
      updateRegretRow(
        solver.oopVsIpRegret[betIndex],
        oopIndex * 2,
        [values.foldValue, values.callValue],
        values.nodeValue,
        ipStrategy[betIndex + 1],
      );
    }

    // Player 1 regrets.
    updateRegretRow(
      solver.ipAfterRegret,
      ipIndex * solver.ipActions,
      ipAfterActionValues,
      ipAfterValue,
      oopStrategy[0],
    );
    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      const values = ipResponseValues[betIndex];
      updateRegretRow(
        solver.ipVsOopRegret[betIndex],
        ipIndex * 2,
        [values.foldValueP1, values.callValueP1],
        values.nodeValueP1,
        oopStrategy[betIndex + 1],
      );
    }

    const linearWeight = Math.max(0, solver.iteration - averagingDelay);
    if (linearWeight > 0) {
      accumulateAverage(solver.oopRootSum, oopIndex * solver.oopActions, oopStrategy, linearWeight);
      for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
        accumulateAverage(
          solver.oopVsIpSum[betIndex],
          oopIndex * 2,
          oopResponseStrategies[betIndex],
          linearWeight * oopStrategy[0],
        );
      }
      accumulateAverage(solver.ipAfterSum, ipIndex * solver.ipActions, ipStrategy, linearWeight);
      for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
        accumulateAverage(
          solver.ipVsOopSum[betIndex],
          ipIndex * 2,
          ipResponseStrategies[betIndex],
          linearWeight,
        );
      }
    }
  }
