# Pascal Plugin Structural (`@kruschdev/pascal-plugin-structural`)

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](./LICENSE)
[![Pascal Plugin API v1](https://img.shields.io/badge/Pascal_Plugin_API-v1-38bdf8.svg)](https://github.com/pascalorg/editor)
[![Kernel](https://img.shields.io/badge/Kernel-%40kruschdev%2Fpascal--mep--kernel-a78bfa.svg)](https://github.com/kruschdev/pascal-mep-kernel)
[![3D CAD Models](https://img.shields.io/badge/MIT_3D_CAD_Models-62_.glb-10b981.svg)](./docs/CAD-CATALOG.md)
[![IRC/NDS Tests](https://img.shields.io/badge/Tests-104%2F104_Passing-22c55e.svg)](./src/__tests__)

An open-source, MIT-licensed **Residential and Light-Commercial IRC / AWC NDS / WFCM / AISC Structural Framing** plugin for [Pascal Editor](https://github.com/pascalorg/editor) (`pluginId: krusch:structural`).

I built this as a standalone external plugin implementing Pascal's full Plugin API v1 and `E-016` agent contracts on top of [`@kruschdev/pascal-mep-kernel`](https://github.com/kruschdev/pascal-mep-kernel) so it drops cleanly into any Pascal host without requiring upstream core merges. It anchors **Priority #1** in the 4-trade right-of-way hierarchy (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`), sharing exact roof planes, 3D opening prisms, concave footprints, rotated beam/column OBBs, and single-source declarative IRC rules with the rest of the MEP stack.

> [!NOTE]
> **Active Iteration:** Verified with `104 / 104` deterministic unit tests (`1,493` assertions), `5 / 5` entry boundary gates, and audited across `246` real public Pascal buildings (`0` crashes, `0/0/0/0` errors on two-story Aymeric House alongside Plumbing, HVAC, and Electrical). I am still actively expanding framing edge cases and connector details across complex multi-roof architectures.

## 4-Trade Coordinated Cutaway (Shared `@kruschdev/pascal-mep-kernel`)

![Aymeric House Finished Architecture vs 4-Trade Coordinated MEP Cutaway powered by @kruschdev/pascal-mep-kernel](https://raw.githubusercontent.com/kruschdev/pascal-mep-kernel/main/assets/social-preview.png)

Watch the full two-story Aymeric House finished-to-cutaway walkthrough (Structural -> Plumbing -> Dual-Wing HVAC -> Electrical, `1,412` coordinated nodes, `0/0/0/0` errors) in [`@kruschdev/pascal-mep-kernel`](https://github.com/kruschdev/pascal-mep-kernel).

## Walkthrough Video (Recorded Live in Pascal Editor)

![Live Pascal Editor Walkthrough: One-Click IRC/NDS Auto-Frame on Craftsman 32x24 House, Live Switch from Stick Rafters to Prefab Fink W-Trusses, Structural Layer Peeling, Quick-Place Steel HSS Column, HDU5 Hold-Down & Firestop, and Split-Pane 7-Tab Engineering Schedule & Priced BOM](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walkthrough.gif)

**[Watch Full 720p HD Walkthrough Video Recorded in Pascal Editor (`assets/demo-walkthrough.mp4`)](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walkthrough.mp4)**

## Showcase Gallery

![4-Panel 3D Structural Assembly Cutaways: Wall Framing & Window Header (IRC R602.7), TJI I-Joist & LVL Girder Floor System (IRC R502), Fink Roof Truss & H2.5A Hurricane Ties (IRC R802.10), and Seismic Braced Shear Wall with Dual HDU5 Hold-Downs & BP3x3 Washers (IRC R602.10)](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-structural-cutaways.png)

![Full-Building 3D Stick-Rafter Structural Framing Skeleton with LVL Ridge Beam, Framing X-Ray Cutaway, and Engineered Headers](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-stick-rafter.png)

![Prefab Fink W-Truss Roof System with Galvanized Steel Gusset Connector Plates, Gable Rake Studs, and Framing X-Ray](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-fink-truss.png)

![Wall Framing Close-Up: Pressure-Treated Mudsills Cut at Doors, Double Top Plates, 3-Stud Corners, King/Jack Studs, Engineered LVL Headers, Double Window Sills, and Bounded Cripples](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walls-headers.png)

![Split-Pane Pascal Editor 3D Framing X-Ray Viewport and Live Populated 7-Tab Structural Engineering Schedule](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-structural-schedule.png)

![62 Clean-Room MIT Structural CAD Models (.glb): Built-Up, LSL, LVL, PSL, Glulam, Flitch & Steel W-Beams, TJI I-Joists, Prefab Trusses, Columns & Footings, 47 Simpson-Class Connectors, Fire Blocking & Structural Assembly Cutaways](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/cad-material-catalog.png)

### 62-Model Clean-Room MIT CAD Library (7 Categories)

| Category | Count | Included Highlights |
|---|---|---|
| **Engineered & Structural Beams** | 10 | `(2) 2x10` & `(3) 2x12` Built-Up Headers/Girders, `1.55E` LSL, 2- & 3-Ply `2.0E` LVL, `2.0E` PSL Parallam, `24F-V4` Glulam, A36 Steel Flitch Beam, A992 `W10x22` & `W12x40` Wide-Flange Steel Beams |
| **I-Joists & Prefabricated Trusses** | 7 | `TJI-110`, `TJI-230`, `TJI-560` Engineered I-Joists w/ LVL flanges & factory knockouts, 16" Open-Web Parallel-Chord Floor Truss, 24 ft Fink W-Web, Scissor Vaulted, and 28 ft Room-in-Attic Roof Trusses |
| **Structural Columns & Footings** | 6 | `4x4` DF-L Post, `(3) 2x6` King Post, `5-1/4"` PSL Column, `5-1/2"` Architectural Glulam Column, `3-1/2"` Concrete-Filled Steel Lally, and `HSS 4x4x1/4` Steel Column w/ Spread Pad Footings |
| **Hurricane Ties & Framing Clips** | 9 | `H1`, `H2.5A`, `H10A`, `HGA10`, `MTS16`, `HTS20` Twisted Uplift Straps, `A35` 3-Way Framing Angle, `LTP4` Lateral Tie Plate, `LS50` Field-Skewable Angle |
| **Joist & Engineered Beam Hangers** | 7 | `LUS210`, `HUS210`, `LSSU210` Sloped/Skewed Rafter Hanger, `IUS2.56/11.88` & `MIT411.88` I-Joist Hangers, `HGUS5.50/12` Heavy Girder Hanger, `HUCQ410-SDS` Concealed-Flange Hanger |
| **Post Bases, Caps & Hold-Downs** | 13 | `ABU44Z`, `ABU66Z`, `CB66` Post Bases, `BC4`, `LPC6Z`, `CCQ66` Post Caps, `HDU2`, `HDU5`, `HDU11` Hold-Downs, `STHD14`, `MSTC40` Strap, `BP3x3` Seismic Plate Washer, `SSTB16` Anchor Bolt |
| **Fire Blocking & Assembly Cutaways** | 10 | `IRC R302.11(1)-(5)` Stud Cavity, Soffit, Mineral-Wool Chase & UL Intumescent Collar Firestops, `R302.12` Floor Draftstop, plus 5 Full Modular Wall/Floor/Roof/Shear-Wall/Foundation Cutaways |

## Key Capabilities

1. **Multi-Species Dimensional Framing (`IRC 2021/2024` and `AWC NDS 2024`)**: Full span tables and NDS design values (`Fb`, `Fv`, `Fc`, `Fc_perp`, `E`, `Emin`, NDS Table 4A size factors `Cf`, and NDS 2024 Table 4B size-specific SYP `Fb` values) for **Douglas Fir-Larch #2**, **Spruce-Pine-Fir #2**, **Southern Yellow Pine #2**, and **Hem-Fir #2** across `12"`, `16"`, and `24"` OC framing, plus automatic `2x6` wet-wall upgrades near plumbing fixtures and wet rooms.
2. **Full-Building 3D `InstancedMesh` Framing Skeleton and Framing X-Ray**: Renders complete per-level structural skeletons in <= 8 batched draw calls (walls, framed door/window openings with zero studs piercing glass, TJI I-joists or Warren open-web floor trusses seated cleanly below slab soffits, stick rafters or Fink/Scissor/Attic roof trusses with exact point-to-point basis quaternions, continuous strip footings, and distributed Simpson-class hardware), paired with a one-click **Finished View | Framing X-Ray** toggle synced directly to Pascal's `wallMode`.
3. **Engineered Wood, Laminated Beams, and Structural Steel**: First-class `structural:beam` sizing and 3D CAD geometry for **Built-Up Dimensional**, **LSL 1.55E**, **LVL 2.0E 2600Fb** (1- to 4-ply), **PSL 2.0E Parallam**, **Glulam 24F-V4 / 24F-V8**, **A36 Flitch Beams**, and **A992 Steel W-Beams** (`W8x18` to `W14x30`), with multi-bay floor girder and cathedral ridge-beam splitting, ASD bending/shear checks, `L/360` and `L/240` deflection checks, bearing length (`IRC R502.6`), and exact jack-stud counts (`IRC R602.7`).
4. **47-SKU Simpson-Class Connector and Hardware Catalog**: Clean-room MIT galvanized-steel 3D CAD models and ASD uplift/download/lateral capacities across all 10 hardware families: **Hurricane Ties** (`H1`, `H2.5A`, `H10A`, `HGA10`, `MTS16`, `HTS20`), **Framing Angles and Clips** (`A35`, `A34`, `LTP4`, `L50`, `LS50`), **Joist and Beam Hangers** (`LUS26` to `LUS212`, `HUS210`, `LSSU210`, `IUS2.56/11.88`, `MIT411.88`, `HHUS210-2`, `HHUS410`, `HHUS5.50/10`, `HGUS5.50/12`, `HUCQ410-SDS`), **Post Bases and Caps** (`ABU44Z` to `ABU66Z`, `CB44`/`CB66`, `BC4`, `LPC4Z`/`LPC6Z`, `CCQ46`/`CCQ66`), **Hold-Downs and Straps** (`HDU2` to `HDU11`, `STHD14`, `LSTA24`, `MSTA36`, `MSTC40`, `CS16`, `CS-PF`), and **Seismic Anchorage** (`BP3x3` plate washers, `SSTB16` anchor bolts).
5. **Complete `IRC R302.11` Fire Blocking and `IRC R302.12` Draftstopping**: Derives, models, and audits all 8 code-mandated firestop planes: `10 ft` vertical stud cavities (`R302.11(2)`), furred walls (`R302.11(2)`), soffits and drop ceilings (`R302.11(1)`), stair stringers top and bottom (`R302.11(3)`), vertical chases and chimneys (`R302.11(4)`), MEP pipe/conduit/duct plate penetration collars (`R302.11(5)`), floor-ceiling draftstopping (`<= 1,000 sq ft`, `R302.12`), and attic draftstopping (`<= 3,000 sq ft`, `R302.12.1`).
6. **Continuous Load-Path Tracing and `IRC R602.10` Braced Wall Lines**: Traces gravity loads from beams through columns, TJI squash blocks, and spread pad footings (`IRC R403.1`), audits continuous wind/seismic uplift paths, and evaluates `R602.10` braced wall percentages with `CS-PF` portal and engineered shear-wall escalation.
7. **Priority #1 Cross-Trade Interop and Kernel Parity**: Persists 5 clean scene-graph nodes (`structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, `structural:firestop`) and shares [`@kruschdev/pascal-mep-kernel`](https://github.com/kruschdev/pascal-mep-kernel) (`7`-type canonical roof shell, raised-heel roof framing, uncovered flat-roof joists, rotated OBB clash detection, and declarative IRC wind/seismic/bearing rules) so `@kruschdev/pascal-plugin-plumbing`, `@kruschdev/pascal-plugin-hvac`, and `@kruschdev/pascal-plugin-electrical` automatically snap to real studs, route around LVL/Glulam/steel beams and columns as inviolable no-bore keep-outs, and coordinate `R302.11(5)` penetration firestops with zero cross-plugin npm coupling. `auditStructuralScene` enforces per-level beam and column MEP clashes directly (while stud `IRC R602.6` bore/notch rules and TJI web-hole clearances are checked by downstream MEP trade routers against published `structural:assembly` and `TJI_IJOIST_CATALOG` metadata). The priced BOM quantifies wall studs and plates, persisted beams, columns and spread pad footings, Simpson-class connectors, and firestop assemblies (excluding field floor joists, roof rafters/trusses, sheathing, and continuous strip footings).

## Documentation

| Guide | What It Covers |
|---|---|
| **[Architecture Guide](./docs/ARCHITECTURE.md)** | System layout, 5 entrypoint boundary gates, 5 `structural:*` node schemas, and parametric R3F instanced rendering |
| **[IRC / AWC NDS Reference](./docs/IRC-REFERENCE.md)** | Multi-species span tables, NDS ASD beam/column formulas, Simpson-class hardware selection, R302.11/R302.12 fire blocking, and R602.10 bracing |
| **[62-Model MIT 3D CAD Catalog](./docs/CAD-CATALOG.md)** | Full inventory of all 62 procedural `.glb` structural and hardware models and programmatic `./cad` builders |
| **[Agent Tools Reference (`E-016`)](./docs/AGENT-TOOLS.md)** | All 9 pure Zod agent tools and headless scene operations for MCP servers, chat workflows, and automation |
| **[Media Kit & Launch Copy](./docs/MEDIA-KIT.md)** | Ready-to-share social preview (`1280 x 640`), HD walkthrough video, high-res screenshots, 4-panel cutaways, CAD contact sheet, and launch copy |
| **[Walkthrough Voiceover Script](./docs/WALKTHROUGH-SCRIPT.md)** | Timed 60-second narration beat sheet and one-command Gemini TTS (`gemini-3.8-flash-tts`) + `ffmpeg` muxing script (`scripts/add-voiceover.sh`) |

## Package Entrypoints

| Entrypoint | Export | Boundary Guarantee |
|---|---|---|
| `.` | `structuralPlugin`, `structuralHostPanel`, `structuralScheduleView`, `structuralChatExtension` | Full editor integration (`EditorHostPanel`, 7-tab `EditorHostView`, `InspectorExtension`, chat cards) |
| `./render` | `structuralRenderPlugin` | Editor-free read-only viewer manifest (verified by `bun run check:render`) |
| `./cad` | `STRUCTURAL_CAD_CATALOG`, `buildBuildingSkeletonGroup`, `buildBeamCad`, `buildConnectorCad`, `buildAssemblyPreviewCad` | Editor-free, React-free Three.js CAD builders for all 62 structural and connector models |
| `./irc` | Pure IRC/NDS sizing, auto-populate, audit, fire blocking, load-path, schedule, and BOM pricing functions | Framework-free TypeScript (zero React, Three.js, or `@pascal-app/*`) |
| `./agent-tools` | `structuralAgentTools` (`PluginAgentTools`, `E-016`) | Pure Zod-only contracts (`9` tools + skill) |
| `./agent-operations` | `structuralAgentOperations` (`AgentOperations`, `E-016`) | Pure headless scene operations with uniform `changes: { delete, create }` envelopes |

## Quick Start in a Pascal Host

```bash
npm install @kruschdev/pascal-plugin-structural
# or
bun add @kruschdev/pascal-plugin-structural
```

Register alongside the rest of the 4-trade suite (`structural`, `plumbing`, `hvac`, `electrical`):

```ts
import { extendPluginDiscovery } from '@pascal-app/core'
import { registerEditorHostPanel, registerEditorHostView } from '@pascal-app/editor'
import {
  structuralHostPanel,
  structuralPlugin,
  structuralScheduleView,
} from '@kruschdev/pascal-plugin-structural'

extendPluginDiscovery(async () => [structuralPlugin])
registerEditorHostPanel(structuralHostPanel)
registerEditorHostView(structuralScheduleView)
```

For read-only viewers (zero `@pascal-app/editor` bundle overhead):

```ts
import { setPluginDiscovery } from '@pascal-app/core'
import { structuralRenderPlugin } from '@kruschdev/pascal-plugin-structural/render'

setPluginDiscovery(async () => [structuralRenderPlugin])
```

## Development and Verification

```bash
bun install
bun run check          # tsc --noEmit + bun test src (104/104 tests) + 5/5 entry gates + dist/ build + Turbopack chunk gate
bun run export:cad     # Export all 62 clean-room .glb structural CAD models + catalog.json to assets/cad/
bun scripts/render-cad-thumbnails.ts     # Re-render all 62 studio thumbnails + 6x11 contact sheet
bun scripts/render-structural-cutaways.ts # Re-render 4-panel 3D structural assembly cutaways
PASCAL_EDITOR_URL=http://localhost:3210/project/structural-media-showcase bun run render:walkthrough # Re-render assets/demo-walkthrough.mp4 and .gif
bun scripts/render-social-preview.ts     # Re-render 1280x640 OpenGraph social preview card
bash scripts/add-voiceover.sh --voice Charon --replace-main # Synthesize & mux Gemini TTS narration
```

> **Engineering Disclaimer**: All IRC/AWC/NDS/AISC calculations, beam selections, connector schedules, fire-blocking audits, and BOM estimates in this plugin are deterministic drafting and pre-engineering aids and never substitute for a licensed Structural Engineer (SE/PE) stamp or local AHJ approval.

## License

MIT. Created by Kevin Ruschman ([@kruschdev](https://github.com/kruschdev)).
