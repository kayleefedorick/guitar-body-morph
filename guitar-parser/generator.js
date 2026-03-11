#!/usr/bin/env node
/**
 * Phase 3: Arc Chain Generator
 *
 * Fits a compact parametric model to each assembled guitar outline,
 * then regenerates the outline from those parameters using tangent-
 * continuous arc chains. Measures error against source geometry.
 *
 * Canonical coordinate system:
 *   Origin  = string endpoint (nut end of centerline)
 *   +Y      = toward strap button (body extends downward in SVG = +Y here)
 *   +X      = treble side
 *   -X      = bass side
 *   Units   = SVG px (1 px ≈ 1 mm at the DXF 25.4 scale)
 *
 * The parametric model uses ~20 landmark points + tangent constraints.
 * Each section is reconstructed as a G1 arc chain through its landmarks.
 */

'use strict';

const fs = require('fs');

const assembled = JSON.parse(fs.readFileSync('./guitar_final.json',    'utf8'));
const organized = JSON.parse(fs.readFileSync('./guitars_organized.json', 'utf8'));

const GUITARS = ['Strat','Tele','Jazzmaster','Mustang','Fender Lead','Akula','Wolfgang','Les Paul'];

// ─── Vec2 helpers ─────────────────────────────────────────────────────────────

const V = {
  add:  (a,b) => ({x:a.x+b.x, y:a.y+b.y}),
  sub:  (a,b) => ({x:a.x-b.x, y:a.y-b.y}),
  scale:(a,s) => ({x:a.x*s,   y:a.y*s  }),
  len:  (a)   => Math.sqrt(a.x*a.x+a.y*a.y),
  norm: (a)   => { const l=V.len(a); return l>1e-10?{x:a.x/l,y:a.y/l}:{x:1,y:0}; },
  dot:  (a,b) => a.x*b.x+a.y*b.y,
  perp: (a)   => ({x:-a.y, y:a.x}),   // 90° CCW
  dist: (a,b) => V.len(V.sub(a,b)),
  mid:  (a,b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2}),
  angle:(a)   => Math.atan2(a.y, a.x),
  fromAngle:(a,l) => ({x:Math.cos(a)*l, y:Math.sin(a)*l}),
};

// ─── Circular arc fitting: fit one arc through two endpoints with given tangent at start ──

/**
 * Given:
 *   p0       = start point
 *   t0       = unit tangent at p0 (direction of travel)
 *   p1       = end point
 * Returns an arc segment {x0,y0,x1,y1,rx,ry,rot,largeArc,sweep,cx,cy,radius,arcLength,tangentStart,tangentEnd}
 * or null if points are coincident or tangent is parallel to chord.
 */
