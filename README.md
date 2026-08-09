# Poker Solver

[![CI](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml)

**Live solver:** <https://edwin-hou.github.io/poker-solver/>

Poker Solver is a focused browser application for studying two-card Texas Hold'em. The GitHub Pages site opens directly into the solver—there is no landing page, marketing section, methodology page, or footer before the workspace.

Everything runs locally in a Web Worker. Cards, ranges, and strategies are not uploaded to a server.

## Preflop modes

### Approximate six-max charts

The default preflop mode provides instant position-aware charts for:

- open first in;
- facing an open;
- facing a 3-bet.

Inputs include hero position, opener or 3-bettor position, stack depth, and open size. The engine uses transparent lookup targets and hand-class scoring to generate fold, call, limp, raise, 3-bet, and 4-bet frequencies across all 169 starting-hand classes. It then expands each class into exact suit combinations for the shared combo inspector.

This mode is deliberately labeled **approximate**. It does not report EV, NashConv, or exploitability, because those quantities are not solved by the lookup model. The charts are original heuristic approximations rather than copied proprietary solver outputs.

### Heads-up push/fold CFR+

The second preflop mode retains the sampled CFR+ game:

```text
SB: fold or jam
BB versus jam: fold or call
called hands: sampled five-card runout
```

Blinds, ante, effective stack, ranges, iterations, and evaluation samples are configurable.

## Postflop modes

| Street | Hosted abstraction | Evaluation |
|---|---|---|
| Flop | One configured betting street; sampled turn and river check-down | Monte Carlo estimate |
| Turn | One configured betting street; sampled river check-down | Monte Carlo estimate |
| River | Complete configured check/bet/fold/call tree | Exact for the finite tree |

The card model uses a full 52-card deck, exact two-card combinations, exact public-card blockers, and exact best-five-of-seven showdown evaluation.

## Interface

The solver-only workspace contains:

- Preflop, Flop, Turn, and River tabs;
- street-specific presets;
- position, stack, pot, board, range, and bet-size controls;
- action-colored 13×13 strategy matrices;
- exact suit-combination inspection;
- decision-node navigation;
- JSON export;
- explicit exact-versus-estimated accuracy labels.

## Local development

```bash
git clone https://github.com/edwin-hou/poker-solver.git
cd poker-solver
npm ci
npm test
npm run serve
```

Open <http://localhost:8000>.

The application has no front-end framework or runtime backend dependency. `npm run build` creates the static Pages artifact in `dist/`.

## Range notation

Supported forms include:

```text
AA, AKs, AKo
TT+
A2s+
22-66
A2s-A5s
AsKh
AKs:50%
AKo@0.25
random
```

## Project layout

```text
src/
  cards.js              exact card and hand evaluation
  range.js              range parsing and combo expansion
  preflop-lookup.js     approximate six-max chart engine
  preflop-solver.js     heads-up push/fold CFR+
  postflop-solver.js    sampled flop and turn engines
  solver.js             exact finite-tree river engine
  solve.js              unified dispatcher
site/
  app.js                solver workspace controller
  result-view.js        matrix and combo rendering
  solver-worker.js      browser worker entry point
  partials/              solver configuration and results only
  styles/
test/
  all-streets.test.js
  preflop-lookup.test.js
  site-result-view.test.js
```

## Accuracy and scope

Poker Solver is an educational browser-scale project, not a replacement for a distributed commercial solving platform.

- The normal preflop charts are approximations.
- The CFR+ preflop tree is heads-up push/fold only.
- Flop and turn do not optimize later-street betting.
- Postflop raises are not yet included.
- There is no multiway play, rake, ICM, node locking, or cloud solution database.
- River exploitability is exact only for its configured restricted tree.

See [docs/SCOPE.md](docs/SCOPE.md) and [docs/ALGORITHM.md](docs/ALGORITHM.md) for the precise game definitions.

## Responsible use

Use Poker Solver for off-table study and research. Do not use it for assistance during live or online play where doing so violates platform rules or applicable law.

## License

MIT
