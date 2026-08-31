import { cardToString, parseCards } from "./cards.js";
import {
  createFishRange,
  filterFishRange,
  observeFishAction,
  summarizeFishRange,
} from "./fish-model.js";

const STREET_COUNTS = Object.freeze({ flop: 3, turn: 4, river: 5 });
const STREET_ORDER = Object.freeze(["preflop", "flop", "turn", "river"]);
const HERO_ALIASES = Object.freeze(["hero", "me", "you", "btn"]);
const FISH_ALIASES = Object.freeze(["fish", "villain", "opponent", "bb"]);

function normalizeLabel(value) {
  return String(value ?? "").trim().toLowerCase().replace(/:$/, "");
}

function actorForLine(line, heroName, fishName) {
  const actor = normalizeLabel(line.split(":", 1)[0].split(/\s+(?:checks|bets|calls|raises|folds|3-bets)/i, 1)[0]);
  const heroLabels = new Set([...HERO_ALIASES, normalizeLabel(heroName)].filter(Boolean));
  const fishLabels = new Set([...FISH_ALIASES, normalizeLabel(fishName)].filter(Boolean));
  if ([...heroLabels].some((label) => actor === label || normalizeLabel(line).startsWith(`${label} `))) return "hero";
  if ([...fishLabels].some((label) => actor === label || normalizeLabel(line).startsWith(`${label} `))) return "fish";
  return null;
}

function actionForLine(line) {
  const text = line.toLowerCase();
  if (/\bfolds?\b/.test(text)) return "fold";
  if (/\bchecks?\b/.test(text)) return "check";
  if (/\bcalls?\b/.test(text)) return "call";
  if (/\b(?:raises?|3-?bets?)\b/.test(text)) return "raise";
  if (/\bbets?\b/.test(text)) return "bet";
  return null;
}

function amountForLine(line) {
  const raiseTo = line.match(/\b(?:raises?|3-?bets?)(?:\s+\$?[0-9]+(?:\.[0-9]+)?)?\s+to\s+\$?([0-9]+(?:\.[0-9]+)?)/i);
  if (raiseTo) return Number(raiseTo[1]);
  const actionText = line.match(/\b(?:bets?|calls?)\s+\$?([0-9]+(?:\.[0-9]+)?)/i);
  return actionText ? Number(actionText[1]) : null;
}

