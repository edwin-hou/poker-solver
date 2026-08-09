import {
  expandRange,
  parseBetSizes,
  parseCards,
  summarizeRange,
  validatePokerConfig,
} from "../src/index.js";
import {
  DEFAULT_SCENARIO_BY_STREET,
  SCENARIOS,
  STREET_META,
  formatFloat,
  number,
} from "./ui-constants.js";
import {
  clearNodeSelection,
  exportResult,
  initializeResultView,
  renderNode,
  renderResult,
} from "./result-view.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $("#solver-form"),
  scenario: $("#scenario"),
  street: $("#street"),
  streetTabs: [...document.querySelectorAll("#street-tabs [data-street]")],
  postflopSetup: $("#postflop-setup"),
  preflopSetup: $("#preflop-setup"),
  postflopBetting: $("#postflop-betting"),
  preflopBetting: $("#preflop-betting"),
  preflopTreeNote: $("#preflop-tree-note"),
  preflopModel: $("#preflop-model"),
  preflopLookupSetup: $("#preflop-lookup-setup"),
  preflopPushfoldSetup: $("#preflop-pushfold-setup"),
  preflopSpot: $("#preflop-spot"),
  heroPosition: $("#hero-position"),
  villainPosition: $("#villain-position"),
  villainPositionField: $("#villain-position-field"),
  lookupStack: $("#lookup-stack"),
  openSize: $("#open-size"),
  rangeEditor: $("#range-editor"),
  accuracySettings: $("#accuracy-settings"),
  lookupAccuracyNote: $("#lookup-accuracy-note"),
  board: $("#board"),
  pot: $("#pot"),
  stack: $("#stack"),
  smallBlind: $("#small-blind"),
  bigBlind: $("#big-blind"),
  ante: $("#ante"),
  preflopStack: $("#preflop-stack"),
  oopRange: $("#oop-range"),
  ipRange: $("#ip-range"),
  oopRangeLabel: $("#oop-range-label"),
  ipRangeLabel: $("#ip-range-label"),
  oopPositionChip: $("#oop-position-chip"),
  ipPositionChip: $("#ip-position-chip"),
  boardFieldLabel: $("#board-field-label"),
  boardHelp: $("#board-help"),
  oopBets: $("#oop-bets"),
  ipBets: $("#ip-bets"),
  iterations: $("#iterations"),
  iterationsOutput: $("#iterations-output"),
  averagingDelay: $("#averaging-delay"),
  evaluationSamples: $("#evaluation-samples"),
  seed: $("#seed"),
  oopRangeCount: $("#oop-range-count"),
  ipRangeCount: $("#ip-range-count"),
  treePreview: $("#tree-preview"),
  error: $("#form-error"),
  solveButton: $("#solve-button"),
  solveButtonLabel: $("#solve-button-label"),
  cancelButton: $("#cancel-button"),
  resetButton: $("#reset-button"),
  placeholder: $("#results-placeholder"),
  progressView: $("#progress-view"),
  resultsView: $("#results-view"),
  progressTitle: $("#progress-title"),
  progressDetail: $("#progress-detail"),
  progressBar: $("#progress-bar"),
  progressIterations: $("#progress-iterations"),
  progressPercent: $("#progress-percent"),
  resultStreet: $("#result-street"),
  resultBoard: $("#result-board"),
  metricExploitabilityLabel: $("#metric-exploitability-label"),
  metricExploitability: $("#metric-exploitability"),
  metricExploitabilityPot: $("#metric-exploitability-pot"),
  metricOopLabel: $("#metric-oop-label"),
  metricOopEv: $("#metric-oop-ev"),
  metricDeals: $("#metric-deals"),
  metricIterations: $("#metric-iterations"),
  metricRuntime: $("#metric-runtime"),
  nodeSelect: $("#node-select"),
  rangeSide: $("#range-side"),
  actionLegend: $("#action-legend"),
  rangeGrid: $("#range-grid"),
  selectedClass: $("#selected-class"),
  classSummary: $("#class-summary"),
  comboHead: $("#combo-head"),
  comboBody: $("#combo-body"),
  exportButton: $("#export-button"),
  resolveButton: $("#resolve-button"),
  accuracyNote: $("#accuracy-note"),
};

