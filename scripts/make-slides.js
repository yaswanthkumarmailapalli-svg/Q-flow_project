// Builds docs/Q-FLOW_SIH26137_Presentation.pptx with pptxgenjs (paths point at a scratch folder; adjust before re-running).
const pptxgen = require('/usr/local/lib/node_modules_global/lib/node_modules/pptxgenjs');
const sharp = require('/usr/local/lib/node_modules_global/lib/node_modules/sharp');
// Simple line icons (24x24 viewBox, white stroke), drawn for this deck.
const P = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const fa = {
  FaTrafficLight: P('<rect x="8" y="2" width="8" height="20" rx="2"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/>'),
  FaProjectDiagram: P('<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.5 6h9M6.2 8.2l4.6 7.6M17.8 8.2l-4.6 7.6"/>'),
  FaAtom: P('<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>'),
  FaSlidersH: P('<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="#0E6B5C"/><circle cx="16" cy="12" r="2" fill="#0E6B5C"/><circle cx="10" cy="18" r="2" fill="#0E6B5C"/>'),
  FaSatelliteDish: P('<path d="M4 10a8 8 0 0 0 10 10L4 10z"/><path d="M9 15l4-4"/><path d="M14 4a6 6 0 0 1 6 6M14 8a2 2 0 0 1 2 2"/>'),
  FaRoute: P('<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>'),
  FaCut: P('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6L20 18M8.6 16.4L20 6"/>'),
  FaSearch: P('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>'),
  FaSeedling: P('<path d="M12 22V11"/><path d="M12 11C12 6 8 4 3 4c0 5 3 7 9 7zM12 13c0-4 3-6 9-6 0 4-3 6-9 6z"/>'),
  FaBalanceScale: P('<path d="M12 3v18M7 21h10M4 7h16"/><path d="M6 7l-3 7a3 3 0 0 0 6 0L6 7zM18 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>'),
  FaTruck: P('<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  FaFlask: P('<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/><path d="M7 15h10"/>'),
  FaLocationArrow: P('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'),
  FaSyncAlt: P('<path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M21 4v5h-5M3 20v-5h5"/>'),
  FaCheckCircle: P('<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>')
};
const M = require('/tmp/rep/main.json'); const E = require('/tmp/rep/extra.json');
const C = { teal:'0E6B5C', dark:'0F2A25', ink:'1D2B28', muted:'4C5A56', tint:'E7EFEC', line:'C8D3CF', amber:'B86E00', white:'FFFFFF', grey:'8A9692', soft:'D8EEE8' };
async function icon(svg){ const buf=await sharp(Buffer.from(svg)).png().toBuffer(); return 'image/png;base64,'+buf.toString('base64'); }
(async()=>{
const pres=new pptxgen(); pres.layout='LAYOUT_16x9'; pres.title='Q-FLOW SIH26137';
const H='Arial', Bd='Calibri';
const title=(s,t,sub)=>{ s.addText(t,{x:0.5,y:0.32,w:9,h:0.6,fontFace:H,fontSize:28,bold:true,color:C.ink,margin:0,isTextBox:true}); if(sub) s.addText(sub,{x:0.5,y:0.9,w:9,h:0.35,fontFace:Bd,fontSize:13,color:C.muted,margin:0,isTextBox:true}); };
const foot=(s,n)=>s.addText(`Q-FLOW · SIH26137   ${n}`,{x:0.5,y:5.28,w:9,h:0.25,fontFace:Bd,fontSize:9,color:C.grey,align:'right',margin:0,isTextBox:true});
const circleIcon=async(s,Comp,x,y,d=0.55,bg=C.teal)=>{ s.addShape(pres.shapes.OVAL,{x,y,w:d,h:d,fill:{color:bg},line:{color:bg}}); s.addImage({data:await icon(Comp),x:x+d*0.22,y:y+d*0.22,w:d*0.56,h:d*0.56}); };
const card=(s,x,y,w,h,fill=C.tint)=>s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w,h,rectRadius:0.08,fill:{color:fill},line:{color:fill}});
let n=1;
// 1 Title
{ const s=pres.addSlide(); s.background={color:C.dark};
  s.addShape(pres.shapes.OVAL,{x:0.5,y:0.6,w:0.75,h:0.75,fill:{color:C.teal},line:{color:C.teal}}); s.addText('Q',{x:0.5,y:0.6,w:0.75,h:0.75,fontFace:H,fontSize:30,bold:true,color:C.white,align:'center',valign:'middle',margin:0,isTextBox:true});
  s.addText('Q-FLOW',{x:0.5,y:1.6,w:9,h:0.9,fontFace:H,fontSize:48,bold:true,color:C.white,margin:0,isTextBox:true});
  s.addText('Quantum-inspired metaheuristic optimisation for intelligent traffic routing',{x:0.5,y:2.5,w:8.5,h:0.8,fontFace:Bd,fontSize:20,color:'CFE7E1',margin:0,isTextBox:true});
  s.addText('Smart India Hackathon · Problem SIH26137',{x:0.5,y:3.55,w:8,h:0.4,fontFace:Bd,fontSize:14,color:'9FC9BF',margin:0,isTextBox:true});
  s.addText('Team: add team name and members',{x:0.5,y:4.6,w:8,h:0.4,fontFace:Bd,fontSize:12,italic:true,color:'9FC9BF',margin:0,isTextBox:true});
  s.addNotes('Introduce the team and the problem statement SIH26137.'); n++; }
// 2 Problem
{ const s=pres.addSlide(); s.background={color:C.white}; title(s,'The problem','Urban fleets must route many vehicles through congested roads, under tight constraints');
  const items=[[fa.FaTrafficLight,'Congestion','Travel times change with traffic load; a route that is short on a map can be slow at 6 pm.'],[fa.FaProjectDiagram,'NP-hard routing','Vehicle routing with capacity and time windows explodes combinatorially; exact methods only scale to small cases.'],[fa.FaAtom,'Quantum hardware is not ready','Quantum computers cannot yet run problems this size, so we use a quantum-inspired algorithm on classical CPUs.']];
  for(let i=0;i<3;i++){ const x=0.5+i*3.05; card(s,x,1.55,2.8,2.75); await circleIcon(s,items[i][0],x+0.3,1.8);
    s.addText(items[i][1],{x:x+0.3,y:2.55,w:2.3,h:0.45,fontFace:H,fontSize:16,bold:true,color:C.ink,margin:0,isTextBox:true});
    s.addText(items[i][2],{x:x+0.3,y:3.05,w:2.3,h:1.6,fontFace:Bd,fontSize:13,color:C.muted,margin:0,valign:'top',isTextBox:true}); }
  foot(s,n++); }
// 3 Solution / architecture
{ const s=pres.addSlide(); title(s,'Our solution','One platform: network model, QPSO optimiser, benchmarking, and a real driver app');
  s.addImage({path:'/tmp/rep/fig/arch.png',x:0.5,y:1.4,w:9,h:9*820/1800}); foot(s,n++); }
// 4 Model
{ const s=pres.addSlide(); title(s,'Network model and formulation','A weighted graph with travel-time and distance on every edge');
  card(s,0.5,1.45,4.4,3.45); s.addText('Objective (CVRPTW)',{x:0.75,y:1.6,w:4,h:0.4,fontFace:H,fontSize:15,bold:true,color:C.teal,margin:0,isTextBox:true});
  s.addText([{text:'F = Σ distance + 0.4 · Σ route time',options:{breakLine:true}},{text:'    + 1500 · capacity overload (kg)',options:{breakLine:true}},{text:'    + 20 · lateness (min)',options:{breakLine:true}},{text:'    + 10000 · extra vehicles'}],{x:0.75,y:2.05,w:4,h:1.35,fontFace:'Courier New',fontSize:12,color:C.ink,margin:0,isTextBox:true});
  s.addText('Constraints: vehicle capacity, customer time windows, depot closing time, fleet size. Every plan is flagged feasible or infeasible with the reason.',{x:0.75,y:3.5,w:3.95,h:1.2,fontFace:Bd,fontSize:12.5,color:C.muted,margin:0,valign:'top',isTextBox:true});
  const rows=[[fa.FaSlidersH,'Simulated traffic (BPR)','t = t₀ (1 + 0.15 (V/C)⁴) + incident delay; time-of-day and per-road variation'],[fa.FaSatelliteDish,'Live traffic (TomTom)','Real road distances and live travel times from TomTom Matrix Routing (verified)'],[fa.FaRoute,'Shortest path','Same weighted graph; QPSO compared with exact Dijkstra']];
  for(let i=0;i<3;i++){ const y=1.5+i*1.17; await circleIcon(s,rows[i][0],5.3,y,0.5); s.addText(rows[i][1],{x:6,y:y-0.02,w:3.5,h:0.35,fontFace:H,fontSize:14,bold:true,color:C.ink,margin:0,isTextBox:true}); s.addText(rows[i][2],{x:6,y:y+0.33,w:3.5,h:0.7,fontFace:Bd,fontSize:12,color:C.muted,margin:0,valign:'top',isTextBox:true}); }
  foot(s,n++); }
// 5 QPSO
{ const s=pres.addSlide(); title(s,'QPSO design','Quantum-behaved particle swarm (Sun, Feng & Xu 2004) plus problem-specific operators');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:0.5,y:1.45,w:9,h:0.95,rectRadius:0.08,fill:{color:C.dark},line:{color:C.dark}});
  s.addText([{text:'p = φ·pBest + (1−φ)·gBest        x ← p ± α·|mBest − x|·ln(1/u)',options:{breakLine:true,fontFace:'Courier New',fontSize:14,color:C.white}},{text:'Particles move in a "quantum potential well" around the attractor p; α falls from 0.95 to 0.50.',options:{fontFace:Bd,fontSize:12,color:'CFE7E1'}}],{x:0.75,y:1.52,w:8.5,h:0.8,margin:0,isTextBox:true});
  const it=[[fa.FaCut,'Optimal split decoder','Cuts each customer order into ≤ K routes at the cheapest break points (dynamic programming)'],[fa.FaSearch,'Local search','2-opt, or-opt and swap; Lamarckian, plus elite search on the global best'],[fa.FaSeedling,'Heuristic seeding','Time-window-aware constructive tours start 15% of the swarm'],[fa.FaBalanceScale,'Fair budget','All evaluations, including local search, count against the same budget']];
  for(let i=0;i<4;i++){ const x=0.5+(i%2)*4.6, y=2.65+Math.floor(i/2)*1.25; await circleIcon(s,it[i][0],x,y,0.5); s.addText(it[i][1],{x:x+0.7,y:y-0.03,w:3.7,h:0.35,fontFace:H,fontSize:14,bold:true,color:C.ink,margin:0,isTextBox:true}); s.addText(it[i][2],{x:x+0.7,y:y+0.32,w:3.7,h:0.75,fontFace:Bd,fontSize:12,color:C.muted,margin:0,valign:'top',isTextBox:true}); }
  foot(s,n++); }
