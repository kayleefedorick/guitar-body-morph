# Guitar Body Morphing App

This app morphs classic guitar outlines by blending how the shapes **bend** (curvature) rather than just blending point positions. By integrating this blended curvature, the engine produces smooth, **G1 tangent-continuous** results ready for CAD and CNC toolpath generation.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project File Structure](#project-file-structure)
3. [How the Morphing Engine Works](#how-the-morphing-engine-works)
4. [Body Shape Topology](#body-shape-topology)
5. [The Generated Bottom](#the-generated-bottom)
6. [The Shared Skeleton System](#the-shared-skeleton-system)
7. [Adding a New Body Shape](#adding-a-new-body-shape)
8. [Data File Reference](#data-file-reference)
9. [Known Limitations](#known-limitations)

---

## Quick Start

1. **Open** `guitar_morph_app.html` in any modern web browser.
2. **Global Morph**: Click a guitar name for Shape A; **Shift+Click** for Shape B.
3. **Section Mix**: Click **SECTION MIX** to assign different guitars to specific body regions.
4. **Controls**:
* **Slider**: Adjust morph parameter $t$ (0.0 to 1.0).
* **Left/Right Arrows**: Fine-tune $t$ by $\pm 0.01$.
* **Space**: Instant jump between Shape A and B.
* **Drag/Scroll**: Pan and zoom the canvas.



---

## Project File Structure

The pipeline operates in four distinct steps to move from raw art to a functional app:

* **`parseSVG.js`**: Reads `source.svg` and converts labeled paths into absolute segment coordinates.
* **`assembleFinal.js`**: Sorts section chains into a continuous outline and checks join quality.
* **`generator.js`**: Extracts named landmarks (horn tips, heel points, etc.) and tangent angles.
* **`buildMorphApp.js`**: Injects data into the HTML template to create the final `guitar_morph_app.html`.
* **`validateFinal.js`**: A definitive test suite checking 500+ morph combinations for gaps or kinks.

---

## How the Morphing Engine Works

### The Curvature Integration Approach

Instead of moving points along a straight line, the engine blends the "bending" of the curves:

1. **Curvature ($κ$):** Arcs are converted to signed curvature values ($κ = \pm 1/R$).
2. **Normalization:** Both guitar profiles are mapped to a common length scale.
3. **Blending:** Curvature is blended at parameter $t$: $κ(u) = κ_A(u) + (κ_B(u) - κ_A(u)) \times t$.
4. **Integration:** The engine integrates curvature to find tangent angles ($\theta$), then integrates again to find $(x, y)$ positions.

### Endpoint Correction and Tangent Carry

To ensure sections meet perfectly, a **similarity transform** (scale and rotation) is applied to each section to make it land on its interpolated target endpoint. A **tangent carry** system passes the rotation to the next section to maintain smooth G1 joins.

---

## Body Shape Topology

The outline is divided into five sections that form a connected ring:

1. **`bass_side`**: Bottom-bass corner to the bass horn tip.
2. **`inner_bass_cutaway`**: Bass horn tip to the bass neck heel.
3. **[Neck Heel Gap]**: An intentional opening between the bass and treble heels.
4. **`inner_treble_cutaway`**: Treble neck heel to the treble horn tip.
5. **`treble_side`**: Treble horn tip to the bottom-treble corner.
6. **`bottom`**: Connects the treble and bass corners across the strap-button end.

---

## The Generated Bottom

The bottom of the guitar is created using a **G1 tangent-continuous solver**. Instead of blending fixed shapes, the engine calculates a synthetic arc that "fillets" the gap between the treble and bass flanks.

* **Collinear Centers**: The solver ensures the center points of the side arcs and the bottom arc are aligned, creating a perfectly smooth transition.
* **Round Control**: The user can adjust the bottom depth using a slider:
* **Flat (0.0)**: A shallow, broad arc.
* **Natural (0.5)**: Matches the average depth of the source guitars.
* **Deep (1.0)**: A pronounced, rounded curve.

At the most extreme ranges, the Round Control may produce incorrect geometry. This is largely dependent on the geometry of the paths being joined.

---

## The Shared Skeleton System

In **Section Mix mode**, the app uses a Shared Skeleton to prevent parts from drifting apart. This framework acts as a pre-computed map of "Join Points."

* **Join Points**: Specific coordinates (like horn tips and heel corners) are calculated first by interpolating between selected guitars.
* **Forced Alignment**: Every individual section is forced to start and end at these shared coordinates.
* **Seamless Mixing**: This allows you to combine a "Strat" bass horn with a "Tele" treble side without creating gaps or sharp kinks in the geometry.

---

## Adding a New Body Shape

### 1. Inkscape Workflow

* **Labeling**: Use **Object Properties - Label** to name paths exactly: `{Guitar Name} {section name}`.
* **Arcs Only**: Use circular arcs (`A` commands) rather than Bezier curves.
* **Coordinate System**: $(0,0)$ is the neck centerline. $+Y$ is toward the strap button.

### 2. Registration and Build

1. Save your file as `source.svg`.
2. Run the build pipeline: `parseSVG.js` -> `assembleFinal.js` -> `generator.js` -> `validateFinal.js` -> `buildMorphApp.js`.
3. Add the name and hex color to `GUITARS` and `COLORS` in `morph_app_template.html`.

---

## Data File Reference

### `guitar_final.json`

Stores the assembled geometry and metadata for each guitar.

```json
{
  "Strat": {
    "totalSegments": 35,
    "sections": [
      {
        "name": "bass_side",
        "startPt": { "x": -459.4, "y": 1570.5 },
        "endPt":   { "x": -422.4, "y": -78.8 }
      }
    ],
    "segments": [
      {
        "type": "arc",
        "rx": 580.0, "ry": 580.0,
        "sweep": true,
        "arcLength": 320.4
      }
    ]
  }
}

```

### `guitar_landmarks.json`

Stores key skeleton points used to align sections in **Section Mix** mode:

* **`bassHornTip` / `trebHornTip**`: The ends of the horns.
* **`bottomLeft` / `bottomRight**`: The lower corners of the body.
* **`heelTangents`**: Unit vectors ensuring the neck pocket joins remain smooth.

---

## Known Limitations

* **Degenerate Cutaways**: Morphing between a cutaway and a non-cutaway shape can produce artifacts; G2 smoothing is a planned fix.
* **Units**: Measurements are in SVG pixels ($\approx 1\text{mm}$); real-world scaling for mm/inches is planned.
* **Mirroring**: A future feature would add a mirroring toggle for creating left-handed guitar shapes.
* **SVG / DXF export**: A future feature would add an export button for direct use in CAD/CAM software.
* **Custom mode**: A future mode would allow advanced users to create their own guitar body shapes using text field entry to modify parameters.
* **Neck heel**: The app does not yet close the neck heel gap or add the heel geometry. This is required for solid closed geometry suitable for guitar building. This will be implemented in a future feature. The neck heel is essentially a trapezoid with dimensions that can be user specified. This shape will be combined with the main guitar body shape. The body cutaway geometry will be trimmed or extended as needed to intersect the neck heel, then the neck heel will be trimmed and have extraneous lines removed until a single closed path remains. Then, fillets of a user-specified radius are applied to the inside corners where the new heel meets the body path. Finally, fillets of a different radius are applied to any external non-tangent points.