// Runs the real Fleet VRP page script (src/vrp.html) against a tiny fake DOM and a
// Leaflet stand-in, and drives the main user flows. Catches runtime errors and
// broken UI logic; it does not check layout or visuals. Node only.
console.log('--- Fleet VRP page flows (fake DOM) ---');
const vm=require('vm'),fs=require('fs'),path=require('path');
const SRC=path.join(__dirname,'..','src');
// ---- tiny fake DOM ----
function El(tag,id){this.tagName=(tag||'div').toUpperCase();this.id=id||'';this.children=[];this.attrs={};this.style={};this.dataset={};this._html='';this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.listeners={};
 const cls=new Set();this.classList={add:(...c)=>c.forEach(x=>cls.add(x)),remove:(...c)=>c.forEach(x=>cls.delete(x)),toggle:(c,f)=>{const on=f===undefined?!cls.has(c):f;on?cls.add(c):cls.delete(c);return on},contains:c=>cls.has(c)};
 Object.defineProperty(this,'className',{get:()=>[...cls].join(' '),set:v=>{cls.clear();String(v).split(/\s+/).filter(Boolean).forEach(x=>cls.add(x))}});}
El.prototype={get innerHTML(){return this._html},set innerHTML(v){this._html=String(v);this.children=[]},appendChild(c){this.children.push(c);return c},append(...c){c.forEach(x=>this.children.push(x))},prepend(c){this.children.unshift(c)},insertBefore(c){this.children.push(c);return c},remove(){},
 setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},removeAttribute(k){delete this.attrs[k]},addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f)},removeEventListener(){},
 querySelector(){return null},querySelectorAll(){return []},closest(){return null},contains(){return false},getBoundingClientRect(){return{left:0,top:0,right:300,bottom:40,width:300,height:40}},focus(){},scrollIntoView(){},getContext(){return new Proxy({},{get:(t,k)=>k==='canvas'?{}:typeof k==='string'&&k.startsWith('measure')?()=>({width:10}):()=>{} ,set:()=>true})},
 get clientWidth(){return 600},get clientHeight(){return 200},get parentElement(){return new El('div')},get firstChild(){return this.children[0]||new El('span')},get isConnected(){return true}};
const byId={};const getEl=id=>byId[id]||(byId[id]=new El('div',id));
const html=fs.readFileSync(path.join(SRC,'vrp.html'),'utf8');
// pre-create elements with ids from markup, with initial values for inputs
for(const m of html.matchAll(/<(input|select|button|div|span|canvas|table|tbody|b|section|p|h2|h3)\b([^>]*)>/g)){const id=(m[2].match(/\bid="([^"]+)"/)||[])[1];if(!id)continue;const e=getEl(id);e.tagName=m[1].toUpperCase();const v=(m[2].match(/\bvalue="([^"]*)"/)||[])[1];if(v!==undefined)e.value=v;if(/\bhidden\b/.test(m[2]))e.hidden=true;}
getEl('timeOfDaySelect').value='';
const choiceBtns=['10','25','50','custom'].map(sc=>{const b=new El('button');b.dataset.scale=sc;if(sc==='10')b.classList.add('active');return b});
const fleetBtns=['ev','cargo','rapid'].map(t=>{const b=new El('button');b.dataset.fleetType=t;return b});
const store=new Map();let confirmAnswer=true;const confirms=[];const toasts=[];const timers=[];
const document={documentElement:new El('html'),body:new El('body'),getElementById:getEl,createElement:t=>new El(t),
 querySelector:(s)=>s.includes('data-scale="custom"')?choiceBtns[3]:null,
 querySelectorAll:(s)=>s.includes('#instanceScaleChoices .choice')?choiceBtns:s.includes('#fleetVehicleGrid .vehicle-btn')?fleetBtns:s.includes('#benchTable tbody tr')?[]:[],addEventListener(){}};
let mapClick=null;
const L={map(){const m={setView(){return m},on(t,f){if(t==='click')mapClick=f;return m},addLayer(){return m},removeLayer(){return m},fitBounds(){return m},invalidateSize(){return m},eachLayer(){},getCenter(){return{lat:17.38,lng:78.48}}};return m},
 tileLayer(){return{addTo(){return this}}},control:Object.assign(()=>({addTo(){return this}}),{zoom:()=>({addTo(){return this}})}),
 polyline(){return{addTo(){return this},bindPopup(){return this},on(){return this}}},marker(){return{addTo(){return this},bindPopup(){return this}}},divIcon:o=>o,circleMarker(){return{addTo(){return this},bindPopup(){return this}}},
 DomUtil:{create:(t,c)=>{const e=new El(t);e.className=c||'';return e}},DomEvent:{disableClickPropagation(){}}};