// 6 Method
{ const s=pres.addSlide(); title(s,'How we benchmark','Built so that the results can be trusted and reproduced');
  const st=[['Equal budget','Every algorithm gets the same number of objective evaluations'],['10 seeded runs','Per instance; mean, median, spread and feasibility reported'],['Held-out instances','Tuned on seeds 101–110 only; tested on unseen seeds 1–10'],['Exact reference','At 8 customers: true optimum by enumeration + optimal split']];
  for(let i=0;i<4;i++){ const x=0.5+i*2.3; card(s,x,1.55,2.1,2.1); s.addText(st[i][0],{x:x+0.2,y:1.75,w:1.7,h:0.7,fontFace:H,fontSize:15,bold:true,color:C.teal,margin:0,valign:'top',isTextBox:true}); s.addText(st[i][1],{x:x+0.2,y:2.5,w:1.75,h:1.3,fontFace:Bd,fontSize:12.5,color:C.muted,margin:0,valign:'top',isTextBox:true}); }
  s.addText('Compared with: simulated annealing (also with the same split decoder, as a fairness check), genetic algorithm, ant colony, classical PSO, Clarke-Wright and an exact solver.',{x:0.5,y:3.95,w:9,h:0.7,fontFace:Bd,fontSize:13,color:C.ink,margin:0,isTextBox:true});
  foot(s,n++); }
