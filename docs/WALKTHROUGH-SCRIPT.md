# Walkthrough Voiceover Script (`@kruschdev/pascal-plugin-structural`)

Timed narration script synchronized to [`assets/demo-walkthrough.mp4`](../assets/demo-walkthrough.mp4) (`62.9s` narrated runtime, `1280 x 720` H.264 @ 24fps + 48 kHz AAC voiceover via `gemini-3.8-flash-tts` voice `Charon`, 148 words, singular first-person voice).

## Clean Continuous Narration Text (TTS Input)

```text
This is Pascal Plugin Structural, an open-source MIT plugin I built for Pascal Editor. One click auto-frames an entire building to IRC and AWC NDS span tables, placing 2x6 studs, TJI I-joists, stick rafters, engineered LVL headers, and Simpson-class connectors in Framing X-Ray.

Switch floor and roof systems on the fly to regenerate open-web floor trusses and prefab Fink roof trusses complete with galvanized gang-nail gusset plates and H2.5A hurricane ties.

Peeling the roof layer exposes pressure-treated mudsills cut cleanly at doors, double top plates, three-stud corners, king and jack studs, and window cripples. You can also drop in live steel HSS columns with spread pad footings, Simpson-class hold-downs, and IRC R302.11 fire blocking.

Finally, open the split-pane seven-tab engineering schedule to inspect beams, columns, 47 connector SKUs, continuous load paths, braced wall lines, live IRC audits, and a priced contractor BOM. Everything is MIT licensed on GitHub.
```

## Chapter-by-Chapter Beat Sheet

| Time | Chapter | Visual On Screen | Spoken Line |
|---|---|---|---|
| `0:00 - 0:13` | **1. One-Click IRC/NDS Auto-Frame (Stick Rafter + TJI)** | Craftsman 32x24 House -> Select `2x6` @ `16"` OC, `TJI I-Joist`, `Stick Rafter` -> Click `Auto-Frame (IRC/NDS)` -> 3D Orbit (`0 Err · 0 Warn`) | "This is Pascal Plugin Structural, an open-source MIT plugin I built for Pascal Editor. One click auto-frames an entire building to IRC and AWC NDS span tables, placing 2x6 studs, TJI I-joists, stick rafters, engineered LVL headers, and Simpson-class connectors in Framing X-Ray." |
| `0:13 - 0:25` | **2. Live Floor & Roof System Switching (Fink W-Truss)** | Switch to `Open-Web Truss` + `Fink Truss` -> Click `Auto-Frame (IRC/NDS)` -> 3D Orbit showing gang-nail gusset plates & H2.5A ties | "Switch floor and roof systems on the fly to regenerate open-web floor trusses and prefab Fink roof trusses complete with galvanized gang-nail gusset plates and H2.5A hurricane ties." |
| `0:25 - 0:38` | **3. Layer Peeling, Framing Close-Up & Fire Blocking** | Toggle `Roof` off -> Zoom & orbit wall framing/headers -> Quick-Place `+ Steel HSS`, `HDU5-SDS2.5`, `R302.11(2) 10ft Wall`, `R302.11(4) Chase`, `R302.11(1) Soffit` -> Zoom/orbit & toggle `Firestop` layer -> `Finished View` / `Framing X-Ray` | "Peeling the roof layer exposes pressure-treated mudsills cut cleanly at doors, double top plates, three-stud corners, king and jack studs, and window cripples. You can also drop in live steel HSS columns with spread pad footings, Simpson-class hold-downs, and IRC R302.11 fire blocking." |
| `0:38 - 0:49` | **4. Split-Pane 7-Tab Engineering Schedule** | Open `Schedule & Audit` -> Collapse rail -> `Beams & Headers`, `Columns & Footings`, `Connectors & Fasteners`, `Fire Blocking & Draftstopping` | "Finally, open the split-pane seven-tab engineering schedule to inspect beams, columns, 47 connector SKUs, continuous load paths, braced wall lines, live IRC audits, and a priced contractor BOM. Everything is MIT licensed on GitHub." |
| `0:49 - 1:00` | **5. Load Path, Braced Wall Lines, IRC Audit & Priced BOM** | `Load Path & Bracing` -> `IRC Audit` (`PASS`) -> `Priced BOM` (category cards + CSV/Markdown export) | *(Completes final chapter narration cleanly with +0.4s outro hold)* |

## Synthesizing & Muxing Voiceover with Gemini TTS

Run:

```bash
bash scripts/add-voiceover.sh --voice Charon
```

Use `--dry-run` first to validate the exact `gemini-api tts` request offline at zero cost:

```bash
bash scripts/add-voiceover.sh --dry-run
```
