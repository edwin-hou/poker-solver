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

function takesEveryAction(range, contexts, action) {
  return range.filter((combo) => contexts.every((context) =>
    fishActionForCombo(combo, context) === action));
}

function baseCommitment(seat, bigBlind) {
  if (seat.id === "sb") return 2;
  if (seat.id === "bb") return bigBlind;
  return 0;
}

function unopenedContext(position, openBb = 4) {
  return { type: "sixmax-unopened", position, openBb };
}

function afterLimpContext(position, openBb = 4, limperCount = 1) {
  return { type: "sixmax-after-limp", position, openBb, limperCount };
}

function vsOpenContext(position, openerPosition, openBb, details = {}) {
  return { type: "sixmax-vs-open", position, openerPosition, openBb, ...details };
}

function vsThreeBetContext(position, threeBettorPosition, threeBetBb, details = {}) {
  return { type: "preflop-vs-threebet", position, threeBettorPosition, threeBetBb, ...details };
}

function vsFourBetContext(position, fourBettorPosition, fourBetBb, details = {}) {
  return { type: "preflop-vs-fourbet", position, fourBettorPosition, fourBetBb, ...details };
}

function limpedPlan({ bigBlind, random }) {
  const limperCount = random() < 0.58 ? 2 : 1;
  const choices = limperCount === 1
    ? [[EARLY_POSITIONS[Math.floor(random() * EARLY_POSITIONS.length)]]]
    : [["utg", "hj"], ["utg", "co"], ["hj", "co"]];
  const limperIds = new Set(choices[Math.floor(random() * choices.length)]);
  const firstLimperIndex = Math.min(...[...limperIds].map((id) => EARLY_POSITIONS.indexOf(id)));
  const smallTarget = 15 + Math.max(0, limperCount - 1) * bigBlind;
  const largeTarget = 21 + Math.max(0, limperCount - 1) * bigBlind;
  const responseContextsFor = (id) => {
    const seat = SIX_HANDED_OPPONENTS.find((entry) => entry.id === id);
    return [smallTarget, largeTarget].map((target) => ({
      type: "preflop-vs-open",
      position: seat.position,
      openerPosition: "BTN",
      openBb: target / bigBlind,
      priorAction: limperIds.has(id) ? "limped" : "blind",
      coldCallerCount: limperCount,
    }));
  };
  const plans = new Map();

  for (const id of EARLY_POSITIONS) {
    const seat = SIX_HANDED_OPPONENTS.find((entry) => entry.id === id);
    const index = EARLY_POSITIONS.indexOf(id);
    const context = index <= firstLimperIndex
      ? unopenedContext(seat.position)
      : afterLimpContext(seat.position, 4, limperCount);
    const action = limperIds.has(id) ? "limp" : "fold";
    plans.set(id, {
      action,
      context,
      committed: action === "limp" ? bigBlind : 0,
      status: action === "limp" ? `Limped ${bigBlind}` : "Folded preflop",
      text: action === "limp" ? `limps ${bigBlind}` : "folds",
      provenance: action === "limp"
        ? "Keep the wide, call-first hands this online loose-passive profile enters without raising."
        : "Remove the obvious premiums and playable hands this online loose-passive profile would enter.",
    });
  }

  const designatedLimper = [...limperIds][0];
  return {
    kind: "limped",
    plans,
    constraints: new Map([
      [designatedLimper, (range) => takesEveryAction(range, responseContextsFor(designatedLimper), "call")],
      ["bb", (range) => takesEveryAction(range, responseContextsFor("bb"), "call")],
      ["sb", (range) => range.filter((combo) => responseContextsFor("sb").every((context) =>
        fishActionForCombo(combo, context) !== "raise"))],
    ]),
    limperCount,
    callerCount: 0,
    openAmount: 0,
    openerId: null,
    smallTarget,
    largeTarget,
    startingPot: 6 + limperCount * bigBlind,
    spotLabel: `BTN versus ${limperCount} limper${limperCount === 1 ? "" : "s"}`,
  };
}

