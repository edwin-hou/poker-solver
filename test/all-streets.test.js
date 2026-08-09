import test from "node:test";
import assert from "node:assert/strict";

import {
  HoldemPostflopSolver,
  HoldemPreflopSolver,
  normalizeSolveStreet,
  solvePokerSpot,
} from "../src/index.js";

function assertStrategyRows(result) {
  assert.ok(result.nodes.length > 0);
  for (const node of result.nodes) {
    assert.equal(node.combos.length, node.strategies.length);
    for (const strategy of node.strategies.slice(0, 12)) {
      const total = strategy.reduce((sum, value) => sum + value, 0);
      assert.ok(Math.abs(total - 1) < 1e-8, `${node.id} strategy total=${total}`);
      assert.ok(strategy.every((value) => value >= 0 && value <= 1));
    }
  }
}

test("starting street can be inferred from board-card count", () => {
  assert.equal(normalizeSolveStreet({ board: "" }), "preflop");
  assert.equal(normalizeSolveStreet({ board: "Qs Ts 7h" }), "flop");
  assert.equal(normalizeSolveStreet({ board: "Qs Ts 7h 2c" }), "turn");
  assert.equal(normalizeSolveStreet({ board: "Qs Ts 7h 2c 3d" }), "river");
});

test("heads-up preflop push-fold solver returns SB and BB matrices", async () => {
  const solver = new HoldemPreflopSolver({
    street: "preflop",
    sbRange: "AA,KK,AKs",
    bbRange: "QQ,JJ,AQs",
    smallBlind: 0.5,
    bigBlind: 1,
    ante: 0,
    stack: 12,
    iterations: 2_500,
    averagingDelay: 100,
    evaluationSamples: 1_000,
    seed: 17,
  });
  await solver.train({ yieldEvery: 5_000 });
  const result = solver.result();
  assert.equal(result.abstraction.street, "preflop");
  assert.equal(result.config.board.length, 0);
  assert.ok(result.nodes.some((node) => node.id === "sb-root"));
  assert.ok(result.nodes.some((node) => node.id === "bb-vs-jam"));
  assert.equal(result.evaluation.exact, false);
  assertStrategyRows(result);
});

test("flop and turn solvers sample future cards and produce strategy grids", async () => {
  for (const config of [
    { street: "flop", board: "Qs Ts 7h", seed: 23 },
    { street: "turn", board: "Qs Ts 7h 2c", seed: 29 },
  ]) {
    const solver = new HoldemPostflopSolver({
      ...config,
      oopRange: "AA,KK,AKs,QJs",
      ipRange: "QQ,JJ,AQs,KJs",
      pot: 10,
      stack: 40,
      oopBetSizes: "50",
      ipBetSizes: "50",
      iterations: 3_000,
      averagingDelay: 100,
      evaluationSamples: 1_000,
    });
    await solver.train({ yieldEvery: 5_000 });
    const result = solver.result();
    assert.equal(result.abstraction.street, config.street);
    assert.equal(result.evaluation.exact, false);
    assert.equal(result.config.board.length, config.street === "flop" ? 3 : 4);
    assertStrategyRows(result);
  }
});

test("unified dispatcher preserves the exact river solver", async () => {
  const result = await solvePokerSpot({
    street: "river",
    board: "2c 3d 7h 8s Kc",
    oopRange: "AA,QQ,AsKs,5c4c",
    ipRange: "JJ,TT,AdKd,5d4d",
    pot: 100,
    stack: 100,
    oopBetSizes: "75",
    ipBetSizes: "75",
    iterations: 500,
    averagingDelay: 25,
    seed: 42,
  });
  assert.equal(result.abstraction.street, "river");
  assert.ok(Number.isFinite(result.evaluation.exploitability));
  assertStrategyRows(result);
});
