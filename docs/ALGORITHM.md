# Algorithm and game definitions

Poker Solver exposes four starting streets through one interface, but it does not treat them as one giant no-limit game tree. Each mode uses a deliberately bounded heads-up abstraction that can run in a static browser application.

## 1. Shared card and range model

All modes use:

- a standard 52-card deck;
- two private hole cards per player;
- weighted ranges expanded from 169-class notation into exact suit combinations;
- exact board and cross-player card removal;
- exact five-card and best-five-of-seven hand ordering.

For private holdings `h0` and `h1`, a deal is legal only when neither hand overlaps the public board or the other private hand. Its unnormalized chance weight is

```text
w(h0, h1) = w0(h0) · w1(h1).
```

The chance-sampled trainers draw from the two weighted ranges and reject conflicting holdings. This is equivalent to drawing from the product distribution conditioned on legal private deals.

## 2. Starting-street dispatcher

`src/solve.js` routes a configuration according to its selected street:

```text
preflop → HoldemPreflopSolver
flop    → HoldemPostflopSolver
turn    → HoldemPostflopSolver
river   → HoldemRiverSolver
```

When the street is omitted, the dispatcher infers it from the public-card count:

```text
0 cards → preflop
3 cards → flop
4 cards → turn
5 cards → river
```

Other public-card counts are rejected.

## 3. Preflop push/fold game

The hosted preflop mode is a heads-up SB-versus-BB push/fold abstraction.

### 3.1 Public parameters

A solve contains:

- small blind `SB`;
- big blind `BB`;
- per-player ante `A`;
- effective stack `S` in big blinds;
- a weighted SB range;
- a weighted BB range.

### 3.2 Betting tree

```text
SB
├─ fold
└─ jam S
   └─ BB
      ├─ fold
      └─ call
```

There are no limps, non-all-in opens, 3-bets, or 4-bets in this version.

### 3.3 Utilities

Utilities are zero-sum and measured in the same stack units used by the configuration.

From SB's perspective:

```text
SB folds:             uSB = -(SB + A)
SB jams, BB folds:    uSB = +(BB + A)
SB jams, BB calls:    uSB = showdown_sign · S
```

`showdown_sign` is `+1`, `0`, or `-1`. For every sampled called branch, five public cards are drawn without replacement and both seven-card hands are evaluated exactly.

BB's utility is always the negative of SB's utility.

### 3.4 Information sets

There is one SB information set for every exact SB combo and one BB response information set for every exact BB combo. Hidden opponent cards never appear in an information-set key.

## 4. Flop and turn single-street games

Flop and turn share one postflop engine.

### 4.1 Public parameters

A solve contains:

- a three-card flop or four-card turn board;
- OOP and IP weighted ranges;
- current pot `P`;
- effective stack `S`;
- one or more OOP bet sizes;
- one or more IP bet sizes after an OOP check.

Bet-size inputs are percentages of the current pot and are capped at the effective stack.

### 4.2 Betting tree

```text
OOP
├─ check
│  └─ IP
│     ├─ check
│     └─ bet one configured size
│        └─ OOP: fold or call
└─ bet one configured size
   └─ IP: fold or call
```

Raises are not included.

### 4.3 Future public cards

The selected street is the only strategic betting street in this abstraction.

- A flop iteration samples a turn and river.
- A turn iteration samples a river.
- After the selected street's actions, all future streets are treated as check-downs.

The completed five-card board is combined with each private holding and evaluated with the exact seven-card evaluator. No hand-strength bucket replaces the sampled showdown in the current implementation.

### 4.4 Terminal utilities

Let `s(h0, h1, r)` be `-1`, `0`, or `+1` for OOP on sampled runout `r`. Then:

```text
check-check:             uOOP = s · P / 2
OOP bet B, IP folds:     uOOP = +P / 2
OOP bet B, IP calls:     uOOP = s · (P / 2 + B)
OOP checks, IP bet C,
OOP folds:               uOOP = -P / 2
OOP checks, IP bet C,
OOP calls:               uOOP = s · (P / 2 + C)
```

