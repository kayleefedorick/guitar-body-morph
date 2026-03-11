#!/usr/bin/env node
/**
 * Guitar SVG Parser - No external dependencies
 */

const fs = require('fs');

function extractLabeledPaths(svgText) {
  const paths = [];
  const pathRe = /<path[^>]*>/g;
  let m;
  while ((m = pathRe.exec(svgText)) !== null) {
    const tag = m[0];
    const labelMatch = tag.match(/inkscape:label="([^"]+)"/);
    const dMatch = tag.match(/\sd="([^"]+)"/);
    if (labelMatch && dMatch) {
      paths.push({ label: labelMatch[1], d: dMatch[1] });
    }
  }
  return paths;
}

function parsePathData(d) {
  const tokens = [];
  const re = /([MmAaLlHhVvZzCcSsQqTt])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push({ type: 'cmd', val: match[1] });
    else tokens.push({ type: 'num', val: parseFloat(match[2]) });
  }

  const commands = [];
  let i = 0;

  function nextNums(count) {
    const out = [];
    for (let k = 0; k < count; k++) {
      if (i >= tokens.length || tokens[i].type !== 'num') return null;
      out.push(tokens[i++].val);
    }
    return out;
  }

  function hasMoreNums() {
    return i < tokens.length && tokens[i].type === 'num';
  }

  while (i < tokens.length) {
    if (tokens[i].type !== 'cmd') { i++; continue; }
    const cmd = tokens[i++].val;

    if (cmd === 'M' || cmd === 'm') {
      const p = nextNums(2); if (!p) continue;
      commands.push({ cmd, x: p[0], y: p[1] });
      while (hasMoreNums()) {
        const p2 = nextNums(2); if (!p2) break;
        commands.push({ cmd: cmd === 'M' ? 'L' : 'l', x: p2[0], y: p2[1] });
      }
    } else if (cmd === 'A' || cmd === 'a') {
      while (hasMoreNums()) {
        const p = nextNums(7); if (!p) break;
        commands.push({ cmd, rx: p[0], ry: p[1], rot: p[2], largeArc: p[3] === 1, sweep: p[4] === 1, x: p[5], y: p[6] });
      }
    } else if (cmd === 'L' || cmd === 'l') {
      while (hasMoreNums()) {
        const p = nextNums(2); if (!p) break;
        commands.push({ cmd, x: p[0], y: p[1] });
      }
    } else if (cmd === 'H' || cmd === 'h') {
      while (hasMoreNums()) {
        const p = nextNums(1); if (!p) break;
        commands.push({ cmd, x: p[0] });
      }
    } else if (cmd === 'V' || cmd === 'v') {
      while (hasMoreNums()) {
        const p = nextNums(1); if (!p) break;
        commands.push({ cmd, y: p[0] });
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      commands.push({ cmd: 'Z' });
    } else {
      while (hasMoreNums()) i++;
    }
  }
  return commands;
}

function resolveAbsolute(commands) {
  let cx = 0, cy = 0;
  const segs = [];

  for (const cmd of commands) {
    const c = cmd.cmd;
    if (c === 'M') { cx = cmd.x; cy = cmd.y; }
    else if (c === 'm') { cx += cmd.x; cy += cmd.y; }
    else if (c === 'L') {
      segs.push({ type: 'line', x0: cx, y0: cy, x1: cmd.x, y1: cmd.y });
      cx = cmd.x; cy = cmd.y;
    } else if (c === 'l') {
      const x = cx + cmd.x, y = cy + cmd.y;
      segs.push({ type: 'line', x0: cx, y0: cy, x1: x, y1: y });
      cx = x; cy = y;
    } else if (c === 'H') {
      segs.push({ type: 'line', x0: cx, y0: cy, x1: cmd.x, y1: cy });
      cx = cmd.x;
    } else if (c === 'h') {
      const x = cx + cmd.x;
      segs.push({ type: 'line', x0: cx, y0: cy, x1: x, y1: cy });
      cx = x;
    } else if (c === 'A') {
      segs.push({ type: 'arc', rx: cmd.rx, ry: cmd.ry, rot: cmd.rot, largeArc: cmd.largeArc, sweep: cmd.sweep, x0: cx, y0: cy, x1: cmd.x, y1: cmd.y });
      cx = cmd.x; cy = cmd.y;
    } else if (c === 'a') {
      const x = cx + cmd.x, y = cy + cmd.y;
      segs.push({ type: 'arc', rx: cmd.rx, ry: cmd.ry, rot: cmd.rot, largeArc: cmd.largeArc, sweep: cmd.sweep, x0: cx, y0: cy, x1: x, y1: y });
      cx = x; cy = y;
    }
  }
  return segs;
}

