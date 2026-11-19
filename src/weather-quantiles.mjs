import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {NBM_OPEN_DATA,nbmStationBlocks,nbmNumber} from './nbm-station-guidance.mjs';
import {bracketBounds,studentTCdf} from './temperature-distribution.mjs';
const labels=['FHR','TXNMN','TXNSD','TXNP1','TXNP2','TXNP5','TXNP7','TXNP9','Q24P1','Q24P2','Q24P5','Q24P7','Q24P9','S24P1','S24P2','S24P5','S24P7','S24P9'];
function columns(line){
 const cells=[];
 for(const [i,day] of line.slice(6).split('|').entries()){
  const split=i===0?4:3;
  for(const raw of [day.slice(0,split),day.slice(split,split+4)]){
   cells.push(nbmNumber(raw));
  }
 }
 return cells;
}
export function parseNbpBulletin(text,stations){
 const out={};
 for(const {station,version,runtime,lines} of nbmStationBlocks(text,'NBP',stations)) {
  const block={};
  for(const line of lines) {
   const label=line.slice(0,6).trim();
   if(labels.includes(label))block[label]=columns(line);
  }
  const rows=[];
  for(const [index,hour] of (block.FHR??[]).entries()) {
   if(!Number.isFinite(hour))continue;
   rows.push({
    ftime:new Date(runtime+hour*3600000).toISOString(),
    mean:block.TXNMN?.[index]??null,
    spread:block.TXNSD?.[index]??null,
    temperature:[block.TXNP1?.[index],block.TXNP2?.[index],block.TXNP5?.[index],block.TXNP7?.[index],block.TXNP9?.[index]]
     .map(value=>Number.isFinite(value)&&Math.abs(value)<999?value:null),
    rainHundredths:[block.Q24P1?.[index],block.Q24P2?.[index],block.Q24P5?.[index],block.Q24P7?.[index],block.Q24P9?.[index]]
     .map(value=>value??null),
    snowTenths:[block.S24P1?.[index],block.S24P2?.[index],block.S24P5?.[index],block.S24P7?.[index],block.S24P9?.[index]]
     .map(value=>value??null),
   });
  }
  out[station]={station,version:version??null,runtime:new Date(runtime).toISOString(),rows};
 }
 return out;
}
export async function latestStationQuantiles({stations,cacheDir,now=Date.now(),fetchImpl=fetch}){
 await mkdir(cacheDir,{recursive:true});const hour=Math.floor(now/3600000)*3600000;
 for(let back=0;back<=24;back++){
  const run=new Date(hour-back*3600000);const h=run.getUTCHours();if(![0,1,7,12,13,19].includes(h))continue;
  const runtime=run.toISOString(),cached=join(cacheDir,`nbp-${runtime.slice(0,13)}.json`);
  let prior;try{const c=JSON.parse(await readFile(cached,'utf8'));if(c.runtime===runtime)prior=c;if(prior&&stations.every(s=>c.stations[s]))return c;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const hh=String(h).padStart(2,'0'),date=runtime.slice(0,10).replaceAll('-','');
  const source=`${NBM_OPEN_DATA}/blend.${date}/${hh}/text/blend_nbptx.t${hh}z`;
  const r=await fetchImpl(source,{signal:AbortSignal.timeout(45000)});if([403,404].includes(r.status))continue;if(!r.ok)throw new Error(`NBP ${r.status}: ${source}`);
  const parsed=parseNbpBulletin(await r.text(),stations);if(!Object.keys(parsed).length)continue;
  if(Object.values(parsed).some(s=>s.runtime!==runtime))throw new Error('NBP run/header mismatch');
  const record={runtime,source,stations:{...prior?.stations,...parsed}},temporary=cached+'.'+process.pid+'.tmp';
  await writeFile(temporary,JSON.stringify(record));await rename(temporary,cached);
  const files=(await readdir(cacheDir)).filter(n=>n.startsWith('nbp-')).sort();for(const stale of files.slice(0,Math.max(0,files.length-6)))await unlink(join(cacheDir,stale)).catch(()=>{});
  return record;
 }
 throw new Error('no probabilistic NBM station bulletin in the previous 24 hours');
}
/** Interpolate published quantiles; heavy outer tails are an explicit, unvalidated extrapolation. */
export function quantileCdf(x,q){
 if(q.length!==5||q.some(v=>!Number.isFinite(v))||q.some((v,i)=>i>0&&v<q[i-1]))throw new TypeError('five monotone temperature quantiles required');
 const probs=[.1,.25,.5,.75,.9];
 if(x===-Infinity)return 0;if(x===Infinity)return 1;
 if(x<q[0])return .2*studentTCdf((x-q[0])/Math.max(1,(q[2]-q[0])/1.28155),4);
 if(x>=q[4])return 1-.2*studentTCdf((q[4]-x)/Math.max(1,(q[4]-q[2])/1.28155),4);
 // Spread integer-valued quantiles by a half degree at ties to retain CDF continuity.
 const knots=q.map((v,i)=>v+(i-2)*.01);
 for(let i=1;i<5;i++)if(x<knots[i])return probs[i-1]+(probs[i]-probs[i-1])*Math.max(0,Math.min(1,(x-knots[i-1])/(knots[i]-knots[i-1])));
 return .9;
}
export function priceStationQuantiles(c,quantiles,now){
 const b=c.binding;if(!b||!['high','low'].includes(b.kind)||!quantiles||now-Date.parse(quantiles.runtime)>18*3600000||now<Date.parse(quantiles.runtime))return null;
 const target=Date.parse(b.targetDate+'T00:00:00Z')+(b.kind==='high'?24:12)*3600000;
 const row=quantiles.stations[b.station]?.rows.find(r=>Date.parse(r.ftime)===target);
 if(!row||row.temperature.some(v=>v===null))return null;
 const [lo,hi]=bracketBounds({strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike});
 try{return {id:`nbm-qmd-${b.kind}-v5-v1`,p:Math.max(0,Math.min(1,quantileCdf(hi,row.temperature)-quantileCdf(lo,row.temperature))),details:{source:quantiles.source,runtime:quantiles.runtime,ftime:row.ftime,quantiles:row.temperature,percentiles:[10,25,50,75,90],outerTails:'Student-t extrapolation, nu=4, not a published tail probability',proxy:b.proxy}};}catch{return null;}
}