let worker = null;
let rangeDebounce = null;

function isLookupMode() {
  return elements.street.value === "preflop" && elements.preflopModel.value === "lookup";
}

function createWorker() {
  worker?.terminate();
  worker = new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", (event) => {
    finishWithError(event.message || "The solver worker stopped unexpectedly.");
  });
}

function handleWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.type === "progress") {
    const { iteration, target, fraction } = message.progress;
    const street = elements.street.value;
    if (isLookupMode()) {
      elements.progressTitle.textContent = "Generating preflop chart…";
      elements.progressDetail.textContent = "Applying position, stack, price, and hand-class lookup targets.";
    } else {
      elements.progressTitle.textContent = `Solving ${STREET_META[street].label.toLowerCase()} strategy…`;
      elements.progressDetail.textContent =
        street === "preflop"
          ? "Sampling two-card deals and five-card boards while updating push/fold regrets."
          : street === "river"
            ? "Updating exact river counterfactual regrets."
            : "Sampling compatible deals and future public runouts while updating regrets.";
    }
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    elements.progressIterations.textContent = isLookupMode()
      ? "Lookup complete"
      : `${number.format(iteration)} / ${number.format(target)} iterations`;
    elements.progressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    return;
  }
  if (message.type === "result") {
    finishSolve();
    renderResult(message.result);
    return;
  }
  if (message.type === "cancelled") {
    finishSolve();
    showPlaceholder();
    return;
  }
  if (message.type === "error") finishWithError(message.error?.message ?? "Unknown solver error.");
}

function showPlaceholder() {
  elements.placeholder.hidden = false;
  elements.progressView.hidden = true;
  elements.resultsView.hidden = true;
}

function showProgress() {
  const street = elements.street.value;
  elements.placeholder.hidden = true;
  elements.resultsView.hidden = true;
  elements.progressView.hidden = false;
  elements.progressTitle.textContent = isLookupMode()
    ? "Building approximate preflop chart…"
    : `Building ${STREET_META[street].label.toLowerCase()} game…`;
  elements.progressDetail.textContent = isLookupMode()
    ? "Preparing the 169-class matrix and exact two-card combinations."
    : street === "preflop"
      ? "Expanding SB and BB ranges, blinds, and the push/fold game."
      : "Applying board blockers and preparing exact two-card combinations.";
  elements.progressBar.style.width = "1%";
  elements.progressIterations.textContent = "Preparing";
  elements.progressPercent.textContent = "0%";
}

function finishSolve() {
  elements.solveButton.disabled = false;
  elements.cancelButton.hidden = true;
}

function finishWithError(message) {
  finishSolve();
  elements.error.hidden = false;
  elements.error.textContent = message;
  showPlaceholder();
}

function updatePreflopControls() {
  const preflop = elements.street.value === "preflop";
  const lookup = preflop && elements.preflopModel.value === "lookup";
  elements.preflopLookupSetup.hidden = !lookup;
  elements.preflopPushfoldSetup.hidden = !preflop || lookup;
  elements.rangeEditor.hidden = lookup;
  elements.accuracySettings.hidden = lookup;
  elements.lookupAccuracyNote.hidden = !lookup;
  elements.villainPositionField.hidden = lookup && elements.preflopSpot.value === "rfi";

  if (lookup) {
    elements.oopRange.value = "random";
    elements.ipRange.value = "random";
    elements.solveButtonLabel.textContent = "Show preflop chart";
    elements.preflopTreeNote.textContent =
      elements.preflopSpot.value === "rfi"
        ? "Open-first-in chart with position- and stack-adjusted frequencies."
        : elements.preflopSpot.value === "vs-open"
          ? "Facing-open chart: fold, call, or 3-bet."
          : "Facing-3-bet chart: fold, call, or 4-bet.";
    elements.oopRangeLabel.textContent = "Hero chart coverage";
    elements.ipRangeLabel.textContent = "Villain chart coverage";
    elements.oopPositionChip.textContent = elements.heroPosition.value;
    elements.ipPositionChip.textContent = elements.villainPosition.value;
    return;
  }

  if (preflop) {
    elements.solveButtonLabel.textContent = "Run push/fold solve";
    elements.oopRangeLabel.textContent = "SB range";
    elements.ipRangeLabel.textContent = "BB range";
    elements.oopPositionChip.textContent = "SB";
    elements.ipPositionChip.textContent = "BB";
    elements.preflopTreeNote.textContent = "Heads-up SB fold/jam and BB fold/call CFR+ tree.";
    return;
  }

  elements.solveButtonLabel.textContent = "Build & solve";
  elements.oopRangeLabel.textContent = "OOP range";
  elements.ipRangeLabel.textContent = "IP range";
  elements.oopPositionChip.textContent = "OOP";
  elements.ipPositionChip.textContent = "IP";
}