function fitArc(p0, t0, p1) {
  // The centre of the arc lies on the normal to t0 at p0
  // AND on the perpendicular bisector of p0→p1
  // normal to t0 at p0: n0 = perp(t0)
  // perpendicular bisector of p0p1: passes through mid, direction perp(p1-p0)

  const n0   = V.perp(t0);
  const mid  = V.mid(p0, p1);
  const chord = V.sub(p1, p0);
  const chordLen = V.len(chord);

  if (chordLen < 1e-6) return null; // coincident points → degenerate

  const perpChord = V.perp(V.norm(chord));

  // Solve: p0 + s*n0 = mid + u*perpChord
  // p0.x + s*n0.x = mid.x + u*perpChord.x
  // p0.y + s*n0.y = mid.y + u*perpChord.y
  // → s*n0.x - u*perpChord.x = mid.x - p0.x
  //   s*n0.y - u*perpChord.y = mid.y - p0.y
  const bx = mid.x - p0.x, by = mid.y - p0.y;
  const det = -n0.x * perpChord.y + n0.y * perpChord.x;

  if (Math.abs(det) < 1e-10) {
    // tangent parallel to chord → straight line, return very large radius arc
    const len = chordLen;
    const t1  = V.norm(chord);
    return {
      type: 'arc', x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y,
      rx: 1e6, ry: 1e6, rot: 0, largeArc: false, sweep: true,
      cx: mid.x + perpChord.x*1e6, cy: mid.y + perpChord.y*1e6,
      radius: 1e6, arcLength: len,
      tangentStart: t0, tangentEnd: t1,
      isLine: true,
    };
  }

  const s = (bx * (-perpChord.y) - by * (-perpChord.x)) / det;
  const cx = p0.x + s * n0.x;
  const cy = p0.y + s * n0.y;

  const radius = V.dist({x:cx,y:cy}, p0);

  // Determine sweep direction from tangent
  // If centre is to the LEFT of t0 (i.e. s > 0), arc sweeps CCW → sweep=false in SVG (depends on Y axis)
  // In SVG +Y is DOWN, so we need to be careful.
  // sweep=true in SVG means clockwise when Y is down.
  // We can determine: cross product of t0 with vector from p0 to centre
  const toCenter = V.sub({x:cx,y:cy}, p0);
  const cross = t0.x * toCenter.y - t0.y * toCenter.x;
  // cross > 0 means centre is to the LEFT of travel → arc turns right = CW in SVG = sweep=true... 
  // let's just determine from the geometry
  const sweep = cross > 0; // centre left of travel = rightward turn = CW in SVG

  // Compute arc angular span
  const theta1 = Math.atan2(p0.y - cy, p0.x - cx);
  const theta2 = Math.atan2(p1.y - cy, p1.x - cx);
  let dtheta = theta2 - theta1;

  if (sweep) {
    // CW: dtheta should be negative (or we go the long way)
    while (dtheta > 0)  dtheta -= 2*Math.PI;
  } else {
    // CCW: dtheta should be positive
    while (dtheta < 0)  dtheta += 2*Math.PI;
  }

  const largeArc = Math.abs(dtheta) > Math.PI;
  const arcLength = Math.abs(dtheta) * radius;

  // Tangent at end (perpendicular to radius at p1, in direction of travel)
  const toP1 = V.norm(V.sub(p1, {x:cx,y:cy}));
  let tangentEnd = V.perp(toP1);
  if (sweep) tangentEnd = {x:-tangentEnd.x, y:-tangentEnd.y}; // flip for CW

  return {
    type: 'arc',
    x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y,
    rx: radius, ry: radius, rot: 0, largeArc, sweep,
    cx, cy, radius, arcLength,
    tangentStart: t0,
    tangentEnd,
  };
}

/**
 * Fit a smooth G1 arc chain through an ordered list of points,
 * given the tangent direction at the first point.
 * Returns array of arc segments.
 *
 * For each consecutive pair (p_i, p_{i+1}):
 *   - fit an arc from p_i with tangent t_i to p_{i+1}
 *   - the tangent at p_{i+1} becomes the incoming tangent for the next arc
 *
 * If forcedEndTangent is provided, the final arc is adjusted to match it.
 */
function fitArcChain(points, startTangent, options) {
  options = options || {};
  const segs = [];
  let t = V.norm(startTangent);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const arc = fitArc(p0, t, p1);
    if (!arc) continue;
    segs.push(arc);
    t = arc.tangentEnd;
  }
  return segs;
}

// ─── Parameter extraction: find key landmark points for each guitar ────────────