const ctx={console,Math,JSON,Date,Object,Array,Number,String,Promise,Map,Set,Proxy,Symbol,Error,TypeError,RangeError,Float64Array,Uint32Array,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,
 document,L,performance,navigator:{onLine:true},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i]||null,get length(){return store.size}},
 setTimeout:(f)=>{timers.push(f);return timers.length},clearTimeout(){},setInterval(){},requestAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>'#888888',display:'block'}),
 CustomEvent:function(t,i){this.type=t;this.detail=i&&i.detail},addEventListener(){},dispatchEvent(){},confirm:(m)=>{confirms.push(m);return confirmAnswer},AudioContext:undefined,devicePixelRatio:1,innerWidth:1366,innerHeight:768,
 fetch:()=>Promise.reject(new Error('offline')),AbortController,URL,Blob:function(){},crypto:globalThis.crypto};
ctx.window=ctx;ctx.self=ctx;vm.createContext(ctx);
const mods=['safe-html.js','net.js','emissions.js','config.js','ui.js','i18n.js','location.js','geocode.js','routing.js','traffic-live.js','swarm-sim.js','map.js','trips.js','vrp-engine.js'];
for(const f of mods)vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),ctx,{filename:f});
vm.runInContext('qflowToast=(m,k)=>__toasts.push(k+": "+m)',Object.assign(ctx,{__toasts:toasts}));
const inline=(html.match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9)).filter(s=>!/Theme before first paint/.test(s)).join('\n;\n');
const flush=()=>{let n=0;while(timers.length&&n<50){timers.shift()();n++}};
const assert=require('assert');const passed=[];const ok=(c,msg)=>{assert.ok(c,msg);if(msg)passed.push(msg)};
vm.runInContext(inline+'\n;globalThis.__api={runBenchmark,markStale,renderRouteSummary,recomputeSelectedAlgorithm,get activeNodes(){return activeNodes},set activeNodes(v){activeNodes=v},get sel(){return selectedAlgoResult},get last(){return lastBenchmarkResult},get pins(){return customPinsAdded}};',ctx,{filename:'vrp-inline.js'});
const api=ctx.__api;
flush(); // initial runBenchmark() at load
ok(api.last && api.last.length===5, 'initial benchmark ran (5 result rows)');
ok(/Distance/.test(getEl('vrpSummary').innerHTML) && /Stops served/.test(getEl('vrpSummary').innerHTML), 'plan summary rendered: '+getEl('vrpSummary').innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,160));
ok(getEl('runBenchmarkBtn').disabled===false && !getEl('runBenchmarkBtn').attrs['aria-busy'], 'run button restored after the run');
ok(/Vehicle 1/.test(getEl('vrpVehicleLegend').innerHTML), 'vehicle legend rendered');
fleetBtns[1].onclick(); ok(true,'fleet type button no longer throws (recomputeSelectedAlgorithm)');
getEl('fleetSizeSlider').value='2'; getEl('fleetSizeSlider').onchange();
ok(/Settings changed \(fleet size\)/.test(getEl('vrpStatus').innerHTML) && /would cost/.test(getEl('vrpStatus').innerHTML) && !getEl('vrpStatus').hidden, 'stale notice + re-costed plan after changing fleet size');
getEl('timeOfDaySelect').value='540'; getEl('segmentVarToggle').checked=true; getEl('timeOfDaySelect').onchange();
ok(/departure time/.test(getEl('vrpStatus').innerHTML), 'departure-time change marks results stale');
api.runBenchmark(); ok(getEl('runBenchmarkBtn').disabled===true && getEl('runBenchmarkBtn').attrs['aria-busy']==='true', 'busy state shown before optimising');
flush(); ok(getEl('runBenchmarkBtn').disabled===false, 'busy state cleared');
const before=api.activeNodes.length;
for(let i=0;i<70;i++) mapClick({latlng:{lat:17.38+i*0.001,lng:78.48+i*0.001}});
ok(api.activeNodes.length-1===60, `map pins capped at 60 (had ${before-1}, now ${api.activeNodes.length-1})`);
ok(toasts.some(t=>/Up to 60 delivery stops/.test(t)), 'user told about the limit');
ok(/new stop\(s\) are not in the plan yet/.test(getEl('vrpStatus').innerHTML), 'stale notice mentions new stops');
confirmAnswer=false; getEl('resetPinsBtn').onclick(); ok(api.activeNodes.length-1===60 && confirms.length===1, 'reset asks first; cancelling keeps the stops');
confirmAnswer=true; getEl('resetPinsBtn').onclick(); flush(); ok(api.activeNodes.length-1===10 && api.pins===0, 'confirmed reset restores 10 generated stops');
api.activeNodes=[api.activeNodes[0]]; api.runBenchmark(); ok(/Add at least one delivery stop/.test(getEl('vrpStatus').innerHTML), 'empty instance: actionable message, no crash');

console.log('✓ '+passed.length+' Fleet VRP page checks: initial run, plan summary, busy state, stale notice + re-costing, fleet type, pin limit, reset confirmation, empty instance.');
