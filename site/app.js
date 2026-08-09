import { expandRange, parseBetSizes, parseBoard, summarizeRange } from "../src/index.js";
import { SCENARIOS, formatFloat, number } from "./ui-constants.js";
import { clearNodeSelection, exportResult, initializeResultView, renderNode, renderResult } from "./result-view.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $("#solver-form"),
  scenario: $("#scenario"),
  board: $("#board"),
  pot: $("#pot"),
  stack: $("#stack"),
  oopRange: $("#oop-range"),
  ipRange: $("#ip-range"),
  oopBets: $("#oop-bets"),
  ipBets: $("#ip-bets"),
  iterations: $("#iterations"),
  iterationsOutput: $("#iterations-output"),
  averagingDelay: $("#averaging-delay"),
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
  resultBoard: $("#result-board"),
  metricExploitability: $("#metric-exploitability"),
  metricExploitabilityPot: $("#metric-exploitability-pot"),
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
let latestResult = null;
let latestConfig = null;
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
    elements.progressTitle.textContent = "Training mixed strategies…";
    elements.progressDetail.textContent = "Sampling compatible two-card deals and updating counterfactual regrets.";
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
    elements.progressIterations.textContent = `${number.format(iteration)} / ${number.format(target)} iterations`;
    elements.progressPercent.textContent = `${Math.floor(fraction * 100)}%`;
    return;
  }
  if (message.type === "result") {
    latestResult = message.result;
    finishSolve();
    renderResult(latestResult);
    return;
  }
  if (message.type === "cancelled") {
    finishSolve();
    showPlaceholder();
    return;
  }
  if (message.type === "error") {
    finishWithError(message.error?.message ?? "Unknown solver error.");
  }
}

function showPlaceholder() {
  elements.placeholder.hidden = false;
  elements.progressView.hidden = true;
  elements.resultsView.hidden = true;
}

function showProgress() {
  elements.placeholder.hidden = true;
  elements.resultsView.hidden = true;
  elements.progressView.hidden = false;
  elements.progressTitle.textContent = "Building combo game…";
  elements.progressDetail.textContent = "Applying board blockers and evaluating exact seven-card hand strengths.";
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

function setScenario(name) {
  const scenario = SCENARIOS[name] ?? SCENARIOS["ace-high"];
  elements.board.value = scenario.board;
  elements.oopRange.value = scenario.oopRange;
  elements.ipRange.value = scenario.ipRange;
  elements.pot.value = scenario.pot;
  elements.stack.value = scenario.stack;
  elements.oopBets.value = scenario.oopBets;
  elements.ipBets.value = scenario.ipBets;
  elements.iterations.value = scenario.iterations;
  elements.averagingDelay.value = scenario.averagingDelay;
  elements.seed.value = scenario.seed;
  refreshInputs();
}

function readConfig() {
  return {
    board: elements.board.value,
    oopRange: elements.oopRange.value,
    ipRange: elements.ipRange.value,
    pot: Number(elements.pot.value),
    stack: Number(elements.stack.value),
    oopBetSizes: elements.oopBets.value,
    ipBetSizes: elements.ipBets.value,
    iterations: Number(elements.iterations.value),
    averagingDelay: Number(elements.averagingDelay.value),
    seed: Number(elements.seed.value),
    progressEvery: 5_000,
  };
}

function validateBeforeSolve(config) {
  const board = parseBoard(config.board);
  if (!Number.isFinite(config.pot) || config.pot <= 0) throw new Error("Pot must be positive.");
  if (!Number.isFinite(config.stack) || config.stack <= 0) throw new Error("Effective stack must be positive.");
  const oop = expandRange(config.oopRange, board);
  const ip = expandRange(config.ipRange, board);
  if (!oop.length || !ip.length) throw new Error("Both ranges need at least one unblocked combo.");
  parseBetSizes(config.oopBetSizes, config.pot, config.stack);
  parseBetSizes(config.ipBetSizes, config.pot, config.stack);
  return { board, oop, ip };
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
  latestConfig = config;
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

function updateRangeCounts() {
  try {
    const board = parseBoard(elements.board.value);
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
    output.textContent = `${number.format(summary.comboCount)} unblocked combos · ${formatFloat(summary.weightedCombos)} weighted`;
    output.style.color = "";
  } catch (error) {
    output.textContent = error.message;
    output.style.color = "#f38293";
  }
}

function updateTreePreview() {
  try {
    const pot = Number(elements.pot.value);
    const stack = Number(elements.stack.value);
    const oop = parseBetSizes(elements.oopBets.value, pot, stack);
    const ip = parseBetSizes(elements.ipBets.value, pot, stack);
    elements.treePreview.innerHTML = [
      `<div class="tree-line"><i></i><strong>OOP</strong><span>Check · ${oop.map((size) => `Bet ${formatFloat(size)}`).join(" · ")}</span></div>`,
      `<div class="tree-line"><i></i><strong>IP</strong><span>After check: Check · ${ip.map((size) => `Bet ${formatFloat(size)}`).join(" · ")}</span></div>`,
      `<div class="tree-line"><i></i><strong>Vs bet</strong><span>Fold · Call (raises excluded)</span></div>`,
    ].join("");
  } catch (error) {
    elements.treePreview.textContent = error.message;
  }
}

function wireEvents() {
  elements.form.addEventListener("submit", beginSolve);
  elements.cancelButton.addEventListener("click", cancelSolve);
  elements.resetButton.addEventListener("click", () => {
    elements.scenario.value = "ace-high";
    setScenario("ace-high");
    showPlaceholder();
  });
  elements.scenario.addEventListener("change", () => setScenario(elements.scenario.value));
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
    elements.oopRange,
    elements.ipRange,
    elements.oopBets,
    elements.ipBets,
    elements.iterations,
  ].forEach((input) => input.addEventListener("input", refreshInputs));
}

initializeResultView(elements);
initializeHeroGrid();
wireEvents();
createWorker();
refreshInputs();
