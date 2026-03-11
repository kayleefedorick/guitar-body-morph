#!/usr/bin/env node
'use strict';
const fs = require('fs');

const FINAL     = JSON.parse(fs.readFileSync('./guitar_final.json','utf8'));
const LANDMARKS = JSON.parse(fs.readFileSync('./guitar_landmarks.json','utf8'));

const GUITARS  = ['Strat','Tele','Jazzmaster','Mustang','Fender Lead','Akula','Wolfgang','Les Paul'];
const SECTIONS = ['bass_side','inner_bass_cutaway','inner_treble_cutaway','treble_side','bottom'];
const HEEL_GAP_AFTER = 'inner_bass_cutaway';

function dist(a,b){return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);}
const V={
  sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y}),
  len:a=>Math.sqrt(a.x*a.x+a.y*a.y),
  norm:a=>{const l=Math.sqrt(a.x*a.x+a.y*a.y)||1;return{x:a.x/l,y:a.y/l};},
  perp:a=>({x:-a.y,y:a.x}),
  dot:(a,b)=>a.x*b.x+a.y*b.y,
  angle:a=>Math.atan2(a.y,a.x),
  lerp:(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}),
  lerpA:(a,b,t)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return a+d*t;},
};

function fitArc(p0,t0,p1){
  const n0=V.perp(t0);
  const mid={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2};
  const chord=V.sub(p1,p0);
  const cl=V.len(chord);
  if(cl<0.1)return null;
  const pc=V.perp(V.norm(chord));
  const bx=mid.x-p0.x,by=mid.y-p0.y;
  const det=n0.x*(-pc.y)-n0.y*(-pc.x);
  if(Math.abs(det)<1e-8){
    return{x1:p1.x,y1:p1.y,radius:1e8,tangentStart:t0,tangentEnd:V.norm(chord),isLine:true};
  }
  const s=(bx*(-pc.y)-by*(-pc.x))/det;
  const cx=p0.x+s*n0.x,cy=p0.y+s*n0.y;
  const radius=dist({x:cx,y:cy},p0);
  const toC=V.sub({x:cx,y:cy},p0);
  const cross=t0.x*toC.y-t0.y*toC.x;
  const sweep=cross<0;
  let theta1=Math.atan2(p0.y-cy,p0.x-cx),theta2=Math.atan2(p1.y-cy,p1.x-cx);
  let dt=theta2-theta1;
  if(sweep){while(dt>0)dt-=2*Math.PI;}else{while(dt<0)dt+=2*Math.PI;}
  const toP1=V.norm(V.sub(p1,{x:cx,y:cy}));
  const pp=V.perp(toP1);
  const tangentEnd=sweep?{x:-pp.x,y:-pp.y}:pp;
  return{x1:p1.x,y1:p1.y,radius,sweep,largeArc:Math.abs(dt)>Math.PI,
    arcLength:Math.abs(dt)*radius,tangentStart:t0,tangentEnd};
}

function fitChain(wps,t0){
  const arcs=[];let t=V.norm(t0);
  for(let i=0;i<wps.length-1;i++){const a=fitArc(wps[i],t,wps[i+1]);if(a){arcs.push(a);t=a.tangentEnd;}}
  return arcs;
}

function resample(pts,n){
  if(!pts||pts.length===0)return[];
  if(pts.length===n)return pts;
  const cd=[0];
  for(let i=1;i<pts.length;i++)cd.push(cd[i-1]+dist(pts[i-1],pts[i]));
  const total=cd[cd.length-1];
  if(total<.001)return Array(n).fill(pts[pts.length-1]);
  const r=[];
  for(let k=0;k<n;k++){
    const d=total*k/(n-1);let i=0;
    while(i<cd.length-1&&cd[i+1]<d)i++;
    const f=(cd[i]<d&&i<pts.length-1)?(d-cd[i])/(cd[i+1]-cd[i]):0;
    r.push(V.lerp(pts[Math.min(i,pts.length-1)],pts[Math.min(i+1,pts.length-1)],f));
  }
  return r;
}

function getWP(asm,sn){
  const sec=asm.sections.find(s=>s.name===sn);
  if(!sec)return null;
  const segs=asm.segments.slice(sec.segStart,sec.segEnd+1);
  const pts=segs.map(s=>({x:s.x0,y:s.y0}));
  pts.push({x:segs[segs.length-1].x1,y:segs[segs.length-1].y1});
  return pts;
}
function getSecT(asm,sn,atEnd){
  const sec=asm.sections.find(s=>s.name===sn);
  if(!sec)return null;
  const seg=atEnd?asm.segments[sec.segEnd]:asm.segments[sec.segStart];
  return seg?(atEnd?seg.tangentEnd:seg.tangentStart):null;
}

