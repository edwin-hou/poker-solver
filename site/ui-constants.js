import { RANGE_PRESETS } from "./src/index.js";

export const ACTION_COLORS = ["#53657d", "#e7a63a", "#ed6176", "#9a73ea", "#42c8d8", "#59d29a"];
export const number = new Intl.NumberFormat("en-US");
export const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const SCENARIOS = Object.freeze({
  "ace-high": {
    board: "Ah Kd 7c 4s 2d",
    oopRange: RANGE_PRESETS.oopRiver,
    ipRange: RANGE_PRESETS.ipRiver,
    pot: 100,
    stack: 100,
    oopBets: "50, 100",
    ipBets: "50, 100",
    iterations: 500_000,
    averagingDelay: 5_000,
    seed: 20_260_808,
  },
  paired: {
    board: "Qh Qd 8c 5s 2c",
    oopRange: "22+,A2s+,K5s+,Q8s+,J8s+,T8s+,98s,87s,A8o+,KTo+,QTo+,JTo",
    ipRange: "22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A2o+,K8o+,Q9o+,J9o+,T9o",
    pot: 120,
    stack: 180,
    oopBets: "33, 75, 150",
    ipBets: "50, 100",
    iterations: 350_000,
    averagingDelay: 3_000,
    seed: 20_260_809,
  },
  polar: {
    board: "2c 3d 7h 8s Kc",
    oopRange: "AA,QQ,AsKs,5c4c,6c5c",
    ipRange: "JJ,TT,AdKd,5d4d,6d5d",
    pot: 100,
    stack: 100,
    oopBets: "75",
    ipBets: "75",
    iterations: 80_000,
    averagingDelay: 1_000,
    seed: 42,
  },
  full: {
    board: "Js 9s 6d 3c 2h",
    oopRange: "random",
    ipRange: "random",
    pot: 100,
    stack: 200,
    oopBets: "33, 75, 150",
    ipBets: "33, 75, 150",
    iterations: 500_000,
    averagingDelay: 5_000,
    seed: 1_337,
  },
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

