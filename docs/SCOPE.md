# Scope: Poker Solver versus a commercial multi-street platform

Poker Solver is a real two-card Texas Hold'em CFR+ study solver, but “all-street solver” can describe products with radically different game trees and compute budgets. This document defines exactly what the hosted application solves.

## Current hosted capabilities

| Capability | Poker Solver 1.1 |
|---|---|
| Deck and private cards | Full 52-card deck; exact two-card combinations |
| Ranges | Weighted 169 classes or explicit suit combos |
| Blockers | Exact public-board and cross-player card removal |
| Hand strength | Exact five-card and best-five-of-seven evaluation |
| Players | Heads-up only |
| Starting streets | Preflop, flop, turn, and river |
| Preflop tree | SB fold/jam; BB fold/call |
| Flop tree | One OOP/IP betting street; future turn and river check down |
| Turn tree | One OOP/IP betting street; future river checks down |
| River tree | Complete configured check/bet/fold/call abstraction |
| Postflop bet sizes | Multiple user-defined initial sizes for OOP and IP |
| Postflop raises | Not yet |
| Training | Chance-sampled CFR+ with linear averaging |
| River evaluation | Exact profile EV and exact pure best responses |
| Earlier-street evaluation | Monte Carlo profile EV and information-consistent best-response estimates |
| Hosting | Static GitHub Pages; computation runs locally in a Web Worker |
| Strategy view | Decision-node selector, 13×13 matrix, exact combo table |
| Export | Full configuration, strategies, metrics, and metadata as JSON |

## What “preflop through river” means here

The solution builder can start on any of the four Hold'em streets. Each mode is an independently defined abstraction:

### Preflop

The preflop mode solves a heads-up push/fold game. It models exact hole-card combinations, blinds, antes, effective stack, and sampled five-card runouts when an all-in is called.

It does not currently model:

- limping;
- non-all-in opens;
- calls against ordinary raises;
- 3-bets and 4-bets;
- multiple stack depths in one tree;
- six-max or multiway positions;
- rake or ICM.

### Flop

The flop mode solves the configured flop betting street. It samples compatible turn and river cards to calculate showdown values, but it assumes both later streets check through after the selected flop action resolves.

It therefore does not optimize turn or river betting as part of the same solve.

### Turn

The turn mode solves the configured turn betting street. It samples the river card and assumes no river betting.

### River

The river mode has no future public cards. The complete configured restricted tree can be evaluated exactly, including exact information-consistent best responses and exploitability.

## What a commercial multi-street system adds

A commercial solver and instant-solution platform may include several layers beyond a browser-based regret minimizer:

1. **A much richer preflop tree.** Limp, open, call, squeeze, 3-bet, 4-bet, 5-bet, and multiple all-in branches across several positions and stack depths.
2. **Repeated postflop betting rounds.** Flop actions lead to strategic turn nodes, which lead to strategic river nodes.
3. **Multiple raises at many nodes.** Every additional size multiplies the public game tree.
4. **Public chance decomposition.** Different turn and river cards create many strategically distinct subgames.
5. **Card abstraction or enormous enumeration.** Raw no-limit Hold'em is too large for an unrestricted exact browser solve.
6. **Subgame decomposition and continual re-solving.** Practical systems split the public tree and solve smaller regions while preserving boundary values.
7. **Large precomputed solution libraries.** Instant lookup generally means substantial solutions were computed in advance.
8. **Accelerated or distributed compute.** Native kernels, SIMD, WebAssembly, GPUs, and clusters can support higher-resolution trees.
9. **Product tooling.** Node locking, aggregate reports, saved trees, hand-history review, drills, database search, and cloud sharing are separate product layers.

## Why the river remains the exact reference mode

The river has no future chance cards. This allows the project to keep all of the following exact simultaneously:

- suit-level private combos;
- blocker effects;
- seven-card showdown ordering;
- every terminal payoff in the configured tree;
- profile expected value;
- one information-consistent pure best response for every private holding and public history.

Preflop, flop, and turn reuse the same exact card model but estimate chance and best-response values through independent sampling. Their exported results include the sample count and profile standard error rather than presenting the number as exact.

## Interface similarity and originality

The revised interface uses a workflow common to poker study tools:

- starting-street tabs;
- a left-side solution builder;
- presets, ranges, stack, pot, and betting-tree controls;
- a decision-node browser;
- action-colored 13×13 range matrices;
- combo-level details and export.

The layout and styling are original to this repository. No proprietary GTO Wizard code, visual assets, solution data, or internal APIs are included.

## Next technically defensible extensions

1. Add river raise sizes and preserve exact best-response tests.
2. Expand preflop from push/fold to configurable open/call/3-bet trees.
3. Add range and node locking.
4. Add strategic river subgames beneath turn nodes.
5. Add strategic turn and river subgames beneath flop nodes.
6. Move larger traversal kernels to WebAssembly.
7. Add external-sampling MCCFR and public-state decomposition.
8. Add rake, tournament utility, multiway play, and saved solution formats.

Each extension should retain small exact regression games so that performance improvements do not silently change the modeled game.

## Responsible use and affiliation

Poker Solver is independent open-source software intended for off-table research and education. “GTO Wizard” is referenced only to describe the category of study workflow requested for the project. The software should not be used for prohibited real-time assistance during live or online play.
