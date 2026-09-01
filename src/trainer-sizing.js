export const POSTFLOP_BET_SIZES = Object.freeze([
  Object.freeze({ id: "bet33", fraction: 0.33, label: "Bet ⅓ pot" }),
  Object.freeze({ id: "bet50", fraction: 0.50, label: "Bet ½ pot" }),
  Object.freeze({ id: "bet67", fraction: 0.67, label: "Bet ⅔ pot" }),
  Object.freeze({ id: "bet75", fraction: 0.75, label: "Bet ¾ pot" }),
  Object.freeze({ id: "bet100", fraction: 1.00, label: "Bet pot" }),
]);

export const POSTFLOP_RAISE_SIZES = Object.freeze([
  Object.freeze({ id: "raiseSmall", multiplier: 2.5, label: "Raise 2.5×" }),
  Object.freeze({ id: "raise", multiplier: 3, label: "Raise 3×" }),
  Object.freeze({ id: "raiseLarge", multiplier: 4, label: "Raise 4×" }),
]);

export function heroAllInTarget({ heroCommitted = 0, heroStack = 0 } = {}) {
  return Math.max(0, Number(heroCommitted) || 0) + Math.max(0, Number(heroStack) || 0);
}

export function postflopBetAmount(pot, fraction, heroStack) {
  const wager = Math.max(1, Math.round(Math.max(0, Number(pot) || 0) * Number(fraction)));
  return Math.min(Math.max(0, Number(heroStack) || 0), wager);
}

export function postflopRaiseTarget({
  heroCommitted = 0,
  heroStack = 0,
  opponentCommitted = 0,
  multiplier = 3,
} = {}) {
  const allInTarget = heroAllInTarget({ heroCommitted, heroStack });
  const callAmount = Math.max(0, opponentCommitted - heroCommitted);
  const minimumFullRaise = opponentCommitted + callAmount;
  const sizedTarget = Math.round(opponentCommitted * multiplier);
  return Math.min(allInTarget, Math.max(minimumFullRaise, sizedTarget));
}

export function fractionForBetChoice(choiceId) {
  return POSTFLOP_BET_SIZES.find((size) => size.id === choiceId)?.fraction ?? null;
}
