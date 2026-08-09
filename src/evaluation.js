/** Exact profile and information-consistent best-response evaluation. */

import { compareScores, handsOverlap } from "./cards.js";

function showdownUtility(scoreOop, scoreIp, pot, calledBet = 0) {
  const outcome = compareScores(scoreOop, scoreIp);
  return outcome * (pot / 2 + calledBet);
}

export function evaluateSolver(solver, strategies) {
  const profileValueOop = profileValueSolver(solver, strategies);
  const bestResponseOop = bestResponseOopSolver(solver, strategies);
  const bestResponseIp = bestResponseIpSolver(solver, strategies);
  const profileValueIp = -profileValueOop;
  const nashConv = Math.max(
    0,
    bestResponseOop.value - profileValueOop + (bestResponseIp.value - profileValueIp),
  );
  return {
    profileValueOop,
    profileValueIp,
    bestResponseValueOop: bestResponseOop.value,
    bestResponseValueIp: bestResponseIp.value,
    nashConv,
    exploitability: nashConv / 2,
    bestResponseOop,
    bestResponseIp,
  };
}

export function profileValueSolver(solver, strategies) {
    const { pot, oopBetSizes, ipBetSizes } = solver.config;
    let weightedValue = 0;
    for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
      const oop = solver.oopCombos[oopIndex];
      const root = strategies.oopRoot[oopIndex];
      for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
        const ip = solver.ipCombos[ipIndex];
        if (handsOverlap(oop, ip)) continue;
        const dealWeight = oop.weight * ip.weight;
        const noBet = showdownUtility(oop.score, ip.score, pot, 0);
        const ipAfter = strategies.ipAfterCheck[ipIndex];
        let afterCheck = ipAfter[0] * noBet;
        for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
          const response = strategies.oopVsIpBet[betIndex][oopIndex];
          const responseValue =
            response[0] * (-pot / 2) +
            response[1] * showdownUtility(oop.score, ip.score, pot, ipBetSizes[betIndex]);
          afterCheck += ipAfter[betIndex + 1] * responseValue;
        }
        let value = root[0] * afterCheck;
        for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
          const response = strategies.ipVsOopBet[betIndex][ipIndex];
          const betValue =
            response[0] * (pot / 2) +
            response[1] * showdownUtility(oop.score, ip.score, pot, oopBetSizes[betIndex]);
          value += root[betIndex + 1] * betValue;
        }
        weightedValue += dealWeight * value;
      }
    }
    return weightedValue / solver.validDealWeight;
  }

export function bestResponseOopSolver(solver, strategies) {
    const { pot, oopBetSizes, ipBetSizes } = solver.config;
    const responseActions = ipBetSizes.map(() => new Uint8Array(solver.oopCombos.length));

    // One information-consistent fold/call choice for each OOP combo and IP bet size.
    for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
      for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
        const oop = solver.oopCombos[oopIndex];
        let foldScore = 0;
        let callScore = 0;
        for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
          const ip = solver.ipCombos[ipIndex];
          if (handsOverlap(oop, ip)) continue;
          const reach = ip.weight * strategies.ipAfterCheck[ipIndex][betIndex + 1];
          foldScore += reach * (-pot / 2);
          callScore += reach * showdownUtility(oop.score, ip.score, pot, ipBetSizes[betIndex]);
        }
        responseActions[betIndex][oopIndex] = callScore > foldScore ? 1 : 0;
      }
    }

    const rootActions = new Uint8Array(solver.oopCombos.length);
    let total = 0;
    for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
      const oop = solver.oopCombos[oopIndex];
      const actionScores = new Float64Array(solver.oopActions);
      for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
        const ip = solver.ipCombos[ipIndex];
        if (handsOverlap(oop, ip)) continue;
        const opponentWeight = ip.weight;
        const noBet = showdownUtility(oop.score, ip.score, pot, 0);
        const ipAfter = strategies.ipAfterCheck[ipIndex];
        let checkValue = ipAfter[0] * noBet;
        for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
          const call = responseActions[betIndex][oopIndex] === 1;
          const responseValue = call
            ? showdownUtility(oop.score, ip.score, pot, ipBetSizes[betIndex])
            : -pot / 2;
          checkValue += ipAfter[betIndex + 1] * responseValue;
        }
        actionScores[0] += opponentWeight * checkValue;
        for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
          const response = strategies.ipVsOopBet[betIndex][ipIndex];
          const betValue =
            response[0] * (pot / 2) +
            response[1] * showdownUtility(oop.score, ip.score, pot, oopBetSizes[betIndex]);
          actionScores[betIndex + 1] += opponentWeight * betValue;
        }
      }
      let bestAction = 0;
      for (let action = 1; action < actionScores.length; action += 1) {
        if (actionScores[action] > actionScores[bestAction]) bestAction = action;
      }
      rootActions[oopIndex] = bestAction;
      total += oop.weight * actionScores[bestAction];
    }

    return {
      value: total / solver.validDealWeight,
      rootActions: [...rootActions],
      responseActions: responseActions.map((row) => [...row]),
    };
  }

