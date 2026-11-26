# Pascal Plugin Structural (`AGENTS.md`)

> Standalone MIT Residential and Light-Commercial IRC/AWC/NDS/AISC Structural Framing & Engineered Wood Plugin for Pascal Editor (`@kruschdev/pascal-plugin-structural`, `pluginId: krusch:structural`).

## Hazards and Non-Negotiable Invariants

1. **Trade-Priority Right-of-Way**: Structural (`structural:assembly`, `structural:beam`, `structural:column`, `structural:connector`, `structural:firestop`) holds **Priority #1** right-of-way (`1. Structural -> 2. Plumbing -> 3. HVAC -> 4. Electrical`). Downstream MEP plugins MUST yield to structural beams, columns, shear walls, and `IRC R602.6` / `R502.8` boring zones.
2. **Entry Boundary Gates (`bun run check:render`)**:
   - `./render` (`src/render.ts`) MUST remain 100% free of `@pascal-app/editor` and `next` imports.
   - `./cad` (`src/cad/index.ts`) MUST remain 100% free of React and `@pascal-app/editor` imports.
   - `./agent-tools` (`src/agent-tools.ts`) MUST remain pure Zod-only (`E-016` contract purity).
   - `./agent-operations` (`src/agent-operations.ts`) MUST remain headless-pure (zero React/Three/viewer/editor).
   - `./irc` (`src/irc/index.ts`) MUST remain pure framework-free TypeScript (zero React, Three.js, or `@pascal-app/*` imports).
3. **Plugin Store Isolation**: Keep all plugin UI state inside `src/ui/store.ts`; never extend Pascal's `useScene`, `useEditor`, or `useViewer` stores.
4. **Geometry Resource Safety**: Allocate fresh PBR `CadMaterialPool` instances per CAD build call so Pascal `<GeometrySystem>` disposal never disposes materials still referenced by sibling meshes.
5. **Engineering Disclaimer**: IRC/AWC/NDS/AISC sizing, LVL/Glulam/PSL/Steel beam checks, Simpson-class connector selections, `R302.11`/`R302.12` fire-blocking schedules, and BOM estimates are deterministic drafting aids and never substitute for licensed SE/PE review or local AHJ approval.

## Quick Start

```bash
bun install
bun run check          # tsc --noEmit + bun test src + 5/5 entry boundary gates + dist/ build
bun run export:cad     # Regenerate all clean-room binary .glb CAD models in assets/cad/
```
