import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_NAMES,
  cardToString,
  categoryFromScore,
  compareScores,
  evaluate5,
  evaluate7,
  parseCard,
  parseBoard,
} from "../src/cards.js";

const cards = (text) => [...text.matchAll(/[2-9TJQKA][cdhs]/g)].map((match) => parseCard(match[0]));

test("card parsing round-trips and board validation catches duplicates", () => {
  assert.equal(cardToString(parseCard("As")), "As");
  assert.equal(cardToString(parseCard("T♥"), { symbols: true }), "T♥");
  assert.deepEqual(parseBoard("As Kd 7h 4c 2s").map(cardToString), ["As", "Kd", "7h", "4c", "2s"]);
  assert.throws(() => parseBoard("As As 7h 4c 2s"), /Duplicate/);
});

test("five-card evaluator orders every major category", () => {
  const examples = [
    "AsKd9h7c4s",
    "AsAd9h7c4s",
    "AsAd9h9c4s",
    "AsAdAh7c4s",
    "9s8d7h6c5s",
    "AsJs8s5s2s",
    "AsAdAh7c7s",
    "AsAdAhAc7s",
    "9s8s7s6s5s",
  ].map((text) => evaluate5(cards(text)));
  for (let index = 1; index < examples.length; index += 1) {
    assert.ok(examples[index] > examples[index - 1], `${CATEGORY_NAMES[index]} should beat ${CATEGORY_NAMES[index - 1]}`);
    assert.equal(categoryFromScore(examples[index]), index);
  }
});

test("seven-card evaluator selects the best five and handles the wheel", () => {
  const wheel = evaluate7(cards("As2d3h4c5sKdQh"));
  const pair = evaluate7(cards("AsAd3h4c5sKdQh"));
  const flush = evaluate7(cards("AsTs8s4s2sKdQh"));
  assert.equal(categoryFromScore(wheel), 4);
  assert.equal(categoryFromScore(pair), 1);
  assert.equal(categoryFromScore(flush), 5);
  assert.equal(compareScores(flush, pair), 1);
});
