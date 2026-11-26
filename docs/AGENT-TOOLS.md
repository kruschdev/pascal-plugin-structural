# Agent Tools Reference (`@kruschdev/pascal-plugin-structural/agent-tools`)

All 9 tools conform to Pascal `DECISIONS.md E-016` (pure Zod-only contract with zero React, Three.js, viewer, or editor dependencies) and have matching headless implementations in `@kruschdev/pascal-plugin-structural/agent-operations`.

| Tool Name | Kind | Purpose |
|---|---|---|
| `structural_autopopulate_irc` | Write | Synthesize complete framing assemblies, sized beams/headers/girders, columns with spread footings, Simpson-class connectors, and full `IRC R302.11`/`R302.12` fire blocking from Pascal scene geometry. |
| `structural_place_beam` | Write | Place and auto-size a dimensional built-up, LSL, LVL, PSL, Glulam, Flitch, or A992 Steel W-beam with ASD checks, jack studs, and automatic end hangers. |
| `structural_place_column` | Write | Place and size a wood, built-up, PSL, Glulam, or steel HSS/Lally column with spread footing, rebar callout, and standoff base + post cap connectors. |
| `structural_place_connector` | Write | Place any of the 47 cataloged Simpson-class hardware SKUs (`H2.5A`, `H10A`, `HGA10`, `A35`, `LTP4`, `HHUS410`, `ABU66Z`, `CCQ66`, `HDU5-SDS2.5`, `BP3x3`, etc.). |
| `structural_place_firestop` | Write | Place any `IRC R302.11(1)-(5)` fire blocking or `IRC R302.12` draftstopping zone with approved material verification. |
| `structural_size_member` | Read | Pure IRC/AWC/NDS calculator for beams, floors, roofs, columns, hurricane ties, and hold-downs without mutating the scene. |
| `structural_trace_load_path` | Read | Trace continuous gravity load paths, wind/seismic uplift hardware continuity, and `IRC R602.10` braced wall lines. |
| `structural_audit_irc` | Read | Audit the scene for beam overstress, bearing/jack deficits, undersized footings, missing fire blocking, broken load paths, missing hardware, and Priority #1 MEP beam-boring clashes. |
| `structural_generate_schedule` | Read | Export Beam/Header, Column/Footing, Connector/Fastener, Fire-Blocking Schedules, and a priced BOM (JSON, CSV, Markdown). |
