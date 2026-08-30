import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Pages publishes a branchable Beat Fish trainer with action ranges and hand-history estimation", async () => {
  const solverIndex = await readFile(new URL("../dist/site/index.html", import.meta.url), "utf8");
  const trainer = await readFile(new URL("../dist/site/trainer.html", import.meta.url), "utf8");
  const trainerJs = await readFile(new URL("../dist/site/trainer.js", import.meta.url), "utf8");
  const trainerCss = await readFile(new URL("../dist/site/styles/trainer.css", import.meta.url), "utf8");
  const fishModel = await readFile(new URL("../dist/src/fish-model.js", import.meta.url), "utf8");
  const multiwayPractice = await readFile(new URL("../dist/src/multiway-practice.js", import.meta.url), "utf8");

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
  assert.match(trainer, /id="opponent-seats"/);
  assert.match(trainer, /id="range-opponent-options"/);
  assert.match(trainer, /id="range-combo-detail-list"/);
  assert.match(trainer, /id="mode-analyze"/);
  assert.match(trainer, /id="history-input"/);
  assert.match(trainer, /id="analyze-history"/);
  assert.match(trainer, /id="history-range-grid"/);
  assert.match(trainer, /Colors show the modeled fish action—fold, call, or raise/);
  assert.match(trainer, /Play 6-handed practice/);
  assert.match(trainer, /Estimate heads-up history/);
  assert.match(trainer, /Heads-up only: it does not model extra players/);
  assert.match(trainer, /not a claimed exact multiway solve/);
  assert.match(trainer, /fold,\s+limp, open-raise, call, or 3-bet/);
  assert.doesNotMatch(trainer, /more likely|posterior/i);

  assert.match(trainerJs, /observeFishAction/);
  assert.match(trainerJs, /partitionFishRange/);
  assert.match(trainerJs, /createTrainerTree/);
  assert.match(trainerJs, /trainerTreeChild/);
  assert.match(trainerJs, /preflopLookupStrategyForClass/);
  assert.match(trainerJs, /createSixHandedPracticeScenario/);
  assert.match(trainerJs, /estimateHeroMultiwayEquity/);
  assert.match(trainerJs, /preflop-facing-open/);
  assert.match(trainerJs, /preflop-facing-threebet/);
  assert.match(trainerJs, /opponentsRespondToThreeBet/);
  assert.match(trainerJs, /opponentsRespondToFourBet/);
  assert.match(trainerJs, /analyzeFishHandHistory/);
  assert.match(trainerJs, /rangeCellGradient/);
  assert.match(trainerJs, /Explore this branch/);
  assert.match(trainerJs, /View saved branch/);
  assert.doesNotMatch(trainerJs, /reweighted by how often|posterior range/i);

  assert.match(trainerCss, /--range-fold/);
  assert.match(trainerCss, /--range-call/);
  assert.match(trainerCss, /--range-raise/);
  assert.match(trainerCss, /\.analyzer-panel/);
  assert.match(trainerCss, /\.fish-range-cell\.excluded/);
  assert.match(trainerCss, /\.branch-trail/);
  assert.match(trainerCss, /\.response-explorer/);
  assert.match(trainerCss, /\.exact-combo-list/);
  assert.match(trainerCss, /\.opponent-seats/);
  assert.match(trainerCss, /\.opponent-range-picker/);

  assert.match(fishModel, /Deterministic novice action rule/);
  assert.match(fishModel, /fishActionForCombo/);
  assert.match(fishModel, /partitionFishRange/);
  assert.match(fishModel, /fishRangeContinuingVsOpenSizes/);
  assert.doesNotMatch(fishModel, /fishActionProbabilities/);
  assert.doesNotMatch(fishModel, /\.probability/);

  assert.match(multiwayPractice, /SIX_HANDED_OPPONENTS/);
  assert.match(multiwayPractice, /limperCount/);
  assert.match(multiwayPractice, /raisedPlan/);
  assert.match(multiwayPractice, /threeBetPlan/);
  assert.match(multiwayPractice, /takesEveryAction/);
});