// 7 Results small & medium
{ const s=pres.addSlide(); title(s,'Results: 8 and 20 customers','Held-out instances, mean gap (lower is better)');
  const keys=[['QPSO (optimal split decoder)','QPSO'],['SA with optimal split decoder (fairness check)','SA + split'],['SA','SA'],['GA','GA'],['PSO','PSO']];
  const mk=(T)=>[{name:'Mean gap %',labels:keys.map(k=>k[1]),values:keys.map(k=>T[k[0]].gap)}];
  const opt=(t,x)=>({x,y:1.4,w:3.6,h:3.2,barDir:'col',chartColors:[C.teal,C.grey,C.grey,C.grey,C.grey],showTitle:true,title:t,titleFontSize:12,titleColor:C.ink,showValue:true,dataLabelFontSize:9,dataLabelColor:C.ink,dataLabelFormatCode:'0.0"%"',catAxisLabelColor:C.muted,valAxisLabelColor:C.muted,valAxisLabelFontSize:9,catAxisLabelFontSize:9,valGridLine:{color:'E3E9E7',size:0.5},catGridLine:{style:'none'},showLegend:false,varyColors:true});
  s.addChart(pres.charts.BAR,mk(M.n8),opt('8 customers: gap vs exact optimum',0.4));
  s.addChart(pres.charts.BAR,mk(M.n20),opt('20 customers: gap vs best found',4.0));
  s.addText('0.1%',{x:7.75,y:1.5,w:1.9,h:0.6,fontFace:H,fontSize:34,bold:true,color:C.teal,margin:0,isTextBox:true}); s.addText('from the exact optimum at 8 customers; best on 9 of 10',{x:7.75,y:2.1,w:1.9,h:0.8,fontFace:Bd,fontSize:11,color:C.muted,margin:0,valign:'top',isTextBox:true});
  s.addText('8.9%',{x:7.75,y:3.0,w:1.9,h:0.6,fontFace:H,fontSize:34,bold:true,color:C.teal,margin:0,isTextBox:true}); s.addText('vs 18.0% for SA at 20 customers; wins 8 of 10 (> 2 SE)',{x:7.75,y:3.6,w:1.9,h:0.8,fontFace:Bd,fontSize:11,color:C.muted,margin:0,valign:'top',isTextBox:true});
  s.addText('SA + split = simulated annealing given the same decoder as QPSO.',{x:0.5,y:4.75,w:7,h:0.35,fontFace:Bd,fontSize:10.5,italic:true,color:C.muted,margin:0,isTextBox:true});
  foot(s,n++); }
