# Hosted scope

Poker Solver is a browser-scale two-card Texas Hold'em study application. The public GitHub Pages site contains only the solver workspace.

## Current capabilities

| Capability | Poker Solver 1.2 |
|---|---|
| Deck and private cards | Full 52-card deck; exact two-card combinations |
| Range input | Weighted 169 classes or explicit suit combos |
| Card removal | Exact public-board and cross-player blockers |
| Hand evaluation | Exact five-card and best-five-of-seven ordering |
| Preflop chart positions | UTG, HJ, CO, BTN, SB, BB |
| Preflop chart spots | Open first in, facing open, facing 3-bet |
| Preflop chart output | Approximate fold/call/limp/raise/3-bet/4-bet frequencies |
| Preflop CFR+ tree | Heads-up SB fold/jam; BB fold/call |
| Flop | One strategic street; sampled turn-river check-down |
| Turn | One strategic street; sampled river check-down |
| River | Complete configured check/bet/fold/call abstraction |
| Raises postflop | Not yet |
| Strategy view | Decision-node selector, 13×13 matrix, exact combo table |
| Hosting | Static GitHub Pages; local Web Worker computation |
| Export | Complete JSON result |

## Two different preflop products

### Six-max lookup charts

This is the default preflop experience. It is intended for ordinary cash-game questions such as:

- What should BTN open at 100bb?
- How should BB respond to a 2.5bb BTN open?
- How should CO respond after BTN 3-bets?

The engine uses position-specific lookup targets, stack and price adjustments, and transparent hand-class scoring. It creates plausible mixed-frequency charts immediately.

It is **not** an unrestricted equilibrium solve. The interface therefore does not display EV, NashConv, or exploitability for lookup output.

### Heads-up push/fold CFR+

This is a genuine sampled regret-minimization game, but its tree is deliberately narrow:

```text
SB fold/jam → BB fold/call
```

It supports ranges, blinds, antes, stack depth, sampled all-in boards, and Monte Carlo best-response evaluation.

## Postflop boundaries

### Flop

The configured flop betting street is strategic. Turn and river cards are sampled, but later streets check through.

### Turn

The configured turn betting street is strategic. The river is sampled and checks through.

### River

There are no future public cards. The complete configured finite tree is evaluated exactly, including information-consistent best responses and exploitability.

## What is not implemented

- full limp/open/call/3-bet/4-bet/5-bet preflop trees;
- six-max or multiway CFR+ game trees;
- strategic betting across several postflop streets in one solve;
- postflop raises;
- rake, tournament ICM, or asymmetric stacks;
- node locking, range locking, saved cloud solutions, or a precomputed database;
- distributed, GPU, native, or WebAssembly compute.

## Difference from a commercial platform

A commercial instant-solution product typically combines richer betting trees, public-state decomposition, abstraction, accelerated compute, and a large precomputed solution library. This project instead keeps its code, assumptions, and accuracy labels inspectable and runs in a static browser site.

The interface uses common poker-study interaction patterns—street tabs, configuration controls, decision nodes, action-colored matrices, and combo details—but does not include proprietary code, assets, APIs, or solution data from GTO Wizard or another commercial solver.

## Deployment scope

The Pages artifact loads only:

- a compact Poker Solver header;
- the solution builder;
- the progress/result workspace;
- the shared solver modules and styles required by that workspace.

The former hero, methodology, and footer fragments are not part of the deployed site.
