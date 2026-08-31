import {
  HAND_CLASSES,
  analyzeFishHandHistory,
  cardToHtml,
  cardToString,
  cloneFishRange,
  comboClass,
  compareScores,
  createSixHandedPracticeScenario,
  createDeck,
  createTrainerTree,
  estimateHeroMultiwayEquity,
  evaluate7,
  filterFishRange,
  fishDecisionForCombo,
  addTrainerTreeNode,
  observeFishAction,
  partitionFishRange,
  preflopLookupStrategyForClass,
  recommendHeroPostflopPlan,
  sampleFishAction,
  summarizeFishRange,
  trainerTreeChild,
  trainerTreePath,
} from "../src/index.js";

const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const STREET_BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };
const RANGE_ACTIONS = ["fold", "call", "raise"];
const RANGE_ACTION_LABELS = Object.freeze({
  current: "Still possible",
  fold: "Fold",
  call: "Call",
  raise: "Raise",
  check: "Check",
  bet: "Bet",
});

const $ = (selector) => document.querySelector(selector);
const elements = {
  modePlay: $("#mode-play"),
  modeAnalyze: $("#mode-analyze"),
  playMode: $("#play-mode"),
  analyzeMode: $("#analyze-mode"),
  streetPill: $("#street-pill"),
  spotLabel: $("#spot-label"),
  potLabel: $("#pot-label"),
  heroStack: $("#hero-stack"),
  opponentSeats: $("#opponent-seats"),
  heroCards: $("#hero-cards"),
  boardCards: $("#board-cards"),
  heroStatus: $("#hero-status"),
  handLog: $("#hand-log"),
  historyBack: $("#history-back"),
  historyForward: $("#history-forward"),
  historyLabel: $("#history-label"),
  branchTrail: $("#branch-trail"),
  questionKicker: $("#question-kicker"),
  questionTitle: $("#question-title"),
  questionCopy: $("#question-copy"),
  decisionBasis: $("#decision-basis"),
  decisionBasisTitle: $("#decision-basis-title"),
  decisionBasisCopy: $("#decision-basis-copy"),
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
  rangeOpponentOptions: $("#range-opponent-options"),
  comboDetail: $("#range-combo-detail"),
  comboDetailTitle: $("#range-combo-detail-title"),
  comboDetailCopy: $("#range-combo-detail-copy"),
  comboDetailList: $("#range-combo-detail-list"),
  historyHeroCards: $("#history-hero-cards"),
  historyHeroName: $("#history-hero-name"),
  historyFishName: $("#history-fish-name"),
  historyBigBlind: $("#history-big-blind"),
  historyStartingPot: $("#history-starting-pot"),
  historyInput: $("#history-input"),
  analyzeHistory: $("#analyze-history"),
  historyError: $("#history-error"),
  historyResult: $("#history-result"),
  historyStreetTabs: $("#history-street-tabs"),
  historyStreetContext: $("#history-street-context"),
  historyStreet: $("#history-street"),
  historyBoard: $("#history-board"),
  historyCombos: $("#history-combos"),
  historyClasses: $("#history-classes"),
  historyEvents: $("#history-events"),
  historyWarnings: $("#history-warnings"),
  historyRangeGrid: $("#history-range-grid"),
  historyRangeLegend: $("#history-range-legend"),
  historyComboTitle: $("#history-combo-title"),
  historyComboCopy: $("#history-combo-copy"),
  historyComboList: $("#history-combo-list"),
};

let state = null;
let tree = createTrainerTree();
let currentNodeId = null;
let pendingBranch = null;
let historyIndex = 0;
let rangeVisible = false;
let rangeView = { momentId: null, opponentId: null, choiceId: null, fishAction: null };
let selectedRangeClass = null;
let selectedHistoryRangeClass = null;
let selectedHistoryStreet = null;

function formatMoney(value) {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function randomTrainerHeroCards(scenarioKind) {
  const seekContinue = Math.random() < 0.85;
  let cards = randomCardPair();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const classLabel = comboClass(cards[0], cards[1]);
    const lookup = scenarioKind === "threebet"
      ? preflopLookupStrategyForClass({
        preflopSpot: "vs-3bet",
        heroPosition: "BTN",
        villainPosition: "CO",
        stack: 150,
        openSize: 4,
      }, classLabel)
      : scenarioKind === "raised"
      ? preflopLookupStrategyForClass({
        preflopSpot: "vs-open",
        heroPosition: "BTN",
        villainPosition: "HJ",
        stack: 150,
        openSize: 4,
      }, classLabel)
      : preflopLookupStrategyForClass({
        preflopSpot: "rfi",
        heroPosition: "BTN",
        villainPosition: "BB",
        stack: 150,
        openSize: 10 / 3,
      }, classLabel);
    const continues = scenarioKind === "raised" || scenarioKind === "threebet"
      ? lookup.strategy[1] + lookup.strategy[2] > lookup.strategy[0]
      : lookup.strategy[1] > lookup.strategy[0];
    if (continues === seekContinue) return cards;
    cards = randomCardPair();
  }
  return cards;
}

function cloneActions(actions) {
  return actions.map((entry) => ({ ...entry }));
}

function cloneRangeEvents(events) {
  return events.map((entry) => ({ ...entry }));
}

function cloneOpponent(opponent, { reveal = true } = {}) {
  return {
    ...opponent,
    combo: reveal ? { ...opponent.combo, cards: [...opponent.combo.cards] } : null,
    range: cloneFishRange(opponent.range),
    rangeEvents: cloneRangeEvents(opponent.rangeEvents),
    postflopLine: (opponent.postflopLine ?? []).map((entry) => ({ ...entry })),
  };
}

function cloneTrainerState(source) {
  return {
    ...source,
    heroCards: [...source.heroCards],
    opponents: source.opponents.map((opponent) => cloneOpponent(opponent)),
    runout: [...source.runout],
    board: [...source.board],
    actions: cloneActions(source.actions),
  };
}

function activeOpponents(source = state) {
  return source.opponents.filter((opponent) => !opponent.folded);
}

function opponentById(id, source = state) {
  return source.opponents.find((opponent) => opponent.id === id) ?? null;
}

function preflopRoleFor(opponent, source = state) {
  if (opponent.id === source.threeBettorId) return "threebet";
  if (opponent.id === source.openerId) return "opened";
  if (opponent.preflopAction === "call") return "cold-called";
  if (opponent.preflopAction === "limp") return "limped";
  if (["sb", "bb"].includes(opponent.id)) return "blind";
  return "none";
}

function opponentsInPostflopOrder(source = state) {
  const order = ["sb", "bb", "utg", "hj", "co"];
  return order.map((id) => opponentById(id, source)).filter((opponent) => opponent && !opponent.folded);
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
    scenarioKind: state.scenarioKind,
    spotLabel: state.spotLabel,
    openAmount: state.openAmount,
    openerId: state.openerId,
    threeBetAmount: state.threeBetAmount,
    threeBettorId: state.threeBettorId,
    callerCount: state.callerCount,
    limperCount: state.limperCount,
    smallTarget: state.smallTarget,
    largeTarget: state.largeTarget,
    heroStack: state.heroStack,
    heroCards: [...state.heroCards],
    opponents: state.opponents.map((opponent) => cloneOpponent(opponent, { reveal: state.revealFish })),
    heroStatus: state.heroStatus,
    actions: cloneActions(state.actions),
    stateBefore: cloneTrainerState(state),
  }, pendingBranch ?? {});
  pendingBranch = null;
  currentNodeId = moment.id;
  historyIndex = activePath().length - 1;
  rangeView = { momentId: moment.id, opponentId: null, choiceId: null, fishAction: null };
  selectedRangeClass = null;
  render();
  return moment;
}

function addAction(actor, text) {
  state.actions.push({ street: state.street, actor, text });
}

function addRangeEvent(opponent, text) {
  opponent.rangeEvents.push({ street: state.street, text });
}

function commit(player, amount) {
  const target = player === "hero" ? state : opponentById(player);
  if (!target) throw new Error(`Unknown player: ${player}`);
  const stackKey = player === "hero" ? "heroStack" : "stack";
  const committedKey = player === "hero" ? "heroCommitted" : "committed";
  const paid = Math.max(0, Math.min(Number(amount) || 0, target[stackKey]));
  target[stackKey] -= paid;
  target[committedKey] += paid;
  state.pot += paid;
  return paid;
}

function commitTo(player, target) {
  const source = player === "hero" ? state : opponentById(player);
  const committed = player === "hero" ? source.heroCommitted : source.committed;
  return commit(player, Math.max(0, target - committed));
}

function observeOpponent(opponent, context, action, text) {
  opponent.range = observeFishAction(
    opponent.range,
    context,
    action,
    [...state.heroCards, ...state.board],
  );
  addRangeEvent(opponent, `${text} Keep only exact hands this line-aware live recreational model would take that action with.`);
  if (state.street !== "preflop") {
    opponent.postflopLine ??= [];
    opponent.postflopLine.push({ street: state.street, action, context: { ...context } });
  }
}

function opponentPostflopContext(opponent, type, extra = {}) {
  const line = opponent.postflopLine ?? [];
  const previousStreetEntry = [...line].reverse().find((entry) => entry.street !== state.street) ?? null;
  const aggressiveStreets = new Set(line
    .filter((entry) => entry.street !== state.street && ["bet", "raise"].includes(entry.action))
    .map((entry) => entry.street));
  const opponentCount = activeOpponents().length;
  return {
    type,
    board: state.board,
    opponentCount,
    headsUp: opponentCount === 1,
    wasPreflopAggressor: [state.openerId, state.threeBettorId].includes(opponent.id),
    previousFishAction: previousStreetEntry?.action ?? null,
    barrelCount: aggressiveStreets.size,
    spr: opponent.stack / Math.max(1, state.pot),
    passiveRiverStab: state.street === "river" && aggressiveStreets.size === 0,
    ...extra,
  };
}

