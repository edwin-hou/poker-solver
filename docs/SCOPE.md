# Scope: Poker Solver versus a commercial multi-street solver

Poker Solver is a real two-card Texas Hold'em solver, but “Hold'em solver” covers several very different scales of software. This document makes the boundary explicit.

## Implemented now

| Capability | Poker Solver hosted v1 |
|---|---|
| Private cards | Exact two-card combinations |
| Public cards | Exact five-card river board |
| Ranges | Weighted 169 classes or exact combos |
| Blockers | Exact board and cross-player card removal |
| Hand strength | Exact best five of seven |
| Positions | Heads-up OOP and IP |
| Bet sizes | Multiple user-defined sizes per player |
| Responses | Fold and call |
| Raises | Not yet |
| Training | Chance-sampled CFR+ |
| Evaluation | Exact profile EV and exact pure best responses |
| Hosting | Static GitHub Pages; all computation local |
| Strategy view | 13×13 class grid plus exact combo table |
| Export | Full JSON strategy and metrics |

## What a GTO Wizard-scale system adds

A commercial multi-street platform generally requires:

1. **A much larger public tree.** Flop and turn solves branch over future board cards and repeated betting rounds.
2. **A richer betting tree.** Multiple bet and raise sizes at many nodes rapidly multiply the state count.
3. **Card abstraction or enormous enumeration.** The raw no-limit tree is too large for direct browser enumeration.
4. **Subgame decomposition.** Practical systems solve or re-solve smaller public subgames rather than one monolithic tree.
5. **Large precomputed libraries.** Instant lookup products usually serve solutions computed on substantial backend hardware.
6. **Distributed or accelerated kernels.** Native code, SIMD, GPUs, or clusters are common for high-resolution work.
7. **Product layers.** Saved trees, node locking, aggregate reports, hand-history study, drills, and database search are separate from the core regret minimizer.

## Why the hosted edition starts on the river

The river has no future public chance cards. That makes it possible to keep all of the following exact at once:

- suit-level hole-card combinations;
- blocker effects;
- seven-card showdown ordering;
- the complete restricted betting strategy;
- exact information-consistent best responses.

This is a better correctness foundation than presenting a visually impressive multi-street interface backed by an undocumented heuristic.

## Road to multi-street support

A defensible progression is:

1. Add raise actions on the river.
2. Add node/range locking and warm starts.
3. Add turn chance nodes with river checkdown, then a river subgame.
4. Add external-sampling MCCFR to reduce traversal cost.
5. Add public-state decomposition and continual re-solving.
6. Add strategically meaningful hand bucketing for flop/turn states.
7. Move compute-intensive kernels to WebAssembly or an optional server worker.

Each stage should retain exact best-response tests on smaller regression games so performance improvements do not silently change the game being solved.

## Branding and affiliation

Poker Solver is independent open-source software. “GTO Wizard” is referenced only to explain the category of range-oriented poker study interface requested for the project. No proprietary code, solver outputs, design assets, or databases are included.
