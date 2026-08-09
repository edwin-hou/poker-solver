# Contributing

Changes should preserve the distinction between the exact Hold'em card model and each deliberately restricted betting abstraction.

## Before opening a pull request

```bash
npm test
npm run build
npm run benchmark
```

New solver features should include at least one small regression game. Exact modes should be checked against exact best responses; sampled modes should use deterministic seeds, report their sample count, and be compared with an exact or independently enumerable reduction whenever practical. Avoid judging correctness only from visually plausible range grids.

## Design principles

- Keep information sets free of hidden opponent cards and unseen future cards.
- Keep terminal utilities explicitly zero-sum.
- Measure exploitability against information-consistent best responses.
- Label Monte Carlo quantities as estimates rather than exact values.
- Document every betting-tree and future-street restriction.
- Keep the hosted build dependency-free where practical.
- Preserve the exact river solver as a correctness reference.
- Do not add table capture, live-play automation, or real-time assistance features.
