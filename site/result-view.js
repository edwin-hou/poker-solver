import { HAND_CLASSES, cardToHtml, cardToString } from "../src/index.js";
import {
  ACTION_COLORS,
  STREET_META,
  escapeAttribute,
  escapeHtml,
  formatChips,
  formatCompact,
  formatDuration,
  formatSigned,
  number,
  percent,
} from "./ui-constants.js";

let elements = null;
let latestResult = null;
let selectedClassLabel = null;

export function initializeResultView(domElements) {
  elements = domElements;
  const optionalElements = {
    metricOopUnit: "#metric-oop-unit",
    metricDealsLabel: "#metric-deals-label",
    metricDealsUnit: "#metric-deals-unit",
    metricIterationsLabel: "#metric-iterations-label",
  };
  for (const [key, selector] of Object.entries(optionalElements)) {
    if (!elements[key]) elements[key] = globalThis.document?.querySelector?.(selector) ?? null;
  }
}

export function clearNodeSelection() {
  selectedClassLabel = null;
}

function setText(element, text) {
  if (element) element.textContent = text;
}

export function renderResult(result) {
  if (!elements) throw new Error("Result view has not been initialized.");
  if (!result?.nodes?.length) throw new Error("The solver returned no decision nodes.");

  latestResult = result;
  elements.placeholder.hidden = true;
  elements.progressView.hidden = true;
  elements.resultsView.hidden = false;

  const street = result.abstraction?.street ?? result.config?.street ?? "river";
  const meta = STREET_META[street] ?? STREET_META.river;
  const lookup = result.abstraction?.mode === "lookup";
  elements.resultStreet.textContent = meta.label.toUpperCase();
  if (result.config.board?.length) {
    elements.resultBoard.innerHTML = result.config.board.map((card) => cardToHtml(card)).join(" ");
  } else if (lookup) {
    elements.resultBoard.textContent = result.nodes[0].label;
  } else {
    elements.resultBoard.textContent = "SB vs BB · heads-up push/fold";
  }

  const evaluation = result.evaluation ?? {};
  if (lookup) {
    const actualContinue = result.lookup?.actualContinueFrequency ?? result.lookup?.targetContinueFrequency ?? 0;
    elements.metricExploitabilityLabel.textContent = "Model";
    elements.metricExploitability.textContent = "Lookup";
    elements.metricExploitabilityPot.textContent = "approximate chart";
    elements.metricOopLabel.textContent = "Continue frequency";
    elements.metricOopEv.textContent = `${percent.format(actualContinue * 100)}%`;
    setText(elements.metricOopUnit, "weighted starting combos");
    setText(elements.metricDealsLabel, "Starting hands");
    elements.metricDeals.textContent = formatCompact(result.ranges?.hero?.comboCount ?? result.nodes[0].combos.length);
    setText(elements.metricDealsUnit, "exact two-card combos");
    setText(elements.metricIterationsLabel, "Generation");
    elements.metricIterations.textContent = "Instant";
    elements.metricRuntime.textContent = `${formatDuration(result.runtimeMs)} browser runtime`;
    elements.accuracyNote.textContent =
      result.lookup?.note ??
      "Approximate positional preflop chart. EV, NashConv, and exploitability are not measured.";
  } else {
    const exact = evaluation.exact !== false;
    elements.metricExploitabilityLabel.textContent = exact ? "Exploitability" : "MC exploitability est.";
    elements.metricExploitability.textContent = formatChips(evaluation.exploitability);
    elements.metricExploitabilityPot.textContent = `${percent.format(
      (evaluation.exploitability / result.config.pot) * 100,
    )}% of pot`;
    elements.metricOopLabel.textContent = street === "preflop" ? "SB EV" : "OOP EV";
    elements.metricOopEv.textContent = formatSigned(evaluation.profileValueOop);
    setText(elements.metricOopUnit, "chips / hand");
    setText(elements.metricDealsLabel, "Compatible deals");
    elements.metricDeals.textContent = formatCompact(result.compatibleDealWeight);
    setText(elements.metricDealsUnit, "weighted chance mass");
    setText(elements.metricIterationsLabel, "Iterations");
    elements.metricIterations.textContent = formatCompact(result.iterations);
    elements.metricRuntime.textContent = `${formatDuration(result.runtimeMs)} browser runtime`;

    if (exact) {
      elements.accuracyNote.textContent = `Exact information-consistent best responses for the finite river tree: ${formatChips(
        evaluation.exploitability,
      )} exploitability.`;
    } else {
      const samples = evaluation.evaluationSamples ?? result.config.evaluationSamples;
      const errorText = Number.isFinite(evaluation.profileStandardError)
        ? ` Profile EV standard error ≈ ${formatChips(evaluation.profileStandardError)}.`
        : "";
      elements.accuracyNote.textContent = `${evaluation.method ?? "Monte Carlo best-response estimate"} using ${number.format(
        samples ?? 0,
      )} evaluation samples.${errorText}`;
    }
  }

  elements.nodeSelect.innerHTML = result.nodes
    .map((node) => `<option value="${escapeAttribute(node.id)}">${escapeHtml(node.label)}</option>`)
    .join("");
  elements.nodeSelect.value = result.nodes[0].id;
  selectedClassLabel = null;
  renderNode();
}

