# Q-FLOW algorithm benchmark

Numbers come from `npm run bench` (scripts/compare-algorithms.js; reproducible: every instance and run is seeded). All algorithms here are classical code running on an ordinary CPU; QPSO is quantum-inspired, not quantum hardware.

## Method

Every stochastic algorithm (QPSO, PSO, GA, ACO, SA) gets the same budget of objective evaluations per run: max(2000, min(20000, 300 n)). That rule was fixed before any comparison and isn't tuned per algorithm. Local-search evaluations inside QPSO count against the same budget. Each algorithm does 10 independent seeded runs per instance.

**Gap** is (mean cost − reference) / reference. The reference depends on size:
- **n = 8:** the **exact optimum**. Every one of the 40,320 customer orders is enumerated, and each is cut into at most K vehicle routes at the cheapest break points (the optimal split decoder, below). Any feasible plan with at most K routes, joined route by route, is one of those orders, and its optimal split costs no more than the plan. So this is the true optimum of the objective for at most K vehicles.
- **Larger sizes:** the best cost any method found on that instance, Clarke-Wright included.

For the metaheuristics, "Wins" counts instances where the algorithm had the lowest mean cost among them. For Clarke-Wright it counts instances where its single deterministic result is at or below the best metaheuristic mean. Times are wall-clock in Node 22 on the dev VM, and are only comparable within a table.

**Clarke-Wright** is the greedy constructive savings heuristic with a time-window check on every merge: a merge is rejected if it adds lateness. It is scored on its own routes with the same cost function as everything else. It doesn't limit the number of routes, so when it needs more vehicles than the fleet has, each extra vehicle is penalised at 10,000, as for every algorithm.

**Decoders.** A metaheuristic searches over customer orders; a decoder cuts each order into vehicle routes.
- The **greedy** decoder starts a new vehicle when the next customer doesn't fit. Once the fleet is used up, the last vehicle takes the rest, overloaded.
- The **optimal split** decoder (`splitTourSequence`, after Prins 2004) uses dynamic programming to choose the break points that minimise the same objective with at most K routes. For the same order it is never worse than greedy: in 900 random orders it was better in 81% and equal in the rest.
- QPSO uses the optimal split decoder; GA, PSO, ACO and SA use greedy.
- To show how much of QPSO's result comes from the decoder rather than the search, the tables also include **SA with the optimal split decoder** (fairness check) and **QPSO with the greedy decoder** (ablation).

**QPSO's settings** were chosen on tuning sets and then frozen:
- swarm 20; alpha 0.95 to 0.50;
- Lamarckian local search with the moves 2-opt, or-opt and swap;
- elite local search of 10n evaluations per iteration;
- heuristic seeding;
- the optimal split decoder.

The tuning sets were instance seeds 101–110, plus, for the capacity-tight case, a separate set of 50-customer instances with 95–100% fleet use (seeds 204, 205 and 208–211). The tables use **held-out instance seeds 1–10, which weren't used for tuning**. `QPSO-core` is QPSO with local search and heuristic seeding switched off (just the Sun/Feng/Xu update), included as an ablation.

## Findings

QPSO with the optimal split decoder has the best results of the metaheuristics at 8 and 20 customers, clearly ahead of simulated annealing, including SA given the same decoder. At 50 customers it ties SA on the mean gap and wins more instances. It is slower per run than SA.

**8 customers (gap vs the exact optimum):**
- QPSO's mean gap is **0.1%** (median 0.0%), and it is best on 9 of 10 instances.
- SA with the same decoder: 0.5%. Plain SA: 1.4%.
- Paired by instance, QPSO is lower than SA-with-split on 9 of 10 (difference −0.4 points, SE 0.1, more than 2 SE).

**20 customers:**
- QPSO's mean gap is **8.9%** against SA's 18.0%, and 16.6% for SA with the same decoder. It has the lowest mean cost on 8 of 10 instances.
- Paired against SA-with-split, QPSO is lower on all 10 (−7.7 points, SE 1.6).
- The same holds at half and double the budget. With 3,000 evaluations, QPSO (10.2%) beats SA with 12,000 evaluations (15.3%).
- Clarke-Wright is at or below the best metaheuristic mean on 3 of 10 instances.

**50 customers:**
- The mean gaps are a tie: QPSO 74.9%, SA 73.7%, with only 5 instances, too few for a significance call. QPSO has the lowest mean cost on 3 of 5.
- The large mean gaps come from two instances (seeds 1 and 4) whose total demand exceeds the whole fleet's capacity (101% and 104%), so no algorithm can serve them. There, cost measures how little overload is left, and SA leaves less.
- On the three instances that can be served (seeds 2, 3 and 5; 86%, 99% and 79% fleet use), QPSO's mean cost is lower than SA's on all three: 1,137 vs 1,404, 1,459 vs 1,557 and 1,165 vs 1,378. QPSO is feasible in 29 of 30 runs and SA in 29 of 30.
- This breakdown by serviceable vs over-capacity instances was added after the results were seen. The full table, which includes all five instances, is unchanged above it.

**Run time:**
- At the same number of evaluations, QPSO with the optimal split decoder takes more time per run than SA, because each split evaluation does more work: about 0.9 s against 0.05 s at 50 customers, and 0.14 s against 0.012 s at 20.
- SA given the same decoder takes as long as QPSO and stays behind it.
- So QPSO converges to better routes **per evaluation**, but it isn't faster in wall-clock time.

**What changed, and how it was chosen (no held-out data used):**
- **Split decoder.** The greedy decoder's weakness was capacity-tight fleets: wasted space closed vehicles early, and the leftover customers overloaded the last vehicle. On seeds 101–110 the split decoder improved QPSO at every size. SA gained little from it.
- **Swap move and longer elite search (10n instead of 5n).** Chosen on the separate capacity-tight tuning set, where this variant had the lowest mean cost on 5 of 6 instances against SA (mean gap 10.8% vs 16.0%). On seeds 101–110 it was never worse than the previous setting: 2.1% better at 20 customers and 5.0% better at 50.
- **Earlier version, for the record.** Before these changes, with the greedy decoder and the previous local search, QPSO tied SA at 8 and 20 customers and was clearly worse at 50 (mean gap 302% vs 69%).

**Earlier findings, still valid:**
- Lamarckian local search beat Baldwinian at every size.
- A bounded local search on the global-best tour each iteration was the largest single gain at 20+ customers.
- Seeding paid off only after adding the time-window-aware Solomon nearest-neighbour and earliest-due-date tours.
- Alpha ranges between 0.6–0.3 and 0.96–0.7 were all within noise of each other.

**Untried, so no claims are made:**
- seeding QPSO from the time-window-aware Clarke-Wright routes;
- an adaptive capacity penalty;
- a route-count limit for Clarke-Wright;
- an equal-time (rather than equal-evaluation) comparison;
- instances larger than 50 customers.

## Results (held-out instances)

The tables are generated by `npm run bench` and live in [docs/results.md](docs/results.md) (the main ones are also in the README). They report the same seeded runs as the findings above, now with pooled mean ± std, an example instance per size, and a computed outcome line per table.
