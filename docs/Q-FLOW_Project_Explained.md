# Q-FLOW, explained

This guide explains the whole project in plain language: what problem it solves, how it works inside, what we measured, what the app does, and how to answer the questions people usually ask. Every number here comes from the project's own measured results (`BENCHMARK.md`, `docs/results.md`, `docs/extra-results.md`).

---

## 1. The one-paragraph version

Q-FLOW is a route-planning platform for Indian cities, built for Smart India Hackathon problem SIH26137. It solves a hard planning question: how should a fleet of delivery vehicles visit many customers so that total travel distance and time are as small as possible, without overloading any vehicle, without arriving late, and while traffic changes travel times? It uses a **quantum-inspired** algorithm called **QPSO (Quantum-behaved Particle Swarm Optimisation)**, which borrows ideas from quantum physics but runs on ordinary computers and phones. We compared it fairly with five well-known algorithms and an exact solver. Around the algorithm we built a full web and Android app with live traffic and real GPS turn-by-turn navigation.

---

## 2. The problem we are solving

### 2.1 A simple example

Imagine a company in Hyderabad with **4 delivery vans**, each able to carry **80 kg**, and **20 customers** to visit today. Each customer:

- needs a certain amount of goods (for example 12 kg);
- can only receive the delivery during a **time window** (for example 10:00 to 11:30);
- takes a few minutes to serve.

All vans start from and return to a **depot** (warehouse), which closes at a fixed time. The company wants to decide:

1. which van visits which customers;
2. in what order;

so that the **total distance and driving time are as small as possible**, and **no van is overloaded, no customer gets a late delivery, and no more vans are used than the company has**.

This is called the **Vehicle Routing Problem with capacity and time windows (CVRPTW)**.

### 2.2 Why it is hard

The number of possible plans grows explosively. With just 20 customers, the number of possible orders to visit them is 20! (20 factorial), about **2.4 × 10¹⁸**. Even checking a billion plans per second would take about **77 years**. With 50 or 200 customers it is far worse. Mathematicians call this kind of problem **NP-hard**: no known method finds the guaranteed best answer quickly for large sizes.

So in practice we use **metaheuristics**: clever search methods that find very good (near-optimal) plans in a short time, without checking every possibility.

### 2.3 Why traffic matters

A route that is short on the map can be slow at 6 pm. Travel time depends on how busy each road is, so the system must use realistic travel times, simulated or live, rather than just distance.

---

## 3. Why "quantum-inspired"?

Quantum computers may one day help solve problems like this, but today's quantum hardware is too small and too error-prone to handle real routing problems of this size.

**Quantum-inspired algorithms** take ideas from quantum mechanics and use them inside normal classical programs. They run on any laptop or phone. Q-FLOW does **not** use a quantum computer. It uses a classical algorithm whose search behaviour is inspired by quantum physics.

---

## 4. The key ideas, explained simply

### 4.1 The road network as a weighted graph

Think of the city as a map of dots and lines:

- **dots (nodes)** = the depot and each customer;
- **lines (edges)** = the connection between any two dots;
- each line has **weights**: its **distance** (km) and its **travel time** (minutes).

This is a **weighted graph**. All the algorithms work on this graph.

Travel times come from one of two sources:

| Source | How travel time is calculated | When it is used |
|---|---|---|
| **Simulated traffic (BPR model)** | A standard formula from transport engineering (Bureau of Public Roads): travel time = free-flow time × (1 + 0.15 × (volume ÷ capacity)⁴), plus any incident delay. Busier roads get slower quickly. Can vary by time of day and by road. | Default, and in all benchmarks, so results are repeatable |
| **Live traffic (TomTom)** | Real road distances and current travel times from TomTom's traffic service | When a TomTom API key is configured (verified working) |

### 4.2 What "best" means: the objective function

Every algorithm tries to make one number, the **cost F**, as small as possible:

> **F = total distance + 0.4 × total route time + 1500 × kg overloaded + 20 × minutes late + 10000 × extra vehicles used**