function startNewHand() {
  const scenarioRoll = Math.random();
  const scenarioKind = scenarioRoll < 0.35 ? "limped" : scenarioRoll < 0.78 ? "raised" : "threebet";
  const heroCards = randomTrainerHeroCards(scenarioKind);
  const scenario = createSixHandedPracticeScenario({ heroCards, scenarioKind });
  const hiddenCards = scenario.opponents.flatMap((opponent) => opponent.combo.cards);
  const runout = dealPracticeRunout(heroCards, hiddenCards);
  state = {
    heroCards,
    opponents: scenario.opponents,
    runout,
    board: [],
    street: "preflop",
    pot: scenario.startingPot,
    heroStack: scenario.heroStack,
    heroCommitted: scenario.heroCommitted,
    actions: cloneActions(scenario.preflopActions),
    scenarioKind: scenario.kind,
    spotLabel: scenario.spotLabel,
    openAmount: scenario.openAmount,
    openerId: scenario.openerId,
    threeBetAmount: scenario.threeBetAmount ?? 0,
    threeBettorId: scenario.threeBettorId ?? null,
    callerCount: scenario.callerCount,
    limperCount: scenario.limperCount,
    smallTarget: scenario.smallTarget,
    largeTarget: scenario.largeTarget,
    heroStatus: "Decision pending",
    revealFish: false,
  };
  for (const opponent of state.opponents) opponent.postflopLine = [];
  tree = createTrainerTree();
  currentNodeId = null;
  pendingBranch = null;
  historyIndex = 0;
  rangeVisible = false;
  rangeView = { momentId: null, opponentId: null, choiceId: null, fishAction: null };
  selectedRangeClass = null;
  elements.rangePanel.hidden = true;
  pushHeroDecision(buildPreflopDecision());
}

function buildPreflopDecision() {
  if (state.scenarioKind === "threebet") return buildFacingThreeBetDecision();
  return state.scenarioKind === "raised"
    ? buildFacingOpenDecision()
    : buildPreflopOpenDecision();
}

function pushHeroDecision(decision) {
  state.heroStatus = "Decision pending";
  rangeVisible = false;
  elements.rangePanel.hidden = true;
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
  const lookup = preflopLookupStrategyForClass({
    preflopSpot: "rfi",
    heroPosition: "BTN",
    villainPosition: "BB",
    stack: 150,
    openSize: 10 / 3,
  }, classLabel);
  const [foldFrequency, openFrequency] = lookup.strategy;
  const recommended = openFrequency > foldFrequency ? "isoSmall" : "fold";
  const strongIsolation = ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AKo", "AQs", "AQo", "AJs", "KQs"].includes(classLabel);
  const acceptable = recommended === "isoSmall" && strongIsolation ? ["isoLarge"] : [];
  const reason = recommended === "fold"
    ? `${classLabel} is a fold in the repository's 150bb six-max BTN baseline (${Math.round(foldFrequency * 100)}% fold). Wide limpers do not turn a structurally weak hand into a profitable isolation raise.`
    : `${classLabel} opens in the repository's 150bb six-max BTN baseline (${Math.round(openFrequency * 100)}% raise). Isolating to ${formatMoney(state.smallTarget)} applies the baseline against the fish's wider, weaker limping range.`;
  return {
    type: "preflop-isolate",
    title: `You look down at ${classLabel} on the BTN. Isolate the limpers?`,
    copy: `${state.limperCount} loose-passive player${state.limperCount === 1 ? " has" : "s have"} limped. Other seats have already folded or are waiting in the blinds.`,
    recommended,
    acceptable,
    reason,
    choiceReasons: {
      fold: recommended === "fold"
        ? `Correct. ${classLabel} is outside the 150bb BTN opening baseline, and position alone does not overcome its poor domination and realization against several sticky players.`
        : `This is too tight. ${classLabel} clears the 150bb BTN opening baseline, and the limpers arrive with wide, capped ranges that let you isolate for value or initiative.`,
      isoSmall: recommended === "isoSmall"
        ? `Correct. ${formatMoney(state.smallTarget)} punishes the wide limps while risking less than the larger size and preserving room to maneuver at 150bb.`
        : `This is the main error: it converts a baseline fold into a multiway bluff against players modeled to call too often. Weak hands such as 94o remain folds.`,
      isoLarge: recommended === "fold"
        ? `This compounds the mistake of entering an out-of-range hand by risking even more against inelastic callers.`
        : strongIsolation
          ? `Defensible with this stronger opening hand. The larger size extracts more from loose calls, but it narrows the fish's continuing ranges and lowers the postflop stack-to-pot ratio.`
          : `This is unnecessarily large for the marginal part of your opening range. It gets called by stronger hands, folds out hands you dominate, and builds a larger multiway pot with fragile equity.`,
    },
    basis: {
      title: "150bb six-max baseline + fish-range estimate",
      copy: `${lookup.nodeLabel}. Original deterministic chart approximation: ${Math.round(foldFrequency * 100)}% fold / ${Math.round(openFrequency * 100)}% raise. The opponent limps come only from the low-stakes fish model; isolation sizing is a disclosed multiway best-response estimate, not a solved limped-pot equilibrium.`,
    },
    smallTarget: state.smallTarget,
    largeTarget: state.largeTarget,
    options: [
      { id: "fold", label: "Fold", detail: "Do not enter the limped pot" },
      { id: "isoSmall", label: `Raise to ${formatMoney(state.smallTarget)}`, detail: "Baseline isolation size" },
      { id: "isoLarge", label: `Raise to ${formatMoney(state.largeTarget)}`, detail: "Larger exploit size" },
    ],
  };
}

function buildFacingOpenDecision() {
  const opener = opponentById(state.openerId);
  const classLabel = comboClass(state.heroCards[0], state.heroCards[1]);
  const lookup = preflopLookupStrategyForClass({
    preflopSpot: "vs-open",
    heroPosition: "BTN",
    villainPosition: opener.position,
    stack: 150,
    openSize: state.openAmount / 3,
  }, classLabel);
  const [foldFrequency, callFrequency, threeBetFrequency] = lookup.strategy;
  const baselineContinues = callFrequency + threeBetFrequency > foldFrequency;
  const valueSqueeze = ["AA", "KK", "QQ", "AKs", "AKo"].includes(classLabel);
  const recommended = valueSqueeze ? "squeezeSmall" : baselineContinues ? "callOpen" : "fold";
  const acceptable = valueSqueeze && ["AA", "KK"].includes(classLabel) ? ["squeezeLarge"] : [];
  const reason = recommended === "fold"
    ? `${classLabel} folds most often in the 150bb ${lookup.nodeLabel} baseline (${Math.round(foldFrequency * 100)}% fold). The extra caller improves the price but does not rescue a hand with poor domination or realization.`
    : recommended === "callOpen"
      ? `${classLabel} continues in the 150bb ${lookup.nodeLabel} baseline. Against this fish's obvious-value opening range, the exploit estimate moves non-premium continues into the call bucket rather than inventing a light squeeze.`
      : `${classLabel} is strong enough to squeeze for value against the fish opener and wide cold caller. ${formatMoney(state.smallTarget)} keeps worse hands in while charging both ranges.`;
  return {
    type: "preflop-facing-open",
    title: `You look down at ${classLabel} on the BTN. What is your plan?`,
    copy: `${opener.position} raised to ${formatMoney(state.openAmount)} and one player called. Both blinds are still waiting to act.`,
    recommended,
    acceptable,
    reason,
    choiceReasons: {
      fold: recommended === "fold"
        ? `Correct. ${classLabel} does not clear the 150bb positional continuation baseline, and a cold caller plus live blinds make its equity harder—not easier—to realize.`
        : `This overfolds. ${classLabel} has enough 150bb positional value to continue against the modeled opener and the caller's much wider range.`,
      callOpen: recommended === "callOpen"
        ? `Correct. Calling keeps the fish's dominated and speculative hands in, uses your position, and avoids isolating yourself against the opener's premium-heavy continuing range.`
        : recommended === "fold"
          ? `This is too loose. The price looks attractive, but ${classLabel} is dominated too often and must realize equity through several players.`
          : `This is playable but too passive for a premium. You miss value from the wide cold caller and let both blinds enter cheaply.`,
      squeezeSmall: recommended === "squeezeSmall"
        ? `Correct. This is a value squeeze—not a balance play. ${classLabel} can be called by enough worse hands, and ${formatMoney(state.smallTarget)} collects dead money without forcing the fish into only its strongest continues.`
        : recommended === "fold"
          ? `This is an unsupported bluff. The modeled fish calls reraises too often with pairs and broadways, so a hand that cannot even profitably call should not squeeze.`
          : `This is too aggressive against an opener whose raises are already value-heavy. Calling preserves weaker hands; squeezing makes the continuing range stronger.`,
      squeezeLarge: recommended === "squeezeSmall" && acceptable.includes("squeezeLarge")
        ? `Defensible with the very top of range, especially if the pool ignores sizing. It wins more preflop but also folds out dominated hands that the smaller squeeze keeps.`
        : `This size needs a much more polarized, value-dense hand than ${classLabel}. Against sticky fish it risks more while getting action from the strongest part of their range.`,
    },
    basis: {
      title: "150bb solver baseline + modeled-range best response",
      copy: `${lookup.nodeLabel}: ${Math.round(foldFrequency * 100)}% fold / ${Math.round(callFrequency * 100)}% call / ${Math.round(threeBetFrequency * 100)}% 3-bet. That six-max lookup anchors hand viability; the recommendation then tightens light aggression against the fish's value-heavy open and preserves calls versus its wider weak ranges. This is a transparent multiway estimate, not an exact custom solve.`,
    },
    openerId: state.openerId,
    openAmount: state.openAmount,
    smallTarget: state.smallTarget,
    largeTarget: state.largeTarget,
    options: [
      { id: "fold", label: "Fold", detail: "Leave the raised pot" },
      { id: "callOpen", label: `Call ${formatMoney(state.openAmount)}`, detail: "Take the price in position" },
      { id: "squeezeSmall", label: `Squeeze to ${formatMoney(state.smallTarget)}`, detail: "Baseline squeeze size" },
      { id: "squeezeLarge", label: `Squeeze to ${formatMoney(state.largeTarget)}`, detail: "Higher-pressure exploit size" },
    ],
  };
}

