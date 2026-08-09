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
  board: $("#board"),
  boardFieldLabel: $("#board-field-label"),
  boardHelp: $("#board-help"),
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
  heroGrid: $("#hero-grid"),
};

let worker = null;
let rangeDebounce = null;

function initializeHeroGrid() {
  const fragments = [];
  for (let row = 0; row < 13; row += 1) {
    for (let column = 0; column < 13; column += 1) {
      const strength = (12 - Math.min(row, column)) / 12;
      const bluff = ((row * 17 + column * 11) % 23) / 23;
      const check = Math.max(0.08, 0.72 - strength * 0.48 + bluff * 0.18);
      const small = Math.max(0.04, 0.17 + (1 - Math.abs(strength - 0.5) * 2) * 0.24);
      const large = Math.max(0.04, 1 - check - small);
      const total = check + small + large;
      const first = (check / total) * 100;
      const second = first + (small / total) * 100;
      fragments.push(
        `<span class="mini-cell" style="background:linear-gradient(90deg,var(--action-0) 0 ${first.toFixed(1)}%,var(--action-1) ${first.toFixed(1)}% ${second.toFixed(1)}%,var(--action-2) ${second.toFixed(1)}% 100%)"></span>`,
      );
    }
  }
  elements.heroGrid.innerHTML = fragments.join("");
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
    elements.progressTitle.textContent = `Solving ${STREET_META[street].label.toLowerCase()} strategy…`;
    elements.progressDetail.textContent =
      street === "preflop"
        ? "Sampling two-card deals and five-card boards while updating push/fold regrets."
        : street === "river"
          ? "Updating exact river counterfactual regrets."
          : "Sampling compatible deals and future public runouts while updating regrets.";
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    elements.progressIterations.textContent = `${number.format(iteration)} / ${number.format(target)} iterations`;
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
  elements.progressTitle.textContent = `Building ${STREET_META[street].label.toLowerCase()} game…`;
  elements.progressDetail.textContent =
    street === "preflop"
      ? "Expanding SB and BB ranges, blinds, and the push/fold game."
      : "Applying board blockers and preparing exact two-card combinations.";
  elements.progressBar.style.width = "1%";
  elements.progressIterations.textContent = "Preparing ranges";
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

function setStreet(street, { updateScenario = false } = {}) {
  if (!(street in STREET_META)) street = "flop";
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

  const [firstPosition, secondPosition] = STREET_META[street].positions;
  elements.oopRangeLabel.textContent = `${firstPosition} range`;
  elements.ipRangeLabel.textContent = `${secondPosition} range`;
  elements.oopPositionChip.textContent = firstPosition;
  elements.ipPositionChip.textContent = secondPosition;
  elements.boardFieldLabel.textContent = `${STREET_META[street].label} board`;
  const count = STREET_META[street].boardCards;
  elements.boardHelp.textContent = count
    ? `Enter exactly ${count} unique card${count === 1 ? "" : "s"}.`
    : "No board cards preflop.";

  if (updateScenario) setScenario(DEFAULT_SCENARIO_BY_STREET[street], { updateStreet: false });
  else refreshInputs();
}

function setScenario(name, { updateStreet = true } = {}) {
  const scenario = SCENARIOS[name] ?? SCENARIOS["flop-srp"];
  if (updateStreet) setStreet(scenario.street, { updateScenario: false });
  elements.scenario.value = name in SCENARIOS ? name : DEFAULT_SCENARIO_BY_STREET[scenario.street];
  elements.board.value = scenario.board ?? "";
  elements.oopRange.value = scenario.oopRange;
  elements.ipRange.value = scenario.ipRange;
  elements.iterations.value = scenario.iterations;
  elements.evaluationSamples.value = scenario.evaluationSamples;
  elements.averagingDelay.value = scenario.averagingDelay;
  elements.seed.value = scenario.seed;

  if (scenario.street === "preflop") {
    elements.smallBlind.value = scenario.smallBlind;
    elements.bigBlind.value = scenario.bigBlind;
    elements.ante.value = scenario.ante;
    elements.preflopStack.value = scenario.stack;
  } else {
    elements.pot.value = scenario.pot;
    elements.stack.value = scenario.stack;
    elements.oopBets.value = scenario.oopBets;
    elements.ipBets.value = scenario.ipBets;
  }
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
  if (street === "preflop") {
    return {
      ...common,
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
  elements.cancelButton.hidden = false;
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
  window.clearTimeout(rangeDebounce);
  rangeDebounce = window.setTimeout(updateRangeCounts, 120);
  updateTreePreview();
}

function currentBoard() {
  const count = STREET_META[elements.street.value].boardCards;
  return count === 0 ? [] : parseCards(elements.board.value, { exact: count });
}

function updateRangeCounts() {
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
    elements.oopRange,
    elements.ipRange,
    elements.oopBets,
    elements.ipBets,
    elements.iterations,
    elements.evaluationSamples,
  ].forEach((input) => input.addEventListener("input", refreshInputs));
}

initializeResultView(elements);
initializeHeroGrid();
wireEvents();
createWorker();
setScenario("flop-srp");
