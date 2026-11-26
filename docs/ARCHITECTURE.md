# Architecture (`@kruschdev/pascal-plugin-structural`)

I designed `@kruschdev/pascal-plugin-structural` around Pascal Plugin API v1 and a strict **Hybrid Scene-Graph Persistence** model so downstream MEP trades (`krusch:plumbing`, `krusch:electrical`, and future `krusch:hvac`) can read authoritative Priority #1 structural obstacles directly from Pascal's scene graph with zero cross-package npm dependencies.

## Layer Boundaries (5/5 Verified by `bun run check:render`)

1. **`./irc` (`src/irc/*`)**: Pure framework-free TypeScript (zero React, Three.js, `@pascal-app/*`, or Next.js). Contains all multi-species lumber tables, engineered beam/truss/column/connector catalogs, ASD sizing math, `R302.11`/`R302.12` fire-blocking rules, continuous load-path tracing, auto-population, code audit, schedule pack generation, and priced BOMs.
2. **`./cad` (`src/cad/*`)**: Pure Three.js procedural PBR geometry builders (zero React or `@pascal-app/editor`). Every build call allocates a fresh `createStructuralMaterialPool()` instance so Pascal `<GeometrySystem>` disposal never disposes materials still referenced by sibling meshes.
3. **`./render` (`src/render.ts` + `src/nodes/*`)**: Editor-free viewer plugin defining all 5 `structural:*` node schemas (Zod v4), 3D geometry builders, 2D floorplan symbols, and snapping ports.
4. **`./agent-tools` & `./agent-operations`**: Pure Zod-only `E-016` tool contracts (9 tools) and headless pure scene operations runnable from MCP servers, CLI scripts, or live editor chat.
5. **`.` (`src/index.ts` + `src/ui/*`)**: Full Pascal Editor manifest with isolated Zustand UI store (`src/ui/store.ts`), left-rail authoring panel, live `NOT TO CODE` inspector card, 7-tab full-pane Engineering Schedule View, and lazy chat result cards.

## Hybrid Scene-Graph Persistence

| Node Kind | Prefix | Purpose & Downstream MEP Contract |
|---|---|---|
| `structural:assembly` | `strasm_` | Per-level species, stud size/spacing (`12"`/`16"`/`24"` OC), floor system (`dimensional`/`tji-ijoist`/`open-web-truss`), roof system, design loads, and per-wall overrides (`isLoadBearing`, `isShearWall`, `isWetWall`, `cmu`). Groups repetitive field sticks so scene JSON stays lean. |
| `structural:beam` | `strbm_` | Editable built-up, LSL, LVL, PSL, Glulam, Flitch, or Steel W-beam (`header`, `floor-girder`, `ridge-beam`, `transfer-beam`, etc.). Published as a hard Priority #1 no-bore keep-out box for Plumbing and Electrical routers. |
| `structural:column` | `strcol_` | Editable wood, built-up, PSL, Glulam, or steel HSS/Lally column with axial load, `hasSquashBlocks` flag, spread footing callout, and `transfersFromNodeId`/`transfersToNodeId` links. |
| `structural:connector` | `strcon_` | Editable Simpson-class hardware node (40 SKUs across 10 categories) with ASD uplift/download/lateral capacities and fastener schedules. |
| `structural:firestop` | `strfs_` | Editable `IRC R302.11(1)-(5)` fire blocking or `IRC R302.12` draftstopping plane coordinated with MEP plate penetrations. |
