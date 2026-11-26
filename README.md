# `@kruschdev/pascal-plugin-structural`

Standalone MIT residential and light-commercial **IRC / AWC NDS / WFCM / AISC Structural Framing & Engineered Wood Plugin** for [Pascal Editor](https://github.com/pascalorg/editor) (`pluginId: krusch:structural`).

I built this plugin to serve as **Priority #1** in the Pascal trade right-of-way hierarchy (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`), providing the builder-grade structural framing, engineered beam sizing, Simpson-class hardware connectors, continuous load paths, and full `IRC R302.11` / `R302.12` fire blocking and draftstopping required for real construction workflows.

## Key Capabilities

1. **Multi-Species Dimensional Framing (`IRC 2021/2024` & `AWC NDS 2024`)**: Full span tables and NDS design values (`Fb`, `Fv`, `Fc`, `Fc_perp`, `E`, `Emin`) for **Douglas Fir-Larch #2**, **Spruce-Pine-Fir #2**, **Southern Yellow Pine #2**, and **Hem-Fir #2** across `12"`, `16"`, and `24"` OC framing, plus automatic `2x6` wet-wall upgrades near plumbing fixtures and wet rooms.
2. **Engineered Wood, Laminated Beams & Structural Steel**: First-class `structural:beam` sizing and 3D CAD geometry for **Built-Up Dimensional**, **LSL 1.55E**, **LVL 2.0E 2600Fb** (1- to 4-ply), **PSL 2.0E Parallam**, **Glulam 24F-V4 / 24F-V8**, **A36 Flitch Beams**, and **A992 Steel W-Beams** (`W8x18` to `W14x30`), plus **TJI I-Joists** (with web knockout rules), **Open-Web Floor Trusses**, and **Fink / Scissor / Attic Roof Trusses**. Every beam is checked for ASD bending, shear, `L/360` / `L/240` deflection, bearing length (`IRC R502.6`), and exact jack-stud counts (`1` to `4` per end per `IRC R602.7`).
3. **40-SKU Simpson-Class Connector & Hardware Catalog**: Recognizable galvanized-steel 3D CAD models and ASD uplift/download/lateral capacities across all 10 hardware families: **Hurricane Ties** (`H1`, `H2.5A`, `H10A`, `HGA10`, `MTS16`, `HTS20`), **Framing Angles & Clips** (`A35`, `A34`, `LTP4`, `L50`, `LS50`), **Joist & Beam Hangers** (`LUS26` to `LUS212`, `HUS210`, `LSSU210`, `IUS2.56/11.88`, `MIT411.88`, `HHUS210-2`, `HHUS410`, `HHUS5.50/10`, `HGUS5.50/12`, `HUCQ410-SDS`), **Post Bases & Caps** (`ABU44Z` to `ABU66Z`, `CB44`/`CB66`, `BC4`, `LPC4Z`/`LPC6Z`, `CCQ46`/`CCQ66`), **Hold-Downs & Straps** (`HDU2` to `HDU11`, `STHD14`, `LSTA24`, `MSTA36`, `MSTC40`, `CS16`, `CS-PF`), and **Seismic Anchorage** (`BP3x3` plate washers, `SSTB16` anchor bolts).
4. **Complete `IRC R302.11` Fire Blocking & `IRC R302.12` Draftstopping**: Derives, models, and audits all 8 code-mandated firestop planes: `10 ft` vertical stud cavities (`R302.11(2)`), furred walls (`R302.11(2)`), soffits/drop ceilings (`R302.11(1)`), stair stringers top and bottom (`R302.11(3)`), vertical chases and chimneys (`R302.11(4)`), MEP pipe/conduit/duct plate penetration collars (`R302.11(5)`), floor-ceiling draftstopping (`<= 1,000 sq ft`, `R302.12`), and attic draftstopping (`<= 3,000 sq ft`, `R302.12.1`).
5. **Continuous Load-Path Tracing & `IRC R602.10` Braced Wall Lines**: Traces gravity loads from beams through columns, TJI squash blocks, and spread pad footings (`IRC R403.1`), checks continuous wind/seismic uplift paths, and evaluates `R602.10` braced wall percentages with `CS-PF` portal and engineered shear-wall escalation.
6. **Priority #1 Cross-Trade Interop**: Persists 5 clean scene-graph nodes (`structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, `structural:firestop`) so `@kruschdev/pascal-plugin-plumbing` and `@kruschdev/pascal-plugin-electrical` automatically snap to real studs, route around LVL/Glulam/steel beams and columns as hard no-bore obstacles, and coordinate `R302.11(5)` penetration firestops with zero hard npm dependencies.

## Quick Start

```bash
bun install
bun run check          # tsc --noEmit + bun test src + 5/5 entry boundary gates + dist/ build
bun run export:cad     # Export all 62 clean-room .glb structural CAD models to assets/cad/
```

## Subpath Exports

- `@kruschdev/pascal-plugin-structural` : Full Pascal Plugin API v1 manifest (`structuralPlugin`, `structuralHostPanel`, `structuralScheduleView`, `structuralChatExtension`)
- `@kruschdev/pascal-plugin-structural/render` : Editor-free viewer manifest (`structuralRenderPlugin`)
- `@kruschdev/pascal-plugin-structural/irc` : Pure framework-free IRC/AWC/NDS structural engine
- `@kruschdev/pascal-plugin-structural/cad` : 62 clean-room MIT procedural Three.js PBR structural and hardware CAD builders
- `@kruschdev/pascal-plugin-structural/agent-tools` : 9 pure Zod-only `E-016` agent tool contracts
- `@kruschdev/pascal-plugin-structural/agent-operations` : Headless pure scene operations for MCP and detached runtimes

> **Engineering Disclaimer**: All IRC/AWC/NDS/AISC calculations, beam selections, connector schedules, fire-blocking audits, and BOM estimates in this plugin are deterministic drafting and pre-engineering aids and never substitute for a licensed Structural Engineer (SE/PE) stamp or local AHJ approval.
