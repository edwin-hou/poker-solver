import test from "node:test";
import assert from "node:assert/strict";
import { parseBoard } from "../src/cards.js";
import {
  comboClass,
  expandClass,
  expandRange,
  handClassAt,
  parseRange,
} from "../src/range.js";

test("169-grid orientation matches standard poker range charts", () => {
  assert.equal(handClassAt(0, 0), "AA");
  assert.equal(handClassAt(0, 1), "AKs");
  assert.equal(handClassAt(1, 0), "AKo");
  assert.equal(handClassAt(12, 12), "22");
});

test("hand classes expand to the correct number of exact combos", () => {
  assert.equal(expandClass("AA").length, 6);
  assert.equal(expandClass("AKs").length, 4);
  assert.equal(expandClass("AKo").length, 12);
  const combo = expandClass("AKs")[0];
  assert.equal(comboClass(combo.cards[0], combo.cards[1]), "AKs");
});

test("common plus, dash, explicit combo, and weighted syntax works", () => {
  assert.equal(parseRange("TT+").size, 5 * 6);
  assert.equal(parseRange("A2s+").size, 12 * 4);
  assert.equal(parseRange("22-66").size, 5 * 6);
  const weighted = parseRange("AKs:50%,AsKh@0.25");
  const suitedWeights = [...weighted.values()].filter((combo) => combo.classLabel === "AKs");
  assert.equal(suitedWeights.length, 4);
  assert.ok(suitedWeights.every((combo) => combo.weight === 0.5));
  assert.ok([...weighted.values()].some((combo) => combo.weight === 0.25));
});

test("board blockers remove exact combinations", () => {
  const board = parseBoard("As Kd 7h 4c 2s");
  assert.equal(expandRange("AA", board).length, 3);
  assert.equal(expandRange("AKs", board).length, 2);
});
