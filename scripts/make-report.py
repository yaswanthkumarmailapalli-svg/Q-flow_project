# Builds docs/Q-FLOW_Technical_Report.pdf from docs/results.md, docs/extra-results.md data and docs/figures (paths point at a scratch folder; adjust before re-running).
import json
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('DV','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DVI','/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('DV',normal='DV',bold='DVB',italic='DVI',boldItalic='DVB')
TEAL=colors.HexColor('#0E6B5C'); DARK=colors.HexColor('#1D2B28'); MUTED=colors.HexColor('#4C5A56'); TINT=colors.HexColor('#E7EFEC'); LINE=colors.HexColor('#C8D3CF')
ss=getSampleStyleSheet()
H1=ParagraphStyle('H1',fontName='DVB',fontSize=15,leading=19,textColor=TEAL,spaceBefore=14,spaceAfter=6)
H2=ParagraphStyle('H2',fontName='DVB',fontSize=11.5,leading=15,textColor=DARK,spaceBefore=10,spaceAfter=4)
B=ParagraphStyle('B',fontName='DV',fontSize=9.6,leading=14,textColor=DARK,spaceAfter=6)
SM=ParagraphStyle('SM',parent=B,fontSize=8.2,leading=11,textColor=MUTED)
CAP=ParagraphStyle('CAP',parent=B,fontSize=8.2,leading=11,textColor=MUTED,spaceBefore=2,spaceAfter=10)
BUL=ParagraphStyle('BUL',parent=B,leftIndent=12,bulletIndent=2,spaceAfter=3)
TC=ParagraphStyle('TC',fontName='DV',fontSize=8.2,leading=10.5,textColor=DARK)
TCB=ParagraphStyle('TCB',parent=TC,fontName='DVB')
M=json.load(open('/tmp/rep/main.json')); E=json.load(open('/tmp/rep/extra.json'))
def P(t,s=B): return Paragraph(t,s)
def bullets(items): return [Paragraph(i,BUL,bulletText='•') for i in items]
def tbl(rows,widths,head=True,hl=None):
    data=[[Paragraph(str(c),TCB if (head and r==0) else TC) for c in row] for r,row in enumerate(rows)]
    t=Table(data,colWidths=widths,repeatRows=1 if head else 0)
    st=[('GRID',(0,0),(-1,-1),0.4,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]
    if head: st.append(('BACKGROUND',(0,0),(-1,0),TINT))
    if hl is not None: st.append(('BACKGROUND',(0,hl),(-1,hl),colors.HexColor('#D8EEE8')))
    t.setStyle(TableStyle(st)); return t
def img(p,w): 
    from reportlab.lib.utils import ImageReader
    iw,ih=ImageReader(p).getSize(); return Image(p,width=w,height=w*ih/iw)
LBL={'QPSO (optimal split decoder)':'QPSO (optimal split decoder)','SA with optimal split decoder (fairness check)':'SA + optimal split (fairness check)','QPSO with greedy decoder (ablation)':'QPSO, greedy decoder (ablation)','SA':'Simulated annealing (SA)','QPSO-core (ablation: no local search / seeding)':'QPSO-core (ablation)','GA':'Genetic algorithm (GA)','PSO':'Classical PSO','ACO':'Ant colony (ACO)','Clarke-Wright (time-window-aware, 1 deterministic run)':'Clarke-Wright (1 run)'}
def restable(T):
    rows=[['Algorithm','Mean gap','Feasible runs','Lowest mean cost (instances)']]; hl=None
    for k,v in sorted(T.items(),key=lambda kv:kv[1]['gap']):
        rows.append([LBL.get(k,k),f"{v['gap']:,.1f}%",f"{v['feas']}%",str(v['wins'])])
        if k.startswith('QPSO (optimal'): hl=len(rows)-1
    return tbl(rows,[6.4*cm,2.6*cm,2.8*cm,4.4*cm],hl=hl)

def page(c,d):
    c.saveState(); c.setFont('DV',7.5); c.setFillColor(MUTED)
    c.drawString(2*cm,1.2*cm,'Q-FLOW · SIH26137 · Technical report'); c.drawRightString(A4[0]-2*cm,1.2*cm,f'Page {d.page}'); c.restoreState()
def cover(c,d):
    c.saveState(); c.setFillColor(TEAL); c.rect(0,A4[1]-9*cm,A4[0],9*cm,fill=1,stroke=0)
    c.setFillColor(colors.white); c.setFont('DVB',26); c.drawString(2*cm,A4[1]-4*cm,'Q-FLOW')
    c.setFont('DV',13); c.drawString(2*cm,A4[1]-5.1*cm,'Quantum-inspired metaheuristic optimisation')
    c.drawString(2*cm,A4[1]-5.8*cm,'for intelligent traffic routing')
    c.setFont('DV',10); c.drawString(2*cm,A4[1]-7.2*cm,'Technical report · Smart India Hackathon problem SIH26137 · October 2026')
    c.restoreState(); page(c,d)

doc=SimpleDocTemplate('/tmp/rep/Q-FLOW_Technical_Report.pdf',pagesize=A4,leftMargin=2*cm,rightMargin=2*cm,topMargin=1.8*cm,bottomMargin=1.8*cm,title='Q-FLOW Technical Report (SIH26137)',author='Q-FLOW team')
s=[Spacer(1,8.2*cm)]
s.append(P('<b>Team:</b> (add team name and members) &nbsp;&nbsp; <b>Platform:</b> web app + Android app (Capacitor) &nbsp;&nbsp; <b>Code:</b> qflow-v3',SM))
s.append(Spacer(1,6))
s.append(P('Abstract',H1))
s.append(P('Urban vehicle routing under congestion is an NP-hard combinatorial optimisation problem. Q-FLOW is a complete software platform that models a city road network as a weighted graph, with travel times from the Bureau of Public Roads (BPR) congestion model or from live TomTom traffic, and solves the capacitated vehicle routing problem with time windows (CVRPTW) using quantum-behaved particle swarm optimisation (QPSO), a quantum-inspired algorithm that runs on ordinary classical hardware. QPSO is combined with an optimal split decoder, local search and heuristic seeding, and is benchmarked under equal evaluation budgets on held-out, seeded instances against simulated annealing (SA), a genetic algorithm (GA), ant colony optimisation (ACO), classical PSO, the Clarke-Wright heuristic and an exact solver.'))
s.append(P(f"On held-out instances QPSO is within <b>0.1%</b> of the exact optimum at 8 customers (best on 9 of 10 instances), reaches a mean gap of <b>8.9%</b> against SA's 18.0% at 20 customers (clearly lower, more than two standard errors), ties SA on the mean at 50 customers while winning 3 of 5 instances, and has the lowest mean cost on 2 of 3 instances at 100 and 200 customers (preliminary). It is slower per run than SA in wall-clock time. The platform adds live-traffic routing, real-GPS turn-by-turn navigation with automatic rerouting, dynamic re-planning, and 20 automated test files. All results are reproducible with the commands in Section 10."))
s.append(PageBreak())

s.append(P('1. Problem and motivation',H1))
s.append(P('Indian cities face recurring congestion, inefficient route planning and high logistics costs. Delivery and service fleets must decide which vehicle visits which customers, in what order, within capacity limits and customer time windows, while travel times change with traffic. This is the vehicle routing problem (VRP), which is NP-hard: exact methods only scale to small instances, so practical systems use metaheuristics.'))
s.append(P('Quantum computers promise advantages for combinatorial optimisation, but current hardware cannot run problems of this size reliably. Quantum-inspired algorithms take ideas from quantum mechanics, here the delta-potential-well model behind QPSO, and run them on classical CPUs. SIH26137 asks for such a framework, modelled on a weighted graph, under real-time or simulated traffic, and benchmarked against conventional metaheuristics and exact methods.'))
s.append(P('2. System overview',H1))
s.append(img('/tmp/rep/fig/arch.png',16.5*cm)); s.append(P('Figure 1. Q-FLOW architecture. All optimisation runs on the device (browser or phone); external services provide maps, place search, OSRM/TomTom routing and live traffic.',CAP))
s+=bullets(['<b>Optimisation engine</b> (src/vrp-engine.js, src/vrp-extras.js): QPSO, GA, ACO, SA, PSO, Clarke-Wright, exact solver, Dijkstra and QPSO shortest path, dynamic re-planning.',
 '<b>Fleet VRP and Research lab pages</b>: interactive instances on a map of Hyderabad, benchmark tables, feasibility flags and convergence charts.',
 '<b>Driver app</b>: route comparison with live TomTom travel times, live incidents, and real-GPS turn-by-turn navigation with off-route detection, rerouting, voice guidance and arrival detection (web and Android).',
 '<b>Evidence</b>: seeded benchmark script (npm run bench), extra experiments, and 20 automated test files (npm test).'])

s.append(P('3. Network model (weighted graph)',H1))
s.append(P('Nodes are the depot (0) and customers 1..n. Each ordered pair (i, j) is an edge with two weights: distance d<sub>ij</sub> and travel time t<sub>ij</sub>. Two traffic sources are supported:'))
s+=bullets(['<b>Simulated (BPR):</b> d<sub>ij</sub> = 1.28 × haversine(i, j) and t<sub>ij</sub> = t<super>0</super><sub>ij</sub> (1 + 0.15 (V/C)<super>4</super>) + δ<sub>ij</sub>, with free-flow speed 40 km/h, V/C the volume-to-capacity ratio (optionally varying by time of day and per road) and δ<sub>ij</sub> an incident delay.',
 '<b>Live (TomTom):</b> d<sub>ij</sub> and t<sub>ij</sub> come from TomTom Matrix Routing with live traffic, on the real road network (verified with a working key: 9 of 9 matrix cells routed).'])
s.append(P('For the shortest-path problem the framework uses a weighted road graph with BPR edge costs, solved exactly by Dijkstra and heuristically by QPSO (Research lab §4).'))

s.append(P('4. Mathematical formulation (CVRPTW)',H1))
s.append(P('Each customer i has demand q<sub>i</sub>, a time window [e<sub>i</sub>, l<sub>i</sub>] and service time s<sub>i</sub>; the fleet has K vehicles of capacity Q; the depot closes at l<sub>0</sub>. A solution is a set of routes r<sub>1</sub>..r<sub>m</sub>, each starting and ending at the depot. The objective minimised by every algorithm is:'))
s.append(P('F = Σ<sub>k</sub> D<sub>k</sub> + 0.4 Σ<sub>k</sub> T<sub>k</sub> + 1500 Σ<sub>k</sub> max(0, L<sub>k</sub> − Q) + 20 Σ<sub>i</sub> max(0, a<sub>i</sub> − l<sub>i</sub>) + 10000 max(0, m − K)',ParagraphStyle('eq',parent=B,alignment=1,fontSize=10,backColor=TINT,borderPadding=6,spaceBefore=4,spaceAfter=10)))
s.append(P('D<sub>k</sub> is the road distance of route k, T<sub>k</sub> its completion time back at the depot (driving, waiting and service), L<sub>k</sub> its load, and a<sub>i</sub> the arrival time at customer i. Returning after the depot closes counts as lateness. Vehicles arriving early wait until e<sub>i</sub>.'))
s.append(P('<b>Constraint handling.</b> Capacity, time windows and fleet size are soft constraints with large penalty weights, so every algorithm can move through infeasible regions; each result is then checked and flagged as feasible or infeasible, with the violated constraint reported (kg over capacity, minutes late, extra vehicles). Inputs are validated before solving (coordinates, demands, time windows, capacity, fleet size and traffic values), and impossible instances are diagnosed, e.g. a stop heavier than one vehicle or total demand above fleet capacity.'))

s.append(P('5. Algorithms',H1))
s.append(P('5.1 QPSO (quantum-behaved particle swarm optimisation)',H2))
s.append(P('Each particle encodes a customer order as random keys (one real number per customer; sorting gives the order). The position update is the Sun, Feng and Xu (2004) delta-potential-well rule:'))
s.append(P('p = φ · pBest + (1 − φ) · gBest, &nbsp;&nbsp; x ← p ± α · |mBest − x| · ln(1/u), &nbsp;&nbsp; φ, u ~ U(0, 1)',ParagraphStyle('eq2',parent=B,alignment=1,backColor=TINT,borderPadding=6,spaceBefore=4,spaceAfter=10)))
s.append(P('mBest is the mean of all personal bests and α (contraction-expansion) falls from 0.95 to 0.50. Around this unchanged update, Q-FLOW adds:'))
s+=bullets(['<b>Optimal split decoder</b> (splitTourSequence): dynamic programming cuts each customer order into at most K routes at the cheapest break points, using the same objective F. For the same order it is never worse than the greedy split (tested on 900 random orders: better in 81%, equal otherwise).',
 '<b>Lamarckian local search</b> with 2-opt, or-opt and swap moves (probability 0.25 per particle, up to 2n evaluations), plus an <b>elite local search</b> on the global best each iteration (up to 10n evaluations).',
 '<b>Heuristic seeding</b>: 15% of the initial swarm from Clarke-Wright, nearest-neighbour, Solomon time-oriented nearest-neighbour and earliest-due-date tours.',
 'All local-search evaluations count against the same budget as every other algorithm.'])
s.append(P('5.2 Baselines',H2))
s+=bullets(['<b>Simulated annealing</b>: 2-opt and swap moves, geometric cooling. Also run with the optimal split decoder as a fairness check.',
 '<b>Genetic algorithm</b>: order crossover (OX) and 2-opt mutation. <b>ACO</b>: pheromone and heuristic visibility. <b>Classical PSO</b>: random keys with inertia.',
 '<b>Clarke-Wright</b>: savings heuristic with a time-window check on each merge (one deterministic run).',
 '<b>Exact solver</b>: enumerates every customer order (n ≤ 9) and cuts each with the optimal split decoder. Any plan with at most K routes, joined route by route, is one of those orders, so this gives the true optimum of F for at most K vehicles.'])

s.append(P('6. Experimental method',H1))
s+=bullets(['<b>Instances:</b> seeded random CVRPTW instances around Hyderabad (8, 20, 50 customers; 100 and 200 for scalability), vehicle capacity 80 kg, K = ⌈n/6⌉ vehicles (at least 2), BPR traffic level V/C = 1.4.',
 '<b>Equal budgets:</b> every stochastic algorithm gets the same number of objective evaluations, max(2000, min(20000, 300n)), fixed before any comparison.',
 '<b>Runs:</b> 10 independent seeded runs per instance (5 for the 100/200-customer study).',
 '<b>Tuning vs held-out:</b> QPSO settings were chosen on tuning seeds 101–110 and a separate capacity-tight tuning set (seeds 204, 205, 208–211). All results here use held-out seeds 1–10, never used for tuning.',
 '<b>Gap</b> = (mean cost − reference) / reference; the reference is the exact optimum at n = 8 and the best cost any method found otherwise. "Lowest mean cost" counts instances where the algorithm had the lowest mean among the metaheuristics.'])

s.append(PageBreak())
s.append(P('7. Results',H1))
s.append(img('/tmp/rep/fig/gap.png',16.5*cm)); s.append(P('Figure 2. Mean gap on held-out instances (lower is better).',CAP))
s.append(KeepTogether([P('7.1 Eight customers (gap vs exact optimum)',H2),restable(M['n8'])]))
s.append(P('QPSO is within 0.1% of the exact optimum and has the lowest mean cost on 9 of 10 instances. Paired by instance against SA with the same decoder, QPSO is lower on 9 of 10 (difference −0.4 points, standard error 0.1).',CAP))
s.append(KeepTogether([P('7.2 Twenty customers',H2),restable(M['n20'])]))
s.append(P('QPSO\'s mean gap is 8.9% against 18.0% for SA and 16.6% for SA with the same decoder; it is lower than SA-with-split on all 10 instances (−7.7 points, SE 1.6). The ablations show both parts matter: with the greedy decoder QPSO reaches 12.8%, and without local search and seeding 27.9%. The ranking is the same at half and double the budget.',CAP))
s.append(KeepTogether([P('7.3 Fifty customers',H2),restable(M['n50'])]))
s.append(P('The mean gaps of QPSO (74.9%) and SA (73.7%) tie; QPSO has the lowest mean cost on 3 of 5 instances and a much lower median gap (4.0% vs 22.5%). The large means come from two instances whose total demand exceeds the fleet\'s capacity (101% and 104%), which no algorithm can serve; there SA leaves less overload. On the three serviceable instances QPSO\'s mean cost is lower than SA\'s on all three (1,137 vs 1,404; 1,459 vs 1,557; 1,165 vs 1,378). Only 5 instances: too few for a significance call.',CAP))
s.append(KeepTogether([P('7.4 Scalability (preliminary)',H2),img('/tmp/rep/fig/large.png',16.5*cm),P('Figure 3. Mean cost of QPSO relative to SA on instances that can be served, from 50 to 200 customers.',CAP)]))
rows=[['n','K','Runs','QPSO lowest mean','QPSO cost vs SA (serviceable)','Feasible QPSO / SA','Time per run QPSO / SA']]
for n in ['100','200']:
    t=E['scale'][n]; q=t['QPSO']['means']; a=t['SA']['means']
    rows.append([n,str(t['veh']),'3 × 5 runs',f"{t['QPSO']['wins']} of 3",f"{(q[0]/a[0]-1)*100:+.0f}%, {(q[1]/a[1]-1)*100:+.0f}%",f"{t['QPSO']['feas']:.0f}% / {t['SA']['feas']:.0f}%",f"{t['QPSO']['ms']/1000:.1f} s / {t['SA']['ms']/1000:.2f} s"])
s.append(tbl(rows,[1.2*cm,1.1*cm,2.2*cm,2.8*cm,3.6*cm,2.8*cm,3.3*cm]))
s.append(P('At 100 and 200 customers QPSO has the lowest mean cost on 2 of 3 instances, 14–23% below SA. On the third instance at each size (104% and 99.9% fleet use) SA with the optimal split decoder is better. Three instances per size are too few for firm conclusions.',CAP))

s.append(KeepTogether([P('8. Convergence analysis',H1),img('/tmp/rep/fig/conv.png',16.5*cm)])); s.append(P('Figure 4. Convergence on two held-out 20-customer instances (median of 5 runs). Cost is shown as % above the best solution found by any run.',CAP))
c=E['conv']
s.append(tbl([['Algorithm (20 customers, 10 instances × 5 runs)','Runs within 5% of best','Median evaluations to 5%','Runs within 1% of best','Median evaluations to 1%','Time per run'],
 ['QPSO (optimal split decoder)',f"{c['QPSO']['hit5']:.0f}%",f"{c['QPSO']['med5']:,}",f"{c['QPSO']['hit1']:.0f}%",f"{c['QPSO']['med1']:,}",f"{c['QPSO']['ms']:.0f} ms"],
 ['Simulated annealing',f"{c['SA']['hit5']:.0f}%",f"{c['SA']['med5']:,}",f"{c['SA']['hit1']:.0f}%",f"{c['SA']['med1']:,}",f"{c['SA']['ms']:.0f} ms"],
 ['SA + optimal split',f"{c['SA-split']['hit5']:.0f}%",f"{c['SA-split']['med5']:,}",f"{c['SA-split']['hit1']:.0f}%",f"{c['SA-split']['med1']:,}",f"{c['SA-split']['ms']:.0f} ms"]],
 [5*cm,2.3*cm,2.4*cm,2.3*cm,2.4*cm,2.1*cm],hl=1))
s.append(P('QPSO reaches near-best solutions far more often (68% of runs within 5%, against 18% for SA). SA converges early but stalls in local optima; the runs of SA that do reach the target get there in fewer evaluations. With 3,000 evaluations QPSO (10.2% mean gap) is already better than SA with 12,000 (15.3%).',CAP))
s.append(KeepTogether([P('Computational cost',H2),img('/tmp/rep/fig/time.png',8.5*cm),P('Figure 5. Wall-clock time per run with the same evaluation budget. The optimal split decoder makes each QPSO evaluation more expensive, so QPSO is 10–45× slower per run than SA (under 0.2 s at 20 customers, about 12 s at 200). QPSO\'s advantage is solution quality per evaluation, not wall-clock speed.',CAP)]))

s.append(P('9. Platform features',H1))
s+=bullets(['<b>Live traffic (TomTom)</b>: traffic flow on maps, real incidents, live travel times and a live travel-time matrix for the fleet optimiser. Verified with a working key (6 of 6 service checks, e.g. 253 incidents parsed near Hyderabad). Without a key, all traffic is the labelled BPR simulation.',
 '<b>Real-GPS navigation</b>: continuous device location, route progress, next maneuver, ETA, heading-up camera, off-route detection with automatic rerouting from the latest position, voice guidance and arrival detection.',
 '<b>Dynamic re-planning</b>: QPSO warm-starts from the current plan when conditions change, so the new plan is never worse than keeping the old one.',
 '<b>Honest labelling</b>: every number in the app is marked as live, estimated or simulated.',
 '<b>Quality</b>: 20 automated test files (engine, constraints, navigation, live traffic with mocked responses, UI flows), input validation and offline-safe Android build.'])

s.append(P('10. Reproducibility',H1))
s.append(tbl([['Command','What it does'],['npm test','Runs all 20 test files'],['npm run bench','Re-creates the main benchmark (docs/results.md); deterministic'],['node scripts/extra-experiments.js','Convergence-speed and 100/200-customer runs (resumable; repeat until "done 60/60")'],['npm run tomtom:check','Checks a TomTom key against the six live services'],['npm run android:apk','Builds the Android app']],[5.5*cm,10.5*cm]))

s.append(P('11. Limitations',H1))
s+=bullets(['QPSO is slower per run than SA (Section 8). An equal-time comparison has not been done.',
 'At 50+ customers QPSO is behind SA on the most capacity-tight and over-capacity instances; the 100/200-customer results use only 3 instances each.',
 'The exact solver is limited to 9 customers. No MILP solver (e.g. OR-Tools) has been run on larger instances.',
 'The VRP lab uses straight-line × 1.28 distances unless live TomTom traffic is switched on. The shortest-path experiment uses a synthetic road grid.',
 'Network-wide congestion is reduced only through each route\'s cost; the system-level traffic assignment page is a labelled simulation.',
 'Benchmark instances are synthetic; real fleet data has not been tested.'])
s.append(P('12. Conclusion and next steps',H1))
s.append(P('Q-FLOW delivers the platform requested by SIH26137: a weighted-graph network model with simulated and live traffic, a formal CVRPTW formulation with explicit constraint handling, a quantum-inspired QPSO solver, systematic and reproducible benchmarking against five metaheuristics and an exact method, and convergence and scalability analysis. On held-out instances QPSO matches the exact optimum closely at small sizes and gives the best routes per evaluation at medium sizes, with honest limits at large, capacity-tight sizes and in run time.'))
s+=bullets(['Speed up the split decoder (incremental evaluation, Web Workers) to close the run-time gap.','Benchmark 100–500 customers on more instances and against OR-Tools.','Add an adaptive capacity penalty for over-capacity fleets.','Pilot with real delivery data from a Hyderabad fleet.'])
s.append(P('References',H2))
for r in ['Sun, J., Feng, B. and Xu, W. (2004). Particle swarm optimization with particles having quantum behavior. Proc. IEEE Congress on Evolutionary Computation.','Prins, C. (2004). A simple and effective evolutionary algorithm for the vehicle routing problem. Computers & Operations Research 31(12).','Clarke, G. and Wright, J. W. (1964). Scheduling of vehicles from a central depot to a number of delivery points. Operations Research 12(4).','Solomon, M. M. (1987). Algorithms for the vehicle routing and scheduling problems with time window constraints. Operations Research 35(2).','U.S. Bureau of Public Roads (1964). Traffic Assignment Manual.']:
    s.append(P(r,SM))
s.append(Spacer(1,6))
s.append(P('Appendix A. Delivery table (expected deliverables)',H1))
s.append(tbl([['Expected deliverable','Status','Where'],
 ['Complete software platform','Done','Web app (npm run web) and Android APK'],
 ['Quantum-inspired QPSO implementation','Done','src/vrp-engine.js (runQPSO)'],
 ['Graph-based network modelling','Done','Section 3; distance/time matrices, BPR, TomTom live matrix'],
 ['Mathematical formulation','Done','Section 4; Research lab §1'],
 ['Constraint handling','Done','Section 4; feasibility flags, validation, tests'],
 ['Convergence analysis','Done','Section 8; Fleet VRP and Research lab charts'],
 ['Benchmark vs conventional metaheuristics','Done','Section 7; BENCHMARK.md, docs/results.md'],
 ['Benchmark vs exact methods','Done (n ≤ 9)','Exact enumeration + optimal split; Dijkstra for shortest path'],
 ['Real-time / simulated traffic','Done','TomTom live (verified) and BPR simulation'],
 ['Scalability','Preliminary','Section 7.4; docs/extra-results.md'],
 ['Technical report','Done','This document'],
 ['Presentation','Done','Q-FLOW_SIH26137_Presentation.pptx'],
 ['Demo video','Script ready','Appendix B (to be recorded)']],[6*cm,2.6*cm,7.4*cm]))
s.append(P('Appendix B. Demo video script (about 2½ minutes)',H1))
for t in ['<b>0:00–0:15 Problem.</b> City congestion; vehicle routing is NP-hard; why a quantum-inspired algorithm on classical hardware.',
 '<b>0:15–0:50 Fleet VRP.</b> Choose 25 stops, run "QPSO vs metaheuristics". Show the routes on the map, the benchmark table, the feasibility flags and the convergence chart.',
 '<b>0:50–1:15 Research lab.</b> Formulation, exact-optimum comparison, shortest path vs Dijkstra, dynamic re-planning.',
 '<b>1:15–1:40 Live traffic.</b> Home map with TomTom traffic colours and incidents; Road alerts page.',
 '<b>1:40–2:20 Phone.</b> Plan a trip, start navigation from real GPS, take a wrong turn, show automatic rerouting and arrival.',
 '<b>2:20–2:40 Results.</b> QPSO 0.1% from optimum at 8 customers, 8.9% vs 18.0% at 20; limits at large, capacity-tight sizes and run time.']:
    s.append(P(t,BUL))
doc.build(s,onFirstPage=cover,onLaterPages=page)
print('pdf ok')