function setStreet(street, { updateScenario = false } = {}) {
  if (!(street in STREET_META)) street = "preflop";
  elements.street.value = street;
  for (const button of elements.streetTabs) {
    const active = button.dataset.street === street;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  const preflop = street === "preflop";
  elements.preflopSetup.hidden = !preflop;
  elements.preflopBetting.hidden = !preflop;
  elements.postflopSetup.hidden = preflop;
  elements.postflopBetting.hidden = preflop;

  elements.boardFieldLabel.textContent = `${STREET_META[street].label} board`;
  const count = STREET_META[street].boardCards;
  elements.boardHelp.textContent = count
    ? `Enter exactly ${count} unique card${count === 1 ? "" : "s"}.`
    : "No board cards preflop.";

  if (updateScenario) {
    setScenario(DEFAULT_SCENARIO_BY_STREET[street], { updateStreet: false });
    return;
  }
  updatePreflopControls();
}

function setScenario(name, { updateStreet = true } = {}) {
  const scenario = SCENARIOS[name] ?? SCENARIOS["preflop-btn-rfi"];
  if (updateStreet) setStreet(scenario.street, { updateScenario: false });
  elements.scenario.value = name in SCENARIOS ? name : DEFAULT_SCENARIO_BY_STREET[scenario.street];
  elements.board.value = scenario.board ?? "";
  elements.oopRange.value = scenario.oopRange ?? "random";
  elements.ipRange.value = scenario.ipRange ?? "random";
  elements.iterations.value = scenario.iterations ?? 220_000;
  elements.evaluationSamples.value = scenario.evaluationSamples ?? 24_000;
  elements.averagingDelay.value = scenario.averagingDelay ?? 3_000;
  elements.seed.value = scenario.seed ?? 20_260_812;

  if (scenario.street === "preflop") {
    elements.preflopModel.value = scenario.preflopMode ?? "lookup";
    elements.preflopSpot.value = scenario.preflopSpot ?? "rfi";
    elements.heroPosition.value = scenario.heroPosition ?? "BTN";
    elements.villainPosition.value = scenario.villainPosition ?? "BB";
    elements.lookupStack.value = scenario.stack ?? 100;
    elements.openSize.value = scenario.openSize ?? 2.5;
    elements.smallBlind.value = scenario.smallBlind ?? 0.5;
    elements.bigBlind.value = scenario.bigBlind ?? 1;
    elements.ante.value = scenario.ante ?? 0;
    elements.preflopStack.value = scenario.stack ?? 10;
  } else {
    elements.pot.value = scenario.pot;
    elements.stack.value = scenario.stack;
    elements.oopBets.value = scenario.oopBets;
    elements.ipBets.value = scenario.ipBets;
  }
  updatePreflopControls();
  refreshInputs();
}

function readConfig() {
  const street = elements.street.value;
  const common = {
    street,
    iterations: Number(elements.iterations.value),
    averagingDelay: Number(elements.averagingDelay.value),
    evaluationSamples: Number(elements.evaluationSamples.value),
    seed: Number(elements.seed.value),
    progressEvery: 5_000,
  };

  if (street === "preflop" && elements.preflopModel.value === "lookup") {
    return {
      street,
      preflopMode: "lookup",
      preflopSpot: elements.preflopSpot.value,
      heroPosition: elements.heroPosition.value,
      villainPosition: elements.villainPosition.value,
      stack: Number(elements.lookupStack.value),
      openSize: Number(elements.openSize.value),
      heroRange: "random",
      villainRange: "random",
      seed: Number(elements.seed.value),
    };
  }

  if (street === "preflop") {
    return {
      ...common,
      preflopMode: "push-fold",
      sbRange: elements.oopRange.value,
      bbRange: elements.ipRange.value,
      smallBlind: Number(elements.smallBlind.value),
      bigBlind: Number(elements.bigBlind.value),
      ante: Number(elements.ante.value),
      stack: Number(elements.preflopStack.value),
    };
  }

  return {
    ...common,
    board: elements.board.value,
    oopRange: elements.oopRange.value,
    ipRange: elements.ipRange.value,
    pot: Number(elements.pot.value),
    stack: Number(elements.stack.value),
    oopBetSizes: elements.oopBets.value,
    ipBetSizes: elements.ipBets.value,
  };
}

function validateBeforeSolve(config) {
  const normalized = validatePokerConfig(config);
  if (config.street === "preflop" && config.preflopMode === "lookup") return normalized;

  const blocked = normalized.board ?? [];
  const firstRange = config.street === "preflop" ? config.sbRange : config.oopRange;
  const secondRange = config.street === "preflop" ? config.bbRange : config.ipRange;
  if (!expandRange(firstRange, blocked).length || !expandRange(secondRange, blocked).length) {
    throw new Error("Both ranges need at least one unblocked combo.");
  }
  return normalized;
}

function beginSolve(event) {
  event?.preventDefault();
  elements.error.hidden = true;
  const config = readConfig();
  try {
    validateBeforeSolve(config);
  } catch (error) {
    elements.error.hidden = false;
    elements.error.textContent = error.message;
    return;
  }
  elements.solveButton.disabled = true;
  elements.cancelButton.hidden = isLookupMode();
  showProgress();
  createWorker();
  worker.postMessage({ type: "solve", config });
}

function cancelSolve() {
  worker?.postMessage({ type: "cancel" });
  createWorker();
  finishSolve();
  showPlaceholder();
}

function refreshInputs() {
  elements.iterationsOutput.value = number.format(Number(elements.iterations.value));
  elements.iterationsOutput.textContent = number.format(Number(elements.iterations.value));
  updatePreflopControls();
  window.clearTimeout(rangeDebounce);
  rangeDebounce = window.setTimeout(updateRangeCounts, 120);
  updateTreePreview();
}

function currentBoard() {
  const count = STREET_META[elements.street.value].boardCards;
  return count === 0 ? [] : parseCards(elements.board.value, { exact: count });
}

function updateRangeCounts() {
  if (elements.rangeEditor.hidden) return;
  try {
    const board = currentBoard();
    updateRangeCount(elements.oopRange, elements.oopRangeCount, board);
    updateRangeCount(elements.ipRange, elements.ipRangeCount, board);
    elements.error.hidden = true;
  } catch (error) {
    elements.oopRangeCount.textContent = error.message;
    elements.ipRangeCount.textContent = error.message;
  }
}

function updateRangeCount(input, output, board) {
  try {
    const summary = summarizeRange(expandRange(input.value, board));
    output.textContent = `${number.format(summary.comboCount)} combos · ${formatFloat(summary.weightedCombos)} weighted`;
    output.style.color = "";
  } catch (error) {
    output.textContent = error.message;
    output.style.color = "#f38293";
  }
}

function updateTreePreview() {
  try {
    if (elements.street.value === "preflop" && elements.preflopModel.value === "lookup") {
      const hero = elements.heroPosition.value;
      const villain = elements.villainPosition.value;
      const stack = formatFloat(Number(elements.lookupStack.value));
      const size = formatFloat(Number(elements.openSize.value));
      const spot = elements.preflopSpot.value;
      const lines =
        spot === "rfi"
          ? [
              `<div class="tree-line"><i></i><strong>${hero}</strong><span>${hero === "SB" ? `Fold · Limp · Raise ${size}bb` : `Fold · Raise ${size}bb`}</span></div>`,
              `<div class="tree-line"><i></i><strong>Depth</strong><span>${stack}bb approximate opening chart</span></div>`,
            ]
          : spot === "vs-open"
            ? [
                `<div class="tree-line"><i></i><strong>${villain}</strong><span>Opens ${size}bb</span></div>`,
                `<div class="tree-line"><i></i><strong>${hero}</strong><span>Fold · Call · 3-bet</span></div>`,
              ]
            : [
                `<div class="tree-line"><i></i><strong>${hero}</strong><span>Faces ${villain} 3-bet</span></div>`,
                `<div class="tree-line"><i></i><strong>Response</strong><span>Fold · Call · 4-bet</span></div>`,
              ];
      elements.treePreview.innerHTML = [
        ...lines,
        `<div class="tree-line"><i></i><strong>Method</strong><span>Instant lookup approximation</span></div>`,
      ].join("");
      return;
    }

    if (elements.street.value === "preflop") {
      const stack = formatFloat(Number(elements.preflopStack.value));
      elements.treePreview.innerHTML = [
        `<div class="tree-line"><i></i><strong>SB</strong><span>Fold · Jam ${stack}bb</span></div>`,
        `<div class="tree-line"><i></i><strong>BB vs jam</strong><span>Fold · Call</span></div>`,
        `<div class="tree-line"><i></i><strong>Called branch</strong><span>Sampled five-card check-down board</span></div>`,
      ].join("");
      return;
    }

    const pot = Number(elements.pot.value);
    const stack = Number(elements.stack.value);
    const oop = parseBetSizes(elements.oopBets.value, pot, stack);
    const ip = parseBetSizes(elements.ipBets.value, pot, stack);
    elements.treePreview.innerHTML = [
      `<div class="tree-line"><i></i><strong>OOP</strong><span>Check · ${oop.map((size) => `Bet ${formatFloat(size)}`).join(" · ")}</span></div>`,
      `<div class="tree-line"><i></i><strong>IP</strong><span>After check: Check · ${ip.map((size) => `Bet ${formatFloat(size)}`).join(" · ")}</span></div>`,
      `<div class="tree-line"><i></i><strong>Vs bet</strong><span>Fold · Call</span></div>`,
    ].join("");
  } catch (error) {
    elements.treePreview.textContent = error.message;
  }
}

function wireEvents() {
  elements.form.addEventListener("submit", beginSolve);
  elements.cancelButton.addEventListener("click", cancelSolve);
  elements.resetButton.addEventListener("click", () => {
    setScenario(DEFAULT_SCENARIO_BY_STREET[elements.street.value]);
    showPlaceholder();
  });
  elements.scenario.addEventListener("change", () => setScenario(elements.scenario.value));
  for (const button of elements.streetTabs) {
    button.addEventListener("click", () => setStreet(button.dataset.street, { updateScenario: true }));
  }
  elements.nodeSelect.addEventListener("change", () => {
    clearNodeSelection();
    renderNode();
  });
  elements.exportButton.addEventListener("click", exportResult);
  elements.resolveButton.addEventListener("click", () => elements.form.requestSubmit());

  [
    elements.board,
    elements.pot,
    elements.stack,
    elements.smallBlind,
    elements.bigBlind,
    elements.ante,
    elements.preflopStack,
    elements.preflopModel,
    elements.preflopSpot,
    elements.heroPosition,
    elements.villainPosition,
    elements.lookupStack,
    elements.openSize,
    elements.oopRange,
    elements.ipRange,
    elements.oopBets,
    elements.ipBets,
    elements.iterations,
    elements.evaluationSamples,
  ].forEach((input) => input.addEventListener("input", refreshInputs));
  [elements.preflopModel, elements.preflopSpot, elements.heroPosition, elements.villainPosition].forEach(
    (input) => input.addEventListener("change", refreshInputs),
  );
}

initializeResultView(elements);
wireEvents();
createWorker();
setScenario("preflop-btn-rfi");