function arcToCenterForm(s) {
  const { rx: rxIn, ry: ryIn, rot, largeArc, sweep, x0, y0, x1, y1 } = s;
  const phi = rot * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  const dx2 = (x0 - x1) / 2, dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const rx2 = rx * rx, ry2 = ry * ry;
  const lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const rx2f = rx * rx, ry2f = ry * ry;

  const num = Math.max(0, rx2f * ry2f - rx2f * y1p2 - ry2f * x1p2);
  const den = rx2f * y1p2 + ry2f * x1p2;
  const sq = den < 1e-10 ? 0 : Math.sqrt(num / den);
  const sign = (largeArc === sweep) ? -1 : 1;
  const cxp = sign * sq * rx * y1p / ry;
  const cyp = sign * sq * (-ry * x1p / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  function vecAngle(ux, uy, vx, vy) {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = vecAngle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry
  );
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const theta2 = theta1 + dtheta;
  const sweepSign = dtheta >= 0 ? 1 : -1;

  function ellipseTangent(theta) {
    const te_x = -rx * Math.sin(theta) * sweepSign;
    const te_y =  ry * Math.cos(theta) * sweepSign;
    const tx = cosPhi * te_x - sinPhi * te_y;
    const ty = sinPhi * te_x + cosPhi * te_y;
    const len = Math.sqrt(tx * tx + ty * ty);
    return len > 0 ? { x: tx / len, y: ty / len } : { x: 0, y: 0 };
  }

  const effectiveRadius = Math.sqrt(rx * ry);
  const arcLength = Math.abs(dtheta) * effectiveRadius;

  return {
    cx, cy, rx, ry,
    theta1_deg: +(theta1 * 180 / Math.PI).toFixed(2),
    theta2_deg: +(theta2 * 180 / Math.PI).toFixed(2),
    dtheta_deg: +(dtheta * 180 / Math.PI).toFixed(2),
    tangentStart: { x: +ellipseTangent(theta1).x.toFixed(4), y: +ellipseTangent(theta1).y.toFixed(4) },
    tangentEnd:   { x: +ellipseTangent(theta2).x.toFixed(4), y: +ellipseTangent(theta2).y.toFixed(4) },
    effectiveRadius: +effectiveRadius.toFixed(3),
    arcLength: +arcLength.toFixed(3),
  };
}

function augmentSegments(segs) {
  return segs.map(s => {
    if (s.type === 'arc') {
      return { ...s, center: arcToCenterForm(s) };
    } else {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      return {
        ...s, length: +len.toFixed(3),
        tangentStart: len > 0 ? { x: +(dx/len).toFixed(4), y: +(dy/len).toFixed(4) } : null,
        tangentEnd:   len > 0 ? { x: +(dx/len).toFixed(4), y: +(dy/len).toFixed(4) } : null,
      };
    }
  });
}

function analyzeContinuity(segs) {
  const results = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], b = segs[i + 1];
    const posGap = Math.sqrt((a.x1 - b.x0) ** 2 + (a.y1 - b.y0) ** 2);
    const tA = a.type === 'arc' ? a.center?.tangentEnd : a.tangentEnd;
    const tB = b.type === 'arc' ? b.center?.tangentStart : b.tangentStart;
    let tangDiff = null;
    if (tA && tB) {
      const dot = Math.max(-1, Math.min(1, tA.x * tB.x + tA.y * tB.y));
      tangDiff = +(Math.acos(dot) * 180 / Math.PI).toFixed(2);
    }
    results.push({ segIndex: i, posGap: +posGap.toFixed(4), tangentAngleDiff_deg: tangDiff });
  }
  return results;
}

function computeBBox(segs) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segs) {
    for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1]]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return null;
  return { minX: +minX.toFixed(2), maxX: +maxX.toFixed(2), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), width: +(maxX-minX).toFixed(2), height: +(maxY-minY).toFixed(2) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const svgText = fs.readFileSync('/home/claude/guitar-parser/source.svg', 'utf8');
const rawPaths = extractLabeledPaths(svgText);

console.log(`Found ${rawPaths.length} labeled paths\n`);

