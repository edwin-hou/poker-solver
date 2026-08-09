/** Range notation parsing and exact two-card-combo expansion. */

import {
  RANKS,
  SUITS,
  cardId,
  cardToString,
  comboKey,
  comboToString,
  rankIndex,
  suitIndex,
} from "./cards.js";

export const RANKS_DESC = Object.freeze([...RANKS].reverse());

export function handClassAt(row, column) {
  const rowRank = RANKS_DESC[row];
  const columnRank = RANKS_DESC[column];
  if (rowRank === undefined || columnRank === undefined) throw new Error("Grid coordinates must be between 0 and 12.");
  if (row === column) return `${rowRank}${columnRank}`;
  if (row < column) return `${rowRank}${columnRank}s`;
  return `${columnRank}${rowRank}o`;
}

export const HAND_CLASSES = Object.freeze(
  Array.from({ length: 13 }, (_, row) =>
    Array.from({ length: 13 }, (_, column) => handClassAt(row, column)),
  ),
);

export function normalizeClassLabel(label) {
  const match = /^([2-9TJQKA])([2-9TJQKA])([SO])?$/i.exec(String(label).trim());
  if (!match) throw new Error(`Invalid Hold'em hand class: ${label}`);
  let first = match[1].toUpperCase();
  let second = match[2].toUpperCase();
  const suffix = match[3]?.toLowerCase() ?? "";
  if (first === second) {
    if (suffix) throw new Error(`Pocket pairs do not use suited/offsuit suffixes: ${label}`);
    return `${first}${second}`;
  }
  if (!suffix) throw new Error(`Non-pair hand classes require s or o: ${label}`);
  if (RANKS.indexOf(first) < RANKS.indexOf(second)) [first, second] = [second, first];
  return `${first}${second}${suffix}`;
}

export function comboClass(cardA, cardB) {
  let first = RANKS[rankIndex(cardA)];
  let second = RANKS[rankIndex(cardB)];
  if (first === second) return `${first}${second}`;
  if (RANKS.indexOf(first) < RANKS.indexOf(second)) [first, second] = [second, first];
  const suffix = suitIndex(cardA) === suitIndex(cardB) ? "s" : "o";
  return `${first}${second}${suffix}`;
}

export function expandClass(label) {
  const normalized = normalizeClassLabel(label);
  const firstRank = normalized[0];
  const secondRank = normalized[1];
  const suffix = normalized[2] ?? "";
  const combos = [];

  if (firstRank === secondRank) {
    for (let firstSuit = 0; firstSuit < 4; firstSuit += 1) {
      for (let secondSuit = firstSuit + 1; secondSuit < 4; secondSuit += 1) {
        const cards = [cardId(firstRank, firstSuit), cardId(secondRank, secondSuit)].sort((a, b) => a - b);
        combos.push(toCombo(cards, normalized));
      }
    }
    return combos;
  }

  for (let firstSuit = 0; firstSuit < 4; firstSuit += 1) {
    for (let secondSuit = 0; secondSuit < 4; secondSuit += 1) {
      const isSuited = firstSuit === secondSuit;
      if ((suffix === "s" && !isSuited) || (suffix === "o" && isSuited)) continue;
      const cards = [cardId(firstRank, firstSuit), cardId(secondRank, secondSuit)].sort((a, b) => a - b);
      combos.push(toCombo(cards, normalized));
    }
  }
  return combos;
}

function toCombo(cards, classLabel, weight = 1) {
  return {
    key: comboKey(cards[0], cards[1]),
    cards,
    classLabel,
    display: comboToString(cards[0], cards[1]),
    weight,
  };
}

function parseWeight(token) {
  const match = /^(.*?)(?:[:@]([0-9]*\.?[0-9]+)%?)?$/.exec(token.trim());
  if (!match) throw new Error(`Invalid range token: ${token}`);
  let weight = match[2] === undefined ? 1 : Number(match[2]);
  if (token.trim().endsWith("%") || weight > 1) weight /= 100;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(`Range weight must be between 0 and 1 (or 0% and 100%): ${token}`);
  }
  return { expression: match[1].trim(), weight };
}

function rankPosition(rank) {
  const position = RANKS.indexOf(rank);
  if (position < 0) throw new Error(`Invalid rank: ${rank}`);
  return position;
}

function expandPlus(expression) {
  const base = normalizeClassLabel(expression.slice(0, -1));
  const first = base[0];
  const second = base[1];
  const suffix = base[2] ?? "";
  const labels = [];

  if (first === second) {
    for (let position = rankPosition(first); position < RANKS.length; position += 1) {
      labels.push(`${RANKS[position]}${RANKS[position]}`);
    }
    return labels;
  }

  const firstPosition = rankPosition(first);
  for (let secondPosition = rankPosition(second); secondPosition < firstPosition; secondPosition += 1) {
    labels.push(`${first}${RANKS[secondPosition]}${suffix}`);
  }
  return labels;
}