- Distance and time are what we really want to reduce.
- The big numbers (1500, 20, 10000) are **penalties**. They make breaking a rule so expensive that the algorithm learns to avoid it.

This is called **constraint handling with penalties**. After solving, the app checks every plan and labels it **Feasible** (no rule broken) or **Infeasible**, and says exactly which rule was broken and by how much.

### 4.3 How Particle Swarm Optimisation works (the analogy)

Imagine a flock of birds searching a field for the spot with the most food:

- each bird (**particle**) is at some position, which here means a candidate plan;
- each bird remembers **the best spot it has personally found** (personal best);
- the flock shares **the best spot anyone has found** (global best);
- each bird moves partly towards its own best and partly towards the flock's best, while still exploring.

Over many rounds the flock gathers around very good solutions.

### 4.4 What makes it "quantum-behaved" (QPSO)

In normal PSO, each bird has a velocity, like a ball rolling. In **QPSO**, a particle has **no velocity**. Instead, like a quantum particle in a "potential well", its next position is **drawn at random** around an attraction point between its personal best and the global best:

> attraction point p = φ × personal best + (1 − φ) × global best
> new position = p ± α × |mean of all bests − current position| × ln(1/u)

where φ and u are random numbers between 0 and 1, and α is a setting that starts at 0.95 and shrinks to 0.50 during the run.

**Why this helps:**

- The **logarithm** term sometimes produces **long jumps**. These let a particle escape a poor local area, which gives strong global search (exploration).
- As α shrinks, the jumps get smaller, so the swarm **zooms in** on the best area (exploitation).
- The **mean of all bests** (mBest) keeps the whole swarm coordinated.

This update rule is from Sun, Feng and Xu (2004), and we use it unchanged.

### 4.5 Turning numbers into a delivery order (random keys)

A particle's position is a list of numbers, one per customer, for example [0.71, 0.12, 0.55, …]. Sorting customers by their number gives a **visiting order**: here customer 2 (0.12) comes first, then customer 3 (0.55), then customer 1 (0.71), and so on. This trick is called **random-key encoding**. It lets a "continuous" algorithm like QPSO search over orders.

### 4.6 Cutting the order into vans: the optimal split decoder (our key improvement)

An order of 20 customers still has to be **cut into separate van routes**.

- **The simple (greedy) way:** fill van 1 until the next customer doesn't fit, then start van 2, and so on. This wastes space, and when the vans run out, the last van gets overloaded, which is heavily penalised.
- **Our way, the optimal split decoder:** a dynamic-programming method (after Prins, 2004) checks **every possible place to cut** the order, with at most K vans, and picks the cuts that give the lowest total cost.

For the same order it is **never worse** than the greedy way. In 900 random tests it was better 81% of the time and equal otherwise. This was the single biggest improvement to QPSO's results.

### 4.7 Local search and smart starting points

- **Local search:** after a particle finds a plan, we try small changes and keep any that improve the cost. The changes are:
  - reversing a stretch of the route (2-opt);
  - moving a few customers elsewhere (or-opt);
  - swapping two customers.

  It's like a driver polishing a route by trying small changes.
- **Elite search:** each round, the best plan found so far gets a longer polish.
- **Seeding:** 15% of the swarm starts from good plans built by simple rules (for example "nearest customer next" and "earliest deadline first") instead of random ones.

All of this counts against the same "number of tries" budget as every other algorithm, so the comparison stays fair.

---

## 5. How we tested it fairly (the benchmark)

A result is only convincing if the test is fair. We designed it so that QPSO had **no unfair advantage**:

| Rule | What it means | Why it matters |
|---|---|---|
| **Equal budget** | Every algorithm gets the same number of cost evaluations (tries), e.g. 6,000 for 20 customers | No algorithm wins just by trying more plans |
| **10 repeated runs** | Each algorithm runs 10 times with different random seeds on each test case | Shows the average and the spread, not one lucky run |
| **Tuning vs held-out tests** | QPSO's settings were tuned only on separate tuning cases (seeds 101–110 and a separate tight-capacity set). The reported results use **different cases (seeds 1–10)** that were never used for tuning | Prevents "overfitting": settings that only work on the test data |
| **Exact reference** | For 8 customers, an exact solver checks all 40,320 orders and finds the **true best plan** | We can say exactly how far each algorithm is from perfect |
| **Fairness check** | Simulated annealing was also given QPSO's optimal split decoder | Shows QPSO's win is not only due to the decoder |
| **Reproducible** | Everything is seeded; `npm run bench` regenerates the same tables | Anyone can verify the results |

