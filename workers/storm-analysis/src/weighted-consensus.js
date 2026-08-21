import { AGENCIES, selectWeightsForLead } from './model-repository.js';

const TRACK_VERSION = 'weighted-consensus-track/v1';
const IMPACT_VERSION = 'weighted-hk-impact/v1';
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_DISTANCE_BANDS_KM = Object.freeze([800, 500, 400, 300, 200, 100]);

function timeMs(value){if(value==null||value==='')return null;if(Number.isFinite(value))return value;const n=Date.parse(value);return Number.isFinite(n)?n:null;}
function iso(value){return Number.isFinite(value)?new Date(value).toISOString():null;}
function circularLongitude(items){const sin=items.reduce((s,x)=>s+Math.sin(x.lon*Math.PI/180)*x.weight,0);const cos=items.reduce((s,x)=>s+Math.cos(x.lon*Math.PI/180)*x.weight,0);return Math.atan2(sin,cos)*180/Math.PI;}

export function buildWeightedConsensusTrack(snapshot, model, impactEngine, options={}) {
  if (!impactEngine || typeof impactEngine.buildSourceTrack !== 'function' || typeof impactEngine.interpolateTrackAtTime !== 'function') throw new Error('AI-2 track helpers are required');
  const stepHours = Number(options.stepHours) > 0 ? Number(options.stepHours) : 3;
  const minimumAgencies = Math.max(2, Math.floor(Number(options.minimumAgencies) || 2));
  const tracks = Object.fromEntries(AGENCIES.map(agency => [agency, impactEngine.buildSourceTrack(snapshot?.sources?.[agency])]));
  const usable = AGENCIES.filter(agency => tracks[agency].length >= 2);
  const referenceBaseMs = timeMs(snapshot?.comparison?.referenceBaseTime)
    ?? Math.min(...usable.map(agency => tracks[agency][0].timeMs).filter(Number.isFinite));
  if (usable.length < minimumAgencies || !Number.isFinite(referenceBaseMs)) return {schemaVersion:TRACK_VERSION,modelVersion:model.modelVersion,stepHours,minimumAgencies,referenceBaseTime:iso(referenceBaseMs),points:[],available:false};
  const startMs = Math.max(referenceBaseMs, Math.min(...usable.map(agency => tracks[agency][0].timeMs)));
  const endMs = Math.max(...usable.map(agency => tracks[agency][tracks[agency].length-1].timeMs));
  const times=[]; const stepMs=stepHours*HOUR_MS;
  for(let t=startMs;t<=endMs;t+=stepMs)times.push(t);
  if(!times.length||times[times.length-1]!==endMs)times.push(endMs);
  const reference=snapshot.referencePoint||{};
  const points=times.map(t=>{
    const entries=usable.map(agency=>{const point=impactEngine.interpolateTrackAtTime(tracks[agency],t);return point?{agency,point}:null}).filter(Boolean);
    if(entries.length<minimumAgencies)return null;
    const leadHours=(t-referenceBaseMs)/HOUR_MS;
    const selection=selectWeightsForLead(model,leadHours);
    const weighted=entries.map(x=>({agency:x.agency,point:x.point,weight:Number(selection.weights[x.agency])||0})).filter(x=>x.weight>0);
    const sum=weighted.reduce((s,x)=>s+x.weight,0);
    if(!(sum>0)||weighted.length<minimumAgencies)return null;
    const normalized=weighted.map(x=>({...x,weight:x.weight/sum}));
    const lat=normalized.reduce((s,x)=>s+x.point.lat*x.weight,0);
    const lon=circularLongitude(normalized.map(x=>({lon:x.point.lon,weight:x.weight})));
    return {timeMs:t,time:iso(t),kind:'app-weighted-consensus',leadHours,bucketId:selection.bucketId,modelVersion:model.modelVersion,lat,lon,agencies:normalized.map(x=>x.agency),agencyCount:normalized.length,weights:Object.fromEntries(normalized.map(x=>[x.agency,x.weight])),distanceToHongKongKm:typeof impactEngine.haversineKm==='function'&&Number.isFinite(Number(reference.lat))&&Number.isFinite(Number(reference.lon))?impactEngine.haversineKm(Number(reference.lat),Number(reference.lon),lat,lon):null};
  }).filter(Boolean);
  return {schemaVersion:TRACK_VERSION,modelVersion:model.modelVersion,stepHours,minimumAgencies,referenceBaseTime:iso(referenceBaseMs),points,available:points.length>=2,semantics:{appComputed:true,weightsRenormalizedToAvailableAgencies:true,officialAgencyDataRemainSeparate:true}};
}

export function buildWeightedHongKongImpact(weightedTrack, referencePoint, impactEngine, options={}) {
  const points=Array.isArray(weightedTrack?.points)?weightedTrack.points:[];
  const bands=(Array.isArray(options.distanceBandsKm)&&options.distanceBandsKm.length?options.distanceBandsKm:DEFAULT_DISTANCE_BANDS_KM).map(Number).filter(x=>Number.isFinite(x)&&x>0).filter((x,i,a)=>a.indexOf(x)===i).sort((a,b)=>b-a);
  if(!points.length)return{schemaVersion:IMPACT_VERSION,sourceTrackVersion:weightedTrack?.schemaVersion??null,available:false,closestApproach:null,distanceBands:{}};
  const closestRaw=impactEngine.calculateContinuousNearest(points,referencePoint);
  const closest=closestRaw?{...closestRaw,method:closestRaw.method==='official-point'?'weighted-track-point-v1':closestRaw.method}:null;
  const distanceBands={};
  bands.forEach(thresholdKm=>{const intervals=impactEngine.calculateBandIntervals(points,thresholdKm,referencePoint);distanceBands[String(thresholdKm)]={thresholdKm,intervals,firstEntryTime:intervals[0]?.enterTime??null,lastExitTime:intervals.length?intervals[intervals.length-1].exitTime:null};});
  return{schemaVersion:IMPACT_VERSION,sourceTrackVersion:weightedTrack.schemaVersion,modelVersion:weightedTrack.modelVersion,available:true,closestApproach:closest?{...closest,appComputed:true,source:'champion-weighted-consensus-track-v1'}:null,distanceBands,semantics:{appComputed:true,continuousClosestApproach:true,crossingTimesInterpolated:true,warningSignalPredictionIncluded:false,aiGenerated:false}};
}

export {TRACK_VERSION,IMPACT_VERSION,DEFAULT_DISTANCE_BANDS_KM};