function expandDash(expression) {
  const [leftRaw, rightRaw] = expression.split("-");
  const left = normalizeClassLabel(leftRaw);
  const right = normalizeClassLabel(rightRaw);
  const labels = [];

  const leftPair = left[0] === left[1];
  const rightPair = right[0] === right[1];
  if (leftPair !== rightPair) throw new Error(`Range endpoints must have the same shape: ${expression}`);

  if (leftPair) {
    const start = rankPosition(left[0]);
    const end = rankPosition(right[0]);
    const step = start <= end ? 1 : -1;
    for (let position = start; ; position += step) {
      labels.push(`${RANKS[position]}${RANKS[position]}`);
      if (position === end) break;
    }
    return labels;
  }

  if (left[0] !== right[0] || left[2] !== right[2]) {
    throw new Error(`Non-pair ranges must keep the first rank and suitedness fixed: ${expression}`);
  }
  const start = rankPosition(left[1]);
  const end = rankPosition(right[1]);
  const step = start <= end ? 1 : -1;
  for (let position = start; ; position += step) {
    if (position >= rankPosition(left[0])) throw new Error(`Invalid descending hand range: ${expression}`);
    labels.push(`${left[0]}${RANKS[position]}${left[2]}`);
    if (position === end) break;
  }
  return labels;
}

function exactCombo(expression) {
  const match = /^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/i.exec(expression);
  if (!match) return null;
  const first = cardId(match[1][0].toUpperCase(), match[1][1].toLowerCase());
  const second = cardId(match[2][0].toUpperCase(), match[2][1].toLowerCase());
  if (first === second) throw new Error(`Duplicate card in combo: ${expression}`);
  const cards = [first, second].sort((a, b) => a - b);
  return toCombo(cards, comboClass(cards[0], cards[1]));
}

function allClassLabels() {
  return HAND_CLASSES.flat();
}

/**
 * Parse common poker range notation.
 *
 * Supported examples:
 *   AA, AKs, AKo
 *   TT+, A2s+, KTo+
 *   22-66, A2s-A5s
 *   AsKh
 *   AKs:50%, AKo@0.25
 *   random / all
 */
export function parseRange(notation) {
  const text = String(notation ?? "").trim();
  if (!text) throw new Error("Range cannot be empty.");
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const combos = new Map();

  for (const rawToken of tokens) {
    const { expression: rawExpression, weight } = parseWeight(rawToken);
    const expression = rawExpression.toUpperCase();
    if (!expression) continue;

    const explicit = exactCombo(expression);
    if (explicit) {
      combos.set(explicit.key, { ...explicit, weight });
      continue;
    }

    let labels;
    if (expression === "RANDOM" || expression === "ALL" || expression === "100%") {
      labels = allClassLabels();
    } else if (expression.endsWith("+")) {
      labels = expandPlus(expression);
    } else if (expression.includes("-")) {
      labels = expandDash(expression);
    } else {
      labels = [normalizeClassLabel(expression)];
    }

    for (const label of labels) {
      for (const combo of expandClass(label)) combos.set(combo.key, { ...combo, weight });
    }
  }

  if (combos.size === 0) throw new Error("Range did not expand to any two-card combinations.");
  return combos;
}

export function expandRange(notation, blockedCards = []) {
  const blocked = new Set(blockedCards);
  const parsed = parseRange(notation);
  return [...parsed.values()]
    .filter((combo) => combo.weight > 0 && !blocked.has(combo.cards[0]) && !blocked.has(combo.cards[1]))
    .sort((a, b) => b.cards[1] - a.cards[1] || b.cards[0] - a.cards[0]);
}

export function summarizeRange(combos) {
  const byClass = new Map();
  let weightedCombos = 0;
  for (const combo of combos) {
    weightedCombos += combo.weight;
    const current = byClass.get(combo.classLabel) ?? { comboCount: 0, weightedCombos: 0 };
    current.comboCount += 1;
    current.weightedCombos += combo.weight;
    byClass.set(combo.classLabel, current);
  }
  return { comboCount: combos.length, weightedCombos, byClass };
}

export function rangeToNotation(combos, digits = 3) {
  return combos
    .map((combo) => `${cardToString(combo.cards[0])}${cardToString(combo.cards[1])}:${combo.weight.toFixed(digits)}`)
    .join(",");
}

export const RANGE_PRESETS = Object.freeze({
  random: "random",
  oopRiver:
    "22+,A2s+,K5s+,Q8s+,J8s+,T8s+,98s,87s,A8o+,KTo+,QTo+,JTo",
  ipRiver:
    "22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,87s,76s,65s,A2o+,K8o+,Q9o+,J9o+,T9o",
  tight:
    "66+,ATs+,KQs,AQo+",
  polarDemo:
    "22-55,AKs,AQs,AA,KK,QQ",
});
