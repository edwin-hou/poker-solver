/** Unified solver entry point for preflop, flop, turn, and river. */

import { parseCards } from "./cards.js";
import {
  normalizePreflopMode,
  solvePreflopLookup,
  validatePreflopLookupConfig,
} from "./preflop-lookup.js";
import { solveHoldemPreflop, validatePreflopConfig } from "./preflop-solver.js";
import { solveHoldemPostflop, validatePostflopConfig } from "./postflop-solver.js";
import { solveHoldemRiver } from "./solver.js";

export function normalizeSolveStreet(config = {}) {
  const explicit = String(config.street ?? "").trim().toLowerCase();
  if (["preflop", "flop", "turn", "river"].includes(explicit)) return explicit;

  const board = Array.isArray(config.board) ? config.board : parseCards(config.board ?? "");
  if (board.length === 0) return "preflop";
  if (board.length === 3) return "flop";
  if (board.length === 4) return "turn";
  if (board.length === 5) return "river";
  throw new Error(
    "Choose preflop, flop, turn, or river and provide the corresponding number of board cards.",
  );
}

export function preflopModeForConfig(config = {}) {
  return normalizePreflopMode(config.preflopMode ?? config.preflopModel ?? "lookup");
}

export function validatePokerConfig(config) {
  const street = normalizeSolveStreet(config);
  if (street === "preflop") {
    const mode = preflopModeForConfig(config);
    if (mode === "lookup") return validatePreflopLookupConfig({ ...config, street, preflopMode: mode });
    return validatePreflopConfig({ ...config, street, preflopMode: mode });
  }
  return validatePostflopConfig({ ...config, street });
}

export async function solvePokerSpot(config, hooks = {}) {
  const street = normalizeSolveStreet(config);
  if (street === "preflop") {
    const mode = preflopModeForConfig(config);
    if (mode === "lookup") return solvePreflopLookup({ ...config, street, preflopMode: mode }, hooks);
    return solveHoldemPreflop({ ...config, street, preflopMode: mode }, hooks);
  }
  if (street === "river") return solveHoldemRiver({ ...config, street }, hooks);
  return solveHoldemPostflop({ ...config, street }, hooks);
}
