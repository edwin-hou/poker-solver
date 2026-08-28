import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Pages publishes a linked Beat Fish trainer with range reveal and history navigation", async () => {
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
  assert.match(trainer, /id="range-grid"/);
  assert.match(trainerJs, /observeFishAction/);
  assert.match(trainerJs, /cloneFishRange/);
  assert.match(trainerJs, /Continue hand/);
  assert.match(trainerCss, /\.range-grid/);
  assert.match(fishModel, /Bayesian-updated after every/);
});
