import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Pages publishes a branchable Beat Fish trainer with exact response-range exploration", async () => {
  const solverIndex = await readFile(new URL("../dist/site/index.html", import.meta.url), "utf8");
  const trainer = await readFile(new URL("../dist/site/trainer.html", import.meta.url), "utf8");
  const trainerJs = await readFile(new URL("../dist/site/trainer.js", import.meta.url), "utf8");
  const trainerCss = await readFile(new URL("../dist/site/styles/trainer.css", import.meta.url), "utf8");
  const fishModel = await readFile(new URL("../dist/src/fish-model.js", import.meta.url), "utf8");

  assert.match(solverIndex, /href="trainer\.html"/);
  assert.match(trainer, /<title>Beat Fish · Poker Solver<\/title>/);
  assert.match(trainer, /id="reveal-range"/);
  assert.match(trainer, /id="history-back"/);
  assert.match(trainer, /id="history-forward"/);
  assert.match(trainer, /id="branch-trail"/);
  assert.match(trainer, /id="range-grid"/);
  assert.match(trainer, /id="range-color-legend"/);
  assert.match(trainer, /id="response-sizing-options"/);
  assert.match(trainer, /id="response-action-options"/);
  assert.match(trainer, /id="range-combo-detail-list"/);
  assert.match(trainer, /Colors describe the surviving hand type, not probability/);
  assert.doesNotMatch(trainer, /more likely|posterior/i);

  assert.match(trainerJs, /observeFishAction/);
  assert.match(trainerJs, /partitionFishRange/);
  assert.match(trainerJs, /createTrainerTree/);
  assert.match(trainerJs, /trainerTreeChild/);
  assert.match(trainerJs, /fishRangeBucketLabels/);
  assert.match(trainerJs, /rangeCellGradient/);
  assert.match(trainerJs, /Explore this branch/);
  assert.match(trainerJs, /View saved branch/);
  assert.doesNotMatch(trainerJs, /reweighted by how often|posterior range/i);

  assert.match(trainerCss, /--range-strong/);
  assert.match(trainerCss, /--range-medium/);
  assert.match(trainerCss, /--range-draw/);
  assert.match(trainerCss, /--range-weak/);
  assert.match(trainerCss, /\.fish-range-cell\.excluded/);
  assert.match(trainerCss, /\.branch-trail/);
  assert.match(trainerCss, /\.response-explorer/);
  assert.match(trainerCss, /\.exact-combo-list/);

  assert.match(fishModel, /Deterministic novice action rule/);
  assert.match(fishModel, /fishActionForCombo/);
  assert.match(fishModel, /partitionFishRange/);
  assert.doesNotMatch(fishModel, /fishActionProbabilities/);
  assert.doesNotMatch(fishModel, /\.probability/);
});