function buildFacingThreeBetDecision() {
  const opener = opponentById(state.openerId);
  const threeBettor = opponentById(state.threeBettorId);
  const classLabel = comboClass(state.heroCards[0], state.heroCards[1]);
  const lookup = preflopLookupStrategyForClass({
    preflopSpot: "vs-3bet",
    heroPosition: "BTN",
    villainPosition: threeBettor.position,
    stack: 150,
    openSize: state.openAmount / 3,
  }, classLabel);
  const [foldFrequency, callFrequency, fourBetFrequency] = lookup.strategy;
  const premiumFourBet = ["AA", "KK", "QQ", "AKs"].includes(classLabel);
  const callsContextualThreeBet = ["JJ", "TT", "99", "AKo", "AQs", "AQo", "AJs", "KQs"].includes(classLabel);
  const recommended = premiumFourBet ? "fourBetSmall" : callsContextualThreeBet ? "callThreeBet" : "fold";
  const acceptable = ["AA", "KK"].includes(classLabel) ? ["fourBetLarge"] : [];
  const reason = recommended === "fold"
    ? `${classLabel} folds against this value-heavy but position-aware fish 3-bet range. Even if the 150bb baseline sometimes continues, a recreational player's reraise plus the original opener behind removes the weakest cold calls.`
    : recommended === "callThreeBet"
      ? `${classLabel} has enough equity and 150bb implied value to continue against a reraise range that widens with position and dead money. Calling keeps in hands such as JJ/AQ while avoiding an overplayed 4-bet.`
      : `${classLabel} is strong enough to 4-bet for value against the modeled HJ/CO response to an UTG open. ${formatMoney(state.smallTarget)} keeps worse continues available while preserving room at 150bb.`;
  return {
    type: "preflop-facing-threebet",
    title: `You look down at ${classLabel} on the BTN. Face the 3-bet?`,
    copy: `${opener.position} opened to ${formatMoney(state.openAmount)} and ${threeBettor.position} 3-bet to ${formatMoney(state.threeBetAmount)}. The original raiser and both blinds are still live.`,
    recommended,
    acceptable,
    reason,
    choiceReasons: {
      fold: recommended === "fold"
        ? `Correct. The fish's 3-bet is not a balanced solver range, but it now accounts for opener position, the reraise size, and prior action. ${classLabel} still lacks the equity and implied value to continue profitably.`
        : `This is too tight at 150bb. ${classLabel} retains enough equity or implied value against the contextual value-heavy range to continue in position.`,
      callThreeBet: recommended === "callThreeBet"
        ? `Correct. Calling keeps the fish's full premium range intact, realizes the benefit of 150bb depth, and avoids turning ${classLabel} into an overplayed 4-bet.`
        : recommended === "fold"
          ? `This is a loose cold call into two strong ranges. The stack is deep, but the price is still large and domination makes the implied odds work against you.`
          : `This leaves value on the table with the top of range. The contextual fish range can call a 4-bet with hands such as JJ/QQ/AQ/AK and continue more aggressively with its strongest hands.`,
      fourBetSmall: recommended === "fourBetSmall"
        ? `Correct. This is a value 4-bet against a wider but still unbalanced fish range. The smaller size keeps worse reraises and calls in while leaving postflop room at 150bb.`
        : callsContextualThreeBet
          ? `This is the key overplay. The fish can reraise hands below QQ+/AK when position and dead money justify it, but its range is still value-heavy enough that ${classLabel} performs better as a call.`
          : `This is a bluff into a range whose wider hands are still chosen for recognizable value. The modeled opponent does not fold enough of that range to support this hand as a 4-bet.`,
      fourBetLarge: acceptable.includes("fourBetLarge")
        ? `Defensible with AA or KK, but larger than necessary. It folds out more dominated continues and concentrates action in the opponent's strongest bucket.`
        : recommended === "fourBetSmall"
          ? `${classLabel} is strong enough for the smaller value 4-bet, but this larger size folds out too many of the wider contextual reraises you want to keep.`
        : `This magnifies the 4-bet error. The fish's range is already premium-heavy, so extra pressure does not create the folds a balanced bluff would need.`,
    },
    basis: {
      title: "150bb solver baseline corrected for a contextual fish range",
      copy: `${lookup.nodeLabel}: ${Math.round(foldFrequency * 100)}% fold / ${Math.round(callFrequency * 100)}% call / ${Math.round(fourBetFrequency * 100)}% 4-bet against the lookup's balanced baseline. The recommendation is adjusted for a fish 3-bet range that changes with opener position, sizing, dead money, and prior role. That correction and the multiway cold-call node are disclosed best-response estimates, not an exact custom solve.`,
    },
    openerId: state.openerId,
    threeBettorId: state.threeBettorId,
    threeBetAmount: state.threeBetAmount,
    smallTarget: state.smallTarget,
    largeTarget: state.largeTarget,
    options: [
      { id: "fold", label: "Fold", detail: "Respect the early-position strength" },
      { id: "callThreeBet", label: `Call ${formatMoney(state.threeBetAmount)}`, detail: "Cold-call in position" },
      { id: "fourBetSmall", label: `4-bet to ${formatMoney(state.smallTarget)}`, detail: "Baseline pressure size" },
      { id: "fourBetLarge", label: `4-bet to ${formatMoney(state.largeTarget)}`, detail: "Larger exploit pressure size" },
    ],
  };
}

function postflopEquity() {
  return estimateHeroMultiwayEquity(
    state.heroCards,
    state.board,
    activeOpponents().map((opponent) => opponent.range),
    { samples: 420 },
  );
}

function buildAfterCheckDecision() {
  const equity = postflopEquity();
  const plan = recommendHeroPostflopPlan({
    heroCards: state.heroCards,
    board: state.board,
    opponentRanges: activeOpponents().map((opponent) => opponent.range),
    showdownEquity: equity,
  });
  return {
    type: "postflop-after-checks",
    title: `${activeOpponents().length} opponents check the ${state.street}. What do you do?`,
    copy: "Choose your multiway exploit before inspecting any opponent's surviving range.",
    recommended: plan.recommended,
    acceptable: plan.acceptable,
    reason: plan.reason,
    equity,
    purpose: plan.purpose,
    diagnostics: plan.diagnostics,
    choiceReasons: plan.choiceReasons,
    basis: plan.basis,
    options: [
      { id: "check", label: "Check back", detail: plan.optionDetails.check },
      { id: "bet33", label: "Bet ⅓ pot", detail: plan.optionDetails.bet33 },
      { id: "bet75", label: "Bet ¾ pot", detail: plan.optionDetails.bet75 },
    ],
  };
}

function dealPracticeRunout(heroCards, hiddenCards) {
  const deck = createDeck([...heroCards, ...hiddenCards]);
  const runout = [];
  while (runout.length < 5) {
    const chosen = Math.floor(Math.random() * deck.length);
    runout.push(deck.splice(chosen, 1)[0]);
  }
  return runout;
}