function streetForLine(line) {
  const match = line.match(/(?:\*{3}\s*)?\b(flop|turn|river)\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function boardFromStreetLine(line, existingBoard, street) {
  const cards = parseCards(line, { min: 1, max: 5 });
  const target = STREET_COUNTS[street];
  if (cards.length >= target) return cards.slice(0, target);
  const combined = [...existingBoard];
  for (const card of cards) if (!combined.includes(card)) combined.push(card);
  if (combined.length !== target) {
    throw new Error(`${street[0].toUpperCase()}${street.slice(1)} needs ${target} total board cards.`);
  }
  return combined;
}

function commitTo(state, player, target) {
  const committedKey = player === "hero" ? "heroCommitted" : "fishCommitted";
  const paid = Math.max(0, target - state[committedKey]);
  state[committedKey] += paid;
  state.pot += paid;
  return paid;
}

function commit(state, player, amount) {
  const committedKey = player === "hero" ? "heroCommitted" : "fishCommitted";
  state[committedKey] += Math.max(0, amount);
  state.pot += Math.max(0, amount);
}

function observeRange(state, context, action, line, warnings) {
  const before = state.range.length;
  try {
    state.range = observeFishAction(
      state.range,
      context,
      action,
      [...state.heroCards, ...state.board],
    );
    state.lastFishAction = action;
    state.streetLastFishAction = action;
    state.streetLastFishContext = context;
    const event = {
      street: state.street,
      action,
      text: line,
      before,
      after: state.range.length,
      context,
    };
    state.events.push(event);
    return event;
  } catch (error) {
    warnings.push(`${line}: ${error.message} The prior range was kept instead of inventing combos.`);
    return null;
  }
}

/**
 * Parse a compact or common-room-style hand history and thread the same exact
 * binary fish range through every recognized opponent action.
 */
export function analyzeFishHandHistory(raw = {}) {
  const heroCards = parseCards(raw.heroCards ?? "", { exact: 2 });
  const bigBlind = Number(raw.bigBlind ?? 3);
  const startingPot = Number(raw.startingPot ?? 6);
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) throw new Error("Big blind must be positive.");
  if (!Number.isFinite(startingPot) || startingPot < 0) throw new Error("Starting pot cannot be negative.");

  const lines = String(raw.history ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("Enter at least one hand-history line.");

  const warnings = [];
  const state = {
    heroCards,
    board: [],
    street: "preflop",
    pot: startingPot,
    heroCommitted: 0,
    fishCommitted: 0,
    range: createFishRange({ heroCards }),
    events: [],
    openAmount: null,
    pendingPreflopContext: null,
    lastPreflopAggressor: null,
    fishPreflopRole: "none",
    pendingHeroBet: null,
    lastFishAction: null,
    streetLastFishAction: null,
    streetLastFishContext: null,
  };
  const streetSnapshots = [];

  const captureStreetSnapshot = (event = null) => {
    const snapshot = {
      street: state.street,
      board: [...state.board],
      pot: state.pot,
      range: [...state.range],
      summary: summarizeFishRange(state.range, state.board),
      lastFishAction: state.streetLastFishAction,
      lastFishContext: state.streetLastFishContext,
      checkpoint: event?.text ?? "Starting unblocked range",
      eventCount: state.events.length,
    };
    const existingIndex = streetSnapshots.findIndex((entry) => entry.street === state.street);
    if (existingIndex === -1) streetSnapshots.push(snapshot);
    else streetSnapshots[existingIndex] = snapshot;
  };

  captureStreetSnapshot();

  for (const line of lines) {
    const nextStreet = streetForLine(line);
    if (nextStreet) {
      const before = state.range.length;
      state.street = nextStreet;
      state.board = boardFromStreetLine(line, state.board, nextStreet);
      state.range = filterFishRange(state.range, [...heroCards, ...state.board]);
      state.heroCommitted = 0;
      state.fishCommitted = 0;
      state.pendingHeroBet = null;
      state.streetLastFishAction = null;
      state.streetLastFishContext = null;
      const event = {
        street: nextStreet,
        action: "board",
        text: `${nextStreet[0].toUpperCase()}${nextStreet.slice(1)} ${state.board.map(cardToString).join(" ")}`,
        before,
        after: state.range.length,
      };
      state.events.push(event);
      captureStreetSnapshot(event);
      continue;
    }

    const actor = actorForLine(line, raw.heroName, raw.fishName);
    const action = actionForLine(line);
    if (!action) continue;
    if (!actor) {
      warnings.push(`${line}: ignored because the actor is neither the configured hero nor fish. Multiway actions are not modeled.`);
      continue;
    }
    const amount = amountForLine(line);

    if (state.street === "preflop") {
      if (actor === "hero" && action === "raise") {
        if (amount === null) {
          warnings.push(`${line}: add a raise-to amount so the open size can be modeled.`);
          continue;
        }
        const facingFishReraise = state.lastPreflopAggressor === "fish";
        state.pendingPreflopContext = facingFishReraise
          ? {
            type: "preflop-vs-fourbet",
            fourBetBb: amount / bigBlind,
            priorAction: state.fishPreflopRole === "threebet" ? "threebet" : "opened",
          }
          : { type: "preflop-vs-open", openBb: amount / bigBlind };
        state.openAmount = amount;
        commitTo(state, "hero", amount);
        state.lastPreflopAggressor = "hero";
        continue;
      }
      if (actor === "fish" && ["fold", "call", "raise"].includes(action)) {
        if (state.openAmount === null) {
          warnings.push(`${line}: no earlier hero raise amount was recognized.`);
          continue;
        }
        const event = observeRange(
          state,
          state.pendingPreflopContext ?? { type: "preflop-vs-open", openBb: state.openAmount / bigBlind },
          action,
          line,
          warnings,
        );
        if (action === "call") commitTo(state, "fish", state.heroCommitted);
        if (action === "raise") {
          commitTo(state, "fish", amount ?? state.openAmount * 3.3);
          state.fishPreflopRole = state.fishPreflopRole === "none" ? "threebet" : state.fishPreflopRole;
          state.lastPreflopAggressor = "fish";
        }
        if (event) captureStreetSnapshot(event);
      }
      continue;
    }

    if (actor === "hero") {
      if (action === "bet") {
        if (amount === null) {
          warnings.push(`${line}: add a bet amount so the facing size can be modeled.`);
          continue;
        }
        const potBefore = state.pot;
        commit(state, "hero", amount);
        state.pendingHeroBet = { type: "bet", fraction: amount / Math.max(1, potBefore) };
      } else if (action === "raise") {
        if (amount === null) {
          warnings.push(`${line}: add a raise-to amount so the response can be modeled.`);
          continue;
        }
        commitTo(state, "hero", amount);
        state.pendingHeroBet = { type: "raise", fraction: null };
      } else if (action === "call") {
        commitTo(state, "hero", state.fishCommitted);
      }
      continue;
    }

    if (action === "check" && !state.pendingHeroBet) {
      const event = observeRange(state, { type: "postflop-first", board: state.board }, "check", line, warnings);
      if (event) captureStreetSnapshot(event);
      continue;
    }
    if (action === "bet" && !state.pendingHeroBet) {
      const event = observeRange(state, { type: "postflop-first", board: state.board }, "bet", line, warnings);
      if (amount !== null) commit(state, "fish", amount);
      else warnings.push(`${line}: the range was filtered, but no bet amount was available for pot tracking.`);
      if (event) captureStreetSnapshot(event);
      continue;
    }
    if (state.pendingHeroBet?.type === "bet" && ["fold", "call", "raise"].includes(action)) {
      const event = observeRange(
        state,
        { type: "postflop-vs-bet", board: state.board, betFraction: state.pendingHeroBet.fraction },
        action,
        line,
        warnings,
      );
      if (action === "call") commitTo(state, "fish", state.heroCommitted);
      if (action === "raise") commitTo(state, "fish", amount ?? state.heroCommitted * 3);
      state.pendingHeroBet = null;
      if (event) captureStreetSnapshot(event);
      continue;
    }
    if (state.pendingHeroBet?.type === "raise" && ["fold", "call"].includes(action)) {
      const event = observeRange(state, { type: "postflop-vs-raise", board: state.board }, action, line, warnings);
      if (action === "call") commitTo(state, "fish", state.heroCommitted);
      state.pendingHeroBet = null;
      if (event) captureStreetSnapshot(event);
      continue;
    }

    warnings.push(`${line}: the opponent action could not be placed in the supported action sequence.`);
  }

  if (!state.events.some((event) => !["board"].includes(event.action))) {
    warnings.push("No recognized fish actions filtered the starting range. Use Fish, Villain, Opponent, or the configured fish name at the start of action lines.");
  }

  return {
    heroCards,
    board: [...state.board],
    street: state.street,
    pot: state.pot,
    range: state.range,
    summary: summarizeFishRange(state.range, state.board),
    events: state.events,
    warnings,
    lastFishAction: state.lastFishAction,
    streetSnapshots: streetSnapshots
      .sort((left, right) => STREET_ORDER.indexOf(left.street) - STREET_ORDER.indexOf(right.street)),
  };
}
