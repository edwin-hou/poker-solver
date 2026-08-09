import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HoldemRiverSolver } from "../src/solver.js";

const scenarios = [
  {
    name: "ace-high-default",
    config: {
      board: "Ah Kd 7c 4s 2d",
      oopRange: "22+,A2s+,K5s+,Q8s+,J8s+,T8s+,98s,87s,A8o+,KTo+,QTo+,JTo",
      ipRange: "22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A2o+,K8o+,Q9o+,J9o+,T9o",
      pot: 100,
      stack: 100,
      oopBetSizes: "50,100",
      ipBetSizes: "50,100",
      iterations: 500_000,
      averagingDelay: 5_000,
      seed: 20_260_808,
    },
  },
  {
    name: "polar-regression",
    config: {
      board: "2c 3d 7h 8s Kc",
      oopRange: "AA,QQ,AsKs,5c4c,6c5c",
      ipRange: "JJ,TT,AdKd,5d4d,6d5d",
      pot: 100,
      stack: 100,
      oopBetSizes: "75",
      ipBetSizes: "75",
      iterations: 80_000,
      averagingDelay: 1_000,
      seed: 42,
    },
  },
];

const rows = [];
for (const scenario of scenarios) {
  const start = performance.now();
  const solver = new HoldemRiverSolver(scenario.config);
  await solver.train();
  const evaluation = solver.evaluate();
  const runtimeMs = performance.now() - start;
  const row = {
    name: scenario.name,
    board: scenario.config.board,
    iterations: solver.iteration,
    oopCombos: solver.oopCombos.length,
    ipCombos: solver.ipCombos.length,
    compatibleDealWeight: solver.validDealWeight,
    runtimeMs,
    profileValueOop: evaluation.profileValueOop,
    bestResponseValueOop: evaluation.bestResponseValueOop,
    bestResponseValueIp: evaluation.bestResponseValueIp,
    nashConv: evaluation.nashConv,
    exploitability: evaluation.exploitability,
    exploitabilityPctPot: (evaluation.exploitability / scenario.config.pot) * 100,
  };
  rows.push(row);
  console.log(`${row.name}: exploitability ${row.exploitability.toFixed(6)} chips in ${runtimeMs.toFixed(1)} ms`);
}

const output = resolve(import.meta.dirname, "../benchmarks/summary.json");
await mkdir(resolve(import.meta.dirname, "../benchmarks"), { recursive: true });
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`, "utf8");
