# Guitar Body Morphing App

This app morphs classic guitar outlines by blending how the shapes **bend** (their curvature) rather than blending points, then rebuilding the final outline by integrating that blended curvature - the result is smooth, tangent-continuous (G1) and ready for CNC/CAD. (Under the hood this uses ideas from differential geometry - the math of curves - but you don’t need to understand that to use it.) It’s a lot like highway design: road engineers control how sharply a road turns by shaping curvature and adding gentle transition curves so the driving feel is smooth; the morph engine does the same thing for guitar bodies, producing visually pleasing, manufacturable shapes in real time.


---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project File Structure](#project-file-structure)
3. [How the Morphing Engine Works](#how-the-morphing-engine-works)
   - [ELI5: The Big Idea](#eli5-the-big-idea)
   - [The Curvature Integration Approach](#the-curvature-integration-approach)
   - [The Endpoint Correction (Scale + Rotate)](#the-endpoint-correction-scale--rotate)
   - [Cross-Section Tangent Carry](#cross-section-tangent-carry)
   - [Handling Straight Lines](#handling-straight-lines)
4. [Body Shape Topology](#body-shape-topology)
   - [The Five Sections](#the-five-sections)
   - [The Neck Heel Gap](#the-neck-heel-gap)
   - [Coordinate System](#coordinate-system)
5. [App Features](#app-features)
   - [Global Morph Mode](#global-morph-mode)
   - [Section Mix Mode](#section-mix-mode)
   - [View Toggles](#view-toggles)
   - [Parameter Panel](#parameter-panel)
6. [Section Mix Mode: Technical Details](#section-mix-mode-technical-details)
   - [The Shared Skeleton Problem](#the-shared-skeleton-problem)
   - [Skeleton Join Point Map](#skeleton-join-point-map)
   - [Global Mode vs Mix Mode Distinction](#global-mode-vs-mix-mode-distinction)
7. [Adding a New Body Shape: Full Workflow](#adding-a-new-body-shape-full-workflow)
   - [Step 1 - Draw and Label the SVG in Inkscape](#step-1--draw-and-label-the-svg-in-inkscape)
   - [Step 2 - Parse the SVG](#step-2--parse-the-svg)
   - [Step 3 - Assemble the Outline](#step-3--assemble-the-outline)
   - [Step 4 - Extract Landmarks](#step-4--extract-landmarks)
   - [Step 5 - Validate Everything](#step-5--validate-everything)
   - [Step 6 - Register in the App](#step-6--register-in-the-app)
   - [Step 7 - Rebuild the App](#step-7--rebuild-the-app)
8. [Data File Reference](#data-file-reference)
9. [Validation Reference](#validation-reference)
10. [Arc Math Reference](#arc-math-reference)
11. [Known Limitations and Future Work](#known-limitations-and-future-work)

---

## Quick Start

Open `guitar_morph_app.html` in any modern browser. No build step required.

**Global Morph mode:**
- **Click** a guitar name in the left panel to set Shape A
- **Shift+click** to set Shape B
- **Drag the slider** to morph from A (t = 0) toward B (t = 1)
- **← / →** arrow keys for fine t control (±0.01 per step)
- **Space** to jump instantly between A and B

**Section Mix mode:**
- Click **SECTION MIX** at the top of the left panel
- Each section has its own A slot, B slot, and t-slider
- Click any A or B slot to open a guitar picker and assign any guitar to that section
- The **link button** links a section's slider to the global t value; click again to unlink and control independently

**Canvas navigation** (both modes):
- **Drag** to pan
- **Scroll** to zoom

To rebuild the app after changing any data or the template:

```bash
cd guitar-parser/
node buildMorphApp.js
```

---

## Project File Structure

```
guitar-parser/
│
│  ── Scripts (pipeline, run in order) ──────────────────────────────────────
│
├── parseSVG.js           Step 1 - Reads source.svg, extracts & converts every
│                           labeled path to absolute segment coordinates.
│                           Output: guitar_paths_full.json, guitars_organized.json
│
├── assembleFinal.js      Step 2 - Sorts each guitar's five section chains into
│                           a continuous outline, checks join quality.
│                           Output: guitar_final.json
│
├── generator.js          Step 3 - Extracts named landmark points and heel
│                           tangent angles from the assembled outlines.
│                           Output: guitar_landmarks.json
│
├── buildMorphApp.js      Step 4 - Injects the three JSON data files into the
│                           HTML template and writes the final app.
│                           Output: guitar_morph_app.html
│
│  ── Validation ─────────────────────────────────────────────────────────────
│
├── validateFinal.js      Runs all 56 guitar pairs × 7 t-values, checks every
│                           section join for G1 continuity and zero gaps.
│                           ✓ expected: maxKink=0.00°, maxGap=0.00px
│
│  ── App source ─────────────────────────────────────────────────────────────
│
├── morph_app_template.html   Full app source. Data placeholders are injected
│                                 by buildMorphApp.js at build time.
│
│  ── Data files (generated, do not edit by hand) ────────────────────────────
│
├── source.svg                   Original Inkscape SVG with labeled paths
├── guitar_paths_full.json       Raw parsed segments keyed by SVG label
├── guitars_organized.json       Same data, reorganised by guitar name + section
├── guitar_final.json            Assembled ordered outlines with section metadata
├── guitar_landmarks.json        Named landmark points + heel tangent vectors
│
│  ── Final output ───────────────────────────────────────────────────────────
│
└── guitar_morph_app.html        The self-contained app (open in browser)
```

---

## How the Morphing Engine Works

### ELI5

Imagine you are drawing a guitar outline with a felt-tip pen. As the pen moves along the curve, two things are happening at every moment:

1. **The pen is bending** - sometimes it curves left, sometimes right, sometimes it goes straight.
2. **The pen is moving forward** - covering distance.

The *amount of bending* at each moment is called **curvature** (κ, kappa). A tight curve has high curvature. A gentle curve has low curvature. A straight line has zero curvature.

If you know every guitar's curvature story - how much it bends at each point along its outline - you can blend two curvature stories together to make a smooth in-between shape.

That is all the morphing engine does:

1. Read the "curvature story" of Guitar A.
2. Read the "curvature story" of Guitar B.
3. Blend them: at t = 0.5, every point along the outline has curvature halfway between A's curvature and B's curvature.
4. Integrate (add up) the blended curvature story to reconstruct the full shape.

Because we are blending *bending*, not *point positions*, the resulting outline is always smooth - there are never any kinks or sharp corners introduced by the morph itself.

---

### The Curvature Integration Approach

Every guitar outline is stored as a chain of circular arcs (and occasionally straight line segments). Each arc has:

- A **radius** R (how gently it curves)
- A **sweep direction** (clockwise or counter-clockwise)
- An **arc length** (how long that arc is)

We convert each arc into a signed curvature value:

```
κ = +1/R    (clockwise arc, curving right relative to direction of travel)
κ = −1/R    (counter-clockwise arc, curving left)
κ = 0       (straight line segment)
```

This gives us a **curvature profile**: a step function that says "at this distance along the outline, the curvature is this value."

To morph between two guitars A and B at parameter t:

1. **Normalise** both curvature profiles to a common arc-length scale (0 → 1).
2. **Blend**: at each normalised position u, compute `κ(u) = κA(u) + (κB(u) − κA(u)) × t`.
3. **Integrate** the blended κ(u) to get the tangent angle θ at each point:
   `θ(s) = θ₀ + ∫₀ˢ κ(σ) dσ`
4. **Integrate** θ(s) to get x, y position:
   `x(s) = x₀ + ∫₀ˢ cos θ(σ) dσ`
   `y(s) = y₀ + ∫₀ˢ sin θ(σ) dσ`

Since our curvature profiles are piecewise-constant (one value per arc), the integrals are exact - we sum arc-by-arc. Each integrated segment is itself a circular arc (or a straight line if κ = 0), so the output is a valid, manufacturable arc chain.

**Why this approach works:**
- G1 continuity (smooth tangent at every junction) is guaranteed by integration - the tangent angle θ is continuous because we are integrating a finite function.
- The output reproduces Guitar A exactly at t = 0 and Guitar B exactly at t = 1.
- Straight-line segments blend naturally into curved arcs and vice versa (κ blends between 0 and ±1/R).

---

### The Endpoint Correction (Scale + Rotate)

There is a subtle catch: when we blend two curvature profiles with different total arc lengths, the integrated chain does not automatically end exactly where we want it to. The blended total length is correct (it is lerped between the two source lengths), but the *direction* of the chain through space may be slightly off.

After building the raw integrated chain for each section, we apply a **similarity transform** (uniform scale + rotation, both about the start point) to make the chain's endpoint land exactly on the interpolated target endpoint.

```
target_end = lerp(sectionA_end, sectionB_end, t)
scale  = |target_end − start| / |raw_end − start|
rotate = angle(target_end − start) − angle(raw_end − start)
```

This transform is applied to all arc **positions and radii** (scale changes arc sizes; rotation changes their positions). Crucially, the **tangent angles stored in the arc objects are NOT updated** - only a separate `carryTeAngle` value is updated with the rotation. This distinction matters for cross-section continuity, explained next.

---

### Cross-Section Tangent Carry

The guitar outline is split into five independent sections. Each section is morphed independently, then joined together.

For the joins between sections to be smooth, the end tangent of section N must equal the start tangent of section N+1. We achieve this with a **tangent carry**:

```
carryTeAngle = (pre-xform end tangent) + (rotation from endpoint correction)
```

When section N+1 is built, its starting tangent angle is set to `carryTeAngle` from section N. This means:

- The integrated chain for N+1 starts heading in exactly the right direction.
- The endpoint correction for N+1 adds its *own* rotation to produce its own `carryTeAngle`.
- No matter how many sections chain together, each join is tangent-continuous.

If we updated the tangent angles *inside* the arc objects during the xform, then the carry angle passed to N+1 would already include N's rotation, and N+1's xform would add a *second* rotation on top - causing a kink. Separating the carry angle from the stored arc angles is what prevents this.

---

### Handling Straight Lines

Some guitars have straight-line segments on their cutaways rather than curves. Straight lines are treated as circular arcs with κ = 0 - zero curvature. This fits naturally into the framework:

- When morphing Akula (κ = 0 on cutaway) → Strat (κ > 0 on cutaway), the blended κ smoothly grows from 0, gently curving what was previously straight.
- The line segment's tangent direction is preserved exactly at t = 0 and t = 1.

Segments are **not filtered to arcs-only** before passing to the morph engine - both arc and line segments are included, each getting a κ value.

---

## Body Shape Topology

### The Five Sections

Every guitar outline is divided into exactly five named sections. The sections always appear in this fixed order:

| # | Name | Description |
|---|------|-------------|
| 0 | `bass_side` | From the bottom-bass corner, up the bass flank, through the bass horn, to the top of the bass-side cutaway |
| 1 | `inner_bass_cutaway` | The inner curve of the bass cutaway, from the cutaway top down to the bass neck heel. The outline is **open** across the neck heel gap after this section. |
| 2 | `inner_treble_cutaway` | The inner curve of the treble cutaway, from the treble neck heel up to the treble cutaway top. Begins on the other side of the neck heel gap. |
| 3 | `treble_side` | From the treble cutaway area, down the treble flank, through the treble horn, to the bottom-treble corner |
| 4 | `bottom` | From the bottom-treble corner to the bottom-bass corner across the strap-button end |

The five sections form a connected ring: `bass_side` → `inner_bass_cutaway` → *[neck heel gap]* → `inner_treble_cutaway` → `treble_side` → `bottom` → back to `bass_side`.

### The Neck Heel Gap

The neck pocket creates an intentional open gap in the outline between the end of `inner_bass_cutaway` and the start of `inner_treble_cutaway`. The app does not bridge it with a synthetic arc - the neck heel will be added separately in a future step.

At the gap, the tangent carry is **reset**: `inner_treble_cutaway` restarts its tangent from the interpolated heel tangent data stored in `guitar_landmarks.json`.

### Coordinate System

```
Origin (0, 0) = string endpoint / neck centerline
+X = treble side (right when facing the front of the guitar)
−X = bass side
+Y = toward strap button (the body extends in the +Y direction)

Units: SVG pixels ≈ 1 mm at working scale
```

All segment coordinates, landmark positions, and SVG output use this system.

---

## App Features

### Global Morph Mode

The default mode. Select any two guitars as Shape A and Shape B from the left panel, then drag the morph slider to blend between them. Every section uses the same guitar pair and the same t value simultaneously.

Controls:
- **Click** a guitar → set as Shape A (blue highlight, A badge)
- **Shift+click** a guitar → set as Shape B (purple highlight, B badge)
- **Slider** (or ← / → keys) → adjust morph parameter t from 0.000 to 1.000
- **Space** → jump between t = 0 and t = 1

The header bar shows the current arc count and render time in milliseconds.

### Section Mix Mode

Click **SECTION MIX** at the top of the left panel to switch modes. Each of the five body sections gets an independent row with:

- **A slot** (blue left border) - the "from" guitar for this section
- **B slot** (purple left border) - the "to" guitar for this section
- **t-slider** - morph parameter for this section, coloured as a gradient between the two chosen guitars' colours
- **🔗 link button** - when lit (blue), the section's t-slider tracks the global morph slider; click to unlink and set an independent t value

Click any A or B slot to open a guitar picker popup and assign any of the eight guitars to that section. Manually changing a slot automatically unlinks that section.

When you change the global A or B selection in Global Morph mode, all linked sections update automatically.

Ghost source shapes on the canvas show all guitars currently referenced across all sections.

### View Toggles

| Toggle | Default | What it shows |
|--------|---------|---------------|
| Source shapes (ghost) | On | Semi-transparent outlines of the source guitars |
| Morph outline | On | The morphed result in white |
| Neck heel gap | Off | Dashed line connecting the bass and treble neck heel points |
| Waist line | On | Dashed line through the interpolated waist points |
| Landmarks | Off | Named point markers (horn tips, bottom, heel points) |
| Section colours | Off | Each section rendered in its own colour instead of white |

Section colours: bass side = blue `#4488ff`, bass cutaway = green `#44ee88`, treble cutaway = yellow `#ffcc44`, treble side = red `#ff5544`, bottom = purple `#cc44ff`.

### Parameter Panel

The right panel displays interpolated scalar measurements for the current morph state:

| Parameter | Description |
|-----------|-------------|
| Body height | Distance from neck heel baseline to bottom point |
| Body width | Maximum width across the body |
| Waist offset | Angle of the waist line relative to horizontal |
| Heel width | Distance between bass and treble neck heel points |
| Bass horn R | Radius of the outermost bass horn arc |
| Treble horn R | Radius of the outermost treble horn arc |
| Bass CW R | Radius of the bass cutaway inner arc |
| Treble CW R | Radius of the treble cutaway inner arc |
| Bottom R | Radius of the bottom curve |

Below the morphed values, an A vs B comparison table shows the raw values for both source guitars side by side. In Section Mix mode, the reference guitar pair is taken from the bass side section.

---

## Section Mix Mode: Technical Details

### The Shared Skeleton Problem

In Global Morph mode, all five sections use the same guitar pair and t value. Every section's endpoint targets are automatically consistent - they all come from the same two outlines, so adjacent sections chain together perfectly.

In Section Mix mode, adjacent sections can use completely different guitar pairs at different t values. This creates two problems:

**Cross-section join gaps.** If section N computes its endpoint target from its own guitars, and section N+1 computes its start point from *its own* guitars, those two points will generally not match. The result is either a positional gap or a large xform distortion.

**Closing join mismatch.** `bass_side` is the first section processed and has no `curP` carry to anchor its start. If `bass_side.startP` is computed from its own guitars but `bottom.endP` is computed from bottom's (different) guitars, the outline does not close.

### Skeleton Join Point Map

The fix is a **shared landmark skeleton**: before any section geometry is computed, all six cross-section join points are pre-computed. Each join point is "owned" by one section - it uses that section's guitar pair and t value to lerp a landmark position. Adjacent sections that share the same join point both receive the same pre-computed coordinate, so they always connect.

The six join points and their ownership:

| Join point | Owned by | Method |
|------------|----------|--------|
| Bottom-bass corner | `bottom` endP = `bass_side` startP | Landmark `bottomLeft` |
| Bass horn tip | `bass_side` endP = `inner_bass_cutaway` startP | Raw segment endpoint lerp - no landmark |
| Bass cutaway deep | `inner_bass_cutaway` endP | Landmark `bassCWDeep` |
| Treble heel (neck reset) | `inner_treble_cutaway` startP | Landmark `trebCWDeep` |
| Treble cutaway exit | `inner_treble_cutaway` endP = `treble_side` startP | Raw segment endpoint lerp - no landmark |
| Bottom-treble corner | `treble_side` endP = `bottom` startP | Landmark `bottomRight` |

The two "raw segment lerp" join points - bass horn tip and treble cutaway exit - have no named landmark because they are topological endpoints of a single section with no corresponding feature in other guitars. They are computed by lerping the raw segment endpoints of the owning section's guitars at that section's t value.

This scheme was verified empirically: for all eight guitars, each landmark-matched join point is within 0.01 px of the corresponding segment endpoint. The assignment was determined by measuring the distance from every landmark to every section's actual start and end points.

### Global Mode vs Mix Mode Distinction

A single `buildMorph(nameA, nameB, t, secCfg)` function handles both modes:

- **Global mode**: `secCfg` is `null`. Endpoint targets are computed from raw segment endpoint lerps - identical to pre-section-mix behavior. The skeleton is not computed or used. `inner_treble_cutaway` resets with `curP = null` (start point computed from raw segment data).

- **Mix mode**: `secCfg` is a map of `sectionName → {guitarA, guitarB, t}`. The skeleton is pre-computed and all `startP` / `endP` targets use it. `inner_treble_cutaway` resets with `curP` anchored to the pre-computed `trebCWDeep` skeleton point.

This distinction is critical. The `bassCWDeep` landmark (neck heel, ~y=167 for Strat) is ~400 px away from where `bass_side` actually ends (bass horn tip, ~y=−79 for Strat). Applying the skeleton in global mode would force a massive xform distortion on every guitar's bass side in every morph.

**Validation** across all 168 exhaustive mix-mode combinations (every guitar pair × every section offset × t ∈ {0, 0.5, 1}) and all 280 global-mode morphs: max gap = 0.00 px, max kink = 0.00° at all section joins.

---

## Adding a New Body Shape: Full Workflow

### Step 1 - Draw and Label the SVG in Inkscape

The source SVG must contain the body outline divided into five labeled paths.

**Path labeling convention** (Inkscape `Object Properties → Label`):

```
{Guitar Name} bass side
{Guitar Name} treble side
{Guitar Name} inner bass cutaway
{Guitar Name} inner treble cutaway
{Guitar Name} bottom
```

Examples: `Strat bass side`, `Les Paul inner treble cutaway`, `Wolfgang bottom`

**Important rules:**

1. **Use circular arcs (`A` commands)** in SVG path data, not Bézier curves. The morph engine only understands arcs. Inkscape can convert Bézier splines to arc approximations via extensions, or you can draw arc-by-arc in a CAD tool and export as SVG.

2. **All five paths must be present** - even for guitars without a true feature in a slot. For a guitar with no bass cutaway (like the Les Paul), the `inner bass cutaway` path can be omitted and the assembler will treat the bass side endpoint as the neck heel.

3. **Paths can be in any winding order** - the assembler automatically detects and corrects direction.

4. **Part name aliases** - if a path has an unusual label, add an alias to the `PART_ALIASES` map in `parseSVG.js`:

```javascript
const PART_ALIASES = {
  'My Guitar unusual name': 'inner bass cutaway',
};
```

5. **Save as `source.svg`** in the `guitar-parser/` directory.

---

### Step 2 - Parse the SVG

```bash
cd guitar-parser/
node parseSVG.js
```

Reads `source.svg`, parses all labeled paths into absolute segment coordinates, converts each arc from SVG endpoint form to center form, and writes `guitar_paths_full.json` and `guitars_organized.json`.

**Reading the output:**

```
▶ MyGuitar
   bass side   12 segs  W:310  H:1560  gap:0.0  kink:2.1°  start:[-380,1640]  end:[-105,210]  ✓
```

- `gap` - largest positional gap between consecutive segments within the path (should be < 2 px)
- `kink` - largest tangent discontinuity within the path (~180° means path is stored backwards, auto-corrected by the assembler)

---

### Step 3 - Assemble the Outline

```bash
node assembleFinal.js
```

Sorts the five section chains into a continuous outline, orients them in the correct winding direction, and writes `guitar_final.json`.

**Reading the output:**

```
▶ MyGuitar  (38 segs)
  bass_side→inner_bass_cutaway     gap:  0.0px  kink: 0.8°  ✓
  inner_treble_cutaway→treble_side gap:  0.0px  kink: 0.5°  ✓
  treble_side→bottom               gap:  0.0px  kink: 0.0°  ✓
  bottom→bass_side                 gap:  0.0px  kink: 0.9°  ✓
  Neck heel: bass=[-108,195] treb=[112,360] gap=288.4px
```

- **gap** at each join should be `0.0px`. Larger values mean sections did not connect - check path orientation in Inkscape.
- **kink** should be under 5°. Values above 10° suggest a mis-oriented segment near a section boundary.
- **Neck heel gap** is the intentional open distance between the bass and treble neck heel points (typically 200–400 px).

---

### Step 4 - Extract Landmarks

```bash
node generator.js
```

Scans `guitar_final.json` and identifies named geometric landmarks: horn tips, waist points, bottom point, neck heel entry points, cutaway deep points, and the tangent direction at each heel. Writes `guitar_landmarks.json`.

If any auto-extracted landmarks look wrong (check with the `Landmarks` view overlay enabled), manually correct the values in `guitar_landmarks.json`. The most important values to verify for Section Mix mode are `bassCWDeep`, `trebCWDeep`, `bottomLeft`, and `bottomRight`, as these are used as skeleton join points.

---

### Step 5 - Validate Everything

```bash
node validateFinal.js
```

Runs a full morph validation: every registered guitar pair × 7 values of t × all section joins. Expected output:

```
══════════════════════════════════════════════════
  G1 VALIDATION RESULTS
══════════════════════════════════════════════════
  Guitar pairs tested: 56 × 7 t-values = 392 morphs
  Section joins checked: 588
  Issues (kink>2° or gap>2px): 0
  Max kink observed: 0.00°
  Max gap observed: 0.00px

  ✓ All section joins G1 continuous across all pairs and t values
```

**If you see issues:**

| Symptom | Likely cause |
|---------|-------------|
| `maxGap > 0` at a section boundary | Section endpoint positions inconsistent - check `assembleFinal.js` output for that guitar |
| `maxKink > 2°` at a cross-section join | The `heelTangents` entry in `guitar_landmarks.json` is inaccurate for one of the guitars |
| NaN values | A section has near-zero-length arcs - check the assembled chain for degenerate segments |
| Wrong shape at t=0 or t=1 | Assembled outline is not correctly oriented - check `assembleFinal.js` winding |

---

### Step 6 - Register in the App

Add the new guitar to two places in `morph_app_template.html`:

**1. The `GUITARS` constant:**
```javascript
const GUITARS = ['Strat', 'Tele', 'Jazzmaster', 'Mustang',
                 'Fender Lead', 'Akula', 'Wolfgang', 'Les Paul',
                 'MyGuitar'];   // ← add here
```

**2. The `COLORS` map:**
```javascript
const COLORS = {
  'Strat':       '#ff5e5e',
  // ... existing entries ...
  'MyGuitar':    '#00e5a0',   // ← add here, any hex colour
};
```

---

### Step 7 - Rebuild the App

```bash
node buildMorphApp.js
```

Open `guitar_morph_app.html` in a browser. Your new shape should appear in the guitar list (Global Morph mode) and in every section's guitar picker popup (Section Mix mode), and morph smoothly with all existing shapes.

---

## Data File Reference

### `guitar_final.json`

Top-level keys are guitar names. Each value contains:

```json
{
  "guitar": "Strat",
  "totalSegments": 35,
  "sections": [
    {
      "name": "bass_side",
      "segStart": 0,
      "segEnd": 10,
      "startPt": { "x": -459.4, "y": 1570.5 },
      "endPt":   { "x": -422.4, "y":  -78.8 }
    }
  ],
  "neckHeelBassEnd":     { "x": -109.1, "y": 167.0 },
  "neckHeelTrebleStart": { "x":  119.4, "y": 370.8 },
  "neckHeelGap_px": 306.2,
  "segments": [
    {
      "type": "arc",
      "x0": -459.4, "y0": 1570.5,
      "x1": -612.0, "y1": 1287.2,
      "rx": 580.0, "ry": 580.0,
      "rot": 0, "largeArc": false, "sweep": true,
      "arcLength": 320.4,
      "tangentStart": { "x": -0.466, "y": -0.885 },
      "tangentEnd":   { "x": -0.866, "y":  0.500 }
    },
    {
      "type": "line",
      "x0": -454.0, "y0": 600.0,
      "x1": -526.0, "y1":  51.0,
      "length": 554.7,
      "tangentStart": { "x": -0.129, "y": -0.992 },
      "tangentEnd":   { "x": -0.129, "y": -0.992 }
    }
  ]
}
```

### `guitar_landmarks.json`

Top-level keys are guitar names. Each value contains:

| Field | Description |
|-------|-------------|
| `landmarks.bassHornTip` | Outermost point of the bass horn |
| `landmarks.trebHornTip` | Outermost point of the treble horn |
| `landmarks.bottomPt` | Lowest point of the body (strap button end) |
| `landmarks.bottomLeft` | Bottom-bass corner - start of `bass_side`, end of `bottom`. Used as skeleton join point in Section Mix mode. |
| `landmarks.bottomRight` | Bottom-treble corner - end of `treble_side`, start of `bottom`. Used as skeleton join point. |
| `landmarks.heelBass` | Last endpoint of `inner_bass_cutaway` (bass side of neck pocket) |
| `landmarks.heelTreble` | First endpoint of `inner_treble_cutaway` (treble side of neck pocket) |
| `landmarks.bassCWDeep` | Deep point of the bass cutaway - end of `inner_bass_cutaway`. Used as skeleton join point. |
| `landmarks.trebCWDeep` | Deep point of the treble cutaway - start of `inner_treble_cutaway`. Used as skeleton join point and heel reset anchor. |
| `landmarks.waistBass` | Narrowest point on the bass flank |
| `landmarks.waistTreble` | Narrowest point on the treble flank |
| `heelTangents.bass` | Unit tangent vector at the bass neck heel endpoint |
| `heelTangents.treble` | Unit tangent vector at the treble neck heel endpoint |
| `params` | Scalar measurements derived from landmarks (body height, widths, horn radii, etc.) |

---

## Validation Reference

### `node parseSVG.js`

Checks raw SVG → segment conversion:
- Position gaps between consecutive segments within a path (should be < 2 px)
- Tangent kinks between consecutive segments (flags > 8°, error > 20°)
- Bounding box sanity check on scale

### `node assembleFinal.js`

Checks five-section assembly:
- Position gap at each section join (should be 0 px)
- Tangent kink at each section join (should be < 5°)
- Position gap at the closing join `bottom → bass_side` (should be 0 px)
- Neck heel gap (informational; expected 200–400 px)

### `node validateFinal.js`

Validates the morph engine across all guitar pairs:
- G1 continuity at every section join for all pairs at 7 values of t
- Zero positional gaps at all joins
- No NaN values in any morphed arc

This is the definitive pass/fail test. **All new shapes must pass before the app is rebuilt.**

---

## Arc Math Reference

### SVG Arc to Center Form

SVG stores arcs in endpoint parameterisation: `A rx ry x-rotation large-arc-flag sweep-flag x y`. The morph engine needs center parameterisation. The conversion (implemented in `parseSVG.js`, function `arcToCenterForm`) computes:

- `(cx, cy)` - center of the circle
- `theta1` - angle from center to start point (radians)
- `dtheta` - signed angular span
- `tangentStart`, `tangentEnd` - unit tangent vectors at both endpoints

### Curvature Sign Convention

In the morph engine (SVG Y-down coordinate system):

```
κ = +1/R   →   sweep=true  (clockwise on screen, curving to the right of direction of travel)
κ = −1/R   →   sweep=false (counter-clockwise on screen, curving to the left)
κ = 0      →   straight line
```

### Center from Tangent and Start Point

To reconstruct a circle from a start point `p0`, a unit tangent `(tx, ty)` at `p0`, and a radius `R`:

```
sweep=true  (CW):  center = p0 + R × (−ty,  tx)
sweep=false (CCW): center = p0 + R × ( ty, −tx)
```

### Arc Length

For a circular arc with radius R and angular span |dθ|:

```
arcLength = R × |dθ|
```

---

## Known Limitations and Future Work

### Current Goals

**Section mix global slider** - The Global Slider is currently only shown on the Global Mix tab. It should also be shown on the Section Mix tab.

**Cutaway style transitions** - When morphing between a shape with a bass cutaway (e.g. Strat) and one without (e.g. Les Paul), the `inner_bass_cutaway` section degenerates. The current engine uses the available section for both A and B when one is missing, which produces a reasonable result but does not fully remove the cutaway. A future improvement would remove the degenerate section and extend `bass_side` by adding an arc with G2 continuity whose length is determined by the neck heel width of the guitar with the missing section.

**Smoothing** - In Section Mix mode, it would be helpful to have options for smoothing the final path after all assembly has been done. Two future features are planned to implement this:
- **G1 (tangent continuity)** This option would check the final assembled path for G1 tangency using a high amount of precision. Any points that are not completely tangent would have fillets of a user specified radius added.
- **G2 (curvature continuity)** This option is similar to G1 smoothing but checks the final assembled path for G2 curvature continuity. Arcs are applied to smooth the path using calculated radii to achieve G2 continuity.

**Section mix parameter display** - In Section Mix mode, the right panel's parameter readout and A vs B comparison table use only the bass side section's guitar pair as a reference. A future improvement would show per-section parameters or let the user choose the reference section.

**Custom mode** - A future mode implemenation would allow advanced users to create their own guitar body shapes using text field entry to modify parameters.

**Real-world units** - Parameters are currently displayed in SVG pixels. A future improvement would convert these to mm or inches and allow rescaling the entire outline to a target body width and/or length.

**Mirroring** - A future feature would add a mirroring toggle for creating left-handed guitar shapes.

**SVG / DXF export** - A future feature would add an export button for direct use in CAD/CAM software.

### Todo Later:

**Neck heel** - The app does not yet close the neck heel gap or add the heel geometry. This is required for solid closed geometry suitable for guitar building. This will be implemented in a future feature. The neck heel is essentially a trapezoid with dimensions that can be user specified. This shape will be combined with the main guitar body shape. The body cutaway geometry will be trimmed or extended as needed to intersect the neck heel, then the neck heel will be trimmed and have extraneous lines removed until a single closed path remains. Then, fillets of a user speicifed radius are applied to the inside corners where the new heel meets the body path. Finally, fillets of a different radius are applied to any external non-tangent points.