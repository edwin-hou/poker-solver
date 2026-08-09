import { HAND_CLASSES, cardToHtml, cardToString } from "./src/index.js";
import { ACTION_COLORS, escapeAttribute, escapeHtml, formatChips, formatCompact, formatDuration, formatSigned, number, percent } from "./ui-constants.js";

let elements = null;
let latestResult = null;
let selectedClassLabel = null;

export function initializeResultView(domElements) { elements = domElements; }
export function clearNodeSelection() { selectedClassLabel = null; }

export function renderResult(result) {
  elements.placeholder.hidden = true;
  elements.progressView.hidden = true;
  elements.resultsView.hidden = false;
  const board = result.config.board;
  elements.resultBoard.innerHTML = board.map((card) => cardToHtml(card)).join(" ");
  elements.metricExploitability.textContent = formatChips(result.evaluation.exploitability);
  elements.metricExploitabilityPot.textContent = `${percent.format((result.evaluation.exploitability / result.config.pot) * 100)}% of pot`;
  elements.metricOopEv.textContent = formatSigned(result.evaluation.profileValueOop);
  elements.metricDeals.textContent = formatCompact(result.compatibleDealWeight);
  elements.metricIterations.textContent = formatCompact(result.iterations);
  elements.metricRuntime.textContent = `${formatDuration(result.runtimeMs)} browser runtime`;
  elements.accuracyNote.textContent = `Exact best-response exploitability for this finite tree: ${formatChips(result.evaluation.exploitability)} (${percent.format((result.evaluation.exploitability / result.config.pot) * 100)}% of pot).`;

  elements.nodeSelect.innerHTML = result.nodes
    .map((node) => `<option value="${escapeAttribute(node.id)}">${escapeHtml(node.label)}</option>`)
    .join("");
  currentNodeId = result.nodes[0]?.id ?? null;
  selectedClassLabel = null;
  elements.nodeSelect.value = currentNodeId;
  renderNode();
}

export function renderNode() {
  if (!latestResult) return;
  const node = latestResult.nodes.find((candidate) => candidate.id === elements.nodeSelect.value) ?? latestResult.nodes[0];
  if (!node) return;
  currentNodeId = node.id;
  elements.rangeSide.textContent = `${node.player} range · ${number.format(node.combos.length)} combos`;
  elements.actionLegend.innerHTML = node.actionLabels
    .map((label, index) => `<span class="legend-item"><i class="legend-color" style="background:${ACTION_COLORS[index % ACTION_COLORS.length]}"></i>${escapeHtml(label)}</span>`)
    .join("");

  const aggregate = aggregateNodeByClass(node);
  const grid = [];
  let firstPopulated = null;
  for (const row of HAND_CLASSES) {
    for (const label of row) {
      const item = aggregate.get(label);
      if (!item) {
        grid.push(`<button class="range-cell empty" type="button" aria-label="${label}, not in range"><span class="range-label">${label}</span></button>`);
        continue;
      }
      if (!firstPopulated) firstPopulated = label;
      const frequencies = item.sums.map((value) => value / item.weight);
      const dominantIndex = maxIndex(frequencies);
      const gradient = actionGradient(frequencies);
      const title = node.actionLabels.map((action, index) => `${action}: ${percent.format(frequencies[index] * 100)}%`).join(" · ");
      const selected = selectedClassLabel === label ? " selected" : "";
      grid.push(
        `<button class="range-cell${selected}" type="button" data-class="${label}" style="background:${gradient}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(`${label}: ${title}`)}"><span class="range-label">${label}</span><span class="range-frequency">${percent.format(frequencies[dominantIndex] * 100)}%</span></button>`,
      );
    }
  }
  elements.rangeGrid.innerHTML = grid.join("");
  elements.rangeGrid.querySelectorAll("[data-class]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedClassLabel = button.dataset.class;
      renderNode();
      renderComboInspector(node, selectedClassLabel);
    });
  });

  if (!selectedClassLabel || !aggregate.has(selectedClassLabel)) selectedClassLabel = firstPopulated;
  elements.rangeGrid.querySelector(`[data-class="${CSS.escape(selectedClassLabel ?? "")}"]`)?.classList.add("selected");
  renderComboInspector(node, selectedClassLabel);
}

function aggregateNodeByClass(node) {
  const map = new Map();
  node.combos.forEach((combo, index) => {
    const current = map.get(combo.classLabel) ?? {
      weight: 0,
      count: 0,
      sums: new Array(node.actionLabels.length).fill(0),
    };
    current.weight += combo.weight;
    current.count += 1;
    for (let action = 0; action < current.sums.length; action += 1) {
      current.sums[action] += combo.weight * node.strategies[index][action];
    }
    map.set(combo.classLabel, current);
  });
  return map;
}

function renderComboInspector(node, classLabel) {
  if (!classLabel) {
    elements.selectedClass.textContent = "Select a hand";
    elements.classSummary.textContent = "";
    elements.comboBody.innerHTML = `<tr><td class="empty-cell">Choose a populated grid cell above.</td></tr>`;
    return;
  }
  const rows = [];
  const aggregate = new Array(node.actionLabels.length).fill(0);
  let totalWeight = 0;
  node.combos.forEach((combo, index) => {
    if (combo.classLabel !== classLabel) return;
    const strategy = node.strategies[index];
    totalWeight += combo.weight;
    for (let action = 0; action < aggregate.length; action += 1) aggregate[action] += combo.weight * strategy[action];
    rows.push({ combo, strategy });
  });
  elements.selectedClass.textContent = classLabel;
  if (!rows.length) {
    elements.classSummary.textContent = "Not present in this range";
    elements.comboBody.innerHTML = `<tr><td class="empty-cell">No unblocked combinations.</td></tr>`;
    return;
  }
  const frequencies = aggregate.map((value) => value / totalWeight);
  const dominant = maxIndex(frequencies);
  elements.classSummary.textContent = `${rows.length} combos · ${node.actionLabels[dominant]} ${percent.format(frequencies[dominant] * 100)}%`;
  elements.comboHead.innerHTML = `<tr><th>Combo</th><th>Made hand</th><th>Weight</th>${node.actionLabels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
  elements.comboBody.innerHTML = rows
    .sort((a, b) => a.combo.display.localeCompare(b.combo.display))
    .map(({ combo, strategy }) => {
      const cards = combo.cards.map((card) => cardToHtml(card)).join("");
      const actions = strategy
        .map((value, index) => `<td><span class="action-value"><i style="background:${ACTION_COLORS[index % ACTION_COLORS.length]}"></i>${percent.format(value * 100)}%</span></td>`)
        .join("");
      return `<tr><td>${cards}</td><td>${escapeHtml(combo.category)}</td><td>${percent.format(combo.weight * 100)}%</td>${actions}</tr>`;
    })
    .join("");
}

function actionGradient(frequencies) {
  let cursor = 0;
  const stops = [];
  frequencies.forEach((frequency, index) => {
    const start = cursor;
    cursor += Math.max(0, frequency) * 100;
    stops.push(`${ACTION_COLORS[index % ACTION_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`);
  });
  if (cursor < 99.999) stops.push(`${ACTION_COLORS[0]} ${cursor.toFixed(2)}% 100%`);
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

export function exportResult() {
  if (!latestResult) return;
  const blob = new Blob([JSON.stringify(latestResult, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const board = latestResult.config.board.map((card) => cardToString(card)).join("");
  anchor.href = url;
  anchor.download = `riverforge-${board}-${latestResult.iterations}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function maxIndex(values) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) if (values[index] > values[best]) best = index;
  return best;
}

