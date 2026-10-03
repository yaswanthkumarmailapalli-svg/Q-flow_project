# Q-FLOW (SIH26137): gap analysis and improvement plan

This analysis is based on the project folder (demo version, 3 Oct 2026), the SIH26137 problem statement, and the measured benchmark results in `BENCHMARK.md` and `docs/results.md`. The starting score is **≈72%**, from `SIH26137_coverage.txt`.

All percentages are **my estimates**, not an official SIH score. They show where the gaps are, not what judges will award.

---

## 1. Current strength of each section

| Section | Current | Main reason it isn't higher |
|---|---:|---|
| Problem understanding & framing | 85% | Strong README; some UI text overclaims (§3, H4) |
| QPSO algorithm implementation | 95% | Complete, tested, documented; tuning/test split is clean |
| Graph-based network model | 85% | VRP graph is complete; shortest path runs on a synthetic grid, not real roads |
| Mathematical formulation | 95% | Objective and BPR model are written out (Research lab §1, README) |
| Constraint handling | 100% | Capacity, time windows, fleet size, depot hours, feasibility flags, validation |
| Convergence analysis | 75% | Curves only; no convergence-speed numbers (evaluations to target) |
| Benchmarking vs metaheuristics | 90% | Equal budgets, seeds, held-out instances; no formal significance test |
| Benchmarking vs exact methods | 50% | Enumeration ≤ 9 stops (exact only within the greedy-split space) and Dijkstra; no true exact VRP solver |
| Scalability (smart-city scale) | 50% | Benchmarked at 8 / 20 / 50 stops; engine accepts 200, but that's untested at scale |
| Traffic: real-time / simulated | 100% | TomTom live (6/6 checks verified) + BPR simulation |
| Congestion minimisation | 50% | Per-route only; network-wide assignment is a simulated demo |
| Objective 3 (beat classical algorithms) | 30% | Measured: ties SA at 8/20 stops, loses at 50; SA faster per run |
| Software platform (web + Android) | 100% | Built, tested (19 test files), APK verified |
| Documentation | 85% | Thorough, but the README has a screenshot placeholder |
| Report / slides / demo video | 0% | Not yet created |
| Accuracy & consistency of UI claims | 70% | 6 overclaims or inconsistencies (H4) |

---

## 2. Gaps, prioritised by impact

### HIGH impact

**H1. No technical report (PDF).** Deliverable: 0%.
- **Why it matters:** the problem statement asks for "mathematical formulation, constraint handling, convergence analysis, and systematic performance benchmarking". Judges look for these in a document, not by reading code.
- **What to add:** a 10–15 page report with these sections:
  1. Problem & motivation
  2. Related work: QPSO (Sun, Feng & Xu 2004), CVRPTW, BPR
  3. Network model (weighted graph, BPR travel time, TomTom live matrix)
  4. Mathematical formulation: objective F, constraints, penalties
  5. Algorithms: QPSO update, random-key encoding, split decoder, local search, seeding; brief notes on GA, ACO, SA, PSO and Clarke-Wright
  6. Experimental method: seeds, equal budgets, tuning vs held-out instances
  7. Results: tables from `docs/results.md`
  8. Convergence analysis
  9. Scalability
  10. Limitations
  11. Platform (web, Android, live traffic, navigation)
  12. Conclusion
- **Estimated gain:** deliverables +6–7 points, overall about +2.

**H2. No presentation slides and no demo video.** Deliverables: 0% each.
- **Why it matters:** SIH judging is mostly a pitch plus a live demo. Without a deck and a backup video, a network failure during the demo can sink the presentation.
- **What to add:**
  - **Slides (10–12):**
    1. Problem
    2. Why quantum-inspired
    3. Architecture
    4. Network model & formulation
    5. QPSO design
    6. Benchmark method
    7. Results (honest)
    8. Convergence
    9. Live traffic & real navigation demo
    10. Scalability & limitations
    11. Impact & next steps
    12. Team
  - **Video:** a 2–3 minute screen recording that follows the script in §4.
- **Estimated gain:** deliverables +13 points, overall about +4.5.

**H3. Objective 3 is not met by the measurements, and the framing must be careful.**
- **Evidence:**
  - At n = 50, QPSO's mean gap is 302% vs SA's 69%; QPSO is lower on only 2 of 5 instances (`docs/results.md`).
  - At n = 20, SA's mean gap is 13.0% vs QPSO's 14.4%.
