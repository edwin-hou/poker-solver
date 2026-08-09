import { RANGE_PRESETS } from "../src/index.js";

export const ACTION_COLORS = ["#64748b", "#4387ff", "#ef5f73", "#9b72ef", "#2fc5aa", "#f2ad45"];
export const number = new Intl.NumberFormat("en-US");
export const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const STREET_META = Object.freeze({
  preflop: { label: "Preflop", boardCards: 0, positions: ["SB", "BB"] },
  flop: { label: "Flop", boardCards: 3, positions: ["OOP", "IP"] },
  turn: { label: "Turn", boardCards: 4, positions: ["OOP", "IP"] },
  river: { label: "River", boardCards: 5, positions: ["OOP", "IP"] },
});

export const SCENARIOS = Object.freeze({
  "preflop-15bb": {
    label: "HU push/fold · 15bb",
    street: "preflop",
    board: "",
    oopRange: "random",
    ipRange: "random",
    smallBlind: 0.5,
    bigBlind: 1,
    ante: 0,
    stack: 15,
    iterations: 180_000,
    evaluationSamples: 20_000,
    averagingDelay: 2_000,
    seed: 20_260_810,
  },
  "preflop-8bb": {
    label: "HU push/fold · 8bb + ante",
    street: "preflop",
    board: "",
    oopRange: "random",
    ipRange: "random",
    smallBlind: 0.5,
    bigBlind: 1,
    ante: 0.1,
    stack: 8,
    iterations: 150_000,
    evaluationSamples: 18_000,
    averagingDelay: 1_500,
    seed: 20_260_811,
  },
  "flop-srp": {
    label: "Flop · BTN vs BB SRP",
    street: "flop",
    board: "Qs Ts 7h",
    oopRange: RANGE_PRESETS.oopRiver,
    ipRange: RANGE_PRESETS.ipRiver,
    pot: 6,
    stack: 97,
    oopBets: "33, 75",
    ipBets: "33, 75",
    iterations: 220_000,
    evaluationSamples: 24_000,
    averagingDelay: 3_000,
    seed: 20_260_812,
  },
  "turn-barrel": {
    label: "Turn · ace-high barrel",
    street: "turn",
    board: "Ah Kd 7c 4s",
    oopRange: RANGE_PRESETS.oopRiver,
    ipRange: RANGE_PRESETS.ipRiver,
    pot: 18,
    stack: 82,
    oopBets: "50, 100",
    ipBets: "50, 100",
    iterations: 200_000,
    evaluationSamples: 22_000,
    averagingDelay: 3_000,
    seed: 20_260_813,
  },
  "river-polar": {
    label: "River · polar benchmark",
    street: "river",
    board: "2c 3d 7h 8s Kc",
    oopRange: "AA,QQ,AsKs,5c4c,6c5c",
    ipRange: "JJ,TT,AdKd,5d4d,6d5d",
    pot: 100,
    stack: 100,
    oopBets: "75",
    ipBets: "75",
    iterations: 80_000,
    evaluationSamples: 12_000,
    averagingDelay: 1_000,
    seed: 42,
  },
  "river-wide": {
    label: "River · wide ranges",
    street: "river",
    board: "Ah Kd 7c 4s 2d",
    oopRange: RANGE_PRESETS.oopRiver,
    ipRange: RANGE_PRESETS.ipRiver,
    pot: 100,
    stack: 100,
    oopBets: "50, 100",
    ipBets: "50, 100",
    iterations: 500_000,
    evaluationSamples: 30_000,
    averagingDelay: 5_000,
    seed: 20_260_808,
  },
});

export const DEFAULT_SCENARIO_BY_STREET = Object.freeze({
  preflop: "preflop-15bb",
  flop: "flop-srp",
  turn: "turn-barrel",
  river: "river-polar",
});

export function formatFloat(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatChips(value) {
  return `${formatFloat(value)} chips`;
}

export function formatSigned(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatFloat(value)}`;
}

export function formatCompact(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