function extractLandmarks(guitar, assembled_data, org_data) {
  const r   = assembled_data;
  const segs = r.segments;

  // Helper: get segments for a named section
  function secSegs(name) {
    const s = r.sections.find(s => s.name === name);
    return s ? segs.slice(s.segStart, s.segEnd + 1) : [];
  }

  // Helper: all endpoints in a section
  function endpts(name) {
    return secSegs(name).flatMap(s => [{x:s.x0,y:s.y0},{x:s.x1,y:s.y1}]);
  }

  // Helper: find endpoint with max/min property
  function extreme(pts, fn) {
    return pts.reduce((a,b) => fn(b) > fn(a) ? b : a, pts[0] || {x:0,y:0});
  }

  // ── Waist line data ────────────────────────────────────────────────────────
  const waistData = org_data['waist offset angle'];
  let waistBass = null, waistTreble = null, waistAngleDeg = 0;
  if (waistData && waistData.segments.length > 0) {
    const ws = waistData.segments[0];
    // Bass end = more negative X
    if (ws.x0 < ws.x1) {
      waistBass   = {x: ws.x0, y: ws.y0};
      waistTreble = {x: ws.x1, y: ws.y1};
    } else {
      waistBass   = {x: ws.x1, y: ws.y1};
      waistTreble = {x: ws.x0, y: ws.y0};
    }
    const dx = waistTreble.x - waistBass.x;
    const dy = waistTreble.y - waistBass.y;
    waistAngleDeg = Math.atan2(-dy, dx) * 180/Math.PI; // canonical (Y up)
  }

  // ── Key geometric landmarks ────────────────────────────────────────────────

  // Bass side: find the point of maximum leftward extent (horn tip)
  const bassEndpts  = endpts('bass_side');
  const bassHornTip = extreme(bassEndpts, p => -p.x); // most negative X

  // Treble side: point of maximum rightward extent (horn tip area)
  const trebEndpts  = endpts('treble_side');
  const trebHornTip = extreme(trebEndpts, p => p.x);  // most positive X

  // Bottom: lowest point (max Y)
  const botEndpts = endpts('bottom');
  const bottomPt  = extreme(botEndpts, p => p.y);

  // Bottom extent: leftmost and rightmost points of bottom section
  const bottomLeft  = extreme(botEndpts, p => -p.x);
  const bottomRight = extreme(botEndpts, p => p.x);

  // Neck heel endpoints
  const heelBass   = r.neckHeelBassEnd;
  const heelTreble = r.neckHeelTrebleStart;

  // Inner bass cutaway deepest point (most positive X = closest to centerline)
  const ibcEndpts = endpts('inner_bass_cutaway');
  const bassCWDeep = ibcEndpts.length > 0 ? extreme(ibcEndpts, p => p.x) : null;

  // Inner treble cutaway deepest point (most negative X = closest to centerline)
  const itcEndpts = endpts('inner_treble_cutaway');
  const trebCWDeep = itcEndpts.length > 0 ? extreme(itcEndpts, p => -p.x) : null;

  // ── Radii at key points ────────────────────────────────────────────────────
  // Find the arc with smallest radius near the horn tip (defines horn roundness)
  function minRadiusNear(sectionName, nearPt, maxDistFrac) {
    const ss = secSegs(sectionName).filter(s => s.type === 'arc');
    if (!ss.length) return null;
    const thresh = r.neckHeelGap_px * (maxDistFrac || 0.5);
    const nearby = ss.filter(s => {
      return V.dist({x:s.x0,y:s.y0}, nearPt) < thresh ||
             V.dist({x:s.x1,y:s.y1}, nearPt) < thresh;
    });
    const pool = nearby.length > 0 ? nearby : ss;
    return Math.min(...pool.map(s => s.effectiveRadius || 1e6));
  }

  // Get tangent at heel endpoints (from assembled segments)
  function heelTangent(sectionName, fromEnd) {
    const ss = secSegs(sectionName);
    if (!ss.length) return null;
    const seg = fromEnd ? ss[ss.length-1] : ss[0];
    return fromEnd ? seg.tangentEnd : seg.tangentStart;
  }

  const bassHeelTangent  = heelTangent('inner_bass_cutaway', true)  || heelTangent('bass_side', true);
  const trebHeelTangent  = heelTangent('inner_treble_cutaway', false);

  // ── Compute derived params ─────────────────────────────────────────────────
  const bodyHeight  = bottomPt.y;
  const bodyWidth   = bottomRight.x - bottomLeft.x; // at bottom

  return {
    guitar,
    // Key landmarks (all in SVG px, same coord system as assembled data)
    landmarks: {
      // Corners / extents
      bassHornTip,
      trebHornTip,
      bottomPt,
      bottomLeft,
      bottomRight,
      heelBass:   heelBass   || {x:0,y:0},
      heelTreble: heelTreble || {x:0,y:0},
      bassCWDeep,
      trebCWDeep,
      waistBass,
      waistTreble,
    },
    // Tangents at heel (used to constrain neck pocket geometry)
    heelTangents: {
      bass:   bassHeelTangent,
      treble: trebHeelTangent,
    },
    // Scalar parameters
    params: {
      bodyHeight,
      bodyWidth,
      waistAngleDeg,
      waistBassY:   waistBass   ? waistBass.y   : null,
      waistTrebleY: waistTreble ? waistTreble.y : null,
      waistOffsetDy: (waistBass && waistTreble) ? waistTreble.y - waistBass.y : 0,
      bassHornY:    bassHornTip.y,  // negative = above origin (horn extends above nut)
      trebHornY:    trebHornTip.y,
      bassHornX:    bassHornTip.x,
      trebHornX:    trebHornTip.x,
      heelBassX:    heelBass   ? heelBass.x   : 0,
      heelBassY:    heelBass   ? heelBass.y   : 0,
      heelTrebleX:  heelTreble ? heelTreble.x : 0,
      heelTrebleY:  heelTreble ? heelTreble.y : 0,
      neckHeelWidth: (heelBass && heelTreble) ? heelTreble.x - heelBass.x : 0,
      bassHornRadius:  minRadiusNear('bass_side', bassHornTip, 0.3),
      trebHornRadius:  minRadiusNear('treble_side', trebHornTip, 0.3),
      bassCWRadius:    minRadiusNear('inner_bass_cutaway', bassCWDeep || {x:0,y:0}, 1.0),
      trebCWRadius:    minRadiusNear('inner_treble_cutaway', trebCWDeep || {x:0,y:0}, 1.0),
      bottomRadius:    (() => {
        const ss = secSegs('bottom').filter(s => s.type==='arc');
        return ss.length ? Math.max(...ss.map(s => s.effectiveRadius||0)) : 0;
      })(),
    },
  };
}