**What we compared against:**

- **Simulated annealing (SA):** accepts some worse moves early on, like cooling metal, to escape traps. It's the strongest baseline.
- **Genetic algorithm (GA):** combines and mutates plans, like evolution.
- **Ant colony optimisation (ACO):** artificial ants lay "pheromone" on good paths.
- **Classical PSO:** the original particle swarm, with velocities.
- **Clarke-Wright:** a classic quick rule that merges routes by distance saved. It runs once and is very fast.
- **Exact solver:** checks everything; only possible for small cases (up to 9 customers).

**How to read "gap":** gap = how much more expensive a plan is than the reference (the true optimum, or the best plan any method found). A gap of 0.1% means almost perfect.

---

## 6. The results, and what they mean

### 6.1 Small and medium problems: QPSO is clearly best

| Size | QPSO | Simulated annealing | SA with our decoder | Meaning |
|---|---|---|---|---|
| **8 customers** (vs true optimum) | **0.1%** gap; best on 9 of 10 cases | 1.4% | 0.5% | QPSO almost always finds the perfect plan |
| **20 customers** | **8.9%** gap; best on 8 of 10 cases | 18.0% | 16.6% | QPSO's plans average about half the excess cost of SA's; the difference is statistically clear (more than 2 standard errors) |

Other algorithms at 20 customers: GA 28.3%, classical PSO 36.9%, ACO 87.3%.

**Ablation results show both parts of QPSO matter.** At 20 customers, QPSO without the split decoder scores 12.8%, and QPSO without local search and seeding scores 27.9%.

### 6.2 Large problems: QPSO is competitive, with honest limits

- **50 customers:** QPSO and SA **tie** on average gap (74.9% vs 73.7%), and QPSO is best on 3 of 5 cases.
  - The big averages come from two test cases where **total demand is more than all vans can carry** (101% and 104% of capacity). No algorithm can serve them, and there SA leaves less overload.
  - On the three cases that **can** be served, QPSO's plans are cheaper than SA's on all three: 1,137 vs 1,404, 1,459 vs 1,557, and 1,165 vs 1,378.
- **100 and 200 customers (preliminary, 3 cases each):** QPSO is cheapest on 2 of 3 cases at both sizes, **14–23% cheaper than SA**. On the most capacity-tight case at each size, SA with our decoder does better.

### 6.3 Convergence: how quickly good plans are found

On 20-customer cases:

- **68% of QPSO runs** got within 5% of the best known plan, against **18% for SA**;
- **34% of QPSO runs** got within 1%, against **12% for SA**;
- QPSO with **3,000 tries** (10.2% gap) beat SA with **12,000 tries** (15.3% gap).

The convergence charts show SA improving fast at first and then **getting stuck**, while QPSO **keeps improving**. This is the "stronger global search" the problem statement asks for.

### 6.4 The honest trade-off: computing time

QPSO's smarter split decoder makes each try more expensive, so **QPSO takes longer per run**:

| Customers | QPSO | SA |
|---|---|---|
| 20 | 0.1 s | 0.01 s |
| 50 | 0.9 s | 0.05 s |
| 200 | 12 s | 0.3 s |

So QPSO gives **better plans for the same number of tries**, but not faster wall-clock time. For a delivery company planning routes once in the morning, a few seconds is acceptable. We state this openly rather than hiding it.

---

## 7. The application, page by page

Q-FLOW runs as a **website** and as an **Android app** (built with Capacitor). All optimisation runs **on the device**. External services provide maps, place search, routes and live traffic.

### For judges and researchers (Judge view)

