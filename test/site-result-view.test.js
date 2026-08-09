import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initializeResultView, renderResult } from "../dist/site/result-view.js";

function fakeElement() {
  let html = "";
  return {
    hidden: false,
    textContent: "",
    value: "",
    style: {},
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
}

function fakeElements() {
  const names = [
    "placeholder",
    "progressView",
    "resultsView",
    "resultStreet",
    "resultBoard",
    "metricExploitabilityLabel",
    "metricExploitability",
    "metricExploitabilityPot",
    "metricOopLabel",
    "metricOopEv",
    "metricDeals",
    "metricIterations",
    "metricRuntime",
    "nodeSelect",
    "rangeSide",
    "actionLegend",
    "rangeGrid",
    "selectedClass",
    "classSummary",
    "comboHead",
    "comboBody",
    "accuracyNote",
  ];
  return Object.fromEntries(names.map((name) => [name, fakeElement()]));
}

test("a completed all-street browser solve renders its strategy workspace", () => {
  globalThis.CSS = globalThis.CSS ?? { escape: (value) => String(value) };
  const elements = fakeElements();
  initializeResultView(elements);

  const result = {
    abstraction: { street: "flop" },
    config: { board: [0, 5, 10], pot: 100 },
    evaluation: {
      exploitability: 0.125,
      profileValueOop: -1.5,
      exact: false,
      evaluationSamples: 2_000,
      method: "Monte Carlo test",
      profileStandardError: 0.01,
    },
    compatibleDealWeight: 1,
    iterations: 10_000,
    runtimeMs: 25,
    nodes: [
      {
        id: "oop-root",
        label: "Flop: OOP first action",
        player: "OOP",
        actionLabels: ["Check", "Bet 75"],
        combos: [
          {
            cards: [48, 49],
            classLabel: "AA",
            display: "AcAd",
            weight: 1,
            category: "Pair",
          },
        ],
        strategies: [[0.6, 0.4]],
      },
    ],
  };

  assert.doesNotThrow(() => renderResult(result));
  assert.equal(elements.resultsView.hidden, false);
  assert.equal(elements.nodeSelect.value, "oop-root");
  assert.equal(elements.resultStreet.textContent, "FLOP");
  assert.match(elements.rangeGrid.innerHTML, /AA/);
  assert.match(elements.comboBody.innerHTML, /Pair/);
  assert.match(elements.metricExploitability.textContent, /0\.13/);
  assert.match(elements.metricExploitabilityLabel.textContent, /MC/);
});

test("an approximate preflop chart renders without inventing exploitability", () => {
  globalThis.CSS = globalThis.CSS ?? { escape: (value) => String(value) };
  const elements = fakeElements();
  initializeResultView(elements);

  const result = {
    abstraction: { street: "preflop", mode: "lookup" },
    config: {
      board: [],
      heroPosition: "BTN",
      villainPosition: "BB",
      preflopSpot: "rfi",
      pot: null,
    },
    evaluation: { exact: false, exploitability: null, profileValueOop: null },
    lookup: {
      targetContinueFrequency: 0.47,
      note: "Approximate chart test",
    },
    ranges: { hero: { comboCount: 6 } },
    compatibleDealWeight: 12,
    iterations: 0,
    runtimeMs: 3,
    nodes: [
      {
        id: "preflop-lookup-root",
        label: "BTN open first in · 100bb",
        player: "BTN",
        actionLabels: ["Fold", "Raise 2.5bb"],
        combos: [
          {
            cards: [48, 49],
            classLabel: "AA",
            display: "AcAd",
            weight: 1,
            category: "Pocket pair",
          },
        ],
        strategies: [[0, 1]],
      },
    ],
  };

  assert.doesNotThrow(() => renderResult(result));
  assert.equal(elements.resultStreet.textContent, "PREFLOP");
  assert.equal(elements.metricExploitability.textContent, "Lookup");
  assert.equal(elements.metricExploitabilityLabel.textContent, "Model");
  assert.match(elements.metricOopEv.textContent, /47/);
  assert.match(elements.accuracyNote.textContent, /Approximate chart test/);
});

test("repository-root Pages publishing exposes only one solution-builder workspace", async () => {
  const redirect = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(redirect, /\.\/site\//);

  const app = await readFile(new URL("../dist/site/app.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../dist/site/solver-worker.js", import.meta.url), "utf8");
  const index = await readFile(new URL("../dist/site/index.html", import.meta.url), "utf8");
  const boot = await readFile(new URL("../dist/site/boot.js", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../dist/site/builder-only.js", import.meta.url), "utf8");
  const output = await readFile(new URL("../dist/site/partials/solver-results.html", import.meta.url), "utf8");

  assert.match(app, /\.\.\/src\/index\.js/);
  assert.match(worker, /\.\.\/src\/solve\.js/);
  assert.match(index, /solver-only\.css/);
  assert.doesNotMatch(boot, /chrome\.html|hero\.html|method\.html|footer\.html/);
  assert.match(boot, /solver-config\.html/);
  assert.match(boot, /solver-results\.html/);
  assert.match(boot, /builder-only\.js/);
  assert.match(workspace, /showBuilder/);
  assert.match(workspace, /resolve-button/);
  assert.match(output, /id="results-panel"[^>]*hidden/);
  assert.doesNotMatch(output, /placeholder-orbit|Your strategy matrix will appear here|placeholder-facts/);
  await assert.rejects(
    readFile(new URL("../dist/site/partials/chrome.html", import.meta.url), "utf8"),
    /ENOENT/,
  );
});