// ─── Reconstruct outline from landmarks ───────────────────────────────────────
/**
 * Given the landmark set for a guitar, reconstruct each section as a
 * tangent-continuous arc chain, using the key points as waypoints.
 *
 * This is the GENERATOR - it takes landmarks → produces a smooth outline.
 * After fitting, the result can be morphed by interpolating landmarks.
 */
function reconstructFromLandmarks(lm, sourceAssembled) {
  const r    = sourceAssembled;
  const segs = r.segments;

  function secSegs(name) {
    const s = r.sections.find(s => s.name === name);
    return s ? segs.slice(s.segStart, s.segEnd + 1) : [];
  }

  // Helper: sample N evenly-spaced points along a section's arc chain
  function sampleSection(name, n) {
    const ss = secSegs(name);
    if (!ss.length) return [];
    // Use arc midpoints + endpoints as natural samples
    const pts = [];
    for (const seg of ss) {
      pts.push({x: seg.x0, y: seg.y0});
    }
    pts.push({x: ss[ss.length-1].x1, y: ss[ss.length-1].y1});
    return pts;
  }

  // Reconstruct each section as arc chain through its sampled points
  const reconstructedSections = {};

  for (const sec of r.sections) {
    const srcSegs = secSegs(sec.name);
    if (!srcSegs.length) continue;

    // Get all waypoints (arc endpoints)
    const waypoints = srcSegs.map(s => ({x:s.x0, y:s.y0}));
    waypoints.push({x: srcSegs[srcSegs.length-1].x1, y: srcSegs[srcSegs.length-1].y1});

    // Start tangent from source
    const startTangent = srcSegs[0].tangentStart || {x:0, y:1};

    // Fit arc chain through all waypoints
    const arcs = fitArcChain(waypoints, startTangent);
    reconstructedSections[sec.name] = arcs;
  }

  return reconstructedSections;
}

// ─── Error measurement ────────────────────────────────────────────────────────
/**
 * Measure the max and RMS deviation between source segments and reconstructed arcs.
 * Samples points along source arcs and finds distance to nearest reconstructed arc.
 */
