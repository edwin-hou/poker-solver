import test from "node:test";
import assert from "node:assert/strict";
import { HoldemRiverSolver, parseBetSizes } from "../src/solver.js";

test("percentage bet sizes are translated to chips and capped by stack", () => {
  assert.deepEqual(parseBetSizes("50,100,150", 100, 120), [50, 100, 120]);
});

test("solver uses real two-card hands, blockers, and a zero-sum evaluation", async () => {
  const solver = new HoldemRiverSolver({
    board: "2c 3d 7h 8s Kc",
    oopRange: "AA,QQ,AsKs,5c4c,6c5c",
    ipRange: "JJ,TT,AdKd,5d4d,6d5d",
    pot: 100,
    stack: 100,
    oopBetSizes: "75",
    ipBetSizes: "75",
    iterations: 12_000,
    averagingDelay: 500,
    seed: 42,
    progressEvery: 5_000,
  });
  await solver.train();
  const result = solver.result();
  assert.equal(result.game, "heads-up two-card Texas Hold'em river");
  assert.ok(result.ranges.oop.comboCount > 0);
  assert.ok(result.ranges.ip.comboCount > 0);
  assert.ok(Math.abs(result.evaluation.profileValueOop + result.evaluation.profileValueIp) < 1e-9);
  assert.ok(result.evaluation.exploitability >= 0);
  assert.ok(result.evaluation.exploitability < 2.5, `exploitability=${result.evaluation.exploitability}`);
  assert.equal(result.nodes[0].combos[0].cards.length, 2);
});

test("more CFR+ training materially reduces exact exploitability", async () => {
  const config = {
    board: "2c 3d 7h 8s Kc",
    oopRange: "AA,QQ,AsKs,5c4c,6c5c",
    ipRange: "JJ,TT,AdKd,5d4d,6d5d",
    pot: 100,
    stack: 100,
    oopBetSizes: "75",
    ipBetSizes: "75",
    iterations: 500,
    averagingDelay: 50,
    seed: 7,
  };
  const solver = new HoldemRiverSolver(config);
  await solver.train();
  const early = solver.evaluate().exploitability;
  solver.config.iterations = 20_000;
  await solver.train();
  const late = solver.evaluate().exploitability;
  assert.ok(late < early * 0.6, `expected exploitability to improve: early=${early}, late=${late}`);
});