export function renderNode() {
  if (!latestResult || !elements) return;
  const node =
    latestResult.nodes.find((candidate) => candidate.id === elements.nodeSelect.value) ??
    latestResult.nodes[0];
  if (!node) return;

  elements.nodeSelect.value = node.id;
  elements.rangeSide.textContent = `${node.player} range · ${number.format(node.combos.length)} combos`;
  elements.actionLegend.innerHTML = node.actionLabels
    .map(
      (label, index) =>
        `<span class="legend-item"><i class="legend-color" style="background:${ACTION_COLORS[index % ACTION_COLORS.length]}"></i>${escapeHtml(label)}</span>`,
    )
    .join("");

  const aggregate = aggregateNodeByClass(node);
  const grid = [];
  let firstPopulated = null;
  for (const row of HAND_CLASSES) {
    for (const label of row) {
      const item = aggregate.get(label);
      if (!item) {
        grid.push(
          `<button class="range-cell empty" type="button" aria-label="${escapeAttribute(
            `${label}, not in range`,
          )}"><span class="range-label">${escapeHtml(label)}</span></button>`,
        );
        continue;
      }
      if (!firstPopulated) firstPopulated = label;
      const frequencies = item.sums.map((value) => value / item.weight);
      const dominantIndex = maxIndex(frequencies);
      const gradient = actionGradient(frequencies);
      const title = node.actionLabels
        .map((action, index) => `${action}: ${percent.format(frequencies[index] * 100)}%`)
        .join(" · ");
      const selected = selectedClassLabel === label ? " selected" : "";
      grid.push(
        `<button class="range-cell${selected}" type="button" data-class="${escapeAttribute(
          label,
        )}" style="background:${gradient}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(
          `${label}: ${title}`,
        )}"><span class="range-label">${escapeHtml(label)}</span><span class="range-frequency">${percent.format(
          frequencies[dominantIndex] * 100,
        )}%</span></button>`,
      );
    }
  }

  elements.rangeGrid.innerHTML = grid.join("");
  elements.rangeGrid.querySelectorAll("[data-class]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedClassLabel = button.dataset.class;
      renderNode();
    });
  });

  if (!selectedClassLabel || !aggregate.has(selectedClassLabel)) selectedClassLabel = firstPopulated;
  if (selectedClassLabel) {
    elements.rangeGrid
      .querySelector(`[data-class="${cssEscape(selectedClassLabel)}"]`)
      ?.classList.add("selected");
  }
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
    elements.comboHead.innerHTML = "";
    elements.comboBody.innerHTML = `<tr><td class="empty-cell">Choose a populated grid cell.</td></tr>`;
    return;
  }

  const rows = [];
  const aggregate = new Array(node.actionLabels.length).fill(0);
  let totalWeight = 0;
  node.combos.forEach((combo, index) => {
    if (combo.classLabel !== classLabel) return;
    const strategy = node.strategies[index];
    totalWeight += combo.weight;
    for (let action = 0; action < aggregate.length; action += 1) {
      aggregate[action] += combo.weight * strategy[action];
    }
    rows.push({ combo, strategy });
  });

  elements.selectedClass.textContent = classLabel;
  if (!rows.length) {
    elements.classSummary.textContent = "Not present in this range";
    elements.comboHead.innerHTML = "";
    elements.comboBody.innerHTML = `<tr><td class="empty-cell">No unblocked combinations.</td></tr>`;
    return;
  }

  const frequencies = aggregate.map((value) => value / totalWeight);
  const dominant = maxIndex(frequencies);
  elements.classSummary.textContent = `${rows.length} combos · ${node.actionLabels[dominant]} ${percent.format(
    frequencies[dominant] * 100,
  )}%`;
  elements.comboHead.innerHTML = `<tr><th>Combo</th><th>Class</th><th>Weight</th>${node.actionLabels
    .map((label) => `<th>${escapeHtml(label)}</th>`)
    .join("")}</tr>`;
  elements.comboBody.innerHTML = rows
    .sort((a, b) => a.combo.display.localeCompare(b.combo.display))
    .map(({ combo, strategy }) => {
      const cards = combo.cards.map((card) => cardToHtml(card)).join("");
      const actions = strategy
        .map(
          (value, index) =>
            `<td><span class="action-value"><i style="background:${ACTION_COLORS[index % ACTION_COLORS.length]}"></i>${percent.format(
              value * 100,
            )}%</span></td>`,
        )
        .join("");
      return `<tr><td>${cards}</td><td>${escapeHtml(combo.category ?? combo.classLabel)}</td><td>${percent.format(
        combo.weight * 100,
      )}%</td>${actions}</tr>`;
    })
    .join("");
}

function actionGradient(frequencies) {
  let cursor = 0;
  const stops = [];
  frequencies.forEach((frequency, index) => {
    const start = cursor;
    cursor += Math.max(0, frequency) * 100;
    stops.push(
      `${ACTION_COLORS[index % ACTION_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`,
    );
  });
  if (cursor < 99.999) stops.push(`${ACTION_COLORS[0]} ${cursor.toFixed(2)}% 100%`);
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

export function exportResult() {
  if (!latestResult) return;
  const blob = new Blob([JSON.stringify(latestResult, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const street = latestResult.abstraction?.street ?? "spot";
  const descriptor = latestResult.abstraction?.mode === "lookup"
    ? `${latestResult.config.heroPosition}-${latestResult.config.preflopSpot}`
    : latestResult.config.board?.length
      ? latestResult.config.board.map((card) => cardToString(card)).join("")
      : "push-fold";
  anchor.href = url;
  anchor.download = `poker-solver-${street}-${descriptor}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function maxIndex(values) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
