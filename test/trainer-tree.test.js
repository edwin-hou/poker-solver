import test from "node:test";
import assert from "node:assert/strict";

import {
  addTrainerTreeNode,
  createFishRange,
  createTrainerTree,
  observeFishAction,
  parseCard,
  parseCards,
  partitionFishRange,
  trainerTreeChild,
  trainerTreePath,
} from "../src/index.js";

function comboKey(combo) {
  return combo.cards.join("-");
}

function assertExactPartition(range, partitions) {
  const flattened = Object.values(partitions).flat();
  assert.equal(flattened.length, range.length);
  assert.equal(new Set(flattened.map(comboKey)).size, range.length);
  assert.ok(flattened.every((entry) => !("probability" in entry)));
}

test("fish response partitions are exhaustive, disjoint, and sizing-specific", () => {
  const heroCards = [parseCard("2c"), parseCard("3d")];
  const range = createFishRange({ heroCards });
  const small = partitionFishRange(
    range,
    { type: "preflop-vs-open", openBb: 10 / 3 },
    heroCards,
  );
  const large = partitionFishRange(
    range,
    { type: "preflop-vs-open", openBb: 5 },
    heroCards,
  );

  assertExactPartition(range, small);
  assertExactPartition(range, large);
  assert.ok(small.call.length > large.call.length);
  assert.ok(small.raise.length > large.raise.length);
  assert.ok(small.fold.length < large.fold.length);
});

test("postflop sizing explorer assigns each threaded combo to one literal action", () => {
  const heroCards = [parseCard("As"), parseCard("Kd")];
  const board = parseCards("Qs Ts 7h", { exact: 3 });
  let range = createFishRange({ heroCards });
  range = observeFishAction(
    range,
    { type: "preflop-vs-open", openBb: 10 / 3 },
    "call",
    heroCards,
  );
  range = observeFishAction(
    range,
    { type: "postflop-first", board },
    "check",
    [...heroCards, ...board],
  );

  const thirdPot = partitionFishRange(
    range,
    { type: "postflop-vs-bet", board, betFraction: 0.33 },
    [...heroCards, ...board],
  );
  const threeQuarterPot = partitionFishRange(
    range,
    { type: "postflop-vs-bet", board, betFraction: 0.75 },
    [...heroCards, ...board],
  );

  assertExactPartition(range, thirdPot);
  assertExactPartition(range, threeQuarterPot);
  assert.ok(thirdPot.call.length > threeQuarterPot.call.length);
  assert.ok(thirdPot.fold.length < threeQuarterPot.fold.length);
  assert.equal(thirdPot.raise, undefined, "the prior fish check already removed every raising hand");
});

test("trainer tree retains sibling counterfactual branches and navigates each path", () => {
  const tree = createTrainerTree();
  const root = addTrainerTreeNode(tree, { title: "Open decision", range: ["prior"] });
  const small = addTrainerTreeNode(
    tree,
    { title: "Fish calls $10", range: ["small-call"] },
    { parentId: root.id, choiceId: "open10" },
  );
  const large = addTrainerTreeNode(
    tree,
    { title: "Fish folds $15", range: ["large-fold"] },
    { parentId: root.id, choiceId: "open15" },
  );
  const flop = addTrainerTreeNode(
    tree,
    { title: "Flop decision", range: ["small-call", "flop-check"] },
    { parentId: small.id, choiceId: "continue" },
  );

  assert.equal(trainerTreeChild(tree, root.id, "open10"), small);
  assert.equal(trainerTreeChild(tree, root.id, "open15"), large);
  assert.deepEqual(trainerTreePath(tree, flop.id).map((node) => node.id), [root.id, small.id, flop.id]);
  assert.deepEqual(trainerTreePath(tree, large.id).map((node) => node.id), [root.id, large.id]);
  assert.deepEqual(small.range, ["small-call"]);
  assert.deepEqual(large.range, ["large-fold"]);
  assert.equal(tree.nodes.size, 4);
});
