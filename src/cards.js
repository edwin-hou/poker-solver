/**
 * Card parsing and exact Texas Hold'em hand evaluation.
 *
 * Cards use rank-major integer ids:
 *   0..3   = 2c, 2d, 2h, 2s
 *   ...
 *   48..51 = Ac, Ad, Ah, As
 */

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const SUIT_SYMBOLS = Object.freeze({ c: "♣", d: "♦", h: "♥", s: "♠" });
export const CATEGORY_NAMES = Object.freeze([
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
]);

export function cardId(rank, suit) {
  const rankIndex = typeof rank === "number" ? rank : RANKS.indexOf(String(rank).toUpperCase());
  const suitIndex = typeof suit === "number" ? suit : SUITS.indexOf(String(suit).toLowerCase());
  if (rankIndex < 0 || rankIndex >= 13 || suitIndex < 0 || suitIndex >= 4) {
    throw new Error(`Invalid card components: ${rank}${suit}`);
  }
  return rankIndex * 4 + suitIndex;
}

export function rankIndex(card) {
  return Math.floor(card / 4);
}

export function rankValue(card) {
  return rankIndex(card) + 2;
}

export function suitIndex(card) {
  return card % 4;
}

export function parseCard(value) {
  if (Number.isInteger(value) && value >= 0 && value < 52) return value;
  const text = String(value).trim();
  const match = /^([2-9tjqka])([cdhs♣♦♥♠])$/i.exec(text);
  if (!match) throw new Error(`Invalid card: ${value}`);
  const rank = match[1].toUpperCase();
  const symbolToSuit = { "♣": "c", "♦": "d", "♥": "h", "♠": "s" };
  const suit = symbolToSuit[match[2]] ?? match[2].toLowerCase();
  return cardId(rank, suit);
}

export function cardToString(card, { symbols = false } = {}) {
  assertCard(card);
  const rank = RANKS[rankIndex(card)];
  const suit = SUITS[suitIndex(card)];
  return `${rank}${symbols ? SUIT_SYMBOLS[suit] : suit}`;
}

export function cardToHtml(card) {
  assertCard(card);
  const suit = SUITS[suitIndex(card)];
  const tone = suit === "h" || suit === "d" ? "red" : "black";
  return `<span class="card card-${tone}">${RANKS[rankIndex(card)]}${SUIT_SYMBOLS[suit]}</span>`;
}

export function createDeck(excluded = []) {
  const blocked = new Set(excluded.map(parseCard));
  return Array.from({ length: 52 }, (_, index) => index).filter((card) => !blocked.has(card));
}

export function parseCards(value, { exact = null, min = null, max = null } = {}) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  const matches = [...text.matchAll(/([2-9tjqka])([cdhs♣♦♥♠])/gi)].map((match) => parseCard(match[0]));
  const unique = new Set(matches);
  if (unique.size !== matches.length) throw new Error("Duplicate cards are not allowed.");
  if (exact !== null && matches.length !== exact) {
    throw new Error(`Expected exactly ${exact} cards, received ${matches.length}.`);
  }
  if (min !== null && matches.length < min) throw new Error(`Expected at least ${min} cards.`);
  if (max !== null && matches.length > max) throw new Error(`Expected at most ${max} cards.`);
  return matches;
}

export function parseBoard(value) {
  return parseCards(value, { exact: 5 });
}

export function comboKey(cardA, cardB) {
  assertCard(cardA);
  assertCard(cardB);
  if (cardA === cardB) throw new Error("A two-card hand must contain distinct cards.");
  const low = Math.min(cardA, cardB);
  const high = Math.max(cardA, cardB);
  return `${low}-${high}`;
}

export function comboToString(cardA, cardB, options = {}) {
  const cards = [cardA, cardB].sort((a, b) => {
    const rankDifference = rankValue(b) - rankValue(a);
    return rankDifference || suitIndex(b) - suitIndex(a);
  });
  return cards.map((card) => cardToString(card, options)).join("");
}

