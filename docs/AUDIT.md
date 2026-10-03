# Q-FLOW audit — 1 October 2026

Scope: the brief for "QRoute" (SIH26137) was applied to this repository, qflow-v3. This repository has **no Python backend and no server API**: optimisation runs in the browser (`src/vrp-engine.js`, `src/vrp-extras.js`), driver routing calls public OpenStreetMap services directly (OSRM, Nominatim, Photon; see README "External services"), and the Android app is a Capacitor WebView wrapper around the same web app. Items in the brief that assume a backend are listed under "Not applicable".

Baseline before changes: `npm test` — 10 test files, 20 check groups, all passing (Node 22.23.2).

## Findings (highest priority first)

| # | Severity | Area | File(s) | Finding | Status |
|---|---|---|---|---|---|
| F1 | High | Bug | `src/vrp.html` | Fleet powertrain buttons (EV / Cargo / Rapid) call `recomputeSelectedAlgorithm()`, which is not defined anywhere. After the first benchmark (which runs on page load) every click throws a `ReferenceError` and the CO₂ column never updates. | Fixed |
| F2 | High | Optimisation | `src/vrp-engine.js` | Infeasible plans are returned silently: a stop heavier than any vehicle, or more demand than the fleet can carry, produces a "best" plan with capacity overload / lateness / extra vehicles and no flag. The UI presented such plans as the result. | Fixed (`feasible`, `violations`, feasibility rate) |
| F3 | High | Optimisation | `src/vrp-engine.js` | No input validation: `NaN` demand is silently ignored, `NaN` / negative traffic gives `NaN` travel times, capacity ≤ 0 and 0 vehicles are accepted and produce meaningless costs. | Fixed (`validateInstance`, structured errors) |
| F4 | High | Optimisation | `src/vrp-engine.js` | The depot's closing time (`dueTime`) is ignored: a vehicle returning hours after the depot closes is not penalised. | Fixed (return lateness counts as a time-window violation) |
| F18 | High | Optimisation | `src/vrp-engine.js` | Capacity overload was only counted on the last route. A stop heavier than a vehicle placed on any earlier route was not penalised, so QPSO, PSO, GA, ACO and SA returned "feasible" plans carrying 200 kg in an 80 kg vehicle (Clarke-Wright scored its routes separately and was correct). Found by the new regression test. | Fixed |
| F19 | Medium | Routing | `src/routing.js` | "Fastest (Min Time)", "Shortest Distance", "Fewer Signals" and "Greenest" were weighted blends with min-max normalisation, so "Fastest" could return a slower route (e.g. 21 min over 20 min when the 20-min route was worse on the other metrics). | Fixed (rank by the preference's own metric; score breaks ties; Balanced unchanged) |
| F20 | Medium | Performance | `src/vrp-engine.js` | Profiled: ACO spent ~96% of its time recomputing `Math.pow` terms per candidate per step (73 µs per evaluation vs 2.6 µs for the evaluation itself). | Fixed (precomputed; identical results for 15/15 seeded cases, 8.3x faster) |
| F5 | Medium | Optimisation | `src/vrp-engine.js` | GA and SA crash on an instance with no customers (`TypeError` reading `demand`), which also crashes `runFullBenchmark`. | Fixed (empty instances return an empty plan) |
| F6 | Medium | Optimisation | `src/vrp-extras.js` | Dynamic re-planning restarts QPSO from scratch, so the "re-plan" can be worse than keeping the old plan (1 of 15 seeded cases). | Fixed (warm start from the previous plan) |
| F7 | Medium | Performance / DoS | `src/vrp.html` | Map pins are unlimited and optimisation runs synchronously on the UI thread with no loading state; 400 stops took 9.3 s for ACO alone, freezing the page. | Fixed (stop limit, engine limit, loading state) |
| F8 | Medium | UX | `src/vrp.html` | Changing fleet size, capacity, traffic or incidents, or adding pins, leaves the previous results on screen as if current. "Clear / Re-center" discards custom pins without confirmation. | Fixed (stale-results notice + re-costing, confirmation) |
| F9 | Medium | Honesty | `src/network.html` | "Swarm Convergence (QPSO)" percentage is a random number between 78 and 99. | Fixed (computed from the swarm's actual spread) |
| F10 | Medium | Honesty | `src/incidents.html` | Scenario responses state invented outcomes ("3.4 minutes saved", "6 traffic signals preempted", "14 nearby vehicles alerted"). | Fixed (described as simulated scenarios, no invented numbers) |
| F11 | Medium | Honesty | `src/index.html` | Home "live metrics" are invented and tick on a timer (CO₂ avoided, 4,192 active nodes, "Optimal" latency). | Fixed (replaced by factual status: data sources, simulated traffic) |
| F12 | Medium | Honesty | several pages | Labels claim live data: "Live Network", "Real-time", "Live telemetry", "based on live grid density", "under live conditions", "Live re-routing". Traffic is simulated; OSRM durations are road-network speeds without live traffic. | Fixed (relabelled; data-source indicators added) |
| F13 | Medium | Model | `src/vrp-engine.js` | Simulated traffic is one uniform V/C value for the whole network; no time-of-day or per-road variation. Fleet VRP distances are straight-line × 1.28, not OSM roads, and this was not shown in the UI. | Fixed (time-of-day + per-segment simulated profile; data source shown) |
| F14 | Low | Benchmarks | `src/vrp-engine.js`, `scripts/compare-algorithms.js` | Benchmark summaries lack median and feasibility rate. | Fixed |
| F15 | Low | Location | `src/location.js` | Location accuracy is not reported; the IP-based fallback is not labelled as approximate. | Fixed |
| F16 | Low | Validation | `src/lab.html`, `src/network.html` | Numeric inputs (V/C ratios, minutes) are not validated; `NaN` or extreme values flow into the engine. | Fixed |
| F21 | Low | Security | `scripts/serve.js` | The dev server listened on all network interfaces (no host given). A malformed `%` escape in a URL crashed it, and the root check `startsWith(root)` also accepted sibling folders such as `src-x/`. | Fixed (127.0.0.1 by default, `HOST` to opt in; 400 on bad escapes; separator-aware root check) |
| F17 | Low | Security | all pages | No Content-Security-Policy; saved places / history / last location kept in `localStorage` with no way to clear them; `npm audit` could not be run in this environment (network blocked). | Partly fixed (clear-data control); CSP and audit documented as remaining |

## Not applicable to this repository

Python backend, API endpoints and their validation / status codes / timeouts, CORS, host binding, server request limits, Android-to-backend base URLs and local-network configuration, OSMnx road-network download and caching for optimisation, and "Weighted QPSO" (no such variant exists here; the implemented algorithms are QPSO, QPSO-core ablation, PSO, GA, ACO, SA, Clarke-Wright and an exact solver). The driver preferences closest to "Fastest / Shortest / Avoid Jams" are the existing Fastest / Shortest Distance / Fewer Signals / Greenest / Balanced options, which rank OSRM's real road alternatives (`qflowScoreRoutes` in `src/routing.js`).

## Verification after the changes

`npm test` exits 0. It now runs 12 test files and 31 ✓ check groups; the new files are `test/test_robustness.js` and `test/test_vrp_page.js`. No existing test was removed or weakened. `test_helpers.js` now also counts depot-return lateness and checks the `feasible` flag.

`npm run build:www` succeeds. `npm run bench` reran every instance on the changed engine. Each instance's mean cost per algorithm matches the earlier run to within 0.01%, so the conclusions in BENCHMARK.md are unchanged. The tables now include median and feasible-run columns.

The Android configuration was reviewed: no backend URLs, https scheme, no mixed content, no cleartext, `allowBackup=false`, and five permissions in the merged manifest. **No APK was built or tested** in this environment, because there is no Android SDK and the Gradle download is blocked.

Remaining work: a Content-Security-Policy, `npm audit` on a machine with registry access, moving optimisation to a Web Worker, and native review of the updated translations.