- **Why it matters:** the brief asks for "improving convergence speed and solution quality compared with classical algorithms". Claiming this would be false, and judges can run `npm run bench`.
- **What to change:**
  - **Wording:** state the result honestly (rewritten text in §3), and present QPSO's real strengths. It beats classical PSO, GA and ACO at every size. It has the most instance wins at n = 8 and n = 20. Its warm-started re-planning is never worse than the stale plan.
- **Optional experiment:** a capacity-aware decoder or adaptive capacity penalty for QPSO. The n = 50 failure mode is overloading the last vehicle on capacity-tight fleets.
  - Tune it on seeds 101–110 only, and report held-out results whatever they show.
- **Estimated gain:** from the wording alone, only a lower risk of losing credibility. The experiment could add +10–20 points on objective 3, *if* it improves the measured results; not guaranteed.

**H4. Six overclaims or inconsistencies in the app's own text.** Fixed wording is in §3.

| # | Where | Current text | Problem |
|---|---|---|---|
| a | `src/judge.html:56` | "Travel time, congestion…, distance, **road condition, toll** and capacity violations are combined into one score" | The objective has **no** road-condition or toll terms. The actual terms are distance, route time, capacity overload, lateness and extra vehicles (`evaluateTourSequence`) |
| b | `src/results.html:287` | "Optimal Departure Window … **Guarantees arrival by** …" | It's an estimate from travel time; nothing is guaranteed |
| c | `src/results.html:59, 61, 130` | "MULTI-OBJECTIVE PARETO ROUTING", "Analyzing multi-objective Pareto frontiers", "Pareto Frontier Multi-Objective Optimization" | The app ranks 2–3 OSRM/TomTom alternatives with a weighted score. No Pareto frontier is computed |
| d | `src/index.html:125` | "…while balancing **battery energy** and **green emergency corridors**" | The VRP objective has no energy or emergency-corridor terms. Energy is only reported, and the emergency profile is a speed factor |
| e | `src/i18n.js:38–41, 53, 62–65, 77, …` | Hindi, Telugu, Tamil and Marathi hero titles say "Quantum routing"; Hindi body says it balances traffic "in real time" | English says "Smarter routes. Calmer traffic." The other languages claim quantum (not quantum-*inspired*) and real-time balancing. That's inconsistent and overclaims |
| f | `src/index.html:92` | "Powered by Real OpenStreetMap Topology · Quantum-inspired QPSO, GA, ACO & BPR Traffic Formulations" | Mostly fine, but "OpenStreetMap topology" applies to driver routes only. The VRP lab uses straight-line × 1.28 distances unless live traffic is on |

- **Why it matters:** one false claim spotted by a judge damages trust in everything else, and accuracy is part of "professionalism".
- **Estimated gain:** about +3 on the "accuracy & consistency" section. The bigger effect is avoiding a credibility penalty.

**H5. Scalability stops at 50 stops.**
- **Why it matters:** objectives 1 and 4 say "large-scale" and "smart-city logistics". Fifty stops is small.
- **What to add:**
  - Run the same seeded benchmark at **n = 100 and n = 200**: 5 instances × 10 runs, evaluation budget `defaultEvaluationBudget` (capped at 20,000).
  - Report time per run, gap vs best found, and feasibility rate.
  - Add a runtime-vs-n chart.
  - In the report, state honestly how each algorithm scales.
- **Estimated gain:** objective 1 +10, objective 4 +20, scalability items +30–35. Overall about +3–4.

### MEDIUM impact

**M1. No exact VRP baseline beyond enumeration.**
- **What to add:** an exact solver for small CVRPTW instances (n ≤ 10–12). Use Google OR-Tools (Python), or a branch-and-bound in JS, and report the true optimum and QPSO's gap to it.
- **Then:** keep the label "exhaustive optimum over greedy-split tours" only for the existing enumerator.
- **Estimated gain:** about +1.5 overall.

**M2. Convergence analysis is curves only.**
- **What to add:** a table from the existing per-run histories:
  - evaluations needed to get within 5% and 1% of the best cost found;
  - the percentage of runs that reached that target;
  - median time to target.
- **Why it matters:** "faster convergence" is a stated objective, so it needs a number either way.
- **Estimated gain:** about +1 overall.