// 8 Results large
{ const s=pres.addSlide(); title(s,'Results: 50 to 200 customers','Mean route cost of QPSO relative to SA (= 100) on instances that can be served');
  const cats=['50/s2','50/s3','50/s5','100/s1','100/s2','200/s1','200/s2'];
  const q=[1137,1459,1165,...E.scale['100'].QPSO.means.slice(0,2),...E.scale['200'].QPSO.means.slice(0,2)], a=[1404,1557,1378,...E.scale['100'].SA.means.slice(0,2),...E.scale['200'].SA.means.slice(0,2)];
  s.addChart(pres.charts.BAR,[{name:'SA',labels:cats,values:cats.map(()=>100)},{name:'QPSO',labels:cats,values:q.map((v,i)=>Math.round(v/a[i]*100))}],{x:0.4,y:1.35,w:5.6,h:3.4,barDir:'col',chartColors:[C.grey,C.teal],showValue:true,dataLabelFontSize:8,dataLabelColor:C.ink,showLegend:true,legendPos:'b',legendFontSize:10,catAxisLabelColor:C.muted,valAxisLabelColor:C.muted,catAxisLabelFontSize:9,valAxisLabelFontSize:9,valAxisMaxVal:110,valAxisMinVal:0,valGridLine:{color:'E3E9E7',size:0.5},catGridLine:{style:'none'}});
  card(s,6.3,1.45,3.2,3.3);
  s.addText([{text:'What it shows',options:{bold:true,color:C.teal,fontSize:14,breakLine:true}},{text:'QPSO is 6–23% cheaper than SA on every serviceable instance shown.',options:{bullet:true,breakLine:true}},{text:'50 customers overall: tie on mean gap (74.9% vs 73.7%); QPSO wins 3 of 5.',options:{bullet:true,breakLine:true}},{text:'Over-capacity instances (demand > fleet): SA leaves less overload.',options:{bullet:true,breakLine:true}},{text:'100/200 customers: 3 instances each, preliminary.',options:{bullet:true}}],{x:6.5,y:1.6,w:2.85,h:3.05,fontFace:Bd,fontSize:11.5,color:C.ink,margin:0,valign:'top',paraSpaceAfter:5,isTextBox:true});
  foot(s,n++); }
