# Media Kit and Launch Package (`@kruschdev/pascal-plugin-structural`)

Ready-to-share narrated walkthrough video, high-resolution screenshots, 4-panel 3D structural cutaways showcase, 62-model CAD contact sheet, OpenGraph hero banner, and launch copy for [`@kruschdev/pascal-plugin-structural`](https://github.com/kruschdev/pascal-plugin-structural).

## Included Visual Assets

| Asset | Resolution / Format | Best Use |
|---|---|---|
| [`assets/social-preview.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/social-preview.png) | `1280 x 640` PNG | GitHub Social Preview, OpenGraph card, LinkedIn/X link banner |
| [`assets/demo-walkthrough.mp4`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walkthrough.mp4) | `1280 x 720` H.264 MP4 (`62.9s`, narrated AAC + `+faststart`) | X video post, LinkedIn native video, YouTube, GitHub Release |
| [`assets/demo-walkthrough.gif`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walkthrough.gif) | `640px` palette-optimized GIF | README preview, Reddit, Discord, Slack |
| [`assets/demo-stick-rafter.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-stick-rafter.png) | `1440 x 810` PNG | Live Pascal Editor Framing X-Ray showing 2x6 DF-L #2 studs, TJI I-joists, stick rafters, LVL ridge beam & headers |
| [`assets/demo-fink-truss.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-fink-truss.png) | `1440 x 810` PNG | Live Pascal Editor Framing X-Ray showing prefab Fink W-truss roof with galvanized gusset plates & open-web floor trusses |
| [`assets/demo-walls-headers.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-walls-headers.png) | `1440 x 810` PNG | Live Pascal Editor wall framing close-up (roof layer peeled): PT mudsills cut at doors, double top plates, 3-stud corners, kings, jacks & headers |
| [`assets/demo-structural-cutaways.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-structural-cutaways.png) | `1920 x 760` PNG | 4-panel studio 3D Structural Cutaways showcase (Wall & Header, TJI Floor, Fink Roof Truss, IRC R602.10 Seismic Shear Wall) |
| [`assets/demo-structural-schedule.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/demo-structural-schedule.png) | `1440 x 810` PNG | Live split-pane 3D Framing X-Ray house + populated 7-Tab Structural Engineering Schedule |
| [`assets/cad-material-catalog.png`](https://github.com/kruschdev/pascal-plugin-structural/releases/download/v0.2.0/cad-material-catalog.png) | `1920 x 2794` PNG | Complete 62-model clean-room MIT Structural CAD catalog contact sheet (6x11 studio grid) |
| [`docs/WALKTHROUGH-SCRIPT.md`](./WALKTHROUGH-SCRIPT.md) | Markdown Beat Sheet | Timed ~60-second chapter-by-chapter narration script & TTS input text |
| [`scripts/add-voiceover.sh`](../scripts/add-voiceover.sh) | Bash (`gemini-api tts` + `ffmpeg`) | One-command Gemini TTS synthesis (`gemini-3.8-flash-tts`) and AAC muxing into `assets/demo-walkthrough-narrated.mp4` |

## Project Facts (Quick Reference)

- **Repository**: `https://github.com/kruschdev/pascal-plugin-structural`
- **npm Package**: `https://www.npmjs.com/package/@kruschdev/pascal-plugin-structural` (`@kruschdev/pascal-plugin-structural`)
- **License**: MIT (clean-room procedural Three.js PBR geometry, zero third-party meshes)
- **Host Compatibility**: Pascal Editor Plugin API v1 (`E-014`, `E-016`, `E-017`), zero upstream core changes required
- **4-Trade Hierarchy**: Anchors **Priority #1** (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`) via 5 persisted scene nodes (`structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, `structural:firestop`)
- **3D CAD Library**: 62 exported binary `.glb` models + 62 studio thumbnails across 7 categories (Engineered & Structural Beams, I-Joists & Prefabricated Trusses, Structural Columns & Footings, Hurricane Ties & Framing Clips, Joist & Engineered Beam Hangers, Post Bases / Caps & Hold-Downs, Fire Blocking & Assembly Cutaways)
- **Hardware Catalog**: 47 Simpson-class galvanized steel connector SKUs across 10 hardware families with ASD uplift, download, and lateral capacities
- **Verification**: 55/55 deterministic IRC 2021/2024, AWC NDS 2024, WFCM, AISC 360, fire-blocking, continuous load-path, cross-trade coordination, CAD, and boundary tests (`697` assertions), `tsc --noEmit` clean, 5/5 entrypoint boundary gates, compiled Node 22 ESM + Bun `dist/` build with Turbopack chunk gate

## Ready-to-Post Copy

### Pascal GitHub Discussions (`pascalorg/editor` -> `Show and tell`)

**Category**: `Show and tell` (`https://github.com/pascalorg/editor/discussions/categories/show-and-tell`)

**Title**: `MIT Residential & Light-Commercial IRC/NDS Structural Framing Plugin (@kruschdev/pascal-plugin-structural): Full-Building 3D Framing X-Ray, LVL/Glulam/Steel Beams, 47-SKU Connectors, and 62 .glb CAD Models`

**Attachments to drag-and-drop into the GitHub Discussion editor**:
1. `assets/demo-walkthrough.mp4` (renders an inline native video player in GitHub Discussions)
2. `assets/demo-structural-cutaways.png`

**Body**:

I built a standalone, MIT-licensed **Residential and Light-Commercial IRC / AWC NDS / WFCM / AISC Structural Framing** plugin for Pascal Editor (`@kruschdev/pascal-plugin-structural`, `pluginId: krusch:structural`) implementing Pascal's Plugin API v1 (`E-014`, `E-016`, `E-017`) with zero upstream core changes.

It anchors **Priority #1** in my 4-trade MEP and structural right-of-way suite (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`), persisting 5 clean scene-graph nodes (`structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, `structural:firestop`) so downstream plumbing, HVAC, and electrical plugins automatically snap to real stud framing and route around LVL, Glulam, PSL, and steel beams as inviolable no-bore keep-outs with zero hard npm dependencies.

**What it ships**

- **One-click IRC / AWC NDS 2024 Auto-Frame and full-building 3D Framing X-Ray**: Scans walls, doors, windows, slabs, ceilings, and wet rooms to render complete per-level structural skeletons in <= 8 batched `InstancedMesh` draw calls (PT mudsills cut cleanly at doors, double top plates, 3-stud corners, king/jack studs, double window sills, bounded cripples, zero studs piercing glass, TJI I-joists or open-web floor trusses, stick rafters or prefab Fink/Scissor/Attic roof trusses with galvanized gusset plates, continuous strip footings, and distributed hardware), synced directly to Pascal's `wallMode` via a one-click **Finished View | Framing X-Ray** toggle.
- **Multi-species dimensional framing and engineered wood/steel beams**: Full span tables and NDS 2024 design values (including Table 4A size factors `Cf` and Table 4B size-specific SYP `Fb` values) for Douglas Fir-Larch #2, SPF #2, SYP #2, and Hem-Fir #2 at `12"`, `16"`, and `24"` OC, plus first-class sizing and 3D CAD geometry for Built-Up Dimensional, LSL 1.55E, 1- to 4-ply 2.0E LVL, PSL 2.0E Parallam, Glulam 24F-V4/V8, A36 Flitch beams, and A992 Steel W-beams (`W8x18` to `W14x30`) with ASD bending/shear, `L/360` and `L/240` deflection, bearing length (`IRC R502.6`), and exact jack-stud counts (`IRC R602.7`).
- **47-SKU Simpson-class connector catalog and 62 clean-room MIT `.glb` CAD models**: Procedural Three.js PBR models and ASD capacities across all 10 hardware families (hurricane ties `H1`/`H2.5A`/`H10A`/`HGA10`/`MTS16`/`HTS20`, framing angles `A35`/`LTP4`/`LS50`, joist and girder hangers `LUS`/`HUS`/`IUS`/`MIT`/`HHUS`/`HGUS`/`HUCQ`, post bases/caps `ABU`/`CB`/`BC`/`LPC`/`CCQ`, hold-downs `HDU2` to `HDU11`/`STHD14`/`MSTC40`, and seismic `BP3x3` plate washers + `SSTB16` anchor bolts).
- **Complete `IRC R302.11` fire blocking, `IRC R302.12` draftstopping, continuous load-path tracing, and `IRC R602.10` braced wall lines**: Derives and audits all 8 code-mandated firestop planes, traces gravity loads from beams through columns, TJI squash blocks, and spread pad footings (`IRC R403.1`), checks continuous wind/seismic uplift hardware, and evaluates braced wall line percentages with portal-frame and shear-wall escalation.
- **Split-pane 7-tab Structural Engineering Schedule and 9 pure Zod agent tools**: Interactive schedule tabs (`Beams & Headers`, `Columns & Footings`, `Connectors & Fasteners`, `Fire Blocking & Draftstopping`, `Load Path & Bracing`, `IRC Audit`, `Priced BOM` with Copy CSV / Markdown) plus strict boundary entrypoints (`.`, `./render`, `./cad`, `./irc`, `./agent-tools`, `./agent-operations`).

> Drafting and pre-engineering aid only, not stamped engineering. Always verify structural members, lateral bracing, connectors, and footings with a licensed Structural Engineer (SE/PE) and local AHJ before construction.

**Try it**

```bash
npm install @kruschdev/pascal-plugin-structural
```

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

Or clone and run the full deterministic check suite locally:

```bash
git clone https://github.com/kruschdev/pascal-plugin-structural.git
cd pascal-plugin-structural
bun install && bun run check
```

Repo (MIT): https://github.com/kruschdev/pascal-plugin-structural
npm: https://www.npmjs.com/package/@kruschdev/pascal-plugin-structural

**What I would love feedback on**

1. If you test it on multi-story or cathedral-ceiling Pascal floorplans, let me know where roof-truss geometry, opening headers, or braced wall line calculations hit edge cases.
2. Any feedback on the 62-model CAD catalog, Simpson-class connector selection rules, or cross-trade MEP coordination contracts would be super helpful.

### Pascal Discord (`https://discord.gg/XRKsDcpqgS`)

Attach `assets/demo-walkthrough.mp4` or `assets/demo-walkthrough.gif`:

Hey everyone! I just published an open-source MIT Residential & Light-Commercial IRC / AWC NDS Structural Framing plugin for Pascal Editor (`@kruschdev/pascal-plugin-structural`, built on Plugin API v1 with zero core changes).

One click auto-frames an entire Pascal floorplan into a batched 3D Framing X-Ray skeleton with 2x4/2x6 multi-species studs, PT mudsills cut cleanly at doors, engineered LVL/Glulam/PSL/Flitch/Steel W-beams, TJI I-joists or open-web floor trusses, stick rafters or prefab Fink/Scissor/Attic roof trusses with galvanized gang-nail gusset plates, 47 Simpson-class connector SKUs, IRC R302.11/R302.12 fire blocking and draftstopping, continuous load-path and R602.10 braced wall line checks, a 7-tab split-pane engineering schedule with priced BOM, 62 clean-room MIT `.glb` CAD models, and 9 pure Zod agent tools.

GitHub (MIT): https://github.com/kruschdev/pascal-plugin-structural
npm: https://www.npmjs.com/package/@kruschdev/pascal-plugin-structural
Discussion thread: <paste pascalorg/editor Show and tell URL once posted>

Would love feedback from anyone trying it on real house plans!

### OSArch Community (`https://community.osarch.org`)

**Title**: `Open-source MIT IRC/NDS Structural Framing Plugin + 62 Procedural Three.js .glb CAD Models for Pascal Editor`

**Body**:

I recently built and published `@kruschdev/pascal-plugin-structural`, a standalone MIT-licensed residential and light-commercial structural framing plugin for Pascal Editor (open-source browser-first 3D AECO editor built on React Three Fiber and WebGPU).

A few technical details that may be useful to OpenBIM and AECO builders here:

- **Zero-dependency IRC / AWC NDS 2024 engineering core (`./irc`)**: Pure TypeScript implementations of multi-species dimensional framing span tables (DF-L #2, SPF #2, SYP #2 with NDS 2024 Table 4B size-specific `Fb`, Hem-Fir #2), ASD bending/shear/deflection sizing for Built-Up, LSL, LVL, PSL, Glulam, Flitch, and A992 Steel W-beams, bearing length (`IRC R502.6`) and jack-stud counts (`IRC R602.7`), continuous gravity and wind/seismic uplift load-path tracing, `IRC R602.10` braced wall line analysis, and all 8 `IRC R302.11` / `R302.12` fire-blocking and draftstopping planes.
- **Batched `InstancedMesh` full-building framing skeleton**: Compiles complete per-level wall, floor, roof, footing, and hardware skeletons in <= 8 draw calls with exact point-to-point roof/truss quaternions and zero studs piercing door or window openings.
- **62 clean-room MIT `.glb` structural and connector CAD models (`./cad`)**: Generated purely in Three.js with zero third-party meshes, covering 10 engineered/steel beam families, TJI I-joists, Open-Web/Fink/Scissor/Attic trusses, solid/PSL/Glulam/Lally/HSS columns with pad footings, 47 Simpson-class connector SKUs across 10 hardware families, 5 firestop assemblies, and 5 architectural framing cutaways.
- **9 pure Zod agent tools (`./agent-tools`)**: Designed so MCP servers or headless workflows can auto-frame levels, size and place beams/columns/connectors/firestops, audit load paths and MEP right-of-way clashes, and export priced BOMs without pulling in React or Three.js.

Repo and walkthrough video: https://github.com/kruschdev/pascal-plugin-structural
npm: https://www.npmjs.com/package/@kruschdev/pascal-plugin-structural

Drafting and pre-engineering aid only, not stamped engineering. I would appreciate any critique on NDS 2024 edge cases, seismic SDC D0-D2 braced wall line detailing, or IFC structural member mapping.

### X (Main Video Post)

I built an open-source MIT structural framing plugin for @pascal (Pascal Editor) that turns any floorplan into an IRC and AWC NDS checked 3D framing skeleton in one click.

It generates 2x4 or 2x6 multi-species stud walls with pressure-treated mudsills cut cleanly at doors, engineered LVL, Glulam, PSL, Flitch, and Steel W-beams, TJI I-joists or open-web floor trusses, and stick rafters or prefab Fink, Scissor, and Attic roof trusses with galvanized gang-nail gusset plates and H2.5A hurricane ties.

Switch floor and roof systems live, peel structural layers in Framing X-Ray, inspect all 62 clean-room MIT CAD models and 47 Simpson-class connector SKUs, and open the split-pane 7-tab schedule for continuous load paths, IRC R602.10 braced wall lines, IRC R302.11 fire blocking, live code audits, and priced contractor BOMs.

Repo (MIT): https://github.com/kruschdev/pascal-plugin-structural
npm: https://www.npmjs.com/package/@kruschdev/pascal-plugin-structural

### LinkedIn Post

I just released an open-source MIT-licensed IRC / AWC NDS structural framing plugin for Pascal Editor (`@kruschdev/pascal-plugin-structural`).

Starting from a standard architectural floorplan, one click generates a full-building 3D `InstancedMesh` structural skeleton in Framing X-Ray (synced directly to Pascal's native viewer modes) while anchoring Priority #1 in a 4-trade MEP right-of-way hierarchy alongside plumbing, HVAC, and electrical plugins.

A few engineering details I focused on:
- Multi-species dimensional framing (`IRC 2021/2024` and `AWC NDS 2024`, including Table 4A size factors and Table 4B SYP `Fb` values) with automatic `2x6` wet-wall upgrades, pressure-treated mudsills cut cleanly at door openings, double top plates, 3-stud corners, king/jack studs, double window sills, and bounded cripples.
- First-class sizing and 3D CAD geometry for Built-Up Dimensional, LSL 1.55E, multi-ply 2.0E LVL, PSL Parallam, Glulam 24F-V4/V8, A36 Flitch beams, and A992 Steel W-beams, paired with live switching between dimensional joists, TJI I-joists, open-web floor trusses, stick rafters, and prefab Fink/Scissor/Attic roof trusses.
- 62 clean-room MIT procedural Three.js `.glb` CAD models and 47 Simpson-class connector SKUs (hurricane ties, framing angles, joist and girder hangers, post bases/caps, HDU2-HDU11 hold-downs, straps, and BP3x3 seismic plate washers) with ASD uplift, download, and lateral capacities.
- Complete `IRC R302.11` fire blocking and `IRC R302.12` draftstopping, continuous gravity and uplift load-path tracing, `IRC R602.10` braced wall line checks, and a live 7-tab split-pane engineering schedule with CSV/Markdown priced BOM exports.

Code, all 62 `.glb` assets, and 9 pure Zod agent tools are open source under MIT: https://github.com/kruschdev/pascal-plugin-structural

### Hacker News (`Show HN`)

**Title**: `Show HN: Open-source IRC/NDS structural framing and 3D Framing X-Ray plugin for Pascal Editor`

**Body**:
I built an open-source MIT structural framing plugin (`@kruschdev/pascal-plugin-structural`) for Pascal Editor implementing Pascal's Plugin API v1 (`E-014` / `E-016`) as a standalone external package with zero core merges.

Given a Pascal floorplan, it runs a deterministic IRC 2021/2024 and AWC NDS 2024 framing and beam-sizing engine, renders the full building skeleton in <= 8 batched `InstancedMesh` draw calls (wall framing with zero studs piercing openings, TJI I-joists or open-web floor trusses, stick rafters or prefab Fink/Scissor/Attic roof trusses with exact point-to-point basis quaternions, continuous strip footings, and distributed hardware), traces continuous gravity and wind/seismic uplift load paths, evaluates `IRC R602.10` braced wall lines and all 8 `IRC R302.11`/`R302.12` fire-blocking planes, and generates a live 7-tab engineering schedule and priced contractor BOM.

It also ships 62 clean-room procedural Three.js `.glb` structural and Simpson-class connector CAD models (47 hardware SKUs across 10 families) plus 9 pure Zod agent tools with zero React or Three.js dependencies.

Repo: https://github.com/kruschdev/pascal-plugin-structural

## Regenerating the Full Media Kit

```bash
bun run export:cad
bun scripts/render-cad-thumbnails.ts
bun scripts/render-structural-cutaways.ts
PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/structural-media-showcase bun run render:walkthrough
bun scripts/render-social-preview.ts
bash scripts/add-voiceover.sh --voice Charon --replace-main
```