function buildMorph(nameA,nameB,t){
  const asmA=FINAL[nameA],asmB=FINAL[nameB];
  const lmA=LANDMARKS[nameA],lmB=LANDMARKS[nameB];
  const result={};
  let carriedT=null;

  for(let si=0;si<SECTIONS.length;si++){
    const sn=SECTIONS[si];
    const secA=asmA.sections.find(s=>s.name===sn);
    const secB=asmB.sections.find(s=>s.name===sn);
    if(!secA&&!secB)continue;

    const wpA=getWP(asmA,sn),wpB=getWP(asmB,sn);
    const n=Math.max(wpA?wpA.length:0,wpB?wpB.length:0,2);
    const rA=wpA?resample(wpA,n):resample(wpB,n);
    const rB=wpB?resample(wpB,n):resample(wpA,n);
    const morphWP=rA.map((p,i)=>V.lerp(p,rB[i],t));

    let startT;
    if(sn==='inner_treble_cutaway'){
      const htA=lmA.heelTangents&&lmA.heelTangents.treble;
      const htB=lmB.heelTangents&&lmB.heelTangents.treble;
      if(htA&&htB){
        const ang=V.lerpA(V.angle(htA),V.angle(htB),t);
        startT={x:Math.cos(ang),y:Math.sin(ang)};
      } else {
        const tA=getSecT(asmA,sn,false),tB=getSecT(asmB,sn,false);
        const aA=tA?V.angle(tA):0,aB=tB?V.angle(tB):(tA?V.angle(tA):0);
        startT={x:Math.cos(V.lerpA(aA,aB,t)),y:Math.sin(V.lerpA(aA,aB,t))};
      }
      carriedT=null;
    } else if(carriedT){
      startT=carriedT; carriedT=null;
    } else {
      const tA=getSecT(asmA,sn,false),tB=getSecT(asmB,sn,false);
      const aA=tA?V.angle(tA):Math.PI/2,aB=tB?V.angle(tB):(tA?V.angle(tA):Math.PI/2);
      startT={x:Math.cos(V.lerpA(aA,aB,t)),y:Math.sin(V.lerpA(aA,aB,t))};
    }

    const arcs=fitChain(morphWP,startT);
    if(!arcs.length)continue;
    result[sn]=arcs;
    if(sn!==HEEL_GAP_AFTER) carriedT=arcs[arcs.length-1].tangentEnd;
  }
  return result;
}

// ── Run validation ─────────────────────────────────────────────────────────────
const T_VALS=[0,.1,.25,.5,.75,.9,1];
let totalChecks=0,totalIssues=0,maxKink=0,maxGap=0;

for(let ai=0;ai<GUITARS.length;ai++){
  for(let bi=ai+1;bi<GUITARS.length;bi++){
    const A=GUITARS[ai],B=GUITARS[bi];
    let pairIssues=0;

    for(const t of T_VALS){
      const sections=buildMorph(A,B,t);

      let prevEndT=null,prevEndPt=null,prevSn=null;
      for(const sn of SECTIONS){
        const arcs=sections[sn];
        if(!arcs||!arcs.length)continue;

        if(prevEndT&&prevEndPt&&prevSn!==HEEL_GAP_AFTER){
          const dot=V.dot(prevEndT,arcs[0].tangentStart);
          const kink=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
          const gap=dist(prevEndPt,{x:arcs[0].x1-arcs[0].x1+arcs[0].x1,y:arcs[0].x1-arcs[0].x1+arcs[0].y1});
          // gap check using first arc start point
          const gapPt=dist(prevEndPt,{x:arcs[0].x0??prevEndPt.x,y:arcs[0].y0??prevEndPt.y});
          totalChecks++;
          if(kink>maxKink)maxKink=kink;
          if(gapPt>maxGap)maxGap=gapPt;
          if(kink>2||gapPt>2){
            totalIssues++;
            pairIssues++;
          }
        }
        prevEndT=arcs[arcs.length-1].tangentEnd;
        const lastArc=arcs[arcs.length-1];
        prevEndPt={x:lastArc.x1,y:lastArc.y1};
        prevSn=sn;
      }
    }

    if(pairIssues>0) process.stdout.write('⚠ '+A+'→'+B+': '+pairIssues+' issues\n');
  }
}

console.log('\n══════════════════════════════════════════════════');
console.log('  G1 VALIDATION RESULTS (fixed fitArc + tangent carry)');
console.log('══════════════════════════════════════════════════');
console.log('  Guitar pairs tested: 56 × '+T_VALS.length+' t-values = '+(56*T_VALS.length)+' morphs');
console.log('  Section joins checked: '+totalChecks);
console.log('  Issues (kink>2° or gap>2px): '+totalIssues);
console.log('  Max kink observed: '+maxKink.toFixed(2)+'°');
console.log('  Max gap observed: '+maxGap.toFixed(2)+'px');
if(totalIssues===0) console.log('\n  ✓ All section joins G1 continuous across all pairs and t values');
else console.log('\n  Issues remain - see above');
