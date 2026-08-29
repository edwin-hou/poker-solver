import {
  HAND_CLASSES,
  cardToHtml,
  cardToString,
  cloneFishRange,
  comboClass,
  compareScores,
  createDeck,
  createFishRange,
  createTrainerTree,
  estimateHeroEquity,
  evaluate7,
  filterFishRange,
  fishRangeBucketLabels,
  addTrainerTreeNode,
  observeFishAction,
  partitionFishRange,
  postflopHandFeatures,
  preflopHandStrength,
  sampleFishAction,
  sampleFishCombo,
  summarizeFishRange,
  trainerTreeChild,
  trainerTreePath,
} from "../src/index.js";

const STARTING_STACK = 300;
const STARTING_POT = 6;
const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const STREET_BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };
const RANGE_BUCKETS = ["strong", "medium", "draw", "weak"];

const $ = (selector) => document.querySelector(selector);
const elements = {
  streetPill: $("#street-pill"),
  spotLabel: $("#spot-label"),
  potLabel: $("#pot-label"),
  fishStack: $("#fish-stack"),
  heroStack: $("#hero-stack"),
  fishCards: $("#fish-cards"),
  heroCards: $("#hero-cards"),
  boardCards: $("#board-cards"),
  fishStatus: $("#fish-status"),
  heroStatus: $("#hero-status"),
  handLog: $("#hand-log"),
  historyBack: $("#history-back"),
  historyForward: $("#history-forward"),
  historyLabel: $("#history-label"),
  branchTrail: $("#branch-trail"),
  questionKicker: $("#question-kicker"),
  questionTitle: $("#question-title"),
  questionCopy: $("#question-copy"),
  answerOptions: $("#answer-options"),
  feedbackPanel: $("#feedback-panel"),
  feedbackGrade: $("#feedback-grade"),
  feedbackTitle: $("#feedback-title"),
  feedbackCopy: $("#feedback-copy"),
  revealRange: $("#reveal-range"),
  newHand: $("#new-hand"),
  decisionNote: $("#decision-note"),
  rangePanel: $("#range-panel"),
  hideRange: $("#hide-range"),
  rangeTitle: $("#range-title"),
  rangeCopy: $("#range-copy"),
  rangeGrid: $("#range-grid"),
  rangeLegend: $("#range-color-legend"),
  rangeCombos: $("#range-combos"),
  rangeEffective: $("#range-effective"),
  rangeTop: $("#range-top"),
  rangeThread: $("#range-thread"),
  responseExplorer: $("#response-explorer"),
  responseSizingOptions: $("#response-sizing-options"),
  responseActionOptions: $("#response-action-options"),
  responseExplorerCopy: $("#response-explorer-copy"),
  comboDetail: $("#range-combo-detail"),
  comboDetailTitle: $("#range-combo-detail-title"),
  comboDetailCopy: $("#range-combo-detail-copy"),
  comboDetailList: $("#range-combo-detail-list"),
};

let state = null;
let tree = createTrainerTree();
let currentNodeId = null;
let pendingBranch = null;
let historyIndex = 0;
let rangeVisible = false;
let rangeView = { momentId: null, choiceId: null, fishAction: null };
let selectedRangeClass = null;

function formatMoney(value) {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}

function streetLabel(street) {
  return street[0].toUpperCase() + street.slice(1);
}

function randomCardPair() {
  const deck = createDeck();
  for (let index = 0; index < 2; index += 1) {
    const chosen = index + Math.floor(Math.random() * (deck.length - index));
    [deck[index], deck[chosen]] = [deck[chosen], deck[index]];
  }
  return [deck[0], deck[1]];
}

function cloneActions(actions) {
  return actions.map((entry) => ({ ...entry }));
}

function cloneRangeEvents(events) {
  return events.map((entry) => ({ ...entry }));
}

function cloneTrainerState(source) {
  return {
    ...source,
    heroCards: [...source.heroCards],
    fishCombo: { ...source.fishCombo, cards: [...source.fishCombo.cards] },
    runout: [...source.runout],
    board: [...source.board],
    range: cloneFishRange(source.range),
    actions: cloneActions(source.actions),
    rangeEvents: cloneRangeEvents(source.rangeEvents),
  };
}

function activePath() {
  return currentNodeId ? trainerTreePath(tree, currentNodeId) : [];
}

function currentMoment() {
  return activePath()[historyIndex] ?? null;
}

function snapshotMoment({ kind = "decision", title, copy, decision = null, kicker = null }) {
  const moment = addTrainerTreeNode(tree, {
    kind,
    street: state.street,
    title,
    copy,
    kicker,
    decision,
    answer: null,
    feedback: null,
    board: [...state.board],
    pot: state.pot,
    heroStack: state.heroStack,
    fishStack: state.fishStack,
    heroCards: [...state.heroCards],
    fishCombo: state.revealFish ? { ...state.fishCombo, cards: [...state.fishCombo.cards] } : null,
    fishStatus: state.fishStatus,
    heroStatus: state.heroStatus,
    actions: cloneActions(state.actions),
    range: cloneFishRange(state.range),
    rangeEvents: cloneRangeEvents(state.rangeEvents),
    stateBefore: cloneTrainerState(state),
  }, pendingBranch ?? {});
  pendingBranch = null;
  currentNodeId = moment.id;
  historyIndex = activePath().length - 1;
  rangeView = { momentId: moment.id, choiceId: null, fishAction: null };
  selectedRangeClass = null;
  render();
  return moment;
}

