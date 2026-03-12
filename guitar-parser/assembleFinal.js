#!/usr/bin/env node
/**
 * Phase 2 Final: Production Path Assembler
 * 
 * Assembles each guitar outline into a single continuous open path.
 * Smart auto-orientation: checks which end of each section connects to the previous.
 * 
 * Output: guitar_final.json — clean outlines ready for rendering and parameter fitting
 */

const fs = require('fs');

const organized = JSON.parse(fs.readFileSync('./guitars_organized.json', 'utf8'));

const GUITARS = ['Strat', 'Tele', 'Jazzmaster', 'Mustang', 'Fender Lead', 'Akula', 'Wolfgang', 'Les Paul'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// Reverse a single segment (flip direction + sweep)
function reverseSegment(seg) {
  if (seg.type === 'arc') {
    return {
      type: 'arc',
      x0: seg.x1, y0: seg.y1, x1: seg.x0, y1: seg.y0,
      rx: seg.rx, ry: seg.ry, rot: seg.rot,
      largeArc: seg.largeArc,
      sweep: !seg.sweep,
      effectiveRadius: seg.effectiveRadius,
      arcLength: seg.arcLength,
      tangentStart: seg.tangentEnd ? { x: -seg.tangentEnd.x, y: -seg.tangentEnd.y } : null,
      tangentEnd: seg.tangentStart ? { x: -seg.tangentStart.x, y: -seg.tangentStart.y } : null,
    };
  } else {
    return {
      type: 'line',
      x0: seg.x1, y0: seg.y1, x1: seg.x0, y1: seg.y0,
      length: seg.length,
      tangentStart: seg.tangentEnd ? { x: -seg.tangentEnd.x, y: -seg.tangentEnd.y } : null,
      tangentEnd: seg.tangentStart ? { x: -seg.tangentStart.x, y: -seg.tangentStart.y } : null,
    };
  }
}

// Sort a list of segments into a continuous chain (greedy, allows reversing individual segs)
function sortIntoChain(segs, tol) {
  tol = tol || 8;
  if (segs.length === 0) return [];

  function tryBuild(startIdx, startRev) {
    const used = new Set([startIdx]);
    const chain = [startRev ? reverseSegment(segs[startIdx]) : Object.assign({}, segs[startIdx])];

    while (used.size < segs.length) {
      const last = chain[chain.length - 1];
      const lx = last.x1, ly = last.y1;
      let found = false;
      for (let i = 0; i < segs.length; i++) {
        if (used.has(i)) continue;
        const s = segs[i];
        if (dist(lx, ly, s.x0, s.y0) < tol) {
          chain.push(Object.assign({}, s)); used.add(i); found = true; break;
        }
        if (dist(lx, ly, s.x1, s.y1) < tol) {
          chain.push(reverseSegment(s)); used.add(i); found = true; break;
        }
      }
      if (!found) break;
    }
    return { chain: chain, complete: used.size === segs.length };
  }

  let best = null;
  for (let i = 0; i < segs.length; i++) {
    for (let rev = 0; rev < 2; rev++) {
      const r = tryBuild(i, rev === 1);
      if (!best || r.chain.length > best.chain.length) best = r;
      if (r.complete) break;
    }
    if (best && best.complete) break;
  }
  return best ? best.chain : [];
}

// Given a sorted chain, orient it so its START is closest to (targetX, targetY)
function orientChain(chain, targetX, targetY) {
  if (chain.length === 0) return chain;
  const startDist = dist(chain[0].x0, chain[0].y0, targetX, targetY);
  const endDist = dist(chain[chain.length - 1].x1, chain[chain.length - 1].y1, targetX, targetY);
  if (endDist < startDist) {
    // Reverse the whole chain
    return chain.slice().reverse().map(reverseSegment);
  }
  return chain;
}

// Clean up segment for output
function cleanSeg(seg) {
  const out = {
    type: seg.type,
    x0: +seg.x0.toFixed(3), y0: +seg.y0.toFixed(3),
    x1: +seg.x1.toFixed(3), y1: +seg.y1.toFixed(3),
  };
  if (seg.type === 'arc') {
    out.rx = +seg.rx.toFixed(3); out.ry = +seg.ry.toFixed(3);
    out.rot = seg.rot || 0;
    out.largeArc = seg.largeArc;
    out.sweep = seg.sweep;
    out.effectiveRadius = seg.effectiveRadius ? +seg.effectiveRadius.toFixed(2) : null;
    out.arcLength = seg.arcLength ? +seg.arcLength.toFixed(2) : null;
  } else {
    out.length = seg.length ? +seg.length.toFixed(3) : null;
  }
  if (seg.tangentStart) out.tangentStart = { x: +seg.tangentStart.x.toFixed(5), y: +seg.tangentStart.y.toFixed(5) };
  if (seg.tangentEnd)   out.tangentEnd   = { x: +seg.tangentEnd.x.toFixed(5),   y: +seg.tangentEnd.y.toFixed(5)   };
  return out;
}

// ─── Assemble one guitar ──────────────────────────────────────────────────────

function assembleGuitar(guitar, parts) {
  function getChain(name) {
    const p = parts[name];
    if (!p || !p.segments || p.segments.length === 0) return null;
    return sortIntoChain(p.segments);
  }

  // Sort all sections
  const bassChain         = getChain('bass side');
  const trebleChain       = getChain('treble side');
  const innerBassChain    = getChain('inner bass cutaway');
  const innerTrebleChain  = getChain('inner treble cutaway');
  const bottomChain       = getChain('bottom');

  // ── Determine correct orientations ───────────────────────────────────────
  //
  // Target perimeter winding (clockwise, starting from bass-strap corner):
  //
  //   bass_side: from (bottom-bass) UP to (neck-heel-bass)
  //   [optional] inner_bass_cutaway: from (neck-heel-bass) INTO cutaway
  //   [OPEN: neck heel]
  //   inner_treble_cutaway: from (neck-heel-treble) OUT to treble horn area
  //   treble_side: from (horn/cutaway area) DOWN to (bottom-treble)
  //   bottom: from (bottom-treble) across to (bottom-bass)
  //   [closes back to bass_side start]

  // Key orientation heuristic:
  //   - bass_side should start at large Y (bottom) and end at small/negative Y (neck area)
  //   - treble_side should start at small Y (neck area) and end at large Y (bottom)
  //   - bottom should start at max X (treble side) and end at min X (bass side)
  //   - inner_bass should start where bass_side ends
  //   - inner_treble should end where treble_side starts

  let bass = bassChain ? orientChain(bassChain, 0, -999) : null;       // start toward top
  // bass oriented: start = top, end = bottom... wait
  // From chain data: bass side goes bottom->neck naturally.
  // orientChain(bassChain, 0, 2000) would put the bottom at start.
  // Let's use actual Y: start at HIGH Y (bottom, ~1600), end at LOW Y (near neck, <300)

  bass = bassChain ? orientChain(bassChain, 0, 2000) : null;     // start at bottom
  
  let treble = trebleChain ? orientChain(trebleChain, 0, -999) : null;  // start at top
  
  // Bottom: should start at treble side bottom end, end at bass side bottom start
  // bass[0] is at high Y (bottom-bass), treble[-1] is at high Y (bottom-treble)
  let bottom = bottomChain ? null : null;
  if (bottomChain) {
    const bassBottomX = bass ? bass[0].x0 : -400;
    const bassBottomY = bass ? bass[0].y0 : 1600;
    // Bottom should END near bass start
    bottom = orientChain(bottomChain, bassBottomX, bassBottomY);
    // If bottom START is closer to treble end, we're good
    // otherwise flip
    const trebBottomX = treble ? treble[treble.length-1].x1 : 400;
    const trebBottomY = treble ? treble[treble.length-1].y1 : 1600;
    const startToTreb = dist(bottom[0].x0, bottom[0].y0, trebBottomX, trebBottomY);
    const endToTreb   = dist(bottom[bottom.length-1].x1, bottom[bottom.length-1].y1, trebBottomX, trebBottomY);
    if (endToTreb < startToTreb) {
      bottom = bottom.slice().reverse().map(reverseSegment);
    }
  }

  // Inner bass cutaway: should start where bass side ends
  let innerBass = innerBassChain;
  if (innerBass && bass) {
    const bassEnd = { x: bass[bass.length-1].x1, y: bass[bass.length-1].y1 };
    innerBass = orientChain(innerBass, bassEnd.x, bassEnd.y);
  }

  // Inner treble cutaway: should end where treble side starts
  let innerTreble = innerTrebleChain;
  if (innerTreble && treble) {
    const trebStart = { x: treble[0].x0, y: treble[0].y0 };
    // Orient so END is near treble start
    const chain = orientChain(innerTreble, 0, -999); // temp
    const d1 = dist(chain[chain.length-1].x1, chain[chain.length-1].y1, trebStart.x, trebStart.y);
    const d2 = dist(chain[0].x0, chain[0].y0, trebStart.x, trebStart.y);
    if (d2 < d1) {
      // start is near treble start, so we want end at treble start → reverse
      innerTreble = chain.slice().reverse().map(reverseSegment);
    } else {
      innerTreble = chain;
    }
  }

  // ── Build the outline array ───────────────────────────────────────────────
  // Order: bass → innerBass → [NECK HEEL OPEN] → innerTreble → treble → bottom

  const sections = [];
  const allSegs = [];
  let neckHeelBassEnd = null;
  let neckHeelTrebleStart = null;

  function appendSection(name, chain) {
    if (!chain || chain.length === 0) return;
    const start = allSegs.length;
    for (const seg of chain) allSegs.push(cleanSeg(seg));
    sections.push({
      name: name,
      segStart: start,
      segEnd: allSegs.length - 1,
      startPt: { x: +chain[0].x0.toFixed(2), y: +chain[0].y0.toFixed(2) },
      endPt: { x: +chain[chain.length-1].x1.toFixed(2), y: +chain[chain.length-1].y1.toFixed(2) },
    });
  }

  appendSection('bass_side', bass);

  if (innerBass) {
    appendSection('inner_bass_cutaway', innerBass);
    neckHeelBassEnd = innerBass.length > 0 ?
      { x: +innerBass[innerBass.length-1].x1.toFixed(2), y: +innerBass[innerBass.length-1].y1.toFixed(2) } :
      null;
  } else {
    // No bass cutaway: neck heel is the end of bass side
    neckHeelBassEnd = bass && bass.length > 0 ?
      { x: +bass[bass.length-1].x1.toFixed(2), y: +bass[bass.length-1].y1.toFixed(2) } :
      null;
  }

  // Mark the open gap (neck heel)
  const neckHeelIndex = allSegs.length; // segments after this index are on the other side of the gap

  if (innerTreble) {
    neckHeelTrebleStart = innerTreble.length > 0 ?
      { x: +innerTreble[0].x0.toFixed(2), y: +innerTreble[0].y0.toFixed(2) } :
      null;
    appendSection('inner_treble_cutaway', innerTreble);
  } else {
    neckHeelTrebleStart = treble && treble.length > 0 ?
      { x: +treble[0].x0.toFixed(2), y: +treble[0].y0.toFixed(2) } :
      null;
  }

  appendSection('treble_side', treble);
  appendSection('bottom', bottom);

  // ── Analyze join quality ──────────────────────────────────────────────────

  const joins = [];
  for (let si = 0; si < sections.length - 1; si++) {
    const a = sections[si];
    const b = sections[si + 1];
    const aEnd = allSegs[a.segEnd];
    const bStart = allSegs[b.segStart];
    const posGap = dist(aEnd.x1, aEnd.y1, bStart.x0, bStart.y0);

    const ta = aEnd.tangentEnd;
    const tb = bStart.tangentStart;
    let kink = null;
    if (ta && tb) {
      const dot = Math.max(-1, Math.min(1, ta.x * tb.x + ta.y * tb.y));
      kink = +(Math.acos(dot) * 180 / Math.PI).toFixed(2);
    }

    joins.push({
      from: a.name,
      to: b.name,
      posGap: +posGap.toFixed(3),
      kink_deg: kink,
      fromPt: { x: +aEnd.x1.toFixed(2), y: +aEnd.y1.toFixed(2) },
      toPt: { x: +bStart.x0.toFixed(2), y: +bStart.y0.toFixed(2) },
      isNeckHeel: si === (innerBass ? 1 : 0),
    });
  }

  // Closing join: bottom end back to bass start
  if (allSegs.length > 0 && bass && bass.length > 0) {
    const lastSeg = allSegs[allSegs.length - 1];
    const firstSeg = allSegs[0];
    const posGap = dist(lastSeg.x1, lastSeg.y1, firstSeg.x0, firstSeg.y0);
    const ta = lastSeg.tangentEnd;
    const tb = firstSeg.tangentStart;
    let kink = null;
    if (ta && tb) {
      const dot = Math.max(-1, Math.min(1, ta.x * tb.x + ta.y * tb.y));
      kink = +(Math.acos(dot) * 180 / Math.PI).toFixed(2);
    }
    joins.push({
      from: 'bottom',
      to: 'bass_side',
      posGap: +posGap.toFixed(3),
      kink_deg: kink,
      fromPt: { x: +lastSeg.x1.toFixed(2), y: +lastSeg.y1.toFixed(2) },
      toPt: { x: +firstSeg.x0.toFixed(2), y: +firstSeg.y0.toFixed(2) },
      isClose: true,
    });
  }

  // Neck heel gap
  const neckHeelGap = (neckHeelBassEnd && neckHeelTrebleStart) ?
    dist(neckHeelBassEnd.x, neckHeelBassEnd.y, neckHeelTrebleStart.x, neckHeelTrebleStart.y) : null;

  return {
    guitar,
    totalSegments: allSegs.length,
    sections,
    neckHeelIndex,
    neckHeelBassEnd,
    neckHeelTrebleStart,
    neckHeelGap_px: neckHeelGap ? +neckHeelGap.toFixed(2) : null,
    joins,
    segments: allSegs,
  };
}

// ─── Run for all guitars ──────────────────────────────────────────────────────

const result = {};
for (const guitar of GUITARS) {
  result[guitar] = assembleGuitar(guitar, organized[guitar] || {});
}

fs.writeFileSync('./guitar_final.json', JSON.stringify(result, null, 2));

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log('  FINAL ASSEMBLY REPORT');
console.log('═══════════════════════════════════════════════════════════\n');

for (const guitar of GUITARS) {
  const r = result[guitar];
  console.log('▶ ' + guitar + '  (' + r.totalSegments + ' segs)');

  for (const j of r.joins) {
    if (j.isNeckHeel || j.posGap > 3) continue; // skip expected neck heel gap and clean joins
    const flag = j.posGap > 10 ? '⚠️' : j.kink_deg > 15 ? '🟡' : '✓';
    console.log('  ' + (j.from + '→' + j.to).padEnd(45) + ' gap:' + j.posGap.toFixed(1).padStart(5) + 'px  kink:' + (j.kink_deg != null ? j.kink_deg.toFixed(1) : '-') + '°  ' + flag);
  }

  // Non-neck-heel gaps
  const badJoins = r.joins.filter(j => !j.isNeckHeel && !j.isClose && j.posGap > 10);
  if (badJoins.length === 0 && r.joins.filter(j => !j.isNeckHeel && j.posGap < 5).length === r.joins.filter(j => !j.isNeckHeel).length - 1) {
    console.log('  All section joins clean ✓');
  }

  const he = r.neckHeelBassEnd;
  const ht = r.neckHeelTrebleStart;
  console.log('  Neck heel: bass=[' + (he ? he.x.toFixed(0)+','+he.y.toFixed(0) : '?') + '] treb=[' + (ht ? ht.x.toFixed(0)+','+ht.y.toFixed(0) : '?') + '] gap=' + (r.neckHeelGap_px != null ? r.neckHeelGap_px.toFixed(1) : '?') + 'px');
  console.log('');
}

// Closing join table
console.log('── CLOSING JOINS (bottom → bass_side, should be ~0) ─────');
for (const guitar of GUITARS) {
  const closeJoin = result[guitar].joins.find(j => j.isClose);
  if (closeJoin) {
    const flag = closeJoin.posGap < 5 ? '✓' : '⚠️';
    console.log('  ' + guitar.padEnd(14) + ' gap:' + closeJoin.posGap.toFixed(1).padStart(7) + 'px  kink:' + (closeJoin.kink_deg != null ? closeJoin.kink_deg.toFixed(1) : '-') + '°  ' + flag);
  }
}

console.log('\nWritten: guitar_final.json');
