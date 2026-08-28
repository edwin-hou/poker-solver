import {
  HAND_CLASSES,
  cardToHtml,
  cardToString,
  cloneFishRange,
  comboClass,
  compareScores,
  createDeck,
  createFishRange,
  estimateHeroEquity,
  evaluate7,
  filterFishRange,
  observeFishAction,
  postflopHandFeatures,
  preflopHandStrength,
  sampleFishAction,
  sampleFishCombo,
  summarizeFishRange,
} from "../src/index.js";

const STARTING_STACK = 300;
const STARTING_POT = 6;
const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const STREET_BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };

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
  rangeCombos: $("#range-combos"),
  rangeEffective: $("#range-effective"),
  rangeTop: $("#range-top"),
  rangeThread: $("#range-thread"),
};

let state = null;
let timeline = [];
let historyIndex = 0;
let rangeVisible = false;

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

function snapshotMoment({ kind = "decision", title, copy, decision = null, kicker = null }) {
  const moment = {
    id: timeline.length + 1,
    kind,
    street: state.street,
    title,
    copy,
    kicker,
    decision,
    answer: null,
    feedback: null,
    canContinue: false,
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
  };
  timeline.push(moment);
  historyIndex = timeline.length - 1;
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
  addRangeEvent(`${text} The prior range was reweighted by how often each exact combo takes that action.`);
}

