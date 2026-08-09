# Poker Solver — browser-based Hold'em GTO study solver

[![CI](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml)

**Live solver:** <https://edwin-hou.github.io/poker-solver/>

Poker Solver is an open-source, combo-level CFR+ study tool for **heads-up, two-card Texas Hold'em from preflop through river**. It runs entirely in the browser, accepts weighted Hold'em ranges, expands them into exact suit combinations, applies card removal, and presents strategies in a 13×13 matrix with combo-level inspection.

The interface follows the familiar workflow of modern poker study software—choose a street, configure a spot, solve it, and inspect the resulting range—without copying GTO Wizard's proprietary code, assets, solution database, or precomputed strategies.

## Solving modes

| Starting street | Current hosted model | Future-card treatment | Evaluation |
|---|---|---|---|
| **Preflop** | Heads-up SB fold/jam and BB fold/call | Called hands sample a complete five-card board | Monte Carlo profile EV and information-consistent best-response estimate |
| **Flop** | One configured OOP/IP betting street with check, multiple bet sizes, fold, and call | Samples turn and river cards; no later-street betting | Monte Carlo profile EV and best-response estimate |
| **Turn** | One configured OOP/IP betting street with check, multiple bet sizes, fold, and call | Samples the river card; no river betting | Monte Carlo profile EV and best-response estimate |
| **River** | Complete configured check/bet/fold/call tree | No future cards | Exact profile EV, exact pure best responses, NashConv, and exploitability |

These are deliberately bounded browser-scale abstractions. “Preflop through river” means that every starting street is available in the solution builder; it does **not** mean that one monolithic no-limit tree containing every action on every street is being solved.

## What is genuinely modeled

- A full 52-card deck.
- Two private hole cards per player.
- Standard 169-class range notation expanded into exact suit combinations.
- Weighted range frequencies and explicit combos.
- Board blockers and cross-player card removal.
- Exact best-five-of-seven Hold'em showdown evaluation.
- User-defined postflop pot, effective stack, and multiple bet sizes.
- User-defined preflop blinds, ante, and effective stack.
- Chance-sampled CFR+ training with linear averaging.
- A Web Worker so long solves do not freeze the interface.
- 13×13 strategy grids, exact combo inspection, decision-node navigation, and JSON export.

## Hosted model limits

The current project is a serious educational solver, not a replacement for a commercial distributed solving platform.

- Preflop is push/fold rather than a full limp/open/3-bet/4-bet tree.
- Flop and turn solve the selected street only; future cards are sampled and checked down.
- Postflop raises are not yet included.
- There is no multiway play, rake, tournament ICM, node locking, saved cloud solution library, or distributed backend.
- River is the only mode whose reported exploitability is exact for the configured tree. Earlier-street numbers are explicitly labeled Monte Carlo estimates.

See [docs/SCOPE.md](docs/SCOPE.md) for the architectural gap between this project and commercial multi-street solvers.

## Quick start

```bash
git clone https://github.com/edwin-hou/poker-solver.git
cd poker-solver
npm ci
npm test
npm run serve
```

Then open <http://localhost:8000>.

There are no front-end framework or runtime-server dependencies. `npm run build` creates the static GitHub Pages artifact in `dist/`.

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

Weights may be expressed from `0` to `1` or as percentages. Public-card blockers are removed automatically.

## Using the hosted solver

1. Select **Preflop**, **Flop**, **Turn**, or **River**.
2. Choose a preset or edit the spot manually.
3. Enter both players' weighted ranges.
4. Configure blinds and stack preflop, or board, pot, stack, and bet sizes postflop.
5. Choose the iteration count and evaluation sample count.
6. Click **Build & solve**.
7. Navigate decision nodes and inspect the action-colored range matrix.
8. Click a hand class to view exact suit combinations and mixed frequencies.
9. Export the complete result as JSON when needed.

## CFR+ implementation

At every sampled compatible private-card deal, Poker Solver:

1. Converts nonnegative cumulative regret into the current behavioral strategy.
2. Samples future public cards when the solve begins before the river.
3. Evaluates every legal action in the configured abstraction.
4. Updates counterfactual regrets using the opponent's reach probability.
5. Clips cumulative regrets at zero, as in CFR+.
6. Accumulates a linearly weighted average strategy after a configurable delay.

The river engine enumerates its finite game exactly for profile and best-response evaluation. The preflop, flop, and turn engines use independent Monte Carlo samples for strategy evaluation and information-consistent best-response estimates.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for game definitions, payoff conventions, and evaluation details.

## Exact versus estimated exploitability

For a two-player zero-sum profile $\sigma$, the project reports

```text
NashConv = BR_0(σ_1) - u_0(σ) + BR_1(σ_0) - u_1(σ)
exploitability = NashConv / 2
```

- **River:** exact for the configured finite abstraction.
- **Preflop, flop, and turn:** a Monte Carlo estimate, accompanied by the evaluation sample count and profile-value standard error.

Lower is better. Zero represents a Nash equilibrium of the modeled abstraction, not necessarily of unrestricted no-limit Hold'em.

## Project layout

```text
src/
  cards.js             card parsing and exact five/seven-card evaluation
  range.js             169-class notation and exact combo expansion
  solver.js            exact finite river solver
  preflop-solver.js    heads-up push/fold CFR+
  postflop-solver.js   sampled single-street flop and turn CFR+
  solve.js             unified preflop/flop/turn/river dispatcher
  evaluation.js        exact river profile and best-response evaluation
site/
  index.html           hosted study interface
  app.js               street builder, presets, worker orchestration
  result-view.js       range matrix and combo-level result rendering
  solver-worker.js     background solving entry point
  styles/
scripts/
  build-site.mjs
  serve.mjs
  benchmark.mjs
test/
  all-streets.test.js
  cards.test.js
  range.test.js
  solver.test.js
  site-result-view.test.js
docs/
  ALGORITHM.md
  SCOPE.md
```

## Tests

```bash
npm test
```

The command builds the Pages artifact and then tests:

- card parsing and every major poker hand category;
- exact seven-card best-hand selection;
- range notation, weights, and blockers;
- preflop push/fold strategy generation;
- flop and turn future-card sampling;
- preservation of the exact river engine;
- decreasing river exploitability with more CFR+ training;
- completed-solve rendering and GitHub Pages asset paths.

GitHub Actions runs the suite on Node 22 and Node 24.

## GitHub Pages deployment

The repository supports both common publishing modes:

- **Recommended:** **Settings → Pages → Source → GitHub Actions**. The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds, uploads, and deploys `dist/`.
- **Branch fallback:** publishing `main` from `/ (root)` loads the repository-level redirect and opens `site/`.

See [PAGES_ACTIVATION.md](PAGES_ACTIVATION.md) for the one-time setup.

## Responsible use

Poker Solver is intended for off-table research, education, and strategy study. Do not use it to obtain assistance during live or online play where doing so violates platform rules or applicable law.

## Roadmap

- Add limp, raise, 3-bet, 4-bet, and configurable all-in branches preflop.
- Add one or more postflop raise sizes.
- Add range locking and node locking.
- Add true turn-to-river and flop-to-river betting subgames.
- Add public-state decomposition and continual re-solving.
- Add external-sampling MCCFR and optional WebAssembly kernels.
- Add saved configurations, shareable solution files, rake, and tournament utility models.

## References

- Martin Zinkevich, Michael Johanson, Michael Bowling, and Carmelo Piccione, “Regret Minimization in Games with Incomplete Information,” NeurIPS 2007.
- Oskari Tammelin, “Solving Large Imperfect Information Games Using CFR+,” 2014.
- Matej Moravčík et al., “DeepStack: Expert-Level Artificial Intelligence in Heads-Up No-Limit Poker,” 2017.

## License

MIT