export function bestResponseIpSolver(solver, strategies) {
    const { pot, oopBetSizes, ipBetSizes } = solver.config;
    const responseActions = oopBetSizes.map(() => new Uint8Array(solver.ipCombos.length));

    for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
      for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
        const ip = solver.ipCombos[ipIndex];
        let foldScore = 0;
        let callScore = 0;
        for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
          const oop = solver.oopCombos[oopIndex];
          if (handsOverlap(oop, ip)) continue;
          const reach = oop.weight * strategies.oopRoot[oopIndex][betIndex + 1];
          foldScore += reach * (-pot / 2);
          callScore += reach * -showdownUtility(oop.score, ip.score, pot, oopBetSizes[betIndex]);
        }
        responseActions[betIndex][ipIndex] = callScore > foldScore ? 1 : 0;
      }
    }

    const afterCheckActions = new Uint8Array(solver.ipCombos.length);
    for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
      const ip = solver.ipCombos[ipIndex];
      const scores = new Float64Array(solver.ipActions);
      for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
        const oop = solver.oopCombos[oopIndex];
        if (handsOverlap(oop, ip)) continue;
        const reach = oop.weight * strategies.oopRoot[oopIndex][0];
        scores[0] += reach * -showdownUtility(oop.score, ip.score, pot, 0);
        for (let betIndex = 0; betIndex < ipBetSizes.length; betIndex += 1) {
          const response = strategies.oopVsIpBet[betIndex][oopIndex];
          const p0Value =
            response[0] * (-pot / 2) +
            response[1] * showdownUtility(oop.score, ip.score, pot, ipBetSizes[betIndex]);
          scores[betIndex + 1] += reach * -p0Value;
        }
      }
      let bestAction = 0;
      for (let action = 1; action < scores.length; action += 1) {
        if (scores[action] > scores[bestAction]) bestAction = action;
      }
      afterCheckActions[ipIndex] = bestAction;
    }

    let total = 0;
    for (let ipIndex = 0; ipIndex < solver.ipCombos.length; ipIndex += 1) {
      const ip = solver.ipCombos[ipIndex];
      let comboValue = 0;
      for (let oopIndex = 0; oopIndex < solver.oopCombos.length; oopIndex += 1) {
        const oop = solver.oopCombos[oopIndex];
        if (handsOverlap(oop, ip)) continue;
        const root = strategies.oopRoot[oopIndex];
        const selectedAfterCheck = afterCheckActions[ipIndex];
        let afterCheckValue;
        if (selectedAfterCheck === 0) {
          afterCheckValue = -showdownUtility(oop.score, ip.score, pot, 0);
        } else {
          const betIndex = selectedAfterCheck - 1;
          const response = strategies.oopVsIpBet[betIndex][oopIndex];
          const p0Value =
            response[0] * (-pot / 2) +
            response[1] * showdownUtility(oop.score, ip.score, pot, ipBetSizes[betIndex]);
          afterCheckValue = -p0Value;
        }
        let value = root[0] * afterCheckValue;
        for (let betIndex = 0; betIndex < oopBetSizes.length; betIndex += 1) {
          const call = responseActions[betIndex][ipIndex] === 1;
          const responseValue = call
            ? -showdownUtility(oop.score, ip.score, pot, oopBetSizes[betIndex])
            : -pot / 2;
          value += root[betIndex + 1] * responseValue;
        }
        comboValue += oop.weight * value;
      }
      total += ip.weight * comboValue;
    }

    return {
      value: total / solver.validDealWeight,
      afterCheckActions: [...afterCheckActions],
      responseActions: responseActions.map((row) => [...row]),
    };
  }

