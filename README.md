# Poker Solver

[![CI](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml)

**Live site:** <https://edwin-hou.github.io/poker-solver/>

Poker Solver is a focused browser application for studying two-card Texas Hold'em. GitHub Pages exposes two study tools: the solver workspace and the **Beat Fish** full-hand trainer.

Everything runs locally in the browser. Cards, ranges, strategies, and trainer hands are not uploaded to a server.

## Beat Fish trainer

`site/trainer.html` is an original six-handed exploit-training surface built around transparent basic loose-passive live $1/$2/$3 player archetypes.

- Hands begin preflop and can continue through river.
- Five opponents occupy UTG, HJ, CO, SB, and BB around a BTN hero. Some early seats fold, one or two limp, and curated hidden hands guarantee at least two callers against either offered isolation size so practice reaches a genuinely multiway flop.
- Every opponent has one fixed hidden exact combo and a separate independent binary marginal range for the entire hand. Each exact combo is either still plausible for that seat or removed.
- Opponents use deterministic novice rules rather than mixed strategies: wide limps and calls, passive medium-strength play, loose draw chasing, and value-heavy raises.
- Every observed opponent action filters that seat's existing range; board cards remove impossible blockers from every active range.
- Every answered hero action remains available. Exploring another action creates a persistent sibling branch instead of deleting the line already studied.
- Five fixed hidden opponent hands and one five-card runout are shared across sibling branches, so sizing comparisons are true counterfactuals.
- **Reveal Range** lets you select a seat, displays its literal surviving range for the selected branch, partitions and color-codes it by exact fold/call/raise action facing each hero sizing, and lists literal suit combos on demand.
- Back/forward controls and the branch trail rewind the board, pot, action history, and all five exact range states along the active branch.
- A separate heads-up-only **Estimate a hand history** mode accepts hero cards, player labels, stakes, and a compact action transcript, then threads one blocker-aware binary opponent range through every recognized action.
- Preflop coaching reads the repository's approximate six-max positional lookup table (so hands such as BTN 94o fold). Multiway postflop coaching samples equity from every active exact range and applies clearly disclosed population-exploit thresholds; it is not presented as a solved multiway equilibrium and never reads hidden cards.

The modeled opponent understands the rules and obvious hand strength but does not construct balanced/GTO ranges. This is a study archetype rather than solver output or a claim about every low-stakes player.

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

The solver workspace contains:

- Preflop, Flop, Turn, and River tabs;
- street-specific presets;
- position, stack, pot, board, range, and bet-size controls;
- action-colored 13×13 strategy matrices;
- exact suit-combination inspection;
- decision-node navigation;
- JSON export;
- explicit exact-versus-estimated accuracy labels.

The shared top navigation links the solver and Beat Fish trainer without adding a marketing landing page.

## Local development

```bash
git clone https://github.com/edwin-hou/poker-solver.git
cd poker-solver
npm ci
npm test
npm run serve
```

Open <http://localhost:8000>. The trainer is available at <http://localhost:8000/site/trainer.html>.

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
  fish-model.js         deterministic loose-passive trainer range model
  hand-history-range.js pasted-history parser and binary range thread
  trainer-tree.js       persistent trainer decision branches
  preflop-lookup.js     approximate six-max chart engine
  preflop-solver.js     heads-up push/fold CFR+
  postflop-solver.js    sampled flop and turn engines
  solver.js             exact finite-tree river engine
  solve.js              unified dispatcher
site/
  app.js                solver workspace controller
  trainer.html          Beat Fish full-hand trainer page
  trainer.js            trainer state machine, coaching, and history
  result-view.js        matrix and combo rendering
  solver-worker.js      browser worker entry point
  partials/             solver configuration and results only
  styles/
test/
  all-streets.test.js
  fish-model.test.js
  hand-history-range.test.js
  preflop-lookup.test.js
  site-result-view.test.js
  trainer-page.test.js
  trainer-tree.test.js
```

## Accuracy and scope

Poker Solver is an educational browser-scale project, not a replacement for a distributed commercial solving platform.

- The normal preflop charts are approximations.
- Beat Fish is a transparent deterministic low-stakes player archetype, not equilibrium output or empirical population frequencies.
- The CFR+ preflop tree is heads-up push/fold only.
- Flop and turn do not optimize later-street betting.
- Postflop raises are not yet included in the solver tree; the trainer may present population-modeled raise decisions separately.
- There is no multiway solver, rake, ICM, node locking, or cloud solution database.
- River exploitability is exact only for its configured restricted tree.

See [docs/SCOPE.md](docs/SCOPE.md) and [docs/ALGORITHM.md](docs/ALGORITHM.md) for the precise solver game definitions.

## Responsible use

Use Poker Solver and Beat Fish for off-table study and research. Do not use them for assistance during live or online play where doing so violates platform rules or applicable law.

## License

MIT
