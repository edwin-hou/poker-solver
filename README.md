# Poker Solver — browser-based Hold'em GTO solver

[![CI](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml/badge.svg)](https://github.com/edwin-hou/poker-solver/actions/workflows/pages.yml)

**Live solver:** <https://edwin-hou.github.io/poker-solver/>

Poker Solver is an open-source, combo-level CFR+ solver for **heads-up, two-card Texas Hold'em river spots**. It runs entirely in the browser, accepts real Hold'em ranges and boards, and measures the learned strategy against exact information-consistent best responses.

It follows the familiar study workflow of commercial poker tools—configure a spot, solve it, inspect a 13×13 range grid—without copying GTO Wizard's proprietary solver, database, interface assets, or precomputed solutions.

## What is genuinely modeled

- A full 52-card deck.
- Two private hole cards per player.
- A five-card Hold'em board.
- Standard 169-class range notation expanded into exact suit combinations.
- Card removal between the board and both players' ranges.
- Exact best-five-of-seven hand evaluation.
- User-defined pot and effective stack.
- Multiple OOP and IP bet sizes.
- Check, bet, fold, and call actions.
- Chance-sampled CFR+ training with linear averaging.
- Exact profile EV, pure best responses, NashConv, and exploitability for the finite tree.

## Hosted solver scope

The browser version solves this restricted river tree:

```text
OOP
├─ check
│  └─ IP: check or bet one configured size
│     └─ OOP: fold or call
└─ bet one configured size
   └─ IP: fold or call
```

Raises are intentionally excluded from v1. Flop and turn chance nodes, multi-street range transitions, subgame re-solving, and server-scale abstraction are not yet implemented. Those restrictions keep the complete strategy and exact best-response calculation small enough to run locally in a static GitHub Pages site.

## Quick start

```bash
git clone https://github.com/edwin-hou/poker-solver.git
cd poker-solver
npm ci
npm test
npm run serve
```

Then open <http://localhost:8000>.

There are no runtime dependencies and no front-end framework. `npm run build` copies the static site and shared solver modules into `dist/`.

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

Weights are frequencies from `0` to `1`, or percentages. Board-blocked combinations are removed automatically.

## CFR+ implementation

At every sampled compatible private-card deal, Poker Solver:

1. Converts nonnegative cumulative regret into the current behavioral strategy.
2. Evaluates every legal action in the restricted betting tree.
3. Updates counterfactual regrets using the opponent's reach probability.
4. Clips cumulative regret at zero, as in CFR+.
5. Accumulates a linearly weighted average strategy after a configurable delay.

The training loop lives in a Web Worker, keeping the range editor responsive.

See [docs/ALGORITHM.md](docs/ALGORITHM.md) for equations and payoff conventions.

## Exact exploitability

Training and evaluation are separate. For each player, the evaluator chooses one action for every information set while correctly aggregating all hidden opponent holdings compatible with that information set. It does **not** condition the best response on cards the player cannot observe.

For a strategy profile $\sigma$, Poker Solver reports NashConv as the sum of both players' unilateral best-response gains. For this two-player zero-sum game, exploitability is `NashConv / 2`.

Lower is better. Zero means an exact Nash equilibrium of the configured finite abstraction.

## Reproducible benchmark

```bash
npm run benchmark
```

The checked-in [benchmark summary](benchmarks/summary.json) records the board, ranges, iteration count, runtime, profile EV, exact best-response values, NashConv, and exploitability. Runtime is machine-dependent; exploitability is the meaningful convergence measure.

## Project layout

```text
src/
  cards.js       card parsing and exact five/seven-card evaluation
  range.js       169-class notation and combo expansion
  solver.js      chance-sampled CFR+ and exact best responses
site/
  index.html     hosted solver UI
  app.js         range grid, worker orchestration, JSON export
  result-view.js result rendering and exact combo inspection
  solver-worker.js
  styles/
scripts/
  build-site.mjs
  serve.mjs
  benchmark.mjs
test/
  cards.test.js
  range.test.js
  solver.test.js
  site-result-view.test.js
docs/
  ALGORITHM.md
  SCOPE.md
```

## Test suite

```bash
npm test
```

The test command builds the hosted artifact first, then checks card parsing, every major poker hand category, seven-card best-hand selection, range syntax and blockers, stack-capped sizing, zero-sum evaluation, decreasing exact exploitability, and completed-solve rendering.

GitHub Actions tests Node 22 and Node 24.

## GitHub Pages deployment

The repository supports both common Pages configurations:

- **Recommended:** Settings → Pages → Source → **GitHub Actions**. The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds, uploads, and deploys `dist/`.
- **Branch fallback:** publishing `main` from `/ (root)` loads the repository-root redirect and opens `site/`.

After the repository is renamed to `poker-solver`, its project-site URL is <https://edwin-hou.github.io/poker-solver/>. See [PAGES_ACTIVATION.md](PAGES_ACTIVATION.md) for the one-time setting.

## Responsible use

Poker Solver is intended for off-table research, education, and strategy study. Do not use it to obtain assistance during live or online play where doing so violates platform rules or applicable law.

## Roadmap

- Add one or more raise sizes.
- Add range locking and node locking.
- Add turn solving with public chance nodes.
- Add flop/turn card abstraction and public-tree decomposition.
- Add external-sampling MCCFR and optional WASM kernels.
- Add saved configurations and shareable solution files.
- Add local subgame re-solving across multiple streets.

See [docs/SCOPE.md](docs/SCOPE.md) for the architectural gap between this browser solver and a commercial multi-street platform.

## References

- Martin Zinkevich, Michael Johanson, Michael Bowling, and Carmelo Piccione, “Regret Minimization in Games with Incomplete Information,” NeurIPS 2007.
- Oskari Tammelin, “Solving Large Imperfect Information Games Using CFR+,” 2014.
- Matej Moravčík et al., “DeepStack: Expert-Level Artificial Intelligence in Heads-Up No-Limit Poker,” 2017.

## License

MIT