// 9 Convergence
{ const s=pres.addSlide(); title(s,'Convergence','QPSO keeps improving where simulated annealing stalls');
  s.addImage({path:'/tmp/rep/fig/conv.png',x:0.4,y:1.35,w:6.1,h:6.1*660/1800});
  const c=E.conv; s.addText(`${c.QPSO.hit5.toFixed(0)}%`,{x:6.9,y:1.35,w:2.6,h:0.65,fontFace:H,fontSize:36,bold:true,color:C.teal,margin:0,isTextBox:true});
  s.addText(`of QPSO runs get within 5% of the best known solution (SA: ${c.SA.hit5.toFixed(0)}%)`,{x:6.9,y:2.0,w:2.6,h:0.7,fontFace:Bd,fontSize:11.5,color:C.muted,margin:0,valign:'top',isTextBox:true});
  s.addText('3,000',{x:6.9,y:2.85,w:2.6,h:0.65,fontFace:H,fontSize:36,bold:true,color:C.teal,margin:0,isTextBox:true});
  s.addText('evaluations of QPSO beat 12,000 of SA at 20 customers (10.2% vs 15.3% gap)',{x:6.9,y:3.5,w:2.6,h:0.75,fontFace:Bd,fontSize:11.5,color:C.muted,margin:0,valign:'top',isTextBox:true});
  s.addText('Trade-off: QPSO is slower per run in wall-clock time (0.1 s vs 0.01 s at 20 customers; 12 s vs 0.3 s at 200).',{x:0.5,y:4.25,w:6,h:0.6,fontFace:Bd,fontSize:11.5,italic:true,color:C.amber,margin:0,isTextBox:true});
  foot(s,n++); }
// 10 Platform
{ const s=pres.addSlide(); title(s,'The platform','Web app and Android app, built on the same engine');
  const f=[[fa.FaTruck,'Fleet VRP','Pick stops on a Hyderabad map; compare 6 algorithms; feasibility and convergence'],[fa.FaFlask,'Research lab','Formulation, exact comparison, shortest path, dynamic re-planning'],[fa.FaTrafficLight,'Live traffic','TomTom traffic, incidents and live travel times (verified 6/6)'],[fa.FaLocationArrow,'Real-GPS navigation','Turn-by-turn, heading-up camera, automatic rerouting, voice, arrival'],[fa.FaSyncAlt,'Dynamic re-planning','QPSO warm start: a new plan is never worse than the old one'],[fa.FaCheckCircle,'Tested','20 automated test files; every number labelled live, estimated or simulated']];
  for(let i=0;i<6;i++){ const x=0.5+(i%3)*3.05, y=1.45+Math.floor(i/3)*1.75; card(s,x,y,2.85,1.55); await circleIcon(s,f[i][0],x+0.2,y+0.2,0.45); s.addText(f[i][1],{x:x+0.8,y:y+0.22,w:1.95,h:0.4,fontFace:H,fontSize:13.5,bold:true,color:C.ink,margin:0,isTextBox:true}); s.addText(f[i][2],{x:x+0.2,y:y+0.75,w:2.5,h:0.75,fontFace:Bd,fontSize:11,color:C.muted,margin:0,valign:'top',isTextBox:true}); }
  foot(s,n++); }
