# Q-FLOW demo video script (about 2½ minutes)

Record on a laptop (screen capture) and a phone (screen recording). Keep an offline copy for the presentation day.

| Time | Screen | What to show and say |
|---|---|---|
| 0:00–0:15 | Title / Home | "City fleets lose time and money to congestion. Routing many vehicles with capacity and time windows is NP-hard. Q-FLOW uses QPSO, a quantum-inspired algorithm that runs on ordinary hardware." |
| 0:15–0:50 | Fleet VRP | Choose 25 stops and press "Run QPSO vs Metaheuristics". Show the routes on the map, the benchmark table (QPSO vs SA, GA, ACO, PSO, Clarke-Wright), the Feasible / Infeasible flags and the convergence chart. |
| 0:50–1:15 | Research lab | §1 formulation, §2 comparison against the exact optimum, §4 QPSO vs Dijkstra shortest path, §5 dynamic re-planning (the new plan is never worse). |
| 1:15–1:40 | Home, Road alerts | TomTom live traffic colours and real incidents near Hyderabad; point out the "Live · TomTom" labels. |
| 1:40–2:20 | Phone | Plan a trip, press Start: the arrow is at the real GPS position. Drive or walk, take a wrong turn, show "Rerouting" and the new route from the current position, then "You have arrived". |
| 2:20–2:40 | Results slide | "On held-out instances QPSO is 0.1% from the exact optimum at 8 customers and 8.9% vs 18.0% for SA at 20. At larger, capacity-tight sizes and in run time it has limits, which we report openly. Everything is reproducible with npm test and npm run bench." |
