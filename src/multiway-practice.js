import {
  createFishRange,
  fishActionForCombo,
  observeFishAction,
  sampleFishCombo,
} from "./fish-model.js";

export const SIX_HANDED_OPPONENTS = Object.freeze([
  Object.freeze({ id: "utg", position: "UTG", order: 0 }),
  Object.freeze({ id: "hj", position: "HJ", order: 1 }),
  Object.freeze({ id: "co", position: "CO", order: 2 }),
  Object.freeze({ id: "sb", position: "SB", order: 4 }),
  Object.freeze({ id: "bb", position: "BB", order: 5 }),
]);

const EARLY_POSITIONS = Object.freeze(["utg", "hj", "co"]);

function pick(range, random) {
  if (!range.length) throw new Error("No exact combos fit the curated six-handed practice spot.");
  return sampleFishCombo(range, random);
}

function withoutHiddenCards(range, hiddenCards) {
  const blocked = new Set(hiddenCards);
  return range.filter((combo) => combo.cards.every((card) => !blocked.has(card)));
}

function actionRange(range, context, action) {
  return range.filter((combo) => fishActionForCombo(combo, context) === action);
}

function callsBothIsoSizes(range, isoOpenBbs) {
  return range.filter((combo) => isoOpenBbs.every((openBb) =>
    fishActionForCombo(combo, { type: "preflop-vs-open", openBb }) === "call"));
}

function avoidsThreeBetAtBothSizes(range, isoOpenBbs) {
  return range.filter((combo) => isoOpenBbs.every((openBb) =>
    fishActionForCombo(combo, { type: "preflop-vs-open", openBb }) !== "raise"));
}

/** Build a six-seat BTN isolation spot with one or two limpers and guaranteed multiway callers. */
export function createSixHandedPracticeScenario({
  heroCards,
  bigBlind = 3,
  stack = 300,
  random = Math.random,
} = {}) {
  if (!Array.isArray(heroCards) || heroCards.length !== 2) throw new Error("Six-handed practice needs two hero cards.");
  const limperCount = random() < 0.58 ? 2 : 1;
  const offset = Math.floor(random() * EARLY_POSITIONS.length);
  const limperIds = new Set(Array.from({ length: limperCount }, (_, index) =>
    EARLY_POSITIONS[(offset + index) % EARLY_POSITIONS.length]));
  const smallTarget = 15 + Math.max(0, limperCount - 1) * bigBlind;
  const largeTarget = 21 + Math.max(0, limperCount - 1) * bigBlind;
  const isoOpenBbs = [smallTarget / bigBlind, largeTarget / bigBlind];
  const hiddenCards = [...heroCards];
  let designatedLimper = [...limperIds][0];

  const opponents = SIX_HANDED_OPPONENTS.map((seat) => {
    const beliefPrior = createFishRange({ heroCards });
    const dealtPrior = withoutHiddenCards(createFishRange({ heroCards }), hiddenCards);
    let range = beliefPrior;
    let comboPool = dealtPrior;
    let status = "Waiting for your action";
    let folded = false;
    let committed = seat.id === "sb" ? 2 : seat.id === "bb" ? bigBlind : 0;
    const rangeEvents = [{
      street: "preflop",
      text: `${seat.position} starts with every exact combo not blocked by your cards.`,
    }];

    if (EARLY_POSITIONS.includes(seat.id)) {
      const action = limperIds.has(seat.id) ? "limp" : "fold";
      const context = { type: "preflop-unopened", position: seat.position };
      range = observeFishAction(range, context, action, heroCards);
      comboPool = actionRange(comboPool, context, action);
      if (seat.id === designatedLimper) comboPool = callsBothIsoSizes(comboPool, isoOpenBbs);
      status = action === "limp" ? `Limped ${bigBlind}` : "Folded preflop";
      folded = action === "fold";
      committed = action === "limp" ? bigBlind : 0;
      rangeEvents.push({
        street: "preflop",
        text: `${seat.position} ${action === "limp" ? "limps" : "folds"}; keep only exact combos assigned to that unopened-pot action.`,
      });
    } else if (seat.id === "bb") {
      comboPool = callsBothIsoSizes(comboPool, isoOpenBbs);
    } else {
      comboPool = avoidsThreeBetAtBothSizes(comboPool, isoOpenBbs);
    }

    const combo = pick(comboPool, random);
    hiddenCards.push(...combo.cards);
    return {
      ...seat,
      combo,
      range,
      rangeEvents,
      stack: stack - committed,
      committed,
      status,
      folded,
    };
  });

  return {
    opponents,
    limperCount,
    smallTarget,
    largeTarget,
    heroCommitted: 1,
    heroStack: stack - 1,
    startingPot: 6 + limperCount * bigBlind,
    preflopActions: opponents
      .filter((opponent) => EARLY_POSITIONS.includes(opponent.id))
      .map((opponent) => ({
        street: "preflop",
        actor: opponent.position,
        text: opponent.folded ? "folds" : `limps ${bigBlind}`,
      })),
  };
}
