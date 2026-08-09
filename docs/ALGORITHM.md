# Algorithm and game definitions

Poker Solver exposes several bounded study models through one interface. It does not claim to solve one unrestricted no-limit tree from preflop through river.

## Shared card and range model

All modes use:

- a standard 52-card deck;
- two private hole cards per player;
- weighted 169-class or exact-combo ranges;
- exact public-board and cross-player card removal;
- exact five-card and best-five-of-seven hand ordering.

For legal private holdings `h0` and `h1`, the unnormalized chance weight is

```text
w(h0, h1) = w0(h0) · w1(h1).
```

## Unified dispatcher

`src/solve.js` selects the engine from the street and preflop model:

```text
preflop + lookup    → preflop-lookup.js
preflop + push-fold → preflop-solver.js
flop / turn         → postflop-solver.js
river                → solver.js
```

When the street is omitted, public-card count is used:

```text
0 cards → preflop
3 cards → flop
4 cards → turn
5 cards → river
```

## Approximate six-max preflop lookup

The default preflop mode is a deterministic chart approximation rather than a regret-minimization run.

### Inputs

- decision: open first in, facing an open, or facing a 3-bet;
- hero position: UTG, HJ, CO, BTN, SB, or BB;
- opener or 3-bettor position where relevant;
- effective stack in big blinds;
- opening size;
- optional range filters in the programmatic API.

### Target frequencies

The engine stores smooth position-specific targets for:

- total opening frequency;
- total continuation versus an open;
- 3-bet frequency;
- continuation versus a 3-bet;
- 4-bet frequency.

Stack depth and open size adjust those targets. For example, a larger open reduces calling and defending frequency, while shallow stacks shift more of the continuation range into aggressive actions.

The values are original heuristic targets calibrated to familiar six-max cash-game range widths. They are not copied commercial solution data.

### Hand ordering

Every one of the 169 starting-hand classes receives two transparent scores:

1. **Playability score** — pair strength, high-card strength, suitedness, connectivity, and gap penalties.
2. **Aggression score** — playability plus pair, ace-blocker, broadway, suited-wheel-ace, and suited-king bonuses.

A target percentage is allocated over all 1,326 starting combinations, not merely over 169 equally weighted cells. Pocket pairs therefore count as six combinations, suited hands as four, and offsuit hands as twelve. The boundary class receives a mixed frequency when necessary.

### Actions

```text
Open first in:
  most positions → fold / raise
  small blind    → fold / limp / raise

Facing an open:
  fold / call / 3-bet

Facing a 3-bet:
  fold / call / 4-bet
```

The class strategy is expanded into exact suit combinations so the normal matrix and combo inspector can be reused.

### Accuracy contract

Lookup results contain:

```text
exploitability = null
profile EV     = null
exact          = false
```

The interface displays “Lookup” instead of inventing an EV or exploitability number.

## Heads-up preflop push/fold CFR+

The optional sampled preflop solver uses this tree:

```text
SB
├─ fold
└─ jam S
   └─ BB
      ├─ fold
      └─ call
```

Inputs are small blind, big blind, ante, effective stack, SB range, and BB range. A called all-in samples five public cards without replacement and evaluates both seven-card hands exactly.

From SB's perspective:

```text
SB folds:          uSB = -(SB + ante)
BB folds to jam:   uSB = +(BB + ante)
BB calls:          uSB = showdown_sign · stack
```

The engine trains exact-combo information sets with chance-sampled CFR+ and estimates profile EV and best responses through independent Monte Carlo samples.

## Flop and turn single-street CFR+

Flop and turn share one postflop engine:

```text
OOP
├─ check
│  └─ IP: check or bet one configured size
│     └─ OOP: fold or call
└─ bet one configured size
   └─ IP: fold or call
```

Raises are excluded. A flop iteration samples turn and river cards; a turn iteration samples the river. After the selected street, remaining streets check down.

With current pot `P`, called bet `B`, and showdown sign `s` from OOP's perspective:

```text
check-check:          uOOP = s · P / 2
OOP bet, IP folds:    uOOP = +P / 2
OOP bet B, IP calls:  uOOP = s · (P / 2 + B)
IP bet, OOP folds:    uOOP = -P / 2
IP bet B, OOP calls:  uOOP = s · (P / 2 + B)
```

Profile EV and best-response values are Monte Carlo estimates.

## River finite-tree CFR+

River uses the same restricted check/bet/fold/call structure without future chance cards. After training, every compatible private deal is enumerated to calculate exact profile EV, pure information-consistent best responses, NashConv, and exploitability for that configured finite tree.

## Regret matching and CFR+

At information set `I`, cumulative regret `R(I,a)` becomes the current strategy

```text
σ(I,a) = max(R(I,a), 0) / Σb max(R(I,b), 0).
```

When every regret is nonpositive, actions are uniform. A sampled regret update is

```text
r(I,a) = counterfactual_reach · (action_value(I,a) - node_value(I)).
```

CFR+ truncates cumulative regret after each update:

```text
Rnext(I,a) = max(0, R(I,a) + rnext(I,a)).
```

The returned policy is a realization-weighted average with linear weight `max(0, iteration - averaging_delay)`.

## Best responses and exploitability

A best response chooses one action for an entire information set. It may condition on the responding player's private cards and public history, but not on hidden opponent cards or unseen future cards.

For a two-player zero-sum profile `σ`:

```text
NashConv = BR0(σ1) - u0(σ) + BR1(σ0) - u1(σ)
exploitability = NashConv / 2
```

- River reports this exactly for the configured finite tree.
- Push/fold, flop, and turn report Monte Carlo estimates and standard-error metadata.
- Preflop lookup charts do not report it.