| Page | What it shows |
|---|---|
| **Judge Hub** | A one-page tour, and a table stating which parts are real, live or simulated |
| **Fleet VRP** | Pick 10, 25 or 50 delivery stops on a Hyderabad map (or tap your own). Press "Run QPSO vs Metaheuristics": every algorithm runs 10 times. You see coloured routes per van, a benchmark table (gap, feasibility, wins), Feasible/Infeasible labels with reasons, a convergence chart and a plan summary. Traffic controls: congestion slider, departure time, per-road variation, incidents, or live TomTom traffic. A scalability test runs 10 → 25 → 50 customers |
| **Research Lab** | 1. the formulation; 2. statistical benchmark vs the exact optimum; 3. convergence analysis; 4. shortest path: QPSO vs Dijkstra (exact) on a congested road graph; 5. dynamic re-planning when traffic changes (the new plan is never worse than the old one) |
| **Road Status** | Live traffic colours and real incidents (with TomTom), plus a clearly labelled simulated traffic-assignment demo |
| **Road Alerts** | Real incidents near you (accidents, closures, jams, road works) with TomTom, plus simulated incident scenarios |

### For drivers (Driver view)

| Page | What it shows |
|---|---|
| **Home** | Map of your area with live traffic and incidents; your GPS location and its accuracy |
| **Plan** | Search a destination (or tap the map), add stops, choose a vehicle (car, EV, two-wheeler, emergency) and a preference (fastest, shortest, fewer signals, greenest) |
| **Results** | Up to 3 real road routes compared on time (with live traffic delay), distance, signals and estimated CO₂, with a plain-language explanation of why one route is recommended |
| **Navigation** | Real GPS turn-by-turn guidance: the map turns with your direction, shows the next turn and distance, remaining time and arrival time, gives voice instructions, detects when you leave the route and **automatically reroutes from where you are**, and announces arrival |

### How the navigation works inside

1. **LocationService** reads the phone's real GPS continuously, with accuracy, heading and speed.
2. **RoutingService** asks TomTom (traffic-aware, with turn instructions) for a road route, or OSRM as a backup.
3. **RouteProgress** snaps your position onto the route and computes remaining distance and time, the next turn, and arrival.
4. **Off-route detection** triggers a reroute only after you've clearly left the road for several readings and at least 4 seconds, so normal GPS wobble is ignored.
5. **NavigationCamera** follows you smoothly, rotating the map to your direction of travel.
6. **Voice:** each turn is announced at most three times (far, near and now), never repeated.

---

## 8. How the problem statement is covered

| SIH26137 asks for | Where it is in Q-FLOW |
|---|---|
| Quantum-inspired metaheuristic (QPSO) | `src/vrp-engine.js` (runQPSO), Fleet VRP page |
| Network modelled as a weighted graph | Distance/time matrices; BPR model; TomTom live matrix; road graph for shortest path |
| Real-time or simulated traffic | TomTom live traffic (verified) and BPR simulation |
| VRP and shortest-path problems | CVRPTW solver; QPSO vs Dijkstra shortest path |
| Minimise time, distance, congestion | Objective function; traffic-aware travel times |
| Benchmark vs conventional metaheuristics | SA, GA, ACO, PSO, Clarke-Wright, with equal budgets |
| Benchmark vs exact methods | Exact solver (true optimum up to 9 customers); Dijkstra |
| Mathematical formulation | Research Lab §1; technical report §4 |
| Constraint handling | Penalties + feasibility check + input validation |
| Convergence analysis | Convergence charts and convergence-speed table |
| Scalability | 8 → 200 customers (100/200 preliminary) |
| Complete software platform | Web app + Android app + 20 automated test files |

**Submission documents:**

- `docs/Q-FLOW_Technical_Report.pdf`
- `docs/Q-FLOW_SIH26137_Presentation.pptx`
- `docs/demo-video-script.md`

---

## 9. Technology used