function addAction(actor, text) {
  state.actions.push({ street: state.street, actor, text });
}

function addRangeEvent(text) {
  state.rangeEvents.push({ street: state.street, text });
}

function commit(player, amount) {
  const stackKey = player === "hero" ? "heroStack" : "fishStack";
  const committedKey = player === "hero" ? "heroCommitted" : "fishCommitted";
  const paid = Math.max(0, Math.min(Number(amount) || 0, state[stackKey]));
  state[stackKey] -= paid;
  state[committedKey] += paid;
  state.pot += paid;
  return paid;
}

function commitTo(player, target) {
  const committedKey = player === "hero" ? "heroCommitted" : "fishCommitted";
  return commit(player, Math.max(0, target - state[committedKey]));
}

function observeFish(context, action, text) {
  state.range = observeFishAction(
    state.range,
    context,
    action,
    [...state.heroCards, ...state.board],
  );
  addRangeEvent(`${text} Keep only exact hands this basic fish model would take that action with.`);
}

function startNewHand() {
  const heroCards = randomCardPair();
  const initialRange = createFishRange({ heroCards });
  const fishCombo = sampleFishCombo(initialRange);
  const runoutDeck = createDeck([...heroCards, ...fishCombo.cards]);
  const runout = [];
  while (runout.length < 5) {
    const chosen = Math.floor(Math.random() * runoutDeck.length);
    runout.push(runoutDeck.splice(chosen, 1)[0]);
  }
  state = {
    heroCards,
    fishCombo,
    runout,
    board: [],
    street: "preflop",
    pot: STARTING_POT,
    heroStack: STARTING_STACK,
    fishStack: STARTING_STACK,
    heroCommitted: 0,
    fishCommitted: 0,
    range: initialRange,
    actions: [],
    rangeEvents: [
      {
        street: "preflop",
        text: "Before the fish acts, every exact two-card hand not blocked by your hole cards is still possible.",
      },
    ],
    fishStatus: "Waiting for your action",
    heroStatus: "Decision pending",
    revealFish: false,
  };
  tree = createTrainerTree();
  currentNodeId = null;
  pendingBranch = null;
  historyIndex = 0;
  rangeVisible = false;
  rangeView = { momentId: null, choiceId: null, fishAction: null };
  selectedRangeClass = null;
  elements.rangePanel.hidden = true;
  pushHeroDecision(buildPreflopOpenDecision());
}

function pushHeroDecision(decision) {
  state.heroStatus = "Decision pending";
  snapshotMoment({
    kind: "decision",
    kicker: "Your decision",
    title: decision.title,
    copy: decision.copy,
    decision,
  });
}

function buildPreflopOpenDecision() {
  const classLabel = comboClass(state.heroCards[0], state.heroCards[1]);
  const strength = preflopHandStrength(classLabel);
  let recommended = "fold";
  let reason = `Even against a wide caller, ${classLabel} is too weak to create enough value from an out-of-line open.`;
  let acceptable = [];
  if (strength >= 0.76) {
    recommended = "open15";
    acceptable = ["open10"];
    reason = `${classLabel} is strong enough to punish an inelastic calling range. The larger live sizing captures extra value from dominated calls.`;
  } else if (strength >= 0.30) {
    recommended = "open10";
    acceptable = strength >= 0.62 ? ["open15"] : [];
    reason = `${classLabel} clears the opening threshold against a BB that calls too wide. Use a normal live open and let the fish make the calling mistake.`;
  }
  return {
    type: "preflop-open",
    title: `You look down at ${classLabel}. What is your plan?`,
    copy: "It folds to you on the button. The big blind is the modeled basic loose-passive fish.",
    recommended,
    acceptable,
    reason,
    options: [
      { id: "fold", label: "Fold", detail: "Give up the button" },
      { id: "open10", label: "Raise to $10", detail: "Standard live open" },
      { id: "open15", label: "Raise to $15", detail: "Punish an inelastic caller" },
    ],
  };
}