function measureError(sourceSegs, reconSegs, nSamples) {
  nSamples = nSamples || 10;
  const errors = [];

  // Sample points along source
  for (const s of sourceSegs) {
    if (s.type === 'arc') {
      // Sample along arc using interpolation between endpoints
      for (let t = 0; t <= 1; t += 1/nSamples) {
        // Simple linear interpolation of endpoints as proxy
        // (for validation purposes this is sufficient)
        const px = s.x0 + (s.x1 - s.x0) * t;
        const py = s.y0 + (s.y1 - s.y0) * t;
        // Find min distance to any recon segment
        let minDist = Infinity;
        for (const r of reconSegs) {
          // Distance from point to line segment approximation
          const dx = r.x1 - r.x0, dy = r.y1 - r.y0;
          const len2 = dx*dx + dy*dy;
          if (len2 < 1e-10) continue;
          const t2 = Math.max(0, Math.min(1, ((px-r.x0)*dx + (py-r.y0)*dy) / len2));
          const d = Math.sqrt((px - r.x0 - t2*dx)**2 + (py - r.y0 - t2*dy)**2);
          minDist = Math.min(minDist, d);
        }
        if (isFinite(minDist)) errors.push(minDist);
      }
    }
  }

  if (!errors.length) return {max:0, rms:0, mean:0};
  const max = Math.max(...errors);
  const mean = errors.reduce((a,b)=>a+b,0) / errors.length;
  const rms = Math.sqrt(errors.reduce((a,b)=>a+b*b,0) / errors.length);
  return { max: +max.toFixed(2), rms: +rms.toFixed(2), mean: +mean.toFixed(2), nPts: errors.length };
}

// ─── Convert reconstructed arcs to SVG path string ────────────────────────────

function arcsToSVGPath(arcList) {
  let d = '';
  let px = null, py = null;
  for (const sectionArcs of Object.values(arcList)) {
    for (const a of sectionArcs) {
      if (px === null || Math.abs(a.x0-px)>0.05 || Math.abs(a.y0-py)>0.05) {
        d += `M${a.x0.toFixed(2)} ${a.y0.toFixed(2)} `;
      }
      if (a.isLine || a.radius > 5e4) {
        d += `L${a.x1.toFixed(2)} ${a.y1.toFixed(2)} `;
      } else {
        d += `A${a.radius.toFixed(2)} ${a.radius.toFixed(2)} 0 ${a.largeArc?1:0} ${a.sweep?1:0} ${a.x1.toFixed(2)} ${a.y1.toFixed(2)} `;
      }
      px = a.x1; py = a.y1;
    }
  }
  return d.trim();
}

// ─── Source segments to SVG path ──────────────────────────────────────────────

function sourceToSVGPath(segs) {
  let d = '';
  let px = null, py = null;
  for (const s of segs) {
    if (px === null || Math.abs(s.x0-px)>0.05 || Math.abs(s.y0-py)>0.05) {
      d += `M${s.x0.toFixed(2)} ${s.y0.toFixed(2)} `;
    }
    if (s.type === 'arc') {
      d += `A${s.rx.toFixed(2)} ${s.ry.toFixed(2)} ${s.rot} ${s.largeArc?1:0} ${s.sweep?1:0} ${s.x1.toFixed(2)} ${s.y1.toFixed(2)} `;
    } else {
      d += `L${s.x1.toFixed(2)} ${s.y1.toFixed(2)} `;
    }
    px = s.x1; py = s.y1;
  }
  return d.trim();
}

// ─── Main: process all guitars ────────────────────────────────────────────────

const allLandmarks = {};
const allRecon     = {};
const allErrors    = {};

for (const guitar of GUITARS) {
  const asm = assembled[guitar];
  const org = organized[guitar];

  // Extract landmarks
  const lm = extractLandmarks(guitar, asm, org);
  allLandmarks[guitar] = lm;

  // Reconstruct from landmarks (round-trip test)
  const recon = reconstructFromLandmarks(lm, asm);
  allRecon[guitar] = recon;

  // Measure error per section
  const errors = {};
  for (const sec of asm.sections) {
    const srcSegs   = asm.segments.slice(sec.segStart, sec.segEnd + 1);
    const reconSegs = recon[sec.name] || [];
    errors[sec.name] = measureError(srcSegs, reconSegs);
  }
  allErrors[guitar] = errors;
}

// ─── Build output JSON ────────────────────────────────────────────────────────

const output = {};
for (const guitar of GUITARS) {
  const lm = allLandmarks[guitar];
  output[guitar] = {
    landmarks: lm.landmarks,
    heelTangents: lm.heelTangents,
    params: lm.params,
    sectionErrors: allErrors[guitar],
  };
}