IP's utility is the negative of OOP's utility.

## 5. River finite game

The river uses the same restricted betting tree as the postflop model above, but there are no future chance cards. Every terminal showdown value is therefore known exactly once the private deal is fixed.

After training, the river evaluator enumerates every compatible private deal to calculate:

- exact profile EV;
- exact pure best response for OOP;
- exact pure best response for IP;
- exact NashConv and exploitability for the configured finite tree.

## 6. Regret matching

For information set `I` and action `a`, let cumulative regret be `R(I,a)`. The current behavioral strategy is

```text
σ(I,a) = max(R(I,a), 0) / Σb max(R(I,b), 0)
```

when the denominator is positive. If every cumulative regret is nonpositive, the strategy is uniform over legal actions.

For a sampled private deal and, when required, sampled future board, the engine evaluates every legal strategic action in the abstraction. The regret increment is

```text
r(I,a) = counterfactual_reach · (action_value(I,a) - node_value(I)).
```

The acting player's own reach is excluded from counterfactual reach. Chance and opponent reach are included.

## 7. CFR+

After every update, cumulative regret is truncated at zero:

```text
R_next(I,a) = max(0, R(I,a) + r_next(I,a)).
```

Both players are updated against the same frozen current strategy profile for that iteration.

The returned strategy is a realization-weighted average. With averaging delay `d`, iteration `t` receives linear weight

```text
max(0, t - d).
```

At a response information set, a player's own probability of reaching that response through an earlier action is included in its average-strategy weight.

## 8. Chance sampling

Enumerating all compatible private deals, all future boards, and every strategic action during every CFR iteration would make the hosted application unnecessarily slow.

The trainers therefore sample:

- one compatible private deal per iteration in every mode;
- one complete five-card board for a called preflop all-in;
- one turn-river runout for a flop iteration;
- one river card for a turn iteration.

All strategic actions in the selected finite betting tree are still evaluated for the sampled chance state. This produces an unbiased sampled regret update up to a positive information-set-specific chance scaling, which does not change regret matching because every action at that information set receives the same scaling.

## 9. Average-strategy evaluation

### 9.1 River

River profile value is exact. Every compatible private deal is enumerated, weighted by `w0(h0) · w1(h1)`, and divided by total legal chance weight.

### 9.2 Preflop, flop, and turn

Earlier streets use an independent evaluation RNG and a configurable number of Monte Carlo samples. The output includes:

- profile EV estimate;
- profile-value standard error;
- best-response value estimate for each player;
- NashConv estimate;
- exploitability estimate;
- number of evaluation samples.

These results are explicitly marked `exact: false` in exported JSON.

## 10. Information-consistent best responses

A best response must choose one action for an entire information set. It may condition on the responding player's private cards and the public history, but not on the hidden opponent holding or unseen future cards.

The river evaluator aggregates continuation values across every hidden opponent holding before choosing one action for each exact private combo and public history.

For preflop, flop, and turn, the evaluator estimates the same aggregation with independent Monte Carlo samples. It first estimates response actions at downstream information sets, then uses those fixed choices while estimating the earlier decision. A separate sample stream evaluates the selected response profile.

## 11. NashConv and exploitability

For strategy profile `σ`, player utilities `ui(σ)`, and information-consistent best-response values `BRi(σ-i)`:

```text
NashConv(σ) = Σi [BRi(σ-i) - ui(σ)]
exploitability(σ) = NashConv(σ) / 2
```

The value is exact only for the river abstraction. Earlier-street values are Monte Carlo estimates and may vary slightly with the random seed and evaluation sample count.

Zero means equilibrium of the modeled abstraction. It does not imply equilibrium of unrestricted heads-up no-limit Hold'em.