**M3. No formal significance test.**
- **Current method:** QPSO vs SA is called "within noise" using a 2-standard-error rule.
- **What to add:** a paired Wilcoxon signed-rank test over instances (n = 10). Report the p-value and say plainly what it does and doesn't show.
- **Estimated gain:** small, about +0.5, but it strengthens the benchmark's credibility.

**M4. Shortest path runs on a synthetic grid.**
- **What to add:** run QPSO-vs-Dijkstra on a real road subgraph: a small OSM extract of one Hyderabad ward, with BPR weights. Keep the synthetic grid as a controlled test.
- **Estimated gain:** about +0.5–1.

**M5. Congestion minimisation is per-route only.**
- **What to add:** turn the Road status traffic-assignment demo into a measured experiment on a small BPR network.
  - Report total system travel time for all-or-nothing assignment vs the QPSO assignment, with the same demand and capacities.
  - Label it simulated.
- **Estimated gain:** objective 2 +10, about +2 overall.

**M6. README screenshot is a placeholder** (`docs/screenshot-placeholder.svg`).
- **Fix:** replace it with real captures of Home, Results, Fleet VRP and Navigation.
- **Estimated gain:** small, but judges see it first.

### LOW impact

- **L1. Translations:** native speakers should review the hi, te, ta and mr strings (part of H4e).
- **L2. Old key-named file:** the stray file `bEIhXUUEKLJfNBrXDvVhnwWDPz747JSM` in the project's top-level folder has a name that looks like an old TomTom key. Delete it.
- **L3. TomTom key:** rotate it. It was pasted in chat once, and `.tomtom-key` must not be shared or committed.
- **L4. Naming:** the code says "Quantum-Behaved PSO" and the brief says "Quantum Particle Swarm Optimization". Use one name, for example "QPSO (quantum-behaved PSO)", everywhere.
- **L5. Security hygiene:** no Content-Security-Policy yet, and `npm audit` hasn't been run. Run `npm audit` before submitting.
- **L6. "Optimal" labels:** "Route A (Optimal)" (`plan.html:150`) and "Primary Corridor (Optimal)" (`routing.js:280`) appear when only one route exists. Use "Recommended route".

---

## 3. Improved text for the weak sections

**H4a: `judge.html`, "What the optimizer balances"**
> The fleet optimiser minimises one cost: total distance, plus 0.4 × total route time (including traffic delay from the BPR model or TomTom), plus heavy penalties for capacity overload, late arrivals and using more vehicles than the fleet has. QPSO searches for the set of routes with the lowest cost. The code is in `src/vrp-engine.js` and `src/vrp-extras.js`. Run `npm test` to check it.

**H4b: `results.html` departure banner**
> Suggested departure: leave by {time} to arrive around {arrive} (based on an estimated {N} min trip; traffic can change).

**H4c: `results.html` Pareto labels**
- "MULTI-OBJECTIVE PARETO ROUTING" → "Route comparison"
- "Analyzing multi-objective Pareto frontiers…" → "Comparing routes…"
- "Pareto Frontier Multi-Objective Optimization" + text → "How routes are compared": "Each route is scored on travel time, distance, signals and estimated CO₂. Your chosen preference decides which matters most."

**H4d: `index.html` feature card 03**
> **BPR congestion & fleet types:** travel times grow with road load using the Bureau of Public Roads (BPR) function. Fleet runs compare EV, cargo and bike profiles, and report energy use and estimated CO₂.

**H4e: `i18n.js` (meaning to translate; get a native speaker to check)**
- heroTitle / heroTitle2: "Smarter routes. / Calmer traffic."
- heroBody: "Q-FLOW finds the best route for you and spreads traffic across roads, so roads do not jam."
- findBtn: "Find routes"

**H3: Objective 3 wording for the report and slides**
> **QPSO vs classical algorithms (measured, held-out instances).** With equal evaluation budgets and 10 seeded runs per instance:
> - QPSO beats classical PSO, GA and ACO at every size tested.
> - At 8 and 20 stops it is statistically indistinguishable from simulated annealing, and it wins the most instances.
> - At 50 stops on capacity-tight fleets, simulated annealing is clearly better. QPSO's typical failure is an overloaded last vehicle, which is the focus of our next improvement.
> - Simulated annealing is also faster per run.
>
> We report these results as measured. All numbers are reproducible with `npm run bench`.