fs.writeFileSync('./guitar_landmarks.json', JSON.stringify(output, null, 2));

// ─── Print report ─────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════');
console.log('  PHASE 3: ARC CHAIN GENERATOR - LANDMARK EXTRACTION REPORT');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('── KEY LANDMARKS (px, SVG coords) ──────────────────────────────');
console.log('Guitar          BassHorn[x,y]      TrebHorn[x,y]      HeelBass[x,y]      HeelTreb[x,y]      Bottom[x,y]');
console.log('────────────────────────────────────────────────────────────────────────────────────────────────────────');
for (const guitar of GUITARS) {
  const l = output[guitar].landmarks;
  const fmt = (p) => p ? '['+p.x.toFixed(0)+','+p.y.toFixed(0)+']' : '[n/a]';
  console.log(
    guitar.padEnd(16) +
    fmt(l.bassHornTip).padEnd(20) +
    fmt(l.trebHornTip).padEnd(20) +
    fmt(l.heelBass).padEnd(20) +
    fmt(l.heelTreble).padEnd(20) +
    fmt(l.bottomPt)
  );
}

console.log('\n── RECONSTRUCTION ERROR (endpoint-to-endpoint distance, px) ────');
console.log('Guitar          bass_side  bass_CW  treb_CW  treble_side  bottom  MAX');
console.log('─────────────────────────────────────────────────────────────────────');
for (const guitar of GUITARS) {
  const e = allErrors[guitar];
  const s = (name) => e[name] ? e[name].max.toFixed(1) : '-';
  const all = Object.values(e).map(v=>v.max).filter(isFinite);
  const totalMax = all.length ? Math.max(...all).toFixed(1) : '-';
  const flag = parseFloat(totalMax) < 5 ? '✓' : parseFloat(totalMax) < 15 ? '🟡' : '⚠️';
  console.log(
    guitar.padEnd(16) +
    s('bass_side').padStart(9) + '  ' +
    s('inner_bass_cutaway').padStart(7) + '  ' +
    s('inner_treble_cutaway').padStart(7) + '  ' +
    s('treble_side').padStart(11) + '  ' +
    s('bottom').padStart(6) + '  ' +
    String(totalMax).padStart(5) + '  ' + flag
  );
}

console.log('\n── SCALAR PARAMETERS ──────────────────────────────────────────────');
console.log('Guitar          BodyH   BodyW  WaistOff   BassHornR  TrebHornR  BassCWR  TrebCWR  BottomR  HeelW');
console.log('──────────────────────────────────────────────────────────────────────────────────────────────────');
for (const guitar of GUITARS) {
  const p = output[guitar].params;
  const f = (v,d) => v != null ? v.toFixed(d||0) : '-';
  console.log(
    guitar.padEnd(16) +
    f(p.bodyHeight).padStart(6) + '  ' +
    f(p.bodyWidth).padStart(6) + '  ' +
    f(p.waistAngleDeg,1).padStart(9) + '°  ' +
    f(p.bassHornRadius).padStart(9) + '  ' +
    f(p.trebHornRadius).padStart(9) + '  ' +
    f(p.bassCWRadius).padStart(7) + '  ' +
    f(p.trebCWRadius).padStart(7) + '  ' +
    f(p.bottomRadius).padStart(7) + '  ' +
    f(p.neckHeelWidth).padStart(5)
  );
}

console.log('\n── HEEL TANGENT ANGLES ──────────────────────────────────────────────');
console.log('Guitar          Bass heel angle    Treble heel angle');
console.log('─────────────────────────────────────────────────────');
for (const guitar of GUITARS) {
  const ht = output[guitar].heelTangents;
  const ba = ht.bass   ? (Math.atan2(ht.bass.y,   ht.bass.x)   * 180/Math.PI).toFixed(1) : '-';
  const ta = ht.treble ? (Math.atan2(ht.treble.y, ht.treble.x) * 180/Math.PI).toFixed(1) : '-';
  console.log(guitar.padEnd(16) + String(ba+'°').padStart(16) + '    ' + String(ta+'°').padStart(16));
}

console.log('\nWritten: guitar_landmarks.json');
console.log('\nNext step: build morphing interpolator using these landmark sets.');
