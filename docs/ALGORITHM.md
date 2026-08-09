# Algorithm and game definition

## 1. Public state

A solve is defined by:

- a five-card river board;
- an OOP weighted range over legal two-card combinations;
- an IP weighted range over legal two-card combinations;
- current pot P;
- effective stack S;
- OOP bet sizes B1 through Bm;
- IP bet sizes C1 through Cn.

Every bet is capped at the effective stack. Bet-size inputs in the hosted UI are percentages of the current pot.

A private deal `(h0,h1)` is legal only when the two hole-card combinations do not overlap each other or the public board. Its unnormalized chance weight is `w0(h0) * w1(h1)`.

Chance sampling draws from that product distribution and rejects conflicting private deals, which produces the correctly normalized distribution over legal pairs.

## 2. Terminal utilities

Utilities are zero-sum and measured relative to each player's equal share of the pot before the river action begins.

Let `s(h0,h1)` be -1, 0, or 1 for the exact showdown result from OOP's perspective. Then:

- check-check: `u0 = s * P / 2`;
- a bet B is called: `u0 = s * (P / 2 + B)`;
- IP folds to OOP: `u0 = P / 2`;
- OOP folds to IP: `u0 = -P / 2`.

IP's utility is always `-u0`.

The showdown sign is computed from an exact best-five-of-seven evaluator. No equity buckets or hand-strength approximation are used on the river.

## 3. Information sets

A player's private two-card combination and public action history identify an information set. Hidden opponent cards never appear in that key.

The restricted tree contains four information-set families:

1. OOP at the root: check or any OOP bet size.
2. IP after OOP checks: check or any IP bet size.
3. IP facing each OOP bet size: fold or call.
4. OOP facing each IP bet size: fold or call.

Suit-specific combinations have separate information sets because suits affect card removal and, on many boards, hand strength.

## 4. Regret matching

For information set I and action a, cumulative counterfactual regret is converted into a strategy by normalizing the positive regrets. If every regret is nonpositive, the strategy is uniform.

For a sampled private deal, the action value and on-policy node value are computed by traversing every legal action beneath the relevant decision. The regret increment is the opponent reach probability multiplied by `action value - node value`. The responding player's own earlier action probability is excluded from counterfactual reach.

## 5. CFR+

After each sampled update, RiverForge applies the CFR+ truncation:

```text
R_next(I,a) = max(0, R(I,a) + r_next(I,a))
```

Both players' regrets are updated against the same frozen current profile for that iteration.

The returned policy is a realization-weighted average strategy. After an averaging delay d, iteration t receives linear weight `max(0, t-d)`.

At response nodes, a player's own prior reach is included in the average-strategy weight. Opponent reach is not.

## 6. Chance sampling

The complete private-card matrix can contain hundreds of thousands of compatible deals. Enumerating it during every CFR iteration would make a static browser solver unnecessarily slow.

RiverForge samples one legal private deal per iteration. Sampling the chance event while traversing all strategic actions produces an unbiased counterfactual update up to an information-set-specific positive chance scaling. That scaling does not change regret matching because it multiplies every action regret at the same information set.

Exact enumeration is still used after training for profile EV and best-response evaluation.

## 7. Exact profile value

For the average strategy, RiverForge enumerates every legal private deal, multiplies its terminal expectation by the product of both range weights, and divides by total compatible deal weight.

## 8. Information-consistent best responses

A best response must choose one action per information set, not one action per hidden opponent hand.

For example, when OOP faces an IP bet while holding h0, RiverForge aggregates fold and call values across every compatible IP hand, weighted by the IP range and IP's probability of choosing that bet. The same selected action is then applied against every hidden IP holding in that information set. Backward induction chooses response actions before earlier actions.

## 9. NashConv and exploitability

NashConv is the sum of the amount each player can gain by switching unilaterally to an exact best response. For this two-player zero-sum game, RiverForge reports `exploitability = NashConv / 2`.

This number is exact for the configured finite river abstraction; the learned policy remains approximate because CFR+ is stopped after a finite number of iterations.