function buildVsRaiseDecision(amountToCall, raiserId) {
  const raiser = opponentById(raiserId);
  const equity = postflopEquity();
  const potOdds = amountToCall / Math.max(1, state.pot + amountToCall);
  const raiseContext = raiser.postflopLine?.at(-1)?.context
    ?? opponentPostflopContext(raiser, "postflop-vs-bet");
  const bluffCombos = raiser.range.filter((combo) =>
    ["bluff", "semi-bluff"].includes(fishDecisionForCombo(combo, raiseContext).intent)).length;
  const bluffShare = bluffCombos / Math.max(1, raiser.range.length);
  const extraRespect = state.street === "river" ? 0.08 : bluffShare > 0 ? 0.01 : 0.04;
  const recommended = equity >= potOdds + extraRespect ? "call" : "fold";
  const reason = recommended === "call"
    ? `The raise is still value-heavy, but roughly ${Math.round(bluffShare * 100)}% of its exact combos are modeled bluffs or semi-bluffs. Your estimated ${Math.round(equity * 100)}% equity clears the ${Math.round(potOdds * 100)}% price with the line-specific margin.`
    : `This line contains only about ${Math.round(bluffShare * 100)}% modeled bluffs or semi-bluffs. Your estimated ${Math.round(equity * 100)}% equity does not clear the ${Math.round(potOdds * 100)}% price once that value weight is respected.`;
  return {
    type: "postflop-vs-raise",
    title: `${raiser.position} raises. Do you pay it off multiway?`,
    copy: `You are facing ${formatMoney(amountToCall)} more with ${activeOpponents().length} opponents still represented by independent ranges.`,
    recommended,
    acceptable: [],
    reason,
    equity,
    amountToCall,
    raiserId,
    choiceReasons: {
      fold: recommended === "fold"
        ? `Correct. This exact raise range is only ${Math.round(bluffShare * 100)}% bluff or semi-bluff, and ${Math.round(equity * 100)}% equity does not clear the ${Math.round(potOdds * 100)}% price plus the line-specific margin.`
        : `This is too tight. Even after respecting the fish's strong raise, your ${Math.round(equity * 100)}% estimate still pays for the ${Math.round(potOdds * 100)}% call with the required margin.`,
      call: recommended === "call"
        ? `Correct. This is not a curiosity call: the sampled range equity clears the exact price after accounting for the ${Math.round(bluffShare * 100)}% bluff/semi-bluff share.`
        : `This is a payoff mistake. The raise range is too value-heavy for your ${Math.round(equity * 100)}% equity to clear the adjusted threshold.`,
    },
    basis: {
      title: "Exact pot odds + line-specific bluff share",
      copy: `The price is exact and equity is sampled from every active seat's exact binary range. The raiser's surviving range is ${Math.round(bluffShare * 100)}% bluff/semi-bluff by literal combo count; this is an exploit estimate, not a solved multiway equilibrium.`,
    },
    options: [
      { id: "fold", label: "Fold", detail: "Exploit the face-up raise" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Continue only with enough range equity" },
    ],
  };
}

function buildVsFishBetDecision(amountToCall, bettorId, betContext) {
  const bettor = opponentById(bettorId);
  const equity = postflopEquity();
  const potOdds = amountToCall / Math.max(1, state.pot + amountToCall);
  const bluffCombos = bettor.range.filter((combo) =>
    ["bluff", "semi-bluff"].includes(fishDecisionForCombo(combo, betContext).intent)).length;
  const bluffShare = bluffCombos / Math.max(1, bettor.range.length);
  const multiway = activeOpponents().length > 1;
  const aggressiveAction = bettor.range.length
    ? fishDecisionForCombo(bettor.range[0], betContext).action
    : "bet";
  const raiseThreshold = multiway ? 0.76 : 0.68;
  const callThreshold = potOdds + (multiway && bluffShare < 0.12 ? 0.05 : 0.01);
  const recommended = equity >= raiseThreshold ? "raise" : equity >= callThreshold ? "call" : "fold";
  const lineLabel = aggressiveAction === "raise"
    ? "multiway raise"
    : multiway ? "multiway lead" : "heads-up donk";
  const reason = `${bettor.position}'s ${lineLabel} contains about ${Math.round(bluffShare * 100)}% bluffs or semi-bluffs by exact combo count. Your ${Math.round(equity * 100)}% range equity is compared with ${Math.round(potOdds * 100)}% pot odds and a ${multiway ? "tighter multiway" : "wider heads-up"} continuing threshold.`;
  return {
    type: "postflop-vs-fish-bet",
    title: `${bettor.position} ${aggressiveAction === "raise" ? "raises" : "bets"} into the field. How do you respond?`,
    copy: `The action is not automatically value: this exact ${lineLabel} is modeled from the board, position, earlier line, and bet size.`,
    recommended,
    acceptable: recommended === "raise" ? ["call"] : [],
    reason,
    equity,
    amountToCall,
    bettorId,
    betContext,
    bluffShare,
    aggressiveAction,
    betFraction: betContext.betFraction ?? 0.33,
    choiceReasons: {
      fold: recommended === "fold"
        ? `Correct. ${Math.round(equity * 100)}% equity misses the line-adjusted continuing threshold even after including the modeled bluffs.`
        : `Too tight. The ${Math.round(bluffShare * 100)}% bluff/semi-bluff share and your ${Math.round(equity * 100)}% equity make folding surrender too much.`,
      call: recommended === "call"
        ? `Correct. Calling realizes your equity without isolating yourself against the fish's strongest continue range.`
        : recommended === "raise"
          ? "Calling is profitable, but raising extracts more from the bettor's pair-and-draw continues with your very strong range equity."
          : `This call pays off a range that is still too value-heavy; ${Math.round(equity * 100)}% does not clear the adjusted threshold.`,
      raise: recommended === "raise"
        ? `Correct. ${Math.round(equity * 100)}% equity clears the strong-value threshold, so raising is for value—not because the fish can bluff.`
        : "Raising would fold the air you beat and concentrate action in stronger made hands and robust draws; that is reverse value, not protection.",
    },
    basis: {
      title: "Exact binary betting range + line-aware population prior",
      copy: `The bettor's threaded range contains ${bluffCombos} bluff/semi-bluff combos out of ${bettor.range.length}. Heads-up donks are allowed more bluffs; multiway donks stay strongly value-weighted.`,
    },
    options: [
      { id: "fold", label: "Fold", detail: "Respect a value-heavy lead" },
      { id: "call", label: `Call ${formatMoney(amountToCall)}`, detail: "Realize equity against the whole betting range" },
      { id: "raise", label: "Raise 3×", detail: "Value only—do not raise merely to learn where you are" },
    ],
  };
}

function feedbackFor(decision, choiceId) {
  const best = choiceId === decision.recommended;
  const reasonable = !best && decision.acceptable.includes(choiceId);
  const recommendedLabel = decision.options.find((option) => option.id === decision.recommended)?.label ?? decision.recommended;
  const choiceReason = decision.choiceReasons?.[choiceId] ?? decision.reason;
  if (best) {
    return {
      grade: "A",
      title: "Why this is best",
      copy: choiceReason,
    };
  }
  if (reasonable) {
    return {
      grade: "B",
      title: "Why this works—but is second best",
      copy: `${choiceReason} Preferred: ${recommendedLabel}. ${decision.reason}`,
    };
  }
  return {
    grade: "C",
    title: "What is wrong with this choice",
    copy: `${choiceReason} Preferred: ${recommendedLabel}. ${decision.reason}`,
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
  const decisionOpponent = moment.opponents.find((opponent) =>
    opponent.id === (moment.decision.bettorId ?? moment.decision.raiserId));
  const rangeOpponent = moment.opponents.find((opponent) => opponent.id === rangeView.opponentId)
    ?? decisionOpponent
    ?? moment.opponents.find((opponent) => !opponent.folded)
    ?? moment.opponents[0];
  const responseScenarios = fishResponseScenarios(moment, rangeOpponent);
  const hasImmediateFishResponse = responseScenarios.some((scenario) => scenario.choiceId === choiceId);
  const observedAggression = responseScenarios.find((scenario) => scenario.choiceId === "observed");
  rangeView = {
    momentId: moment.id,
    opponentId: rangeView.opponentId,
    choiceId: hasImmediateFishResponse ? choiceId : observedAggression?.choiceId ?? null,
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
    rangeView = { momentId: existing.id, opponentId: rangeView.opponentId, choiceId: null, fishAction: null };
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
  if (decision.type === "preflop-isolate") {
    if (choice === "fold") {
      addAction("Hero", "folds preflop");
      state.heroStatus = "Folded";
      finishHand("You folded the isolation spot. Use the opponent tabs in Range Reveal to inspect every seat's exact preflop range.", false);
      return;
    }
    const target = choice === "isoLarge" ? state.largeTarget : state.smallTarget;
    commitTo("hero", target);
    addAction("Hero", `isolates to ${formatMoney(target)}`);
    state.heroStatus = `Raised to ${formatMoney(target)}`;
    opponentsRespondToIsolation(target);
    return;
  }

  if (decision.type === "preflop-facing-open") {
    if (choice === "fold") {
      addAction("Hero", "folds facing the raise and caller");
      state.heroStatus = "Folded";
      finishHand("You folded the raised pot. Reveal a range to inspect every seat's exact preflop action range.", false);
      return;
    }
    if (choice === "callOpen") {
      commitTo("hero", state.openAmount);
      addAction("Hero", `calls ${formatMoney(state.openAmount)} on the BTN`);
      state.heroStatus = `Called ${formatMoney(state.openAmount)}`;
      blindsRespondToOpen();
      return;
    }
    const target = choice === "squeezeLarge" ? state.largeTarget : state.smallTarget;
    commitTo("hero", target);
    addAction("Hero", `squeezes to ${formatMoney(target)}`);
    state.heroStatus = `Squeezed to ${formatMoney(target)}`;
    opponentsRespondToThreeBet(target);
    return;
  }

  if (decision.type === "preflop-facing-threebet") {
    if (choice === "fold") {
      addAction("Hero", "folds facing the 3-bet");
      state.heroStatus = "Folded";
      finishHand("You folded to the 3-bet. Reveal a range to inspect the opener's and 3-bettor's exact preflop ranges.", false);
      return;
    }
    if (choice === "callThreeBet") {
      commitTo("hero", state.threeBetAmount);
      addAction("Hero", `cold-calls ${formatMoney(state.threeBetAmount)}`);
      state.heroStatus = `Called ${formatMoney(state.threeBetAmount)}`;
      opponentsRespondAfterHeroCallsThreeBet();
      return;
    }
    const target = choice === "fourBetLarge" ? state.largeTarget : state.smallTarget;
    commitTo("hero", target);
    addAction("Hero", `4-bets to ${formatMoney(target)}`);
    state.heroStatus = `4-bet to ${formatMoney(target)}`;
    opponentsRespondToFourBet(target);
    return;
  }

  if (decision.type === "postflop-after-checks") {
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
    opponentsRespondToBet(amount, fraction);
    return;
  }

  if (decision.type === "postflop-vs-fish-bet") {
    const bettor = opponentById(decision.bettorId);
    if (choice === "fold") {
      addAction("Hero", `folds to ${bettor.position}'s bet`);
      state.heroStatus = "Folded to bet";
      finishHand(`You folded to ${bettor.position}'s line-aware betting range. Reveal it to separate the literal value, semi-bluff, and bluff combos.`, false);
      return;
    }
    if (choice === "call") {
      commitTo("hero", bettor.committed);
      addAction("Hero", `calls ${formatMoney(decision.amountToCall)}`);
      state.heroStatus = "Called bet";
      const followUpRaiserId = settleOpponentsAfterHeroCallsFishAggression(
        bettor.id,
        decision.aggressiveAction,
        decision.betFraction,
      );
      if (followUpRaiserId) {
        const followUpRaiser = opponentById(followUpRaiserId);
        pushHeroDecision(buildVsRaiseDecision(
          Math.max(0, followUpRaiser.committed - state.heroCommitted),
          followUpRaiserId,
        ));
        return;
      }
      nextStreetOrShowdown();
      return;
    }
    const raiseTarget = Math.min(
      state.heroCommitted + state.heroStack,
      Math.max(bettor.committed * 3, bettor.committed + decision.amountToCall * 2),
    );
    commitTo("hero", raiseTarget);
    addAction("Hero", `raises to ${formatMoney(raiseTarget)}`);
    state.heroStatus = `Raised to ${formatMoney(raiseTarget)}`;
    opponentsRespondToHeroRaise(raiseTarget);
    return;
  }

  if (decision.type === "postflop-vs-raise") {
    const raiser = opponentById(decision.raiserId);
    if (choice === "fold") {
      addAction("Hero", `folds to ${raiser.position}'s raise`);
      state.heroStatus = "Folded to raise";
      finishHand(`You folded to ${raiser.position}'s value-heavy raise. Each opponent's range remains available for review.`, false);
      return;
    }
    commitTo("hero", raiser.committed);
    addAction("Hero", `calls ${formatMoney(decision.amountToCall)}`);
    state.heroStatus = "Called raise";
    nextStreetOrShowdown();
  }
}

function opponentsRespondToIsolation(openAmount) {
  const responseOrder = ["sb", "bb", "utg", "hj", "co"];
  for (const id of responseOrder) {
    const opponent = opponentById(id);
    if (!opponent || opponent.folded) continue;
    const context = {
      type: "preflop-vs-open",
      position: opponent.position,
      openerPosition: "BTN",
      openBb: openAmount / 3,
      priorAction: preflopRoleFor(opponent),
      coldCallerCount: state.limperCount,
    };
    const action = sampleFishAction(opponent.combo, context);
    if (action === "raise") throw new Error("Curated multiway practice produced an unexpected preflop 3-bet.");
    observeOpponent(opponent, context, action, `Preflop: ${opponent.position} ${action}s facing ${formatMoney(openAmount)}.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to isolation raise";
      addAction(opponent.position, `folds to ${formatMoney(openAmount)}`);
    } else {
      commitTo(opponent.id, state.heroCommitted);
      opponent.status = `Called ${formatMoney(openAmount)}`;
      addAction(opponent.position, `calls ${formatMoney(openAmount)}`);
    }
  }
  advanceStreet();
}

function blindsRespondToOpen() {
  const opener = opponentById(state.openerId);
  const contextFor = (opponent) => ({
    type: "sixmax-vs-open",
    position: opponent.position,
    openerPosition: opener.position,
    openBb: state.openAmount / 3,
    priorAction: "blind",
    coldCallerCount: state.callerCount + 1,
  });
  for (const id of ["sb", "bb"]) {
    const opponent = opponentById(id);
    if (!opponent || opponent.folded) continue;
    const context = contextFor(opponent);
    const action = sampleFishAction(opponent.combo, context);
    if (action === "raise") throw new Error("Curated raised-pot practice produced an unexpected blind 3-bet.");
    observeOpponent(opponent, context, action, `Preflop: ${opponent.position} ${action}s facing ${opener.position}'s ${formatMoney(state.openAmount)} open.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to the open";
      addAction(opponent.position, "folds");
    } else {
      commitTo(opponent.id, state.openAmount);
      opponent.status = `Called ${formatMoney(state.openAmount)}`;
      addAction(opponent.position, `calls ${formatMoney(state.openAmount)}`);
    }
  }
  advanceStreet();
}

function opponentsRespondToThreeBet(target) {
  const contextFor = (opponent) => ({
    type: "preflop-vs-threebet",
    position: opponent.position,
    threeBettorPosition: "BTN",
    threeBetBb: target / 3,
    priorAction: preflopRoleFor(opponent),
    openerPosition: opponentById(state.openerId)?.position,
    coldCallerCount: state.callerCount,
  });
  for (const id of ["sb", "bb", "utg", "hj", "co"]) {
    const opponent = opponentById(id);
    if (!opponent || opponent.folded) continue;
    const context = contextFor(opponent);
    const action = sampleFishAction(opponent.combo, context);
    if (action === "raise") throw new Error("Curated raised-pot practice produced an unexpected 4-bet.");
    observeOpponent(opponent, context, action, `Preflop: ${opponent.position} ${action}s facing your ${formatMoney(target)} squeeze.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to squeeze";
      addAction(opponent.position, `folds to ${formatMoney(target)}`);
    } else {
      commitTo(opponent.id, target);
      opponent.status = `Called ${formatMoney(target)}`;
      addAction(opponent.position, `calls ${formatMoney(target)}`);
    }
  }
  advanceStreet();
}

function opponentsRespondAfterHeroCallsThreeBet() {
  const threeBettor = opponentById(state.threeBettorId);
  for (const id of ["sb", "bb", state.openerId]) {
    const opponent = opponentById(id);
    if (!opponent || opponent.folded) continue;
    const context = {
      type: "preflop-vs-threebet",
      position: opponent.position,
      threeBettorPosition: threeBettor.position,
      threeBetBb: state.threeBetAmount / 3,
      priorAction: preflopRoleFor(opponent),
      openerPosition: opponentById(state.openerId)?.position,
      coldCallerCount: 1,
    };
    const action = sampleFishAction(opponent.combo, context);
    if (action === "raise") throw new Error("Curated 3-bet practice produced an unexpected 4-bet after the hero called.");
    observeOpponent(opponent, context, action, `Preflop: ${opponent.position} ${action}s facing ${threeBettor.position}'s ${formatMoney(state.threeBetAmount)} 3-bet.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to 3-bet";
      addAction(opponent.position, "folds to the 3-bet");
    } else {
      commitTo(opponent.id, state.threeBetAmount);
      opponent.status = `Called ${formatMoney(state.threeBetAmount)}`;
      addAction(opponent.position, `calls ${formatMoney(state.threeBetAmount)}`);
    }
  }
  advanceStreet();
}

function opponentsRespondToFourBet(target) {
  for (const id of ["sb", "bb", state.openerId, state.threeBettorId]) {
    const opponent = opponentById(id);
    if (!opponent || opponent.folded) continue;
    const context = {
      type: "preflop-vs-fourbet",
      position: opponent.position,
      fourBettorPosition: "BTN",
      fourBetBb: target / 3,
      priorAction: preflopRoleFor(opponent),
      openerPosition: opponentById(state.openerId)?.position,
      threeBettorPosition: opponentById(state.threeBettorId)?.position,
    };
    const action = sampleFishAction(opponent.combo, context);
    if (action === "raise") throw new Error("Curated 3-bet practice produced an unexpected 5-bet.");
    observeOpponent(opponent, context, action, `Preflop: ${opponent.position} ${action}s facing your ${formatMoney(target)} 4-bet.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to 4-bet";
      addAction(opponent.position, `folds to ${formatMoney(target)}`);
    } else {
      commitTo(opponent.id, target);
      opponent.status = `Called ${formatMoney(target)}`;
      addAction(opponent.position, `calls ${formatMoney(target)}`);
    }
  }
  advanceStreet();
}

function advanceStreet() {
  const currentIndex = STREET_ORDER.indexOf(state.street);
  if (currentIndex >= STREET_ORDER.length - 1) {
    finishHand("The river action is complete.", true);
    return;
  }
  state.street = STREET_ORDER[currentIndex + 1];
  state.heroCommitted = 0;
  for (const opponent of state.opponents) opponent.committed = 0;
  const targetCards = STREET_BOARD_COUNT[state.street];
  state.board = state.runout.slice(0, targetCards);
  const boardText = state.board.map(cardToString).join(" ");
  for (const opponent of activeOpponents()) {
    opponent.range = filterFishRange(opponent.range, [...state.heroCards, ...state.board]);
    addRangeEvent(opponent, `${streetLabel(state.street)} ${boardText}: remove newly blocked exact combos while preserving ${opponent.position}'s earlier action filters.`);
  }
  addAction("Board", `${streetLabel(state.street)} · ${boardText}`);
  startMultiwayStreet();
}

function startMultiwayStreet() {
  let aggressor = null;
  let aggressorContext = null;
  let openingBetFraction = null;
  let aggressionIsRaise = false;

  for (const opponent of opponentsInPostflopOrder()) {
    if (!aggressor) {
      const context = opponentPostflopContext(opponent, "postflop-multiway-first", {
        inPosition: false,
        checkedTo: false,
        donk: true,
      });
      const decision = fishDecisionForCombo(opponent.combo, context);
      observeOpponent(opponent, context, decision.action, `${streetLabel(state.street)}: ${opponent.position} ${decision.action}s before the BTN acts.`);
      if (decision.action === "check") {
        addAction(opponent.position, "checks");
        opponent.status = "Checked";
        continue;
      }
      openingBetFraction = decision.betFraction ?? (activeOpponents().length > 1 ? 0.33 : 0.50);
      const amount = Math.max(1, Math.round(state.pot * openingBetFraction));
      commit(opponent.id, amount);
      addAction(opponent.position, `bets ${formatMoney(amount)} (${Math.round(openingBetFraction * 100)}% pot)`);
      opponent.status = `Bet ${formatMoney(amount)}`;
      aggressor = opponent;
      aggressorContext = context;
      continue;
    }

    const context = aggressionIsRaise
      ? opponentPostflopContext(opponent, "postflop-vs-raise", {
        raiseFraction: Math.max(0.15, aggressor.committed / Math.max(1, state.pot - aggressor.committed)),
        raiserPosition: aggressor.position,
      })
      : opponentPostflopContext(opponent, "postflop-vs-bet", {
        betFraction: openingBetFraction,
        bettorPosition: aggressor.position,
      });
    const action = sampleFishAction(opponent.combo, context);
    observeOpponent(opponent, context, action, `${streetLabel(state.street)}: ${opponent.position} ${action}s facing ${aggressor.position}'s bet.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to bet";
      addAction(opponent.position, `folds to ${aggressor.position}'s bet`);
    } else if (action === "call") {
      commitTo(opponent.id, aggressor.committed);
      opponent.status = `Called ${formatMoney(aggressor.committed)}`;
      addAction(opponent.position, `calls ${formatMoney(aggressor.committed)}`);
    } else {
      const raiseTarget = Math.min(
        opponent.committed + opponent.stack,
        Math.max(aggressor.committed * 3, aggressor.committed + state.pot),
      );
      commitTo(opponent.id, raiseTarget);
      opponent.status = `Raised to ${formatMoney(raiseTarget)}`;
      addAction(opponent.position, `raises to ${formatMoney(raiseTarget)}`);
      aggressor = opponent;
      aggressorContext = context;
      aggressionIsRaise = true;
    }
  }

  if (!aggressor) {
    pushHeroDecision(buildAfterCheckDecision());
    return;
  }
  const amountToCall = Math.max(0, aggressor.committed - state.heroCommitted);
  pushHeroDecision(buildVsFishBetDecision(amountToCall, aggressor.id, aggressorContext));
}

function opponentsRespondToBet(amount, fraction) {
  for (const opponent of opponentsInPostflopOrder()) {
    const context = opponentPostflopContext(opponent, "postflop-vs-bet", {
      betFraction: fraction,
      bettorPosition: "BTN",
    });
    const action = sampleFishAction(opponent.combo, context);
    observeOpponent(opponent, context, action, `${streetLabel(state.street)}: ${opponent.position} ${action}s facing your ${Math.round(fraction * 100)}% pot bet.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded";
      addAction(opponent.position, "folds");
      continue;
    }
    if (action === "call") {
      commitTo(opponent.id, state.heroCommitted);
      opponent.status = `Called ${formatMoney(amount)}`;
      addAction(opponent.position, `calls ${formatMoney(amount)}`);
      continue;
    }
    const raiseTarget = Math.min(
      opponent.committed + opponent.stack,
      Math.max(state.heroCommitted * 3, state.heroCommitted + amount * 2),
    );
    commitTo(opponent.id, raiseTarget);
    opponent.status = `Raised to ${formatMoney(opponent.committed)}`;
    addAction(opponent.position, `raises to ${formatMoney(opponent.committed)}`);
    const amountToCall = Math.max(0, opponent.committed - state.heroCommitted);
    settleOpponentsFacingRaise(opponent.id);
    pushHeroDecision(buildVsRaiseDecision(amountToCall, opponent.id));
    return;
  }
  if (!activeOpponents().length) {
    finishHand("Every opponent folded to your bet. Review each seat to see its exact fold range.", false);
    return;
  }
  nextStreetOrShowdown();
}

function settleOpponentsFacingRaise(raiserId) {
  const raiser = opponentById(raiserId);
  for (const opponent of opponentsInPostflopOrder()) {
    if (opponent.id === raiserId) continue;
    const context = opponentPostflopContext(opponent, "postflop-vs-raise", {
      raiseFraction: Math.max(0.15, raiser.committed / Math.max(1, state.pot - raiser.committed)),
      raiserPosition: raiser.position,
    });
    const action = sampleFishAction(opponent.combo, context);
    observeOpponent(opponent, context, action, `${streetLabel(state.street)}: ${opponent.position} ${action}s facing ${raiser.position}'s raise.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to raise";
      addAction(opponent.position, `folds to ${raiser.position}'s raise`);
    } else {
      commitTo(opponent.id, raiser.committed);
      opponent.status = `Called raise to ${formatMoney(raiser.committed)}`;
      addAction(opponent.position, `calls to ${formatMoney(raiser.committed)}`);
    }
  }
}

function opponentsRespondToHeroRaise(target) {
  for (const opponent of opponentsInPostflopOrder()) {
    const context = opponentPostflopContext(opponent, "postflop-vs-raise", {
      raiseFraction: Math.max(0.15, target / Math.max(1, state.pot - state.heroCommitted)),
      raiserPosition: "BTN",
    });
    const action = sampleFishAction(opponent.combo, context);
    observeOpponent(opponent, context, action, `${streetLabel(state.street)}: ${opponent.position} ${action}s facing your raise to ${formatMoney(target)}.`);
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = "Folded to hero raise";
      addAction(opponent.position, "folds to your raise");
    } else {
      commitTo(opponent.id, target);
      opponent.status = `Called raise to ${formatMoney(target)}`;
      addAction(opponent.position, `calls to ${formatMoney(target)}`);
    }
  }
  if (!activeOpponents().length) {
    finishHand("Every opponent folded to your raise.", false);
    return;
  }
  nextStreetOrShowdown();
}

function settleOpponentsAfterHeroCallsFishAggression(aggressorId, aggressiveAction, betFraction) {
  const aggressor = opponentById(aggressorId);
  for (const opponent of opponentsInPostflopOrder()) {
    if (opponent.id === aggressorId) continue;
    const currentEntry = [...(opponent.postflopLine ?? [])]
      .reverse()
      .find((entry) => entry.street === state.street) ?? null;
    const alreadyFacedFinalAction = aggressiveAction === "raise"
      ? currentEntry?.context?.type === "postflop-vs-raise"
      : ["postflop-vs-bet", "postflop-vs-raise"].includes(currentEntry?.context?.type);
    if (alreadyFacedFinalAction) continue;

    const context = aggressiveAction === "raise"
      ? opponentPostflopContext(opponent, "postflop-vs-raise", {
        raiseFraction: Math.max(0.15, aggressor.committed / Math.max(1, state.pot - aggressor.committed)),
        raiserPosition: aggressor.position,
      })
      : opponentPostflopContext(opponent, "postflop-vs-bet", {
        betFraction,
        bettorPosition: aggressor.position,
      });
    const action = sampleFishAction(opponent.combo, context);
    observeOpponent(opponent, context, action, `${streetLabel(state.street)}: ${opponent.position} ${action}s after your call of ${aggressor.position}'s ${aggressiveAction}.`);
    if (action === "raise") {
      const raiseTarget = Math.min(
        opponent.committed + opponent.stack,
        Math.max(aggressor.committed * 3, aggressor.committed + state.pot),
      );
      commitTo(opponent.id, raiseTarget);
      opponent.status = `Raised to ${formatMoney(raiseTarget)}`;
      addAction(opponent.position, `raises to ${formatMoney(raiseTarget)}`);
      return opponent.id;
    }
    if (action === "fold") {
      opponent.folded = true;
      opponent.status = `Folded to ${aggressiveAction}`;
      addAction(opponent.position, `folds to ${aggressor.position}'s ${aggressiveAction}`);
    } else {
      commitTo(opponent.id, aggressor.committed);
      opponent.status = `Called to ${formatMoney(aggressor.committed)}`;
      addAction(opponent.position, `calls to ${formatMoney(aggressor.committed)}`);
    }
  }
  return null;
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
      for (const opponent of activeOpponents()) {
        opponent.range = filterFishRange(opponent.range, [...state.heroCards, ...state.board]);
      }
    }
    const heroScore = evaluate7([...state.heroCards, ...state.board]);
    const results = activeOpponents().map((opponent) => ({
      opponent,
      score: evaluate7([...opponent.combo.cards, ...state.board]),
    }));
    const contenders = [{ hero: true, score: heroScore }, ...results];
    let bestScore = heroScore;
    for (const contender of contenders.slice(1)) {
      if (compareScores(contender.score, bestScore) > 0) bestScore = contender.score;
    }
    const winners = contenders.filter((contender) => compareScores(contender.score, bestScore) === 0);
    const heroWins = winners.some((winner) => winner.hero);
    const winningOpponents = winners.filter((winner) => !winner.hero).map((winner) => winner.opponent.position);
    state.revealFish = true;
    const resultText = winners.length === 1
      ? heroWins ? "You win the multiway showdown." : `${winningOpponents[0]} wins the showdown.`
      : heroWins
        ? `You chop with ${winningOpponents.join(" and ")}.`
        : `${winningOpponents.join(" and ")} chop the showdown.`;
    const shownHands = results.map(({ opponent }) => `${opponent.position} ${opponent.combo.display}`).join(" · ");
    addAction("Showdown", `${resultText} ${shownHands}.`);
    for (const { opponent } of results) opponent.status = `${opponent.combo.display} · showdown`;
    state.heroStatus = resultText;
    copy = `${message} ${resultText} All remaining hidden hands are revealed only now; earlier grades used independent seat ranges, never the actual cards.`;
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

function rangeCellGradient(actionCounts, actions) {
  const total = actions.reduce((sum, key) => sum + (actionCounts[key] ?? 0), 0);
  if (!total) return "";
  let cursor = 0;
  const stops = [];
  for (const key of actions) {
    const count = actionCounts[key] ?? 0;
    if (!count) continue;
    const start = cursor;
    cursor += (count / total) * 100;
    stops.push(`var(--range-${key}) ${start.toFixed(2)}% ${cursor.toFixed(2)}%`);
  }
  return `linear-gradient(135deg, ${stops.join(",")})`;
}

function actionBreakdown(actionCounts, actions, labels) {
  return actions
    .filter((key) => (actionCounts[key] ?? 0) > 0)
    .map((key) => `${labels[key]}: ${actionCounts[key]}`)
    .join(" · ");
}

function fishResponseScenarios(moment, opponent) {
  if (moment.kind !== "decision") return [];
  const optionLabel = (choiceId) =>
    moment.decision.options.find((option) => option.id === choiceId)?.label ?? choiceId;
  const liveCount = moment.opponents.filter((entry) => !entry.folded).length;
  const previousStreetEntry = [...(opponent.postflopLine ?? [])]
    .reverse()
    .find((entry) => entry.street !== moment.street) ?? null;
  const postflopContext = (type, extra = {}) => ({
    type,
    board: moment.board,
    opponentCount: liveCount,
    headsUp: liveCount === 1,
    previousFishAction: previousStreetEntry?.action ?? null,
    wasPreflopAggressor: [moment.openerId, moment.threeBettorId].includes(opponent.id),
    ...extra,
  });

  if (moment.decision.type === "preflop-isolate" && !opponent.folded) {
    const contextFor = (target) => ({
      type: "preflop-vs-open",
      position: opponent.position,
      openerPosition: "BTN",
      openBb: target / 3,
      priorAction: preflopRoleFor(opponent, moment),
      coldCallerCount: moment.limperCount,
    });
    return [
      {
        choiceId: "isoSmall",
        label: optionLabel("isoSmall"),
        context: contextFor(moment.decision.smallTarget),
        actions: [...RANGE_ACTIONS],
      },
      {
        choiceId: "isoLarge",
        label: optionLabel("isoLarge"),
        context: contextFor(moment.decision.largeTarget),
        actions: [...RANGE_ACTIONS],
      },
    ];
  }

  if (moment.decision.type === "preflop-facing-open" && !opponent.folded) {
    const opener = opponentById(moment.openerId, moment);
    const contextFor = (target) => ({
      type: "preflop-vs-threebet",
      position: opponent.position,
      threeBettorPosition: "BTN",
      threeBetBb: target / 3,
      priorAction: preflopRoleFor(opponent, moment),
      openerPosition: opener?.position,
      coldCallerCount: moment.callerCount,
    });
    return [
      {
        choiceId: "squeezeSmall",
        label: optionLabel("squeezeSmall"),
        context: contextFor(moment.decision.smallTarget),
        actions: [...RANGE_ACTIONS],
      },
      {
        choiceId: "squeezeLarge",
        label: optionLabel("squeezeLarge"),
        context: contextFor(moment.decision.largeTarget),
        actions: [...RANGE_ACTIONS],
      },
    ];
  }

  if (moment.decision.type === "preflop-facing-threebet" && !opponent.folded) {
    const opener = opponentById(moment.openerId, moment);
    const threeBettor = opponentById(moment.threeBettorId, moment);
    const contextFor = (target) => ({
      type: "preflop-vs-fourbet",
      position: opponent.position,
      fourBettorPosition: "BTN",
      fourBetBb: target / 3,
      priorAction: preflopRoleFor(opponent, moment),
      openerPosition: opener?.position,
      threeBettorPosition: threeBettor?.position,
    });
    return [
      {
        choiceId: "fourBetSmall",
        label: optionLabel("fourBetSmall"),
        context: contextFor(moment.decision.smallTarget),
        actions: [...RANGE_ACTIONS],
      },
      {
        choiceId: "fourBetLarge",
        label: optionLabel("fourBetLarge"),
        context: contextFor(moment.decision.largeTarget),
        actions: [...RANGE_ACTIONS],
      },
    ];
  }

  if (moment.decision.type === "postflop-after-checks" && !opponent.folded) {
    return [
      {
        choiceId: "bet33",
        label: optionLabel("bet33"),
        context: postflopContext("postflop-vs-bet", { betFraction: 0.33 }),
        actions: [...RANGE_ACTIONS],
      },
      {
        choiceId: "bet75",
        label: optionLabel("bet75"),
        context: postflopContext("postflop-vs-bet", { betFraction: 0.75 }),
        actions: [...RANGE_ACTIONS],
      },
    ];
  }

  if (moment.decision.type === "postflop-vs-fish-bet" && !opponent.folded) {
    const scenarios = [];
    if (opponent.id === moment.decision.bettorId) {
      scenarios.push({
        choiceId: "observed",
        label: `Observed ${moment.decision.aggressiveAction}`,
        context: moment.decision.betContext,
        actions: [moment.decision.aggressiveAction],
      });
    }
    scenarios.push({
      choiceId: "raise",
      label: optionLabel("raise"),
      context: postflopContext("postflop-vs-raise", { raiseFraction: 1 }),
      actions: [...RANGE_ACTIONS],
    });
    return scenarios;
  }

  return [];
}

function fishActionLabel(action, context) {
  if (action === "raise" && context.type === "preflop-vs-open") return "3-bet";
  if (action === "raise" && context.type === "preflop-vs-threebet") return "4-bet";
  if (action === "raise" && context.type === "preflop-vs-fourbet") return "5-bet";
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

function renderResponseExplorer(moment, opponent) {
  const scenarios = fishResponseScenarios(moment, opponent);
  if (!scenarios.length) {
    elements.responseExplorer.hidden = true;
    return {
      range: opponent.range,
      partitions: { current: opponent.range },
      actions: ["current"],
      labels: RANGE_ACTION_LABELS,
      context: null,
      title: `${opponent.position} range · ${streetLabel(moment.street)} · current branch`,
      copy: `Binary marginal range for ${opponent.position}: every exact combo shown still fits this seat's full action thread.`,
    };
  }

  elements.responseExplorer.hidden = false;
  const defaultObservedAggression = scenarios.find((scenario) => scenario.choiceId === "observed");
  const rememberedScenario = scenarios.find((scenario) => scenario.choiceId === rangeView.choiceId);
  const shouldDefaultToObserved = defaultObservedAggression
    && rangeView.choiceId !== "current"
    && !rememberedScenario;
  if (rangeView.momentId !== moment.id || shouldDefaultToObserved) {
    const answeredScenario = scenarios.find((scenario) => scenario.choiceId === moment.answer);
    rangeView = {
      momentId: moment.id,
      opponentId: opponent.id,
      choiceId: answeredScenario?.choiceId ?? defaultObservedAggression?.choiceId ?? null,
      fishAction: null,
    };
    selectedRangeClass = null;
  }

  const selectedScenario = scenarios.find((scenario) => scenario.choiceId === rangeView.choiceId) ?? null;
  elements.responseSizingOptions.innerHTML = [
    `<button type="button" class="response-option${selectedScenario ? "" : " selected"}" data-response-choice="">Current branch <b>${opponent.range.length}</b></button>`,
    ...scenarios.map((scenario) =>
      `<button type="button" class="response-option${selectedScenario?.choiceId === scenario.choiceId ? " selected" : ""}" data-response-choice="${scenario.choiceId}">${scenario.label}</button>`),
  ].join("");
  for (const button of elements.responseSizingOptions.querySelectorAll("[data-response-choice]")) {
    button.addEventListener("click", () => {
      rangeView = {
        momentId: moment.id,
        opponentId: opponent.id,
        choiceId: button.dataset.responseChoice || "current",
        fishAction: null,
      };
      selectedRangeClass = null;
      renderRange(moment);
    });
  }

  if (!selectedScenario) {
    elements.responseExplorerCopy.textContent =
      `Choose a hero sizing to split ${opponent.position}'s exact range into fold, call, and raise buckets.`;
    elements.responseActionOptions.innerHTML = "";
    return {
      range: opponent.range,
      partitions: { current: opponent.range },
      actions: ["current"],
      labels: RANGE_ACTION_LABELS,
      context: null,
      title: `${opponent.position} range · ${streetLabel(moment.street)} · current branch`,
      copy: "Every shown combo survived the branch so far. Choose a sizing above to inspect the deterministic response split.",
    };
  }

  const blockedCards = [...moment.heroCards, ...moment.board];
  const partitions = partitionFishRange(opponent.range, selectedScenario.context, blockedCards);
  const selectedAction = selectedScenario.actions.includes(rangeView.fishAction)
    ? rangeView.fishAction
    : null;
  elements.responseExplorerCopy.textContent =
    `Facing ${selectedScenario.label}, every surviving combo goes to exactly one action. Select a response to highlight its literal combos.`;
  elements.responseActionOptions.innerHTML = [
    `<button type="button" class="response-action${selectedAction ? "" : " selected"}" data-fish-action="">Before response <b>${opponent.range.length}</b></button>`,
    ...selectedScenario.actions.map((action) =>
      `<button type="button" class="response-action${selectedAction === action ? " selected" : ""}" data-fish-action="${action}">${fishActionLabel(action, selectedScenario.context)} <b>${partitions[action]?.length ?? 0}</b></button>`),
  ].join("");
  for (const button of elements.responseActionOptions.querySelectorAll("[data-fish-action]")) {
    button.addEventListener("click", () => {
      rangeView = {
        momentId: moment.id,
        opponentId: opponent.id,
        choiceId: selectedScenario.choiceId,
        fishAction: button.dataset.fishAction || null,
      };
      selectedRangeClass = null;
      renderRange(moment);
    });
  }

  if (!selectedAction) {
    const labels = Object.fromEntries(selectedScenario.actions.map((action) => [
      action,
      fishActionLabel(action, selectedScenario.context),
    ]));
    return {
      range: opponent.range,
      partitions,
      actions: selectedScenario.actions,
      labels,
      context: selectedScenario.context,
      title: `${opponent.position} range before responding to ${selectedScenario.label}`,
      copy: `This is ${opponent.position}'s exact marginal range reaching the decision. Response counts are exhaustive and mutually exclusive for this seat.`,
    };
  }

  return {
    range: partitions[selectedAction] ?? [],
    partitions: { [selectedAction]: partitions[selectedAction] ?? [] },
    actions: [selectedAction],
    labels: {
      [selectedAction]: fishActionLabel(selectedAction, selectedScenario.context),
    },
    context: selectedScenario.context,
    title: `${opponent.position} ${fishActionLabel(selectedAction, selectedScenario.context).toLowerCase()} range facing ${selectedScenario.label}`,
    copy: `Only exact combos assigned to ${fishActionLabel(selectedAction, selectedScenario.context).toLowerCase()} are shown. There are no mixed actions or probability weights.`,
  };
}

function renderComboDetail(range, context) {
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
    ? context
      ? "Each exact combo is played from the fish's visible-hand perspective. The explanation is the deterministic reason for its action."
      : "These are the literal suit combinations assigned to the selected range. Choose a facing size to see the fish's thought process."
    : "No exact suit combinations from this hand class take the selected action.";
  elements.comboDetailList.innerHTML = combos.map((entry) => {
    if (!context) return `<span class="exact-combo">${entry.display}</span>`;
    const decision = fishDecisionForCombo(entry, context);
    const action = fishActionLabel(decision.action, context);
    const intent = decision.intent ? ` · ${decision.intent}` : "";
    return `<div class="exact-combo-thought action-${decision.action}">
      <strong>${entry.display} · ${action}${intent}</strong>
      <span>Fish sees: ${decision.perception}</span>
      <small>${decision.reason}</small>
    </div>`;
  }).join("");
}

function renderRange(moment) {
  const decisionOpponent = moment.opponents.find((entry) =>
    entry.id === (moment.decision?.bettorId ?? moment.decision?.raiserId));
  const opponent = moment.opponents.find((entry) => entry.id === rangeView.opponentId)
    ?? decisionOpponent
    ?? moment.opponents.find((entry) => !entry.folded)
    ?? moment.opponents[0];
  rangeView.opponentId = opponent.id;
  elements.rangeOpponentOptions.innerHTML = moment.opponents
    .map((entry) => `<button type="button" class="response-option opponent-option${entry.id === opponent.id ? " selected" : ""}${entry.folded ? " folded" : ""}" data-range-opponent="${entry.id}"><b>${entry.position}</b><span>${entry.status}</span><small>${entry.range.length} combos</small></button>`)
    .join("");
  for (const button of elements.rangeOpponentOptions.querySelectorAll("[data-range-opponent]")) {
    button.addEventListener("click", () => {
      rangeView = { momentId: moment.id, opponentId: button.dataset.rangeOpponent, choiceId: null, fishAction: null };
      selectedRangeClass = null;
      renderRange(moment);
    });
  }

  const displayed = renderResponseExplorer(moment, opponent);
  const displayedRange = displayed.range;
  const summary = summarizeFishRange(displayedRange, moment.board);
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
      const actionCounts = Object.fromEntries(displayed.actions.map((action) => [
        action,
        (displayed.partitions[action] ?? []).filter((entry) => entry.classLabel === label).length,
      ]));
      const gradient = rangeCellGradient(actionCounts, displayed.actions);
      const breakdown = actionBreakdown(actionCounts, displayed.actions, displayed.labels);
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

  elements.rangeLegend.innerHTML = displayed.actions
    .map((key) => `<span><i class="range-swatch action-${key}"></i>${displayed.labels[key]}</span>`)
    .join("");
  elements.rangeCombos.textContent = summary.comboCount.toLocaleString("en-US");
  elements.rangeEffective.textContent = summary.classCount.toLocaleString("en-US");
  elements.rangeTop.innerHTML = displayed.actions
    .map((key) => `<span class="top-class"><i class="range-swatch action-${key}"></i><b>${displayed.labels[key]}</b>${(displayed.partitions[key]?.length ?? 0).toLocaleString("en-US")} combos</span>`)
    .join("");
  elements.rangeThread.innerHTML = opponent.rangeEvents
    .map((entry) => `<li><strong>${streetLabel(entry.street)}:</strong> ${entry.text.replace(/^\w+:\s*/, "")}</li>`)
    .join("");
  renderComboDetail(displayedRange, displayed.context);
}

function revealOpponentRange(moment, opponentId = null) {
  if (!moment) return;
  const decisionOpponentId = moment.decision?.bettorId ?? moment.decision?.raiserId;
  const opponent = moment.opponents.find((entry) => entry.id === opponentId)
    ?? moment.opponents.find((entry) => entry.id === rangeView.opponentId)
    ?? moment.opponents.find((entry) => entry.id === decisionOpponentId)
    ?? moment.opponents.find((entry) => !entry.folded)
    ?? moment.opponents[0];
  if (!opponent) return;
  rangeVisible = true;
  rangeView = { momentId: moment.id, opponentId: opponent.id, choiceId: null, fishAction: null };
  selectedRangeClass = null;
  render();
  elements.rangePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCards(moment) {
  elements.heroCards.innerHTML = moment.heroCards.map((card) => cardToHtml(card)).join("");
  elements.opponentSeats.innerHTML = moment.opponents.map((opponent) => {
    const cards = opponent.combo
      ? opponent.combo.cards.map((card) => cardToHtml(card)).join("")
      : `<span class="card-back">?</span><span class="card-back">?</span>`;
    const cardLabel = opponent.combo ? `${opponent.position} cards ${opponent.combo.display}` : `${opponent.position} cards hidden`;
    return `<div class="seat opponent-seat${opponent.folded ? " folded" : ""}" data-opponent-seat="${opponent.id}">
      <div class="seat-label"><strong>${opponent.position}</strong><span>${formatMoney(opponent.stack)}</span></div>
      <div class="card-row compact-cards" aria-label="${cardLabel}">${cards}</div>
      <div class="seat-action">${opponent.status}</div>
      <button type="button" class="seat-range-button" data-reveal-opponent-range="${opponent.id}" aria-label="Reveal ${opponent.position} range">Reveal range</button>
    </div>`;
  }).join("");
  for (const button of elements.opponentSeats.querySelectorAll("[data-reveal-opponent-range]")) {
    button.addEventListener("click", () => revealOpponentRange(moment, button.dataset.revealOpponentRange));
  }
  const board = [...moment.board];
  elements.boardCards.innerHTML = Array.from({ length: 5 }, (_, index) =>
    board[index] === undefined ? `<span class="empty-card">—</span>` : cardToHtml(board[index]),
  ).join("");
}

function renderDecision(moment) {
  const path = activePath();
  const activeMoment = historyIndex === path.length - 1;
  const answerRevealed = moment.kind !== "decision" || Boolean(moment.answer);
  elements.questionKicker.textContent = moment.kicker ?? (moment.kind === "decision" ? "Your decision" : "Hand complete");
  elements.questionTitle.textContent = moment.title;
  elements.questionCopy.textContent = moment.copy;
  elements.answerOptions.innerHTML = "";
  if (answerRevealed && moment.decision?.basis) {
    elements.decisionBasis.hidden = false;
    elements.decisionBasisTitle.textContent = moment.decision.basis.title;
    elements.decisionBasisCopy.textContent = moment.decision.basis.copy;
  } else {
    elements.decisionBasis.hidden = true;
  }

  if (moment.kind === "decision") {
    for (const option of moment.decision.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      if (moment.answer === option.id) button.classList.add("selected");
      if (moment.answer && moment.decision.recommended === option.id) button.classList.add("recommended");
      const savedBranch = trainerTreeChild(tree, moment.id, option.id);
      button.setAttribute("aria-pressed", String(moment.answer === option.id));
      const revealedDetail = answerRevealed ? `<small>${option.detail}</small>` : "";
      button.innerHTML = `<span class="answer-label"><strong>${option.label}</strong>${revealedDetail}</span>${savedBranch ? '<span class="branch-saved">Saved branch</span>' : ""}`;
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

  if (!answerRevealed) {
    elements.decisionNote.textContent = "Choose an action first. Grading and strategy explanations unlock only after you commit; each opponent's independent range is available from their seat at any time.";
  } else if (!activeMoment && moment.kind === "decision") {
    elements.decisionNote.textContent = "Reviewing an earlier fork. Every action remains selectable; exploring it creates or reopens a saved counterfactual branch without deleting the others.";
  } else if (moment.kind === "complete") {
    elements.decisionNote.textContent = "Use ← or the branch trail to revisit any earlier fork. Saved alternatives keep their own board, pot, action thread, and every opponent's exact range.";
  } else {
    elements.decisionNote.textContent = "Choose any action for its specific explanation, then explore it. You can return and select every other action or sizing; completed branches stay saved.";
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
  elements.spotLabel.textContent = `${moment.spotLabel} · ${activeOpponents(moment).length} opponents live · $1/$2/$3 · 150bb`;
  elements.potLabel.textContent = formatMoney(moment.pot);
  elements.heroStack.textContent = formatMoney(moment.heroStack);
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

function historyActionLabel(action) {
  return RANGE_ACTION_LABELS[action] ?? streetLabel(action);
}

function renderHistoryComboDetail(range, snapshot) {
  const combos = selectedHistoryRangeClass
    ? range.filter((entry) => entry.classLabel === selectedHistoryRangeClass)
    : [];
  if (!selectedHistoryRangeClass) {
    elements.historyComboTitle.textContent = "Select a hand class";
    elements.historyComboCopy.textContent = "Click any colored cell to list the exact suit combinations still in the estimated range.";
    elements.historyComboList.innerHTML = "";
    return;
  }
  elements.historyComboTitle.textContent = `${selectedHistoryRangeClass} · ${combos.length} exact combo${combos.length === 1 ? "" : "s"}`;
  elements.historyComboCopy.textContent = combos.length
    ? snapshot.lastFishContext
      ? `Every listed combination survived the same prior thread and takes the recorded ${snapshot.lastFishAction} for the visible reason shown below.`
      : "Every listed combination survived the same blocker and action filters from the pasted history."
    : "No exact combinations from this class remain.";
  elements.historyComboList.innerHTML = combos.map((entry) => {
    if (!snapshot.lastFishContext) return `<span class="exact-combo">${entry.display}</span>`;
    const decision = fishDecisionForCombo(entry, snapshot.lastFishContext);
    const intent = decision.intent ? ` · ${decision.intent}` : "";
    return `<div class="exact-combo-thought action-${decision.action}">
      <strong>${entry.display} · ${historyActionLabel(decision.action)}${intent}</strong>
      <span>Fish sees: ${decision.perception}</span>
      <small>${decision.reason}</small>
    </div>`;
  }).join("");
}

function renderHistoryStreetTabs(result, selectedSnapshot) {
  elements.historyStreetTabs.innerHTML = result.streetSnapshots
    .map((snapshot) => {
      const selected = snapshot.street === selectedSnapshot.street;
      return `<button type="button" class="history-street-tab" id="history-tab-${snapshot.street}" role="tab" aria-selected="${selected}" aria-controls="history-range-grid" tabindex="${selected ? "0" : "-1"}" data-history-street="${snapshot.street}" title="${escapeHtml(snapshot.checkpoint)}"><span>${streetLabel(snapshot.street)}</span><small>${snapshot.summary.comboCount.toLocaleString("en-US")} combos</small></button>`;
    })
    .join("");

  const selectStreet = (street, focus = false) => {
    selectedHistoryStreet = street;
    selectedHistoryRangeClass = null;
    renderHistoryAnalysis(result);
    if (focus) elements.historyStreetTabs.querySelector(`[data-history-street="${street}"]`)?.focus();
  };

  for (const button of elements.historyStreetTabs.querySelectorAll("[data-history-street]")) {
    button.addEventListener("click", () => selectStreet(button.dataset.historyStreet));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const snapshots = result.streetSnapshots;
      const currentIndex = snapshots.findIndex((snapshot) => snapshot.street === button.dataset.historyStreet);
      const targetIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? snapshots.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + snapshots.length) % snapshots.length;
      selectStreet(snapshots[targetIndex].street, true);
    });
  }
}

function renderHistoryAnalysis(result) {
  const snapshot = result.streetSnapshots.find((entry) => entry.street === selectedHistoryStreet)
    ?? result.streetSnapshots.at(-1);
  selectedHistoryStreet = snapshot.street;
  selectedHistoryRangeClass = null;
  elements.historyResult.hidden = false;
  renderHistoryStreetTabs(result, snapshot);
  const recognizedActions = result.events
    .slice(0, snapshot.eventCount)
    .filter((event) => event.action !== "board").length;
  const actionDescription = snapshot.lastFishAction
    ? `after ${snapshot.checkpoint}`
    : `after ${snapshot.checkpoint}; no Fish action was recorded on this street`;
  elements.historyStreetContext.textContent = `${streetLabel(snapshot.street)} range ${actionDescription}. It includes ${recognizedActions} recognized Fish action${recognizedActions === 1 ? "" : "s"} from the same threaded history and every blocker visible by this point.`;
  elements.historyStreet.textContent = streetLabel(snapshot.street);
  elements.historyBoard.textContent = snapshot.board.length
    ? snapshot.board.map(cardToString).join(" ")
    : "Preflop";
  elements.historyCombos.textContent = snapshot.summary.comboCount.toLocaleString("en-US");
  elements.historyClasses.textContent = snapshot.summary.classCount.toLocaleString("en-US");
  const visibleEvents = result.events.slice(0, snapshot.eventCount);
  elements.historyEvents.innerHTML = visibleEvents.length
    ? visibleEvents
    .map((event) => `<li><strong>${streetLabel(event.street)}:</strong> ${escapeHtml(event.text)} <small>${event.before} → ${event.after} combos</small></li>`)
      .join("")
    : "<li>Starting unblocked preflop range.</li>";
  elements.historyWarnings.hidden = result.warnings.length === 0;
  elements.historyWarnings.innerHTML = result.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");

  const action = snapshot.lastFishAction ?? "current";
  const actions = [action];
  const labels = { [action]: historyActionLabel(action) };
  const flatClasses = HAND_CLASSES.flat();
  elements.historyRangeGrid.innerHTML = flatClasses
    .map((label) => {
      const combos = snapshot.range.filter((entry) => entry.classLabel === label);
      const total = classComboCount(label);
      if (!combos.length) {
        return `<button type="button" class="fish-range-cell excluded" data-history-range-class="${label}" title="${label}: not in this estimated range"><strong>${label}</strong><small>—</small></button>`;
      }
      const gradient = rangeCellGradient({ [action]: combos.length }, actions);
      return `<button type="button" class="fish-range-cell present" data-history-range-class="${label}" style="background:${gradient}" title="${label}: ${combos.length}/${total} exact combos · ${labels[action]}"><strong>${label}</strong><small>${combos.length}/${total}</small></button>`;
    })
    .join("");
  for (const button of elements.historyRangeGrid.querySelectorAll("[data-history-range-class]")) {
    button.addEventListener("click", () => {
      selectedHistoryRangeClass = button.dataset.historyRangeClass;
      for (const cell of elements.historyRangeGrid.querySelectorAll("[data-history-range-class]")) {
        cell.classList.toggle("selected", cell === button);
      }
      renderHistoryComboDetail(snapshot.range, snapshot);
    });
  }
  elements.historyRangeLegend.innerHTML = `<span><i class="range-swatch action-${action}"></i>${snapshot.lastFishAction ? `${labels[action]} on ${streetLabel(snapshot.street)}'s last Fish action` : `Range after ${streetLabel(snapshot.street)} blockers`}</span>`;
  renderHistoryComboDetail(snapshot.range, snapshot);
}

function analyzeEnteredHistory() {
  elements.historyError.hidden = true;
  elements.historyError.textContent = "";
  try {
    const result = analyzeFishHandHistory({
      heroCards: elements.historyHeroCards.value,
      heroName: elements.historyHeroName.value,
      fishName: elements.historyFishName.value,
      bigBlind: elements.historyBigBlind.value,
      startingPot: elements.historyStartingPot.value,
      history: elements.historyInput.value,
    });
    selectedHistoryStreet = result.streetSnapshots.at(-1)?.street ?? result.street;
    renderHistoryAnalysis(result);
  } catch (error) {
    elements.historyResult.hidden = true;
    elements.historyError.hidden = false;
    elements.historyError.textContent = error.message;
  }
}

function setMode(mode) {
  const analyze = mode === "analyze";
  elements.playMode.hidden = analyze;
  elements.analyzeMode.hidden = !analyze;
  elements.modePlay.classList.toggle("selected", !analyze);
  elements.modeAnalyze.classList.toggle("selected", analyze);
  elements.modePlay.setAttribute("aria-selected", String(!analyze));
  elements.modeAnalyze.setAttribute("aria-selected", String(analyze));
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
  revealOpponentRange(currentMoment());
});

elements.hideRange.addEventListener("click", () => {
  rangeVisible = false;
  render();
});

elements.newHand.addEventListener("click", startNewHand);
elements.modePlay.addEventListener("click", () => setMode("play"));
elements.modeAnalyze.addEventListener("click", () => setMode("analyze"));
elements.analyzeHistory.addEventListener("click", analyzeEnteredHistory);

startNewHand();