const allData = {};
for (const { label, d } of rawPaths) {
  const commands = parsePathData(d);
  const raw = resolveAbsolute(commands);
  const segs = augmentSegments(raw);
  const bb = computeBBox(segs);
  const continuity = analyzeContinuity(segs);

  let waistAngle_deg = null;
  if (label.includes('waist offset angle') && segs.length > 0) {
    const s = segs[0];
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
    waistAngle_deg = +(Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(2);
  }

  allData[label] = {
    segmentCount: segs.length,
    startPoint: segs.length > 0 ? { x: +segs[0].x0.toFixed(2), y: +segs[0].y0.toFixed(2) } : null,
    endPoint: segs.length > 0 ? { x: +segs[segs.length-1].x1.toFixed(2), y: +segs[segs.length-1].y1.toFixed(2) } : null,
    bbox: bb,
    totalArcLength: +segs.filter(s=>s.type==='arc').reduce((sum,s)=>sum+(s.center?.arcLength||0),0).toFixed(2),
    continuity,
    waistAngle_deg,
    segments: segs.map(s => {
      if (s.type === 'arc') {
        return {
          type: 'arc',
          x0: +s.x0.toFixed(3), y0: +s.y0.toFixed(3),
          x1: +s.x1.toFixed(3), y1: +s.y1.toFixed(3),
          rx: +s.rx.toFixed(3), ry: +s.ry.toFixed(3),
          rot: s.rot, largeArc: s.largeArc, sweep: s.sweep,
          ...s.center,
        };
      } else {
        return {
          type: 'line',
          x0: +s.x0.toFixed(3), y0: +s.y0.toFixed(3),
          x1: +s.x1.toFixed(3), y1: +s.y1.toFixed(3),
          length: s.length,
          tangentStart: s.tangentStart,
          tangentEnd: s.tangentEnd,
        };
      }
    }),
  };
}

fs.writeFileSync('/home/claude/guitar-parser/guitar_paths_full.json', JSON.stringify(allData, null, 2));

// Organize by guitar
const GUITARS = ['Strat', 'Tele', 'Jazzmaster', 'Mustang', 'Fender Lead', 'Akula', 'Wolfgang', 'Les Paul'];
const PARTS = ['bass side', 'treble side', 'inner bass cutaway', 'inner treble cutaway', 'bottom', 'waist offset angle'];

// Canonical part name aliases - maps non-standard SVG labels to canonical names
const PART_ALIASES = {
  // Tele bass side has a gentle curve where a cutaway would be - not a real cutaway,
  // but it IS the inner-bass-cutaway topological slot (connects bass side end to neck heel)
  'bass cutaway - not actually a cutaway': 'inner bass cutaway',
};

const organized = {};
for (const guitar of GUITARS) {
  organized[guitar] = {};
  for (const [label, data] of Object.entries(allData)) {
    if (label.startsWith(guitar + ' ')) {
      let part = label.slice(guitar.length + 1);
      // Apply canonical alias if one exists
      if (PART_ALIASES[part]) part = PART_ALIASES[part];
      organized[guitar][part] = data;
    }
  }
}

fs.writeFileSync('/home/claude/guitar-parser/guitars_organized.json', JSON.stringify(organized, null, 2));

// Print summary
console.log('══════════════════════════════════════════════════════════════');
console.log('  GUITAR BODY OUTLINE - EXTRACTED DATA SUMMARY');
console.log('══════════════════════════════════════════════════════════════\n');

for (const guitar of GUITARS) {
  const parts = organized[guitar];
  console.log(`▶ ${guitar}`);

  for (const part of PARTS) {
    const d = parts[part];
    if (!d) { console.log(`   ${part}: NOT FOUND`); continue; }

    if (part === 'waist offset angle') {
      const angle = d.waistAngle_deg;
      const s = d.segments[0];
      console.log(`   waist offset angle: ${angle != null ? (angle>0?'+':'')+angle+'°' : '?'}  (line: [${s?.x0},${s?.y0}] → [${s?.x1},${s?.y1}])`);
    } else {
      const maxGap = d.continuity.length > 0 ? Math.max(...d.continuity.map(c => c.posGap)) : 0;
      const kinks = d.continuity.filter(c => c.tangentAngleDiff_deg != null).map(c => c.tangentAngleDiff_deg);
      const maxKink = kinks.length > 0 ? Math.max(...kinks) : 0;
      const bb = d.bbox;
      const gapFlag = maxGap > 2 ? '⚠️ POSGAP' : '';
      const kinkFlag = maxKink > 20 ? '🔴 KINK' : maxKink > 8 ? '🟡 kink' : '';
      console.log(`   ${part.padEnd(28)} ${d.segmentCount} segs  W:${bb?.width.toFixed(0).padStart(5)}  H:${bb?.height.toFixed(0).padStart(5)}  gap:${maxGap.toFixed(1).padStart(5)}  kink:${maxKink.toFixed(1).padStart(5)}°  start:[${d.startPoint?.x.toFixed(0)},${d.startPoint?.y.toFixed(0)}]  end:[${d.endPoint?.x.toFixed(0)},${d.endPoint?.y.toFixed(0)}]  ${gapFlag} ${kinkFlag}`);
    }
  }
  console.log('');
}

// Waist offset summary
console.log('\n══ WAIST OFFSET ANGLES ══');
for (const guitar of GUITARS) {
  const w = organized[guitar]['waist offset angle'];
  if (w) {
    const a = w.waistAngle_deg;
    const bar = '█'.repeat(Math.max(0, Math.round(Math.abs(a) / 2)));
    console.log(`  ${guitar.padEnd(14)} ${(a >= 0 ? '+' : '') + a.toFixed(1).padStart(6)}°  ${bar}`);
  }
}

console.log('\n\nFiles written: guitar_paths_full.json, guitars_organized.json');
