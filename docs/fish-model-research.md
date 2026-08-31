# Beat Fish population-model notes

Last audited: 2026-08-31

## Scope

This is a deterministic training archetype for a low-stakes live recreational player. It is not a claim that every recreational player takes the same action and it is not a GTO strategy. The audit used Hungry Horse's public catalog index and the strategy entries most directly concerned with recreational-player ranges, bluffing, sizing, multiway play, deep stacks, and postflop line reading. The public channel contains hundreds of shorts and non-strategy entries; those are not treated as independent strategic evidence.

The model keeps one exact binary range from preflop through river. A combo either takes the observed action in its context or is removed. No mixed frequencies are introduced.

## Recurring public-catalog claims translated into rules

| Public observation | Deterministic model rule |
| --- | --- |
| Live players fast-play strong hands too often and under-bluff raises after sustained aggression. | Obvious two-pair-plus raises; turn raises after earlier aggression and passive river stabs receive no generic bluff bucket. |
| Heads-up donk bets are materially bluffier, while multiway donks are major strength signals. | Small heads-up donks may contain obvious overcards, ace-high, and draws. Multiway donks are value plus only the nut combo-draw exception. |
| Checked-to players stab too frequently, especially in position. | Heads-up checked-to flop ranges include small air stabs and obvious semi-bluffs. Multiway checked-to ranges require stronger draws. |
| Modern low-stakes players recognize a few conspicuous bluff triggers. | Paired-turn and ace-turn barrels can retain air after a prior bet; low-SPR strong draws can panic-shove. |
| Nut-flush blockers now appear in some large river bluff lines. | A river pure bluff requires the nut-flush blocker, no made showdown hand, heads-up play, two earlier aggressive streets, and a large observed size. |
| River stabs after passive action and check-back-flop/raise-turn lines are heavily under-bluffed. | Air checks; the estimator does not inherit missed draws into those betting/raising ranges. |
| Recreational players often preserve medium showdown value instead of converting it into a bluff. | Pocket pairs and one-pair hands check rather than bluff, including paired-board pocket pairs such as 77. |
| Bet size is part of the read. | Small heads-up donk/stab bluffs disappear from large observed bets; large blocker bluffs disappear from small river bets. |
| Deep play increases the value of suited, connected hands, but action history and price still matter. | The 150bb preflop model remains wider and call-heavy without manufacturing solver-style light four-bets. |
| Hungry Horse treats charts as a baseline that moves with opponent quality, position, depth, sizing, rake, and players left to act. | First-in raising widens by seat (about 7% UTG, 11% HJ, 14% CO, and 24% BTN) while weaker entered hands remain limps rather than turning the archetype into a LAG. |
| Online recreational profiles range from extremely passive to highly aggressive; the stable signal is excessive VPIP and a position-dependent VPIP–PFR gap, not a single premium-only opening chart. | The model uses a middle recreational opening shape, adds good-looking suited hands later, and still folds structural trash such as 72o. |
| Strong pairs can call or 4-bet depending on position, sizing, and opponent, and recreational populations are heterogeneous. | QQ uses a deterministic 3/6 call–4-bet split versus a 16bb late-position 3-bet; JJ uses 4/6 calls and 2/6 4-bets. Larger 3-bets reduce those 4-bet buckets. Exact suits visualize the split but carry no strategic meaning. |

## Public references

- Hungry Horse's overview of its live-data/exploit approach: https://www.hungryhorsepoker.com/home
- Hungry Horse's five-step low-stakes summary (fast-played value, under-bluffed aggression, capped check-call lines): https://www.linkedin.com/posts/hungryhorsepoker_poker-pokerstrategy-activity-7177786625194651649-tOgf
- “Where Poker Players Bluff Too Much And Where They Never Bluff”: https://bluffaces.com/videos/where-poker-players-bluff-too-much-and-where-they-never-bluff/
- “I Played 100 Hours at Low Stakes - Something's Different”: https://bluffaces.com/videos/i-played-100-hours-at-low-stakes-somethings-different/
- “95% of Pots Are Multiway - The System That Fixes Your Winrate”: https://bluffaces.com/videos/95-of-pots-are-multiway-the-system-that-fixes-your-winrate/
- “If You Can't Do This, You'll Never Beat Live Poker”: https://bluffaces.com/videos/if-you-cant-do-this-youll-never-beat-live-poker/
- “Low Stakes Has Changed for 2026. Most Players Won't Adapt”: https://bluffaces.com/videos/low-stakes-has-changed-for-2026-most-players-wont-adapt/
- “I Tried Playing Perfect GTO at Low Stakes”: https://bluffaces.com/videos/i-tried-playing-perfect-gto-at-low-stakes/
- “Short vs. Deep Stack: The Huge Adjustment You're Missing”: https://bluffaces.com/videos/short-vs-deep-stack-the-huge-adjustment-youre-missing/
- “Big Winners Don't Memorize Preflop Charts. They Use Them Like This”: https://bluffaces.com/videos/big-winners-dont-memorize-preflop-charts-they-use-them-like-this/
- Hand2Note's database-oriented fish profiling examples: https://www.hand2note.com/pt/Blog/Features/key-preflop-stats-player-profiling-and-basic-adjustments
- Hand2Note's 41,000-hand passive-fish report example: https://www.hand2note.com/Help/Features/multi-player-reports
- A transparent 45/8 loose-passive range-size reference: https://poker-reflex.com/tools/vpip-pfr-range
- Public multiway lesson transcript/translation: https://www.gipsyteam.es/news/22-10-2025/botes-multiway-en-vivo-estrategia-completa-hungry-horse

## Guardrails

- “Bluff-heavy” means bluffier relative to another live line, not balanced or majority bluff.
- Strong-looking cards do not justify arbitrary aggression.
- A made pair is not a pure bluff candidate in this archetype.
- Multiway aggression is tightened sharply relative to heads-up aggression.
- Hero recommendations use exact response ranges and disclosed exploit thresholds. They are not labeled as exact six-player equilibrium solutions.