**Report abstract (draft)**
> Urban vehicle routing under congestion is an NP-hard optimisation problem. Q-FLOW is a software platform that models a city's road network as a weighted graph with BPR congestion or live TomTom travel times, and solves capacitated vehicle routing with time windows using a quantum-inspired particle swarm (QPSO) running on ordinary classical hardware. QPSO is benchmarked under equal evaluation budgets against genetic algorithms, ant colony optimisation, simulated annealing, classical PSO, the Clarke-Wright heuristic and an exhaustive solver, on held-out seeded instances. QPSO outperforms PSO, GA and ACO, and matches simulated annealing on small and medium instances, while simulated annealing is stronger at 50 customers. The platform includes live-traffic routing, real-GPS turn-by-turn navigation, dynamic re-planning, and an Android app, all covered by automated tests.

---

## 4. Demo video script (2–3 min)

1. **0:00–0:15 Problem:** congestion; VRP is NP-hard; why quantum-inspired.
2. **0:15–0:45 Fleet VRP:** pick 25 stops, run QPSO vs the other algorithms. Show the routes, the benchmark table, the feasibility flags and the convergence chart.
3. **0:45–1:10 Research lab:** the formulation, the exhaustive-optimum comparison, shortest path vs Dijkstra, and dynamic re-plan.
4. **1:10–1:40 Live traffic:** Home with TomTom traffic colours and real incidents; Road alerts.
5. **1:40–2:20 Phone:** plan a trip, start real-GPS navigation, take a wrong turn, show the automatic reroute and arrival.
6. **2:20–2:40 Honest results:** what QPSO wins, where SA is better, and what's next.

---

## 5. Estimated score after each improvement (estimates)

| After… | Requirements | Objectives | Deliverables | Overall |
|---|---:|---:|---:|---:|
| Now | 83% | 60% | 72% | **≈72%** |
| + H1 report, H2 slides & video | 83% | 60% | 92% | **≈78%** |
| + H5 scalability 100/200 | 85% | 68% | 94% | **≈82%** |
| + M1 exact solver | 87% | 68% | 96% | **≈84%** |
| + M2 convergence table, M3 significance test | 88% | 68% | 97% | **≈84–85%** |
| + M5 measured congestion experiment | 90% | 70% | 97% | **≈86%** |
| + H3 decoder experiment (only if it really improves the held-out results) | 90% | 75% | 97% | **≈87%** |

A realistic honest ceiling is about **85–88%**. Objective 3 can't reach 100% unless the measured results really show QPSO beating simulated annealing.

---

## 6. Final checklist before submitting

**Accuracy (do first; these are small text edits)**
- [ ] Fix `judge.html` objective text (no toll or road condition): H4a
- [ ] Replace "Guarantees arrival": H4b
- [ ] Replace the "Pareto frontier" wording: H4c
- [ ] Fix the Home feature card (battery / emergency corridors): H4d
- [ ] Fix the hi, te, ta and mr strings ("quantum-inspired", no "real time"): H4e, with native review
- [ ] Change "(Optimal)" labels to "Recommended": L6
- [ ] Use one QPSO name everywhere: L4

**Evidence**
- [ ] Run `npm test`; all tests pass
- [ ] Run `npm run bench`; results match `docs/results.md`
- [ ] Add the n = 100 and n = 200 scalability results: H5
- [ ] Add an exact-solver comparison for n ≤ 10–12: M1
- [ ] Add the convergence-speed table and the Wilcoxon test: M2, M3
- [ ] (Optional) Add the measured congestion experiment: M5

**Deliverables**
- [ ] Technical report (PDF) with the honest Objective 3 wording: H1, H3
- [ ] Slides (10–12): H2
- [ ] Demo video (2–3 min) plus an offline backup copy: H2
- [ ] Real screenshots in the README: M6

**Security & packaging**
- [ ] Delete the stray `bEIh…` file: L2
- [ ] Rotate the TomTom key; never share `.tomtom-key`: L3
- [ ] Run `npm audit` and fix what's reasonable: L5
- [ ] Rebuild the APK (`npm run android:apk`); check it says "OK to share"
- [ ] Test the APK on a phone: map, live traffic, navigation, reroute