function buildVsThreeBetDecision(amountToCall) {
  const classLabel = comboClass(state.heroCards[0], state.heroCards[1]);
  const strength = preflopHandStrength(classLabel);
  const recommended = strength >= 0.67 ? "call" : "fold";
  const acceptable = strength >= 0.61 && strength < 0.67 ? ["call"] : [];
  const reason = recommended === "call"
    ? `This fish only 3-bets an obvious premium set of hands, but ${classLabel} retains enough strength to continue in position for ${formatMoney(amountToCall)}.`
    : `A basic fish's rare 3-bet is extremely face-up here. ${classLabel} does not need to defend just because you opened it.`;
  return {
    type: "preflop-vs-3bet",
    title: `Fish 3-bets. Continue with ${classLabel}?`,
    copy: `You are facing ${formatMoney(amountToCall)} more. Treat this rare preflop aggression as value-heavy.`,
    recommended,
    acceptable,
    reason,
    options: [
      { id: "fold", label: "Fold", detail: "Respect the value-heavy 3-bet" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Take position to the flop" },
    ],
  };
}

function postflopEquity() {
  return estimateHeroEquity(state.heroCards, state.board, state.range, { samples: 260 });
}

function buildAfterCheckDecision() {
  const equity = postflopEquity();
  const heroFeatures = postflopHandFeatures({ cards: state.heroCards }, state.board);
  let recommended = "check";
  let acceptable = [];
  if (equity >= 0.72) {
    recommended = "bet75";
    acceptable = ["bet33"];
  } else if (equity >= 0.55) {
    recommended = "bet33";
    acceptable = ["check"];
  } else if (heroFeatures.drawStrength >= 0.14 && equity < 0.48) {
    recommended = "bet33";
    acceptable = ["check"];
  }
  const percentEquity = Math.round(equity * 100);
  const reason = recommended === "bet75"
    ? `You have about ${percentEquity}% showdown equity versus the surviving fish range. A caller-heavy player rewards a bigger value bet instead of slow-playing.`
    : recommended === "bet33"
      ? `You have about ${percentEquity}% equity versus the surviving range. A small bet extracts thin value or applies cheap pressure without bloating the pot unnecessarily.`
      : `You have about ${percentEquity}% equity versus the surviving range. This is a good place to protect showdown value and avoid forcing money into a range that is sticky when it continues.`;
  return {
    type: "postflop-after-check",
    title: `Fish checks the ${state.street}. What do you do?`,
    copy: "Choose your exploit before looking at the fish's surviving range.",
    recommended,
    acceptable,
    reason,
    equity,
    options: [
      { id: "check", label: "Check back", detail: "Realize equity and keep the pot controlled" },
      { id: "bet33", label: "Bet ⅓ pot", detail: "Thin value / cheap pressure" },
      { id: "bet75", label: "Bet ¾ pot", detail: "Charge sticky continues" },
    ],
  };
}

function buildVsDonkDecision(amountToCall) {
  const equity = postflopEquity();
  const potOdds = amountToCall / Math.max(1, state.pot + amountToCall);
  const riverTax = state.street === "river" ? 0.05 : 0;
  let recommended = "fold";
  let acceptable = [];
  if (equity >= (state.street === "river" ? 0.86 : 0.78)) {
    recommended = "raise";
    acceptable = ["call"];
  } else if (equity >= potOdds + riverTax + 0.035) {
    recommended = "call";
  }
  const reason = recommended === "raise"
    ? `Your estimated equity is ${Math.round(equity * 100)}% against the exact hands this fish model leads. There is enough value to raise rather than merely bluff-catch.`
    : recommended === "call"
      ? `You need roughly ${Math.round(potOdds * 100)}% equity and estimate about ${Math.round(equity * 100)}%. Calling keeps the weaker value and draws in.`
      : `The price needs roughly ${Math.round(potOdds * 100)}% equity, while the range estimate is only about ${Math.round(equity * 100)}%. Especially on the river, this fish's aggression is too value-heavy to force a hero call.`;
  return {
    type: "postflop-vs-donk",
    title: `Fish leads ${formatMoney(amountToCall)}. Your response?`,
    copy: `The lead itself has already removed many weak hands from the fish range. Pot: ${formatMoney(state.pot)}.`,
    recommended,
    acceptable,
    reason,
    equity,
    amountToCall,
    options: [
      { id: "fold", label: "Fold", detail: "Do not pay off a value-heavy line" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Keep worse value and draws in" },
      { id: "raise", label: "Raise 3×", detail: "Exploit with a strong value edge" },
    ],
  };
}

function buildVsRaiseDecision(amountToCall) {
  const equity = postflopEquity();
  const potOdds = amountToCall / Math.max(1, state.pot + amountToCall);
  const extraRespect = state.street === "river" ? 0.08 : 0.04;
  const recommended = equity >= potOdds + extraRespect ? "call" : "fold";
  const reason = recommended === "call"
    ? `The raise range is strong, but your estimated ${Math.round(equity * 100)}% equity still clears the ${Math.round(potOdds * 100)}% price with a safety margin.`
    : `This basic fish has no bluff-raise branch in this spot. Your estimated ${Math.round(equity * 100)}% equity does not clear a ${Math.round(potOdds * 100)}% price once that is respected.`;
  return {
    type: "postflop-vs-raise",
    title: `Fish raises. Do you pay it off?`,
    copy: `You are facing ${formatMoney(amountToCall)} more after the fish took one of its strongest lines.`,
    recommended,
    acceptable: [],
    reason,
    equity,
    amountToCall,
    options: [
      { id: "fold", label: "Fold", detail: "Exploit the face-up raise" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Continue only with enough range equity" },
    ],
  };
}

function feedbackFor(decision, choiceId) {
  const best = choiceId === decision.recommended;
  const reasonable = !best && decision.acceptable.includes(choiceId);
  const recommendedLabel = decision.options.find((option) => option.id === decision.recommended)?.label ?? decision.recommended;
  if (best) {
    return {
      grade: "A",
      title: "Best exploit in this model",
      copy: decision.reason,
    };
  }
  if (reasonable) {
    return {
      grade: "B",
      title: "Reasonable, but not my first choice",
      copy: `${decision.reason} I slightly prefer ${recommendedLabel}, but your line is defensible against this fish model.`,
    };
  }
  return {
    grade: "C",
    title: `I prefer ${recommendedLabel}`,
    copy: decision.reason,
  };
}

function chooseAnswer(choiceId) {
  const moment = currentMoment();
  if (!moment || moment.kind !== "decision") return;
  if (!moment.decision.options.some((option) => option.id === choiceId)) return;
  currentNodeId = moment.id;
  historyIndex = activePath().length - 1;
  moment.answer = choiceId;
  moment.feedback = feedbackFor(moment.decision, choiceId);
  const hasImmediateFishResponse = fishResponseScenarios(moment)
    .some((scenario) => scenario.choiceId === choiceId);
  rangeView = {
    momentId: moment.id,
    choiceId: hasImmediateFishResponse ? choiceId : null,
    fishAction: null,
  };
  selectedRangeClass = null;
  render();
}

function exploreSelectedBranch() {
  const moment = currentMoment();
  if (!moment?.answer || moment.kind !== "decision") return;
  const existing = trainerTreeChild(tree, moment.id, moment.answer);
  if (existing) {
    currentNodeId = existing.id;
    historyIndex = activePath().length - 1;
    rangeView = { momentId: existing.id, choiceId: null, fishAction: null };
    selectedRangeClass = null;
    render();
    return;
  }

  state = cloneTrainerState(moment.stateBefore);
  state.heroStatus = moment.decision.options.find((option) => option.id === moment.answer)?.label ?? moment.answer;
  pendingBranch = { parentId: moment.id, choiceId: moment.answer };
  applyHeroChoice(moment.decision, moment.answer);
}

function applyHeroChoice(decision, choice) {
  if (decision.type === "preflop-open") {
    if (choice === "fold") {
      addAction("Hero", "folds preflop");
      state.heroStatus = "Folded";
      finishHand("You folded. Use the history arrows to review the decision and the unrevealed preflop range.", false);
      return;
    }
    const target = choice === "open15" ? 15 : 10;
    commitTo("hero", target);
    addAction("Hero", `raises to ${formatMoney(target)}`);
    state.heroStatus = `Raised to ${formatMoney(target)}`;
    fishRespondPreflop(target);
    return;
  }

  if (decision.type === "preflop-vs-3bet") {
    if (choice === "fold") {
      addAction("Hero", "folds to the 3-bet");
      state.heroStatus = "Folded to 3-bet";
      finishHand("You folded to the fish's face-up premium 3-bet. Reveal the range to see exactly which hands remain.", false);
      return;
    }
    commitTo("hero", state.fishCommitted);
    addAction("Hero", `calls the 3-bet for ${formatMoney(decision.amountToCall)}`);
    state.heroStatus = "Called 3-bet";
    advanceStreet();
    return;
  }

  if (decision.type === "postflop-after-check") {
    if (choice === "check") {
      addAction("Hero", "checks back");
      state.heroStatus = "Checked back";
      nextStreetOrShowdown();
      return;
    }
    const fraction = choice === "bet75" ? 0.75 : 0.33;
    const amount = Math.max(1, Math.round(state.pot * fraction));
    commit("hero", amount);
    addAction("Hero", `bets ${formatMoney(amount)} (${Math.round(fraction * 100)}% pot)`);
    state.heroStatus = `Bet ${formatMoney(amount)}`;
    fishRespondToBet(amount, fraction);
    return;
  }

  if (decision.type === "postflop-vs-donk") {
    if (choice === "fold") {
      addAction("Hero", `folds to the ${state.street} lead`);
      state.heroStatus = "Folded";
      finishHand("You folded to the fish lead. The range reveal preserves exactly which hands can lead at that decision.", false);
      return;
    }
    if (choice === "call") {
      commitTo("hero", state.fishCommitted);
      addAction("Hero", `calls ${formatMoney(decision.amountToCall)}`);
      state.heroStatus = "Called";
      nextStreetOrShowdown();
      return;
    }
    const raiseTarget = Math.min(
      state.heroCommitted + state.heroStack,
      Math.max(state.fishCommitted * 3, state.fishCommitted + decision.amountToCall * 2),
    );
    commitTo("hero", raiseTarget);
    addAction("Hero", `raises to ${formatMoney(state.heroCommitted)}`);
    state.heroStatus = `Raised to ${formatMoney(state.heroCommitted)}`;
    fishRespondToRaise();
    return;
  }

  if (decision.type === "postflop-vs-raise") {
    if (choice === "fold") {
      addAction("Hero", "folds to the raise");
      state.heroStatus = "Folded to raise";
      finishHand("You folded to the fish raise. Step backward to compare your threshold with the literal range that reaches this node.", false);
      return;
    }
    commitTo("hero", state.fishCommitted);
    addAction("Hero", `calls ${formatMoney(decision.amountToCall)}`);
    state.heroStatus = "Called raise";
    nextStreetOrShowdown();
  }
}

function fishRespondPreflop(openAmount) {
  const context = { type: "preflop-vs-open", openBb: openAmount / 3 };
  const action = sampleFishAction(state.fishCombo, context);
  if (action === "fold") {
    observeFish(context, action, `Preflop: fish folds to ${formatMoney(openAmount)}.`);
    addAction("Fish", `folds to ${formatMoney(openAmount)}`);
    state.fishStatus = "Folded";
    finishHand("Fish folds. The revealed range shows the exact hands this model releases to your sizing.", false);
    return;
  }
  if (action === "call") {
    observeFish(context, action, `Preflop: fish calls your ${formatMoney(openAmount)} open.`);
    commitTo("fish", state.heroCommitted);
    addAction("Fish", `calls ${formatMoney(openAmount)}`);
    state.fishStatus = "Called preflop";
    advanceStreet();
    return;
  }

  observeFish(context, action, `Preflop: fish 3-bets your ${formatMoney(openAmount)} open.`);
  const target = Math.min(
    state.fishCommitted + state.fishStack,
    Math.max(35, Math.round((openAmount * 3.3) / 5) * 5),
  );
  commitTo("fish", target);
  addAction("Fish", `3-bets to ${formatMoney(state.fishCommitted)}`);
  state.fishStatus = `3-bet to ${formatMoney(state.fishCommitted)}`;
  const amountToCall = Math.max(0, state.fishCommitted - state.heroCommitted);
  const decision = buildVsThreeBetDecision(amountToCall);
  decision.amountToCall = amountToCall;
  pushHeroDecision(decision);
}

function advanceStreet() {
  const currentIndex = STREET_ORDER.indexOf(state.street);
  if (currentIndex >= STREET_ORDER.length - 1) {
    finishHand("The river action is complete.", true);
    return;
  }
  state.street = STREET_ORDER[currentIndex + 1];
  state.heroCommitted = 0;
  state.fishCommitted = 0;
  const targetCards = STREET_BOARD_COUNT[state.street];
  state.board = state.runout.slice(0, targetCards);
  state.range = filterFishRange(state.range, [...state.heroCards, ...state.board]);
  const boardText = state.board.map(cardToString).join(" ");
  addRangeEvent(`${streetLabel(state.street)} ${boardText}: remove newly blocked exact combos. Every earlier action filter stays in force.`);
  addAction("Board", `${streetLabel(state.street)} · ${boardText}`);
  startFishStreet();
}

function startFishStreet() {
  const context = { type: "postflop-first", board: state.board };
  const action = sampleFishAction(state.fishCombo, context);
  if (action === "check") {
    observeFish(context, action, `${streetLabel(state.street)}: fish checks first.`);
    addAction("Fish", "checks");
    state.fishStatus = "Checked";
    pushHeroDecision(buildAfterCheckDecision());
    return;
  }

  observeFish(context, action, `${streetLabel(state.street)}: fish leads into you.`);
  const fraction = state.street === "river" ? 0.60 : 0.40;
  const amount = Math.max(1, Math.round(state.pot * fraction));
  commit("fish", amount);
  addAction("Fish", `leads ${formatMoney(amount)}`);
  state.fishStatus = `Led ${formatMoney(amount)}`;
  pushHeroDecision(buildVsDonkDecision(amount));
}

function fishRespondToBet(amount, fraction) {
  const context = { type: "postflop-vs-bet", board: state.board, betFraction: fraction };
  const action = sampleFishAction(state.fishCombo, context);
  if (action === "fold") {
    observeFish(context, action, `${streetLabel(state.street)}: fish folds to your ${Math.round(fraction * 100)}% pot bet.`);
    addAction("Fish", "folds");
    state.fishStatus = "Folded";
    finishHand("Fish folds to your bet. Reveal the range to see the exact hands that reach the fold branch.", false);
    return;
  }
  if (action === "call") {
    observeFish(context, action, `${streetLabel(state.street)}: fish calls your ${Math.round(fraction * 100)}% pot bet.`);
    commitTo("fish", state.heroCommitted);
    addAction("Fish", `calls ${formatMoney(amount)}`);
    state.fishStatus = "Called";
    nextStreetOrShowdown();
    return;
  }

  observeFish(context, action, `${streetLabel(state.street)}: fish raises your ${Math.round(fraction * 100)}% pot bet.`);
  const raiseTarget = Math.min(
    state.fishCommitted + state.fishStack,
    Math.max(state.heroCommitted * 3, state.heroCommitted + amount * 2),
  );
  commitTo("fish", raiseTarget);
  addAction("Fish", `raises to ${formatMoney(state.fishCommitted)}`);
  state.fishStatus = `Raised to ${formatMoney(state.fishCommitted)}`;
  const amountToCall = Math.max(0, state.fishCommitted - state.heroCommitted);
  pushHeroDecision(buildVsRaiseDecision(amountToCall));
}

function fishRespondToRaise() {
  const context = { type: "postflop-vs-raise", board: state.board };
  const action = sampleFishAction(state.fishCombo, context);
  if (action === "fold") {
    observeFish(context, action, `${streetLabel(state.street)}: fish folds after you raise its lead.`);
    addAction("Fish", "folds to the raise");
    state.fishStatus = "Folded to raise";
    finishHand("Fish folds to your raise. The range reveal shows the exact value/draw region that was willing to lead but not continue.", false);
    return;
  }
  observeFish(context, action, `${streetLabel(state.street)}: fish calls after you raise its lead.`);
  commitTo("fish", state.heroCommitted);
  addAction("Fish", `calls the raise to ${formatMoney(state.heroCommitted)}`);
  state.fishStatus = "Called raise";
  nextStreetOrShowdown();
}

function nextStreetOrShowdown() {
  if (state.street === "river") {
    finishHand("River action is complete. Showdown.", true);
  } else {
    advanceStreet();
  }
}

function finishHand(message, showdown) {
  let copy = message;
  if (showdown) {
    if (state.board.length < 5) {
      state.board = [...state.runout];
      state.street = "river";
      state.range = filterFishRange(state.range, [...state.heroCards, ...state.board]);
    }
    const heroScore = evaluate7([...state.heroCards, ...state.board]);
    const fishScore = evaluate7([...state.fishCombo.cards, ...state.board]);
    const result = compareScores(heroScore, fishScore);
    state.revealFish = true;
    const resultText = result > 0 ? "You win the showdown." : result < 0 ? "Fish wins the showdown." : "The hand chops.";
    addAction("Showdown", `${resultText} Fish had ${state.fishCombo.display}.`);
    state.fishStatus = `${state.fishCombo.display} · showdown`;
    state.heroStatus = resultText;
    copy = `${message} ${resultText} The hidden fish hand is revealed only now; your earlier grades never used it.`;
  }
  snapshotMoment({
    kind: "complete",
    kicker: "Hand complete",
    title: showdown ? "Showdown complete" : "Hand complete",
    copy,
  });
}

function classComboCount(label) {
  if (label.length === 2) return 6;
  return label.endsWith("s") ? 4 : 12;
}

function rangeCellGradient(buckets) {
  const total = RANGE_BUCKETS.reduce((sum, key) => sum + (buckets[key] ?? 0), 0);
  if (!total) return "";
  let cursor = 0;
  const stops = [];
  for (const key of RANGE_BUCKETS) {
    const count = buckets[key] ?? 0;
    if (!count) continue;
    const start = cursor;
    cursor += (count / total) * 100;
    stops.push(`var(--range-${key}) ${start.toFixed(2)}% ${cursor.toFixed(2)}%`);
  }
  return `linear-gradient(135deg, ${stops.join(",")})`;
}

function bucketBreakdown(buckets, labels) {
  return RANGE_BUCKETS
    .filter((key) => (buckets[key] ?? 0) > 0)
    .map((key) => `${labels[key]}: ${buckets[key]}`)
    .join(" · ");
}

function fishResponseScenarios(moment) {
  if (moment.kind !== "decision") return [];
  const optionLabel = (choiceId) =>
    moment.decision.options.find((option) => option.id === choiceId)?.label ?? choiceId;

  if (moment.decision.type === "preflop-open") {
    return [
      {
        choiceId: "open10",
        label: optionLabel("open10"),
        context: { type: "preflop-vs-open", openBb: 10 / 3 },
        actions: ["fold", "call", "raise"],
      },
      {
        choiceId: "open15",
        label: optionLabel("open15"),
        context: { type: "preflop-vs-open", openBb: 5 },
        actions: ["fold", "call", "raise"],
      },
    ];
  }

  if (moment.decision.type === "postflop-after-check") {
    return [
      {
        choiceId: "bet33",
        label: optionLabel("bet33"),
        context: { type: "postflop-vs-bet", board: moment.board, betFraction: 0.33 },
        actions: ["fold", "call", "raise"],
      },
      {
        choiceId: "bet75",
        label: optionLabel("bet75"),
        context: { type: "postflop-vs-bet", board: moment.board, betFraction: 0.75 },
        actions: ["fold", "call", "raise"],
      },
    ];
  }

  if (moment.decision.type === "postflop-vs-donk") {
    return [{
      choiceId: "raise",
      label: optionLabel("raise"),
      context: { type: "postflop-vs-raise", board: moment.board },
      actions: ["fold", "call"],
    }];
  }

  return [];
}

function fishActionLabel(action, context) {
  if (action === "raise" && context.type === "preflop-vs-open") return "3-bet";
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

function renderResponseExplorer(moment) {
  const scenarios = fishResponseScenarios(moment);
  if (!scenarios.length) {
    elements.responseExplorer.hidden = true;
    return {
      range: moment.range,
      title: `Fish range · ${streetLabel(moment.street)} · current branch`,
      copy: "Binary range: every exact combo shown here still fits this branch's full action thread.",
    };
  }

  elements.responseExplorer.hidden = false;
  if (rangeView.momentId !== moment.id) {
    const answeredScenario = scenarios.find((scenario) => scenario.choiceId === moment.answer);
    rangeView = {
      momentId: moment.id,
      choiceId: answeredScenario?.choiceId ?? null,
      fishAction: null,
    };
    selectedRangeClass = null;
  }

  const selectedScenario = scenarios.find((scenario) => scenario.choiceId === rangeView.choiceId) ?? null;
  elements.responseSizingOptions.innerHTML = [
    `<button type="button" class="response-option${selectedScenario ? "" : " selected"}" data-response-choice="">Current branch <b>${moment.range.length}</b></button>`,
    ...scenarios.map((scenario) =>
      `<button type="button" class="response-option${selectedScenario?.choiceId === scenario.choiceId ? " selected" : ""}" data-response-choice="${scenario.choiceId}">${scenario.label}</button>`),
  ].join("");
  for (const button of elements.responseSizingOptions.querySelectorAll("[data-response-choice]")) {
    button.addEventListener("click", () => {
      rangeView = { momentId: moment.id, choiceId: button.dataset.responseChoice || null, fishAction: null };
      selectedRangeClass = null;
      renderRange(moment);
    });
  }

  if (!selectedScenario) {
    elements.responseExplorerCopy.textContent =
      "Choose a hero sizing to split this exact range into the fish's fold, call, and raise buckets.";
    elements.responseActionOptions.innerHTML = "";
    return {
      range: moment.range,
      title: `Fish range · ${streetLabel(moment.street)} · current branch`,
      copy: "Every shown combo survived the branch so far. Choose a sizing above to inspect the deterministic response split.",
    };
  }

  const blockedCards = [...moment.heroCards, ...moment.board];
  const partitions = partitionFishRange(moment.range, selectedScenario.context, blockedCards);
  const selectedAction = selectedScenario.actions.includes(rangeView.fishAction)
    ? rangeView.fishAction
    : null;
  elements.responseExplorerCopy.textContent =
    `Facing ${selectedScenario.label}, every surviving combo goes to exactly one action. Select a response to highlight its literal combos.`;
  elements.responseActionOptions.innerHTML = [
    `<button type="button" class="response-action${selectedAction ? "" : " selected"}" data-fish-action="">Before response <b>${moment.range.length}</b></button>`,
    ...selectedScenario.actions.map((action) =>
      `<button type="button" class="response-action${selectedAction === action ? " selected" : ""}" data-fish-action="${action}">${fishActionLabel(action, selectedScenario.context)} <b>${partitions[action]?.length ?? 0}</b></button>`),
  ].join("");
  for (const button of elements.responseActionOptions.querySelectorAll("[data-fish-action]")) {
    button.addEventListener("click", () => {
      rangeView = {
        momentId: moment.id,
        choiceId: selectedScenario.choiceId,
        fishAction: button.dataset.fishAction || null,
      };
      selectedRangeClass = null;
      renderRange(moment);
    });
  }

  if (!selectedAction) {
    return {
      range: moment.range,
      title: `Fish range before responding to ${selectedScenario.label}`,
      copy: "This is the exact range reaching the decision. The response counts above are exhaustive and mutually exclusive.",
    };
  }

  return {
    range: partitions[selectedAction] ?? [],
    title: `Fish ${fishActionLabel(selectedAction, selectedScenario.context).toLowerCase()} range facing ${selectedScenario.label}`,
    copy: `Only exact combos assigned to ${fishActionLabel(selectedAction, selectedScenario.context).toLowerCase()} are shown. There are no mixed actions or probability weights.`,
  };
}

function renderComboDetail(range) {
  const combos = selectedRangeClass
    ? range.filter((entry) => entry.classLabel === selectedRangeClass)
    : [];
  if (!selectedRangeClass) {
    elements.comboDetailTitle.textContent = "Select a hand class";
    elements.comboDetailCopy.textContent = "Click any colored matrix cell to list every exact suit combo in this range.";
    elements.comboDetailList.innerHTML = "";
    return;
  }

  elements.comboDetailTitle.textContent = `${selectedRangeClass} · ${combos.length} exact combo${combos.length === 1 ? "" : "s"}`;
  elements.comboDetailCopy.textContent = combos.length
    ? "These are the literal suit combinations assigned to the selected range or fish response."
    : "No exact suit combinations from this hand class take the selected action.";
  elements.comboDetailList.innerHTML = combos
    .map((entry) => `<span class="exact-combo">${entry.display}</span>`)
    .join("");
}

function renderRange(moment) {
  const displayed = renderResponseExplorer(moment);
  const displayedRange = displayed.range;
  const summary = summarizeFishRange(displayedRange, moment.board);
  const labels = fishRangeBucketLabels(moment.board);
  const flatClasses = HAND_CLASSES.flat();
  elements.rangeTitle.textContent = displayed.title;
  elements.rangeCopy.textContent = displayed.copy;

  elements.rangeGrid.innerHTML = flatClasses
    .map((label) => {
      const info = summary.byClass[label];
      const total = classComboCount(label);
      if (!info) {
        return `<button type="button" class="fish-range-cell excluded" data-range-class="${label}" title="${label}: not in this range"><strong>${label}</strong><small>—</small></button>`;
      }
      const gradient = rangeCellGradient(info.buckets);
      const breakdown = bucketBreakdown(info.buckets, labels);
      const exactCombos = displayedRange.filter((entry) => entry.classLabel === label).map((entry) => entry.display).join(", ");
      return `<button type="button" class="fish-range-cell present${selectedRangeClass === label ? " selected" : ""}" data-range-class="${label}" style="background:${gradient}" title="${label}: ${info.count}/${total} exact combos · ${breakdown} · ${exactCombos}"><strong>${label}</strong><small>${info.count}/${total}</small></button>`;
    })
    .join("");
  for (const button of elements.rangeGrid.querySelectorAll("[data-range-class]")) {
    button.addEventListener("click", () => {
      selectedRangeClass = button.dataset.rangeClass;
      renderRange(moment);
    });
  }

  elements.rangeLegend.innerHTML = RANGE_BUCKETS
    .map((key) => `<span><i class="range-swatch bucket-${key}"></i>${labels[key]}</span>`)
    .join("");
  elements.rangeCombos.textContent = summary.comboCount.toLocaleString("en-US");
  elements.rangeEffective.textContent = summary.classCount.toLocaleString("en-US");
  elements.rangeTop.innerHTML = RANGE_BUCKETS
    .map((key) => `<span class="top-class"><i class="range-swatch bucket-${key}"></i><b>${labels[key]}</b>${summary.bucketCounts[key].toLocaleString("en-US")} combos</span>`)
    .join("");
  elements.rangeThread.innerHTML = moment.rangeEvents
    .map((entry) => `<li><strong>${streetLabel(entry.street)}:</strong> ${entry.text.replace(/^\w+:\s*/, "")}</li>`)
    .join("");
  renderComboDetail(displayedRange);
}

function renderCards(moment) {
  elements.heroCards.innerHTML = moment.heroCards.map((card) => cardToHtml(card)).join("");
  if (moment.fishCombo) {
    elements.fishCards.innerHTML = moment.fishCombo.cards.map((card) => cardToHtml(card)).join("");
    elements.fishCards.setAttribute("aria-label", `Fish hole cards ${moment.fishCombo.display}`);
  } else {
    elements.fishCards.innerHTML = `<span class="card-back">?</span><span class="card-back">?</span>`;
    elements.fishCards.setAttribute("aria-label", "Fish hole cards hidden");
  }
  const board = [...moment.board];
  elements.boardCards.innerHTML = Array.from({ length: 5 }, (_, index) =>
    board[index] === undefined ? `<span class="empty-card">—</span>` : cardToHtml(board[index]),
  ).join("");
}

function renderDecision(moment) {
  const path = activePath();
  const activeMoment = historyIndex === path.length - 1;
  elements.questionKicker.textContent = moment.kicker ?? (moment.kind === "decision" ? "Your decision" : "Hand complete");
  elements.questionTitle.textContent = moment.title;
  elements.questionCopy.textContent = moment.copy;
  elements.answerOptions.innerHTML = "";

  if (moment.kind === "decision") {
    for (const option of moment.decision.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      if (moment.answer === option.id) button.classList.add("selected");
      if (moment.answer && moment.decision.recommended === option.id) button.classList.add("recommended");
      const savedBranch = trainerTreeChild(tree, moment.id, option.id);
      button.setAttribute("aria-pressed", String(moment.answer === option.id));
      button.innerHTML = `<span class="answer-label"><strong>${option.label}</strong><small>${option.detail}</small></span>${savedBranch ? '<span class="branch-saved">Saved branch</span>' : ""}`;
      button.addEventListener("click", () => chooseAnswer(option.id));
      elements.answerOptions.append(button);
    }

    if (moment.answer) {
      const exploreButton = document.createElement("button");
      exploreButton.type = "button";
      exploreButton.className = "button button-primary explore-branch";
      exploreButton.textContent = trainerTreeChild(tree, moment.id, moment.answer)
        ? "View saved branch →"
        : "Explore this branch →";
      exploreButton.addEventListener("click", exploreSelectedBranch);
      elements.answerOptions.append(exploreButton);
    }
  }

  if (moment.feedback) {
    elements.feedbackPanel.hidden = false;
    elements.feedbackGrade.textContent = moment.feedback.grade;
    elements.feedbackTitle.textContent = moment.feedback.title;
    elements.feedbackCopy.textContent = moment.feedback.copy;
  } else {
    elements.feedbackPanel.hidden = true;
  }

  if (!activeMoment && moment.kind === "decision") {
    elements.decisionNote.textContent = "Reviewing an earlier fork. Every action remains selectable; exploring it creates or reopens a saved counterfactual branch without deleting the others.";
  } else if (moment.kind === "complete") {
    elements.decisionNote.textContent = "Use ← or the branch trail to revisit any earlier fork. Saved alternatives keep their own board, pot, action thread, and exact fish range.";
  } else {
    elements.decisionNote.textContent = "Choose any action for feedback, then explore it. You can return and select every other action or sizing; completed branches stay saved.";
  }
}

function renderBranchTrail(path) {
  elements.branchTrail.innerHTML = path
    .map((node, index) => {
      if (index === 0) {
        return `<button type="button" class="branch-crumb${historyIndex === index ? " current" : ""}" data-branch-index="${index}">Start</button>`;
      }
      const parent = path[index - 1];
      const choice = parent.decision?.options.find((option) => option.id === node.parentChoice);
      const label = choice?.label ?? node.parentChoice;
      return `<span aria-hidden="true">›</span><button type="button" class="branch-crumb${historyIndex === index ? " current" : ""}" data-branch-index="${index}">${label}</button>`;
    })
    .join("");
  for (const button of elements.branchTrail.querySelectorAll("[data-branch-index]")) {
    button.addEventListener("click", () => {
      historyIndex = Number(button.dataset.branchIndex);
      render();
    });
  }
}

function render() {
  const path = activePath();
  const moment = path[historyIndex];
  if (!moment) return;
  elements.streetPill.textContent = streetLabel(moment.street);
  elements.spotLabel.textContent = "BTN vs BB fish · $1/$2/$3 live model · 100bb";
  elements.potLabel.textContent = formatMoney(moment.pot);
  elements.heroStack.textContent = formatMoney(moment.heroStack);
  elements.fishStack.textContent = formatMoney(moment.fishStack);
  elements.fishStatus.textContent = moment.fishStatus;
  const selectedOption = moment.kind === "decision" && moment.answer
    ? moment.decision.options.find((option) => option.id === moment.answer)
    : null;
  elements.heroStatus.textContent = selectedOption?.label ?? moment.heroStatus;
  elements.historyLabel.textContent = `${historyIndex + 1} / ${path.length} · ${streetLabel(moment.street)} · ${tree.nodes.size} saved`;
  elements.historyBack.disabled = historyIndex === 0;
  elements.historyForward.disabled = historyIndex === path.length - 1;
  elements.handLog.innerHTML = moment.actions.length
    ? moment.actions.map((entry) => `<li><strong>${entry.actor}:</strong> ${entry.text}</li>`).join("")
    : "<li>No action yet.</li>";
  renderCards(moment);
  renderDecision(moment);
  renderBranchTrail(path);
  if (rangeVisible) {
    elements.rangePanel.hidden = false;
    renderRange(moment);
  } else {
    elements.rangePanel.hidden = true;
  }
}

elements.historyBack.addEventListener("click", () => {
  if (historyIndex > 0) {
    historyIndex -= 1;
    render();
  }
});

elements.historyForward.addEventListener("click", () => {
  if (historyIndex < activePath().length - 1) {
    historyIndex += 1;
    render();
  }
});

elements.revealRange.addEventListener("click", () => {
  rangeVisible = true;
  render();
  elements.rangePanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

elements.hideRange.addEventListener("click", () => {
  rangeVisible = false;
  render();
});

elements.newHand.addEventListener("click", startNewHand);

startNewHand();