// 11 Limitations & next
{ const s=pres.addSlide(); title(s,'Honest limits and next steps');
  card(s,0.5,1.25,4.3,3.6,'FBF1E4'); s.addText('Limits today',{x:0.75,y:1.4,w:3.8,h:0.4,fontFace:H,fontSize:16,bold:true,color:C.amber,margin:0,isTextBox:true});
  s.addText([{text:'Slower per run than SA (quality per evaluation, not speed)',options:{bullet:true,breakLine:true}},{text:'Behind SA on over-capacity and the tightest 50+ customer fleets',options:{bullet:true,breakLine:true}},{text:'Exact solver up to 9 customers; no MILP yet',options:{bullet:true,breakLine:true}},{text:'100/200-customer results are preliminary',options:{bullet:true,breakLine:true}},{text:'Synthetic instances; lab uses straight-line distances unless live traffic is on',options:{bullet:true}}],{x:0.75,y:1.9,w:3.85,h:2.85,fontFace:Bd,fontSize:12,color:C.ink,margin:0,valign:'top',paraSpaceAfter:6,isTextBox:true});
  card(s,5.2,1.25,4.3,3.6); s.addText('Next steps',{x:5.45,y:1.4,w:3.8,h:0.4,fontFace:H,fontSize:16,bold:true,color:C.teal,margin:0,isTextBox:true});
  s.addText([{text:'Faster split decoder and Web Workers to cut run time',options:{bullet:true,breakLine:true}},{text:'Benchmark 100–500 customers on more instances, vs OR-Tools',options:{bullet:true,breakLine:true}},{text:'Adaptive capacity penalty for over-capacity fleets',options:{bullet:true,breakLine:true}},{text:'Pilot with real delivery data from a Hyderabad fleet',options:{bullet:true}}],{x:5.45,y:1.9,w:3.85,h:2.85,fontFace:Bd,fontSize:12,color:C.ink,margin:0,valign:'top',paraSpaceAfter:6,isTextBox:true});
  foot(s,n++); }
// 12 Close
{ const s=pres.addSlide(); s.background={color:C.dark};
  s.addText('Everything is reproducible',{x:0.5,y:0.45,w:9,h:0.6,fontFace:H,fontSize:28,bold:true,color:C.white,margin:0,isTextBox:true});
  const cmds=[['npm test','20 automated test files'],['npm run bench','Main benchmark (deterministic)'],['node scripts/extra-experiments.js','Convergence + scale'],['npm run android:apk','Android app build']];
  for(let i=0;i<4;i++){ const y=1.35+i*0.72; s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:0.5,y,w:5.4,h:0.58,rectRadius:0.06,fill:{color:'173F37'},line:{color:'173F37'}}); s.addText(cmds[i][0],{x:0.7,y,w:3.9,h:0.58,fontFace:'Courier New',fontSize:12,color:'CFE7E1',valign:'middle',margin:0,isTextBox:true}); s.addText(cmds[i][1],{x:4.6,y,w:1.25,h:0.58,fontFace:Bd,fontSize:10,color:'9FC9BF',valign:'middle',margin:0,isTextBox:true}); }
  s.addText([{text:'Deliverables',options:{bold:true,fontSize:15,color:C.white,breakLine:true}},{text:'Software platform (web + Android)',options:{bullet:true,breakLine:true}},{text:'QPSO framework + 5 baselines + exact',options:{bullet:true,breakLine:true}},{text:'Formulation, constraints, convergence',options:{bullet:true,breakLine:true}},{text:'Benchmark report + technical report',options:{bullet:true,breakLine:true}},{text:'This presentation; demo video',options:{bullet:true}}],{x:6.3,y:1.35,w:3.3,h:2.9,fontFace:Bd,fontSize:12,color:'CFE7E1',margin:0,valign:'top',paraSpaceAfter:5,isTextBox:true});
  s.addText('Thank you',{x:0.5,y:4.55,w:9,h:0.5,fontFace:H,fontSize:20,bold:true,color:'9FC9BF',margin:0,isTextBox:true}); }
await pres.writeFile({fileName:'/tmp/deck/Q-FLOW_SIH26137_Presentation.pptx'}); console.log('ok');
})();