function raisedPlan({ bigBlind, random }) {
  const openAmount = 12;
  const openBb = openAmount / bigBlind;
  const openerId = random() < 0.55 ? "utg" : "hj";
  const opener = SIX_HANDED_OPPONENTS.find((seat) => seat.id === openerId);
  const laterIds = EARLY_POSITIONS.slice(EARLY_POSITIONS.indexOf(openerId) + 1);
  const callerId = laterIds[Math.floor(random() * laterIds.length)];
  const caller = SIX_HANDED_OPPONENTS.find((seat) => seat.id === callerId);
  const smallTarget = 48;
  const largeTarget = 60;
  const threeBetContextsFor = (position, priorAction) => [smallTarget, largeTarget].map((target) =>
    vsThreeBetContext(position, "BTN", target / bigBlind, {
      priorAction,
      openerPosition: opener.position,
      coldCallerCount: 1,
    }));
  const plans = new Map();

  for (const id of EARLY_POSITIONS) {
    const seat = SIX_HANDED_OPPONENTS.find((entry) => entry.id === id);
    const index = EARLY_POSITIONS.indexOf(id);
    const openerIndex = EARLY_POSITIONS.indexOf(openerId);
    if (index < openerIndex) {
      plans.set(id, {
        action: "fold",
        context: unopenedContext(seat.position, openBb),
        committed: 0,
        status: "Folded preflop",
        text: "folds",
        provenance: "Keep only hands outside this online loose-passive seat's position-aware entering range.",
      });
      continue;
    }
    if (id === openerId) {
      plans.set(id, {
        action: "raise",
        context: unopenedContext(seat.position, openBb),
        committed: openAmount,
        status: `Raised to ${openAmount}`,
        text: `raises to ${openAmount}`,
        provenance: "Keep the obvious value and broadway hands this online loose-passive seat raises instead of limping.",
      });
      continue;
    }
    const action = id === callerId ? "call" : "fold";
    const coldCallerCount = EARLY_POSITIONS.indexOf(callerId) < index ? 1 : 0;
    plans.set(id, {
      action,
      context: vsOpenContext(seat.position, opener.position, openBb, {
        priorAction: "none",
        coldCallerCount,
      }),
      committed: action === "call" ? openAmount : 0,
      status: action === "call" ? `Called ${openAmount}` : "Folded preflop",
      text: action === "call" ? `calls ${openAmount}` : "folds",
      provenance: `Apply the ${seat.position} online loose-passive response using the opener's position, size, and any caller already in the pot.`,
    });
  }

  const constraints = new Map([
    [openerId, (range) => {
      const contexts = threeBetContextsFor(opener.position, "opened");
      return actionRange(range, contexts[0], "call")
        .filter((combo) => fishActionForCombo(combo, contexts[1]) !== "raise");
    }],
    [callerId, (range) => {
      const contexts = threeBetContextsFor(caller.position, "cold-called");
      return actionRange(range, contexts[0], "call")
        .filter((combo) => fishActionForCombo(combo, contexts[1]) !== "raise");
    }],
  ]);
  for (const blindId of ["sb", "bb"]) {
    const blind = SIX_HANDED_OPPONENTS.find((seat) => seat.id === blindId);
    const context = vsOpenContext(blind.position, opener.position, openBb, {
      priorAction: "blind",
      coldCallerCount: 1,
    });
    constraints.set(blindId, (range) => range.filter((combo) =>
      fishActionForCombo(combo, context) !== "raise"));
  }

  return {
    kind: "raised",
    plans,
    constraints,
    limperCount: 0,
    callerCount: 1,
    openAmount,
    openerId,
    smallTarget,
    largeTarget,
    startingPot: 6 + openAmount * 2,
    spotLabel: `BTN facing ${opener.position} raise + 1 caller`,
  };
}