| Part | Technology |
|---|---|
| App | HTML, CSS, JavaScript (no framework), Leaflet maps |
| Android | Capacitor 6, plus a small native Java plugin for voice and keep-screen-on |
| Maps and roads | OpenStreetMap, OSRM routing, Photon and Nominatim search |
| Live traffic | TomTom Traffic, Routing and Matrix Routing APIs |
| Optimisation | Our own JavaScript implementations of QPSO, SA, GA, ACO, PSO, Clarke-Wright, the exact solver and Dijkstra |
| Testing | Node.js automated tests (20 files): engine, constraints, navigation, live traffic (mocked), page flows |

---

## 10. Questions people often ask, and good answers

**"Does this use a quantum computer?"**
No. QPSO is quantum-*inspired*: it uses a search rule modelled on a quantum particle in a potential well, running on ordinary hardware. That's deliberate, because today's quantum hardware can't handle routing problems of this size.

**"Is QPSO better than the other algorithms?"**
At equal numbers of tries:

- **8 customers:** it's within 0.1% of the true optimum.
- **20 customers:** it's clearly the best (8.9% vs 18.0% for simulated annealing).
- **Larger sizes:** it ties or wins on most cases that can be served.

Its weaknesses are run time, and fleets that are overloaded or extremely tight on capacity. We report both openly.

**"Isn't the comparison biased towards your algorithm?"**
We designed it to avoid that:

- the same budget for every algorithm;
- 10 runs each;
- test cases never used for tuning;
- simulated annealing was also given our split decoder.

QPSO still won at 8 and 20 customers, and anyone can rerun everything with `npm run bench`.

**"Why is QPSO slower if it's better?"**
Each QPSO try uses the optimal split decoder, which does more work than the simple greedy cut. The result is better plans per try. For daily route planning, a few seconds is acceptable. Speeding it up is our next step.

**"Is the traffic real?"**
With a TomTom key, yes: live traffic colours, real incidents, live travel times and a live travel-time matrix, all verified working. Without a key, the app uses a standard simulated traffic model and labels it "Simulated". Benchmarks use the simulated model on purpose, so results are repeatable.

**"How do you handle the constraints?"**
Breaking a rule (overload, lateness, too many vans) adds a large penalty to the cost, so the algorithms steer away from it. Every final plan is then checked and labelled feasible or infeasible, with the exact reason.

**"How is your exact solver exact?"**
For up to 9 customers it tries every possible visiting order and cuts each one into van routes at the best possible points. Any valid plan corresponds to one of those orders, so the best result found is the true optimum for that fleet size.

**"Can it handle real cities at scale?"**
We've tested up to 200 customers (preliminary). For larger fleets, the next steps are:

- speeding up the decoder;
- testing more large cases and comparing with industrial solvers such as OR-Tools;
- a pilot with a real Hyderabad delivery fleet.

**"What makes your project different?"**
- A complete, working platform, not just an algorithm: a research lab plus a real navigation app with live traffic.
- Honest, reproducible benchmarking against both metaheuristics and an exact optimum.
- A measurable improvement to QPSO from the optimal split decoder.

---

## 11. Limitations and next steps

**Limitations today:**

- QPSO is slower per run than simulated annealing.
- On overloaded or extremely tight 50+ customer fleets, simulated annealing does better.
- The exact solver is limited to 9 customers.
- Results at 100 and 200 customers use only 3 cases each.
- Benchmark cases are synthetic, and the lab uses straight-line distances unless live traffic is on.
- Network-wide congestion is reduced only through each route's cost.

**Next steps:**

1. A faster split decoder and background processing, to cut run time.
2. Larger studies (100–500 customers) and comparison with OR-Tools.
3. An adaptive capacity penalty for overloaded fleets.
4. A pilot with real delivery data from a Hyderabad fleet.

---

## 12. Key numbers to remember

- **0.1%:** QPSO's gap from the true optimum at 8 customers (best on 9 of 10)
- **8.9% vs 18.0%:** QPSO vs simulated annealing at 20 customers (best on 8 of 10)
- **68% vs 18%:** share of runs reaching within 5% of the best known plan (QPSO vs SA)
- **14–23%:** how much cheaper QPSO's plans were than SA's on serviceable 100–200 customer cases (preliminary)
- **6 of 6:** live TomTom services verified working
- **20:** automated test files
- **1 command:** `npm run bench` reproduces the main results
