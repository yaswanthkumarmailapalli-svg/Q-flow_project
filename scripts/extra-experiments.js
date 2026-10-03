// Extra experiments for the technical report: convergence speed (n=20) and scalability (n=100, 200).
// Held-out seeds only. Resumable: node scripts/extra-experiments.js [seconds]; run again until "done 60/60".
// Extra measurements for the report (held-out seeds only). Resumable cache per cell.
//  A) convergence speed at n=20 (seeds 1-10): evaluations for QPSO / SA / SA-split to get within 5% and 1% of the best cost found by any run.
//  B) scalability: n=100 and n=200, seeds 1-3, 5 runs, QPSO, SA, SA-split, GA, Clarke-Wright.
const fs=require('fs'),path=require('path'); const V=require(require('path').join(__dirname,'..','src','vrp-engine.js'));
const OUT=require('path').join(__dirname,'..','.bench-cache','extra'); fs.mkdirSync(OUT,{recursive:true}); const deadline=Date.now()+(+process.argv[2]||140)*1000;
const cells=[];
for(let s=1;s<=10;s++) for(const a of ['QPSO','SA','SA-split']) cells.push({kind:'conv',n:20,s,a,runs:5});
for(const n of [100,200]) for(let s=1;s<=3;s++) for(const a of ['QPSO','SA','SA-split','GA','CW']) cells.push({kind:'scale',n,s,a,runs:a==='CW'?1:5});
const fns={QPSO:(N,m,c,v,cfg)=>V.runQPSO(N,m,c,v,cfg),SA:(N,m,c,v,cfg)=>V.runSA(N,m,c,v,cfg),'SA-split':(N,m,c,v,cfg)=>V.runSA(N,m,c,v,Object.assign({decoder:'split'},cfg)),GA:(N,m,c,v,cfg)=>V.runGA(N,m,c,v,cfg),CW:(N,m,c,v)=>V.runClarkeWright(N,m,c,v)};
let done=0;
for(const c of cells){ const f=path.join(OUT,`${c.kind}-${c.a}-n${c.n}-s${c.s}.json`); if(fs.existsSync(f)){done++;continue;} if(Date.now()>deadline)break;
  const nodes=V.generateBenchmarkInstance(c.n,undefined,{seed:c.s}); const m=V.buildCostMatrix(nodes,1.4); const veh=Math.max(2,Math.ceil(c.n/6)); const budget=V.defaultEvaluationBudget(c.n);
  const pf=f+'.partial'; const runs=fs.existsSync(pf)?JSON.parse(fs.readFileSync(pf)):[];
  for(let r=runs.length;r<c.runs;r++){ if(Date.now()>deadline){fs.writeFileSync(pf,JSON.stringify(runs)); console.log(`paused in ${f} at run ${r}`); process.exit(0);}
    const res=fns[c.a](nodes,m,80,veh,{seed:c.s*1000+r,maxEvaluations:budget});
    runs.push({cost:res.bestCost,feasible:res.feasible,ms:res.executionTimeMs,conv:c.kind==='conv'?res.convergence:undefined,evals:c.kind==='conv'?res.convergenceEvals:undefined}); fs.writeFileSync(pf,JSON.stringify(runs)); }
  const demand=nodes.slice(1).reduce((a,x)=>a+x.demand,0);
  fs.writeFileSync(f,JSON.stringify({...c,veh,budget,util:demand/(veh*80),runs})); done++; }
console.log(`done ${done}/${cells.length}`);