function threeBetPlan({ bigBlind, random }) {
  const openAmount = 12;
  const threeBetAmount = 42;
  const openBb = openAmount / bigBlind;
  const threeBetBb = threeBetAmount / bigBlind;
  const openerId = "utg";
  const threeBettorId = random() < 0.5 ? "hj" : "co";
  const opener = SIX_HANDED_OPPONENTS.find((seat) => seat.id === openerId);
  const threeBettor = SIX_HANDED_OPPONENTS.find((seat) => seat.id === threeBettorId);
  const smallTarget = 105;
  const largeTarget = 126;
  const fourBetContextsFor = (position, priorAction) => [smallTarget, largeTarget].map((target) =>
    vsFourBetContext(position, "BTN", target / bigBlind, {
      priorAction,
      openerPosition: opener.position,
      threeBettorPosition: threeBettor.position,
    }));
  const plans = new Map();

  for (const id of EARLY_POSITIONS) {
    const seat = SIX_HANDED_OPPONENTS.find((entry) => entry.id === id);
    if (id === openerId) {
      plans.set(id, {
        action: "raise",
        context: unopenedContext(seat.position, openBb),
        committed: openAmount,
        status: `Raised to ${openAmount}`,
        text: `raises to ${openAmount}`,
        provenance: "Keep the obvious value and broadway hands this online loose-passive seat raises instead of limping.",
      });
      continue;
    }
    if (id === threeBettorId) {
      plans.set(id, {
        action: "raise",
        context: vsOpenContext(seat.position, opener.position, openBb, {
          priorAction: "none",
          coldCallerCount: 0,
        }),
        committed: threeBetAmount,
        status: `3-bet to ${threeBetAmount}`,
        text: `3-bets to ${threeBetAmount}`,
        provenance: `Keep the value-heavy hands this ${seat.position} profile reraises after accounting for the UTG open, position, and lack of dead-money callers.`,
      });
      continue;
    }
    const facingThreeBet = EARLY_POSITIONS.indexOf(id) > EARLY_POSITIONS.indexOf(threeBettorId);
    plans.set(id, {
      action: "fold",
      context: facingThreeBet
        ? vsThreeBetContext(seat.position, threeBettor.position, threeBetBb, {
          priorAction: "none",
          openerPosition: opener.position,
        })
        : vsOpenContext(seat.position, opener.position, openBb, {
          priorAction: "none",
          coldCallerCount: 0,
        }),
      committed: 0,
      status: "Folded preflop",
      text: "folds",
      provenance: facingThreeBet
        ? "Keep hands this seat releases after considering the 3-bet size, positions, and the fact it has not invested voluntarily."
        : `Keep hands below this online loose-passive ${seat.position} seat's position-aware call and value-reraise ranges.`,
    });
  }

  const openerFacingThreeBet = vsThreeBetContext(opener.position, threeBettor.position, threeBetBb, {
    priorAction: "opened",
    openerPosition: opener.position,
  });
  const constraints = new Map([
    [openerId, (range) => actionRange(range, openerFacingThreeBet, "call")
      .filter((combo) => fourBetContextsFor(opener.position, "opened").every((context) =>
        fishActionForCombo(combo, context) !== "raise"))],
    [threeBettorId, (range) => takesEveryAction(
      range,
      fourBetContextsFor(threeBettor.position, "threebet"),
      "call",
    )],
  ]);
  for (const blindId of ["sb", "bb"]) {
    const blind = SIX_HANDED_OPPONENTS.find((seat) => seat.id === blindId);
    const contexts = [
      vsThreeBetContext(blind.position, threeBettor.position, threeBetBb, {
        priorAction: "blind",
        openerPosition: opener.position,
      }),
      ...fourBetContextsFor(blind.position, "blind"),
    ];
    constraints.set(blindId, (range) => range.filter((combo) => contexts.every((context) =>
      fishActionForCombo(combo, context) !== "raise")));
  }

  return {
    kind: "threebet",
    plans,
    constraints,
    limperCount: 0,
    callerCount: 0,
    openAmount,
    openerId,
    threeBetAmount,
    threeBettorId,
    smallTarget,
    largeTarget,
    startingPot: 6 + openAmount + threeBetAmount,
    spotLabel: `BTN facing ${opener.position} open + ${threeBettor.position} 3-bet`,
  };
}

/** Build an interesting six-seat BTN spot with limps, a raised pot, or an early 3-bet. */
export function createSixHandedPracticeScenario({
  heroCards,
  bigBlind = 3,
  stack = 450,
  random = Math.random,
  scenarioKind,
} = {}) {
  if (!Array.isArray(heroCards) || heroCards.length !== 2) throw new Error("Six-handed practice needs two hero cards.");
  const roll = random();
  const kind = scenarioKind ?? (roll < 0.35 ? "limped" : roll < 0.78 ? "raised" : "threebet");
  if (!["limped", "raised", "threebet"].includes(kind)) throw new Error(`Unknown six-handed scenario kind: ${kind}`);
  const plan = kind === "threebet"
    ? threeBetPlan({ bigBlind, random })
    : kind === "raised"
      ? raisedPlan({ bigBlind, random })
      : limpedPlan({ bigBlind, random });
  const hiddenCards = [...heroCards];

  const opponents = SIX_HANDED_OPPONENTS.map((seat) => {
    const beliefPrior = createFishRange({ heroCards });
    const dealtPrior = withoutHiddenCards(createFishRange({ heroCards }), hiddenCards);
    const actionPlan = plan.plans.get(seat.id);
    let range = beliefPrior;
    let comboPool = dealtPrior;
    let committed = baseCommitment(seat, bigBlind);
    let status = "Waiting for your action";
    let folded = false;
    const rangeEvents = [{
      street: "preflop",
      text: `${seat.position} starts with every exact combo not blocked by your cards.`,
    }];

    if (actionPlan) {
      range = observeFishAction(range, actionPlan.context, actionPlan.action, heroCards);
      comboPool = actionRange(comboPool, actionPlan.context, actionPlan.action);
      committed = actionPlan.committed;
      status = actionPlan.status;
      folded = actionPlan.action === "fold";
      rangeEvents.push({
        street: "preflop",
        text: `${seat.position} ${actionPlan.text}. ${actionPlan.provenance}`,
      });
    }

    const constraint = plan.constraints.get(seat.id);
    if (constraint) comboPool = constraint(comboPool);
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
      preflopAction: actionPlan?.action ?? null,
    };
  });

  return {
    ...plan,
    opponents,
    heroCommitted: 1,
    heroStack: stack - 1,
    preflopActions: opponents
      .filter((opponent) => EARLY_POSITIONS.includes(opponent.id))
      .map((opponent) => ({
        street: "preflop",
        actor: opponent.position,
        text: plan.plans.get(opponent.id).text,
      })),
  };
}
