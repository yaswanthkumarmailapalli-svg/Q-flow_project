// Fleet VRP page with live traffic: the same fake DOM / Leaflet harness as test_vrp_page.js
// (copied below), plus a stored TomTom key and a mocked fetch that answers Matrix Routing v2
// requests. Checks the live path of src/vrp.html end to end without any network.
// Runs the real Fleet VRP page script (src/vrp.html) against a tiny fake DOM and a
// Leaflet stand-in, and drives the main user flows. Catches runtime errors and
// broken UI logic; it does not check layout or visuals. Node only.
console.log('--- Fleet VRP page with live traffic (fake DOM, mocked TomTom matrix) ---');
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
const store=new Map([['qflowTomTomKey','AbCdEfGhIjKlMnOpQrStUvWxYz012345']]);let confirmAnswer=true;const confirms=[];const toasts=[];const timers=[];
const document={documentElement:new El('html'),body:new El('body'),getElementById:getEl,createElement:t=>new El(t),
 querySelector:(s)=>s.includes('data-scale="custom"')?choiceBtns[3]:null,
 querySelectorAll:(s)=>s.includes('#instanceScaleChoices .choice')?choiceBtns:s.includes('#fleetVehicleGrid .vehicle-btn')?fleetBtns:s.includes('#benchTable tbody tr')?[]:[],addEventListener(){}};
let mapClick=null;
const L={map(){const m={setView(){return m},on(t,f){if(t==='click')mapClick=f;return m},addLayer(){return m},removeLayer(){return m},fitBounds(){return m},invalidateSize(){return m},eachLayer(){},getCenter(){return{lat:17.38,lng:78.48}}};return m},
 tileLayer(){return{addTo(){return this}}},control:Object.assign(()=>({addTo(){return this}}),{zoom:()=>({addTo(){return this}})}),
 polyline(){return{addTo(){return this},bindPopup(){return this},on(){return this}}},marker(){return{addTo(){return this},bindPopup(){return this}}},divIcon:o=>o,circleMarker(){return{addTo(){return this},bindPopup(){return this}}},
 DomUtil:{create:(t,c)=>{const e=new El(t);e.className=c||'';return e}},DomEvent:{disableClickPropagation(){}}};
const __fetches=[];const ctx={__fetches,console,Math,JSON,Date,Object,Array,Number,String,Promise,Map,Set,Proxy,Symbol,Error,TypeError,RangeError,Float64Array,Uint32Array,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,
 document,L,performance,navigator:{onLine:true},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i]||null,get length(){return store.size}},
 setTimeout:(f)=>{timers.push(f);return timers.length},clearTimeout(){},setInterval(){},requestAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>'#888888',display:'block'}),
 CustomEvent:function(t,i){this.type=t;this.detail=i&&i.detail},addEventListener(){},dispatchEvent(){},confirm:(m)=>{confirms.push(m);return confirmAnswer},AudioContext:undefined,devicePixelRatio:1,innerWidth:1366,innerHeight:768,
 fetch:(url,o)=>{__fetches.push({url,o});const b=JSON.parse(o.body);const data=[];b.origins.forEach((_,oi)=>b.destinations.forEach((__,di)=>data.push({originIndex:oi,destinationIndex:di,routeSummary:{lengthInMeters:2000,travelTimeInSeconds:300,trafficDelayInSeconds:60}})));return Promise.resolve({ok:true,status:200,headers:{get:()=>null},json:async()=>({data})})},AbortController,URL,Blob:function(){},crypto:globalThis.crypto};
ctx.window=ctx;ctx.self=ctx;vm.createContext(ctx);
const mods=['safe-html.js','net.js','emissions.js','config.js','ui.js','i18n.js','location.js','geocode.js','routing.js','traffic-live.js','swarm-sim.js','map.js','trips.js','vrp-engine.js'];
for(const f of mods)vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),ctx,{filename:f});
vm.runInContext('qflowToast=(m,k)=>__toasts.push(k+": "+m)',Object.assign(ctx,{__toasts:toasts}));
const inline=(html.match(/<script>([\s\S]*?)<\/script>/g)||[]).map(s=>s.slice(8,-9)).filter(s=>!/Theme before first paint/.test(s)).join('\n;\n');
const flush=()=>{let n=0;while(timers.length&&n<50){timers.shift()();n++}};
const assert=require('assert');const passed=[];const ok=(c,msg)=>{assert.ok(c,msg);if(msg)passed.push(msg)};
vm.runInContext(inline+'\n;globalThis.__api={runBenchmark,markStale,renderRouteSummary,recomputeSelectedAlgorithm,get activeNodes(){return activeNodes},set activeNodes(v){activeNodes=v},get sel(){return selectedAlgoResult},get last(){return lastBenchmarkResult},get pins(){return customPinsAdded}};',ctx,{filename:'vrp-inline.js'});

const api=ctx.__api;
(async()=>{
flush();
const tick=()=>new Promise(r=>setTimeout(r,0));
ok(getEl('liveTrafficRow').hidden===false,'live row shown with a key');
ok(api.last && /SIMULATED/.test(getEl('vrpDataBadge').textContent),'first run (toggle off) is simulated');
getEl('liveTrafficToggle').checked=true; getEl('liveTrafficToggle').onchange();
ok(getEl('trafficSlider').disabled===true,'simulated-only controls disabled in live mode');
ok(/live traffic on/.test(getEl('vrpStatus').innerHTML) && !/would cost/.test(getEl('vrpStatus').innerHTML),'stale notice without simulated re-costing');
api.runBenchmark();
ok(/from TomTom/.test(getEl('vrpStatus').innerHTML),'fetching status shown: '+getEl('vrpStatus').innerHTML);
for(let i=0;i<10;i++){await tick();}
flush();
ok(ctx.__fetches.length>=1,'matrix requested');
ok(/LIVE TRAFFIC \(TOMTOM\)/.test(getEl('vrpDataBadge').textContent),'badge live: '+getEl('vrpDataBadge').textContent);
ok(/Traffic delay \(live, TomTom\)/.test(getEl('vrpSummary').innerHTML),'summary label live');
ok(getEl('runBenchmarkBtn').disabled===false,'button restored');
const n=ctx.__fetches.length; api.runBenchmark(); for(let i=0;i<5;i++)await tick(); flush();
ok(ctx.__fetches.length===n,'second run reuses the live matrix (no new requests)');
console.log(`✓ ${passed.length} Fleet VRP live-traffic checks: key shows the switch, simulated-only controls disabled, TomTom matrix fetched (blocks of <= 100 cells), live badge and labels, matrix reused within 5 minutes.`);
})().catch(e=>{console.error(e);process.exit(1)});