function startNewHand() {
  const heroCards = randomCardPair();
  const initialRange = createFishRange({ heroCards });
  const fishCombo = sampleFishCombo(initialRange);
  state = {
    heroCards,
    fishCombo,
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
        text: "Before any fish action, start from all exact two-card combos that do not conflict with your hole cards.",
      },
    ],
    fishStatus: "Waiting for your action",
    heroStatus: "Decision pending",
    revealFish: false,
  };
  timeline = [];
  historyIndex = 0;
  rangeVisible = false;
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
    copy: "It folds to you on the button. The big blind is the modeled loose-passive fish.",
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
    ? `The fish 3-bet range is much stronger than its calling range, but ${classLabel} retains enough strength to continue in position for ${formatMoney(amountToCall)}.`
    : `A low-3-bet fish is heavily value-weighted here. ${classLabel} does not need to defend just because you opened it.`;
  return {
    type: "preflop-vs-3bet",
    title: `Fish 3-bets. Continue with ${classLabel}?`,
    copy: `You are facing ${formatMoney(amountToCall)} more. Treat the population's rare preflop aggression with respect.`,
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
    ? `You have about ${percentEquity}% showdown equity versus the surviving fish range. A caller-heavy pool rewards a bigger value bet instead of slow-playing.`
    : recommended === "bet33"
      ? `You have about ${percentEquity}% equity versus the surviving range. A small bet extracts thin value or applies cheap pressure without bloating the pot unnecessarily.`
      : `You have about ${percentEquity}% equity versus the surviving range. This is a good place to protect showdown value and avoid forcing money into a range that is sticky when it continues.`;
  return {
    type: "postflop-after-check",
    title: `Fish checks the ${state.street}. What do you do?`,
    copy: "Choose your exploit before looking at the posterior range.",
    recommended,
    acceptable,
    reason,
    equity,
    options: [
      { id: "check", label: "Check back", detail: "Realize equity and keep the pot controlled" },
      { id: "bet33", label: "Bet ⅓ pot", detail: "Thin value / cheap pressure" },
      { id: "bet75", label: "Bet ¾ pot", detail: "Polarize and charge sticky continues" },
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
    ? `Your estimated equity is ${Math.round(equity * 100)}% against the fish range that actually donks here. There is enough value to raise rather than merely bluff-catch.`
    : recommended === "call"
      ? `You need roughly ${Math.round(potOdds * 100)}% equity and estimate about ${Math.round(equity * 100)}%. Calling keeps the fish's weaker value and draws in.`
      : `The price needs roughly ${Math.round(potOdds * 100)}% equity, while the posterior estimate is only about ${Math.round(equity * 100)}%. Especially on the river, fish aggression is not bluff-heavy enough to force a hero call.`;
  return {
    type: "postflop-vs-donk",
    title: `Fish leads ${formatMoney(amountToCall)}. Your response?`,
    copy: `The lead itself has already tightened the fish range. Pot: ${formatMoney(state.pot)}.`,
    recommended,
    acceptable,
    reason,
    equity,
    amountToCall,
    options: [
      { id: "fold", label: "Fold", detail: "Do not pay off a value-heavy line" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Keep bluffs and worse value in" },
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
    ? `The check-raise range is strong, but your estimated ${Math.round(equity * 100)}% equity still clears the ${Math.round(potOdds * 100)}% price with a safety margin.`
    : `This population does not find enough bluff raises. Your estimated ${Math.round(equity * 100)}% equity does not clear a ${Math.round(potOdds * 100)}% price once that under-bluff is respected.`;
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
      { id: "fold", label: "Fold", detail: "Exploit the under-bluffed raise" },
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
      copy: `${decision.reason} I slightly prefer ${recommendedLabel}, but your line is defensible against this population model.`,
    };
  }
  return {
    grade: "C",
    title: `I prefer ${recommendedLabel}`,
    copy: decision.reason,
  };
}

function chooseAnswer(choiceId) {
  const moment = timeline.at(-1);
  if (!moment || historyIndex !== timeline.length - 1 || moment.kind !== "decision" || moment.answer) return;
  if (!moment.decision.options.some((option) => option.id === choiceId)) return;
  moment.answer = choiceId;
  moment.feedback = feedbackFor(moment.decision, choiceId);
  moment.canContinue = true;
  state.heroStatus = moment.decision.options.find((option) => option.id === choiceId)?.label ?? choiceId;
  render();
}

function continueHand() {
  const moment = timeline.at(-1);
  if (!moment?.canContinue || historyIndex !== timeline.length - 1) return;
  moment.canContinue = false;
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
      finishHand("You folded to the fish's value-heavy 3-bet. Review the range reveal to see how much the raise compressed it.", false);
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
      finishHand("You folded to the fish lead. The range reveal preserves exactly what the lead represented at that decision.", false);
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
      finishHand("You folded to the fish raise. Step backward to compare your threshold with the range that survived to this node.", false);
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
    finishHand("Fish folds. The revealed range now shows which hands this model is most likely to release to your sizing.", false);
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
  const deck = createDeck([...state.heroCards, ...state.fishCombo.cards, ...state.board]);
  while (state.board.length < targetCards) {
    const chosen = Math.floor(Math.random() * deck.length);
    state.board.push(deck.splice(chosen, 1)[0]);
  }
  state.range = filterFishRange(state.range, [...state.heroCards, ...state.board]);
  const boardText = state.board.map(cardToString).join(" ");
  addRangeEvent(`${streetLabel(state.street)} ${boardText}: impossible blocked combos are removed, while every earlier action weight is preserved.`);
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
    finishHand("Fish folds to your bet. Reveal the range to see which exact combos were most likely to reach the fold.", false);
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
    finishHand("Fish folds to your raise. The range reveal shows the value/draw region that was willing to lead but not continue.", false);
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
      while (state.board.length < 5) {
        const deck = createDeck([...state.heroCards, ...state.fishCombo.cards, ...state.board]);
        state.board.push(deck[Math.floor(Math.random() * deck.length)]);
      }
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

function renderRange(moment) {
  const summary = summarizeFishRange(moment.range);
  const flatClasses = HAND_CLASSES.flat();
  const densities = flatClasses.map((label) => (summary.byClass[label] ?? 0) / classComboCount(label));
  const maxDensity = Math.max(...densities, 1e-12);
  elements.rangeTitle.textContent = `Fish range · ${streetLabel(moment.street)} · moment ${historyIndex + 1}`;
  elements.rangeCopy.textContent =
    "This is the same exact-combo posterior carried through the hand. Board cards remove impossible combos; fish actions reweight the remaining combos instead of rebuilding a fresh street range.";
  elements.rangeGrid.innerHTML = flatClasses
    .map((label, index) => {
      const mass = summary.byClass[label] ?? 0;
      const relative = Math.min(1, densities[index] / maxDensity);
      return `<div class="fish-range-cell" style="--range-strength:${relative.toFixed(4)}" title="${label}: ${(mass * 100).toFixed(3)}% of current range"><strong>${label}</strong><small>${mass > 0 ? `${(mass * 100).toFixed(mass >= 0.01 ? 1 : 2)}%` : "—"}</small></div>`;
    })
    .join("");
  elements.rangeCombos.textContent = summary.comboCount.toLocaleString("en-US");
  elements.rangeEffective.textContent = Math.round(summary.effectiveCombos).toLocaleString("en-US");
  elements.rangeTop.innerHTML = summary.topClasses
    .slice(0, 10)
    .map((entry) => `<span class="top-class"><b>${entry.classLabel}</b>${(entry.probability * 100).toFixed(1)}%</span>`)
    .join("");
  elements.rangeThread.innerHTML = moment.rangeEvents
    .map((entry) => `<li><strong>${streetLabel(entry.street)}:</strong> ${entry.text.replace(/^\w+:\s*/, "")}</li>`)
    .join("");
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
  const activeMoment = historyIndex === timeline.length - 1;
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
      button.disabled = !activeMoment || Boolean(moment.answer);
      button.innerHTML = `<span class="answer-label"><strong>${option.label}</strong><small>${option.detail}</small></span>`;
      button.addEventListener("click", () => chooseAnswer(option.id));
      elements.answerOptions.append(button);
    }

    if (activeMoment && moment.canContinue) {
      const continueButton = document.createElement("button");
      continueButton.type = "button";
      continueButton.className = "button button-primary";
      continueButton.textContent = "Continue hand →";
      continueButton.addEventListener("click", continueHand);
      elements.answerOptions.append(continueButton);
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

  if (!activeMoment) {
    elements.decisionNote.textContent = "Reviewing history. Reveal Range also rewinds to this exact decision. Use → to return to the live hand.";
  } else if (moment.kind === "complete") {
    elements.decisionNote.textContent = "Use ← to revisit every earlier decision with the range state that was available at that moment, or start a new hand.";
  } else {
    elements.decisionNote.textContent = "Feedback uses only the visible action history and modeled posterior range—not the fish's hidden cards.";
  }
}

function render() {
  const moment = timeline[historyIndex];
  if (!moment) return;
  elements.streetPill.textContent = streetLabel(moment.street);
  elements.spotLabel.textContent = "BTN vs BB fish · $1/$2/$3 live model · 100bb";
  elements.potLabel.textContent = formatMoney(moment.pot);
  elements.heroStack.textContent = formatMoney(moment.heroStack);
  elements.fishStack.textContent = formatMoney(moment.fishStack);
  elements.fishStatus.textContent = moment.fishStatus;
  elements.heroStatus.textContent = moment.heroStatus;
  elements.historyLabel.textContent = `${historyIndex + 1} / ${timeline.length} · ${streetLabel(moment.street)}`;
  elements.historyBack.disabled = historyIndex === 0;
  elements.historyForward.disabled = historyIndex === timeline.length - 1;
  elements.handLog.innerHTML = moment.actions.length
    ? moment.actions.map((entry) => `<li><strong>${entry.actor}:</strong> ${entry.text}</li>`).join("")
    : "<li>No action yet.</li>";
  renderCards(moment);
  renderDecision(moment);
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
  if (historyIndex < timeline.length - 1) {
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