export function handsOverlap(comboA, comboB) {
  return (
    comboA.cards[0] === comboB.cards[0] ||
    comboA.cards[0] === comboB.cards[1] ||
    comboA.cards[1] === comboB.cards[0] ||
    comboA.cards[1] === comboB.cards[1]
  );
}

function assertCard(card) {
  if (!Number.isInteger(card) || card < 0 || card >= 52) throw new Error(`Invalid card id: ${card}`);
}

function packScore(category, kickers) {
  let score = category;
  for (let index = 0; index < 5; index += 1) score = score * 15 + (kickers[index] ?? 0);
  return score;
}

function straightHigh(uniqueRanksDescending) {
  const ranks = [...new Set(uniqueRanksDescending)].sort((a, b) => b - a);
  if (ranks.includes(14)) ranks.push(1);
  let run = 1;
  for (let index = 1; index < ranks.length; index += 1) {
    if (ranks[index - 1] - 1 === ranks[index]) {
      run += 1;
      if (run >= 5) return ranks[index - 4];
    } else if (ranks[index - 1] !== ranks[index]) {
      run = 1;
    }
  }
  return 0;
}

/** Return an integer whose ordinary ordering exactly matches five-card hand ordering. */
export function evaluate5(cards) {
  if (!Array.isArray(cards) && !(cards instanceof Uint8Array)) cards = [...cards];
  if (cards.length !== 5) throw new Error("evaluate5 expects exactly five cards.");
  const unique = new Set(cards);
  if (unique.size !== 5) throw new Error("A poker hand cannot contain duplicate cards.");

  const ranks = cards.map(rankValue).sort((a, b) => b - a);
  const suits = cards.map(suitIndex);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = suits.every((suit) => suit === suits[0]);
  const straight = straightHigh(ranks);

  if (flush && straight) return packScore(8, [straight]);
  if (groups[0][1] === 4) return packScore(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return packScore(6, [groups[0][0], groups[1][0]]);
  if (flush) return packScore(5, ranks);
  if (straight) return packScore(4, [straight]);
  if (groups[0][1] === 3) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return packScore(3, [groups[0][0], ...kickers]);
  }
  const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0]).sort((a, b) => b - a);
  if (pairs.length === 2) {
    const kicker = groups.find((group) => group[1] === 1)[0];
    return packScore(2, [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return packScore(1, [pairs[0], ...kickers]);
  }
  return packScore(0, ranks);
}

/** Evaluate the best five-card hand available from seven Hold'em cards. */
export function evaluate7(cards) {
  if (!Array.isArray(cards) && !(cards instanceof Uint8Array)) cards = [...cards];
  if (cards.length !== 7) throw new Error("evaluate7 expects exactly seven cards.");
  const unique = new Set(cards);
  if (unique.size !== 7) throw new Error("A Hold'em hand cannot contain duplicate cards.");

  let best = -1;
  for (let a = 0; a < 3; a += 1) {
    for (let b = a + 1; b < 4; b += 1) {
      for (let c = b + 1; c < 5; c += 1) {
        for (let d = c + 1; d < 6; d += 1) {
          for (let e = d + 1; e < 7; e += 1) {
            const score = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (score > best) best = score;
          }
        }
      }
    }
  }
  return best;
}

export function categoryFromScore(score) {
  if (!Number.isFinite(score) || score < 0) throw new Error(`Invalid hand score: ${score}`);
  return Math.floor(score / 15 ** 5);
}

export function describeScore(score) {
  return CATEGORY_NAMES[categoryFromScore(score)] ?? "Unknown";
}

export function compareScores(scoreA, scoreB) {
  return scoreA === scoreB ? 0 : scoreA > scoreB ? 1 : -1;
}

export function evaluateHoldemCombo(combo, board) {
  const cards = Array.isArray(combo) ? combo : combo.cards;
  if (!cards || cards.length !== 2) throw new Error("Expected a two-card Hold'em combo.");
  if (!board || board.length !== 5) throw new Error("Expected a five-card river board.");
  return evaluate7([...cards, ...board]);
}
