import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  initializeResultView,
  renderResult,
} from "../dist/result-view.js";

function fakeElement() {
  let html = "";
  return {
    hidden: false,
    textContent: "",
    value: "",
    style: {},
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = String(value);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  };
}

function fakeElements() {
  const names = [
    "placeholder",
    "progressView",
    "resultsView",
    "resultBoard",
    "metricExploitability",
    "metricExploitabilityPot",
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

test("a completed browser solve renders its range grid and combo table", () => {
  globalThis.CSS = globalThis.CSS ?? { escape: (value) => String(value) };
  const elements = fakeElements();
  initializeResultView(elements);

  const result = {
    config: {
      board: [0, 5, 10, 15, 20],
      pot: 100,
    },
    evaluation: {
      exploitability: 0.125,
      profileValueOop: -1.5,
    },
    compatibleDealWeight: 1,
    iterations: 10_000,
    runtimeMs: 25,
    nodes: [
      {
        id: "oop-root",
        label: "OOP first action",
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
  assert.match(elements.rangeGrid.innerHTML, /AA/);
  assert.match(elements.comboBody.innerHTML, /Pair/);
  assert.match(elements.metricExploitability.textContent, /0\.13/);
});

test("repository-root Pages publishing redirects into the static site", async () => {
  const redirect = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(redirect, /\.\/site\//);
});
