# Extra experiments (convergence speed and scalability)

Generated with `node scripts/extra-experiments.js` (repeat until it prints `done 60/60`). Held-out instance seeds only; budgets as in the main benchmark: 6,000 evaluations at n = 20, 20,000 at n = 100 and 200.

## Convergence speed, n = 20 (10 instances × 5 runs each)

Target = the best cost any run of these three algorithms found on that instance. "Reached" = share of runs whose best cost got within the target; "median evaluations" is over the runs that reached it.

| Algorithm | Reached within 5% | Median evaluations (5%) | Reached within 1% | Median evaluations (1%) | Time per run |
|---|---:|---:|---:|---:|---:|
| QPSO (optimal split decoder) | 68% | 1760 | 34% | 3120 | 104 ms |
| SA | 18% | 1481 | 12% | 1521 | 11 ms |
| SA with optimal split decoder | 12% | 1481 | 10% | 1521 | 97 ms |

QPSO reaches near-best solutions far more often, but each of its runs takes longer in wall-clock time.

## Scalability, n = 100 and n = 200 (preliminary: 3 instances × 5 runs)

### n = 100, 17 vehicles, 20,000 evaluations per run

Fleet use (total demand / fleet capacity) per instance: 97.1%, 95.9%, 104.0%.

| Algorithm | Mean cost per instance (seeds 1, 2, 3) | Gap vs best found | Feasible runs | Lowest mean | Time per run |
|---|---|---:|---:|---:|---:|
| QPSO (optimal split decoder) | 2,273, 2,356, 96,476 | 110.8% | 67% | 2/3 | 3.18 s |
| SA | 2,739, 2,737, 91,580 | 115.9% | 60% | 0/3 | 0.09 s |
| SA with optimal split decoder | 2,691, 2,769, 88,410 | 111.0% | 53% | 1/3 | 3.47 s |
| GA | 18,722, 7,491, 151,002 | 510.3% | 0% | 0/3 | 0.43 s |
| Clarke-Wright (1 run) | 12,150, 12,260, 22,496 | 290.9% | 0% | –/3 | 0.00 s |

### n = 200, 34 vehicles, 20,000 evaluations per run

Fleet use (total demand / fleet capacity) per instance: 97.8%, 97.9%, 99.9%.

| Algorithm | Mean cost per instance (seeds 1, 2, 3) | Gap vs best found | Feasible runs | Lowest mean | Time per run |
|---|---|---:|---:|---:|---:|
| QPSO (optimal split decoder) | 4,489, 4,565, 69,273 | 50.7% | 67% | 2/3 | 12.40 s |
| SA | 5,725, 5,914, 52,888 | 50.1% | 13% | 0/3 | 0.27 s |
| SA with optimal split decoder | 5,673, 6,034, 42,133 | 37.6% | 27% | 1/3 | 13.18 s |
| GA | 114,076, 123,489, 218,243 | 1925.2% | 0% | 0/3 | 1.46 s |
| Clarke-Wright (1 run) | 14,123, 14,343, 34,564 | 152.9% | 0% | –/3 | 0.03 s |

Reading: QPSO has the lowest mean cost on 2 of 3 instances at both sizes (14–23% below plain SA on those). On the third instance at each size (fleet use 104% at n = 100, 99.9% at n = 200), SA with the optimal split decoder leaves less overload. QPSO is 35–45× slower per run than plain SA at these sizes. Three instances are too few for a significance call; these results are preliminary.
