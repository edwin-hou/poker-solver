# Contributing

Changes should preserve the distinction between the real Hold'em card model and the deliberately restricted betting abstraction.

## Before opening a pull request

```bash
npm test
npm run build
npm run benchmark
```

New solver features should include at least one small regression game whose exact best response can be evaluated quickly. Avoid judging correctness only from visually plausible range grids.

## Design principles

- Keep information sets free of hidden opponent cards.
- Keep terminal utilities explicitly zero-sum.
- Measure exploitability against information-consistent best responses.
- Document every betting-tree restriction.
- Keep the hosted build dependency-free where practical.
- Do not add real-time table capture or live-play assistance features.
