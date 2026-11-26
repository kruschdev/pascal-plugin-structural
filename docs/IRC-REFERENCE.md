# IRC / AWC NDS / WFCM Engineering Reference

Summary of deterministic code rules implemented in `@kruschdev/pascal-plugin-structural/irc`:

| Domain | Code Basis | Implemented Rules |
|---|---|---|
| Multi-Species Dimension Lumber | IRC 2021/2024 Tables R502.3.1(2), R802.4.1(1)/(5), R802.5.1(2) & NDS 2024 Supplement Table 4A | DF-L #2, SPF #2, SYP #2, Hem-Fir #2 at 12"/16"/24" OC across 20/30/50/70 psf snow bands. |
| Headers & Girders | IRC R602.7(1)/(2)/(3), R502.5, R502.6, AWC NDS | ASD bending (`Fb`), horizontal shear (`Fv`), deflection (`L/360` floor live / `L/240` roof live & floor total), bearing length (`>= 1.5"` wood / `>= 3.0"` masonry), and `1` to `4` jack studs per end across dimensional built-up, LSL, LVL 2.0E, PSL 2.0E, Glulam 24F-V4/V8, A36 Flitch, and A992 Steel W-beams. |
| Engineered Floors & Roofs | IRC R502.1.2, R502.11, R802.4.3, R802.10, TPI 1 | TJI 110/210/230/360/560 I-joists (with knockout and field-cut web-hole clearance rules), open-web floor trusses, Fink/Scissor/Attic roof trusses, and mandatory structural ridge beams when roof pitch is `< 3:12`. |
| Columns & Spread Footings | AWC NDS 3.7 (`Cp` Euler buckling), IRC R403.1, R407.3 | Slenderness-reduced axial capacities for solid/built-up wood, PSL, Glulam, Lally, and HSS columns; spread pad footing sizing from `soilBearingPsf` and frost depth with `#4` rebar mats; TJI squash-block verification. |
| Connectors & Uplift Path | IRC R802.11, R502.6.2, R502.9, R602.11.1, WFCM | 40 Simpson-class SKUs covering hurricane ties (`H1`/`H2.5A`/`H10A`/`HGA10`/`MTS16`/`HTS20`), framing angles (`A35`/`A34`/`LTP4`/`L50`/`LS50`), hangers (`LUS`/`HUS`/`HHUS`/`IUS`/`MIT`/`LSSU`/`HGUS`/`HUCQ`), post bases/caps (`ABU`/`CB`/`BC`/`LPC`/`CCQ`), hold-downs (`HDU2` to `HDU11`, `STHD14`), straps (`LSTA24`/`MSTA36`/`MSTC40`/`CS16`/`CS-PF`), and `BP3x3` seismic plate washers. |
| Fire Blocking & Draftstopping | IRC R302.11(1)-(5), R302.11.1, R302.12, R302.12.1 | Soffit/drop-ceiling interconnections, 10 ft vertical and horizontal wall cavities, stair stringers top and bottom, chases/chimneys, MEP plate penetration intumescent collars, floor-ceiling draftstops (`<= 1,000 sq ft`), and attic draftstops (`<= 3,000 sq ft`). |
| Lateral Bracing | IRC R602.10, R602.10.6.4, AWC SDPWS | Plan-axis braced wall line clustering (`<= 4 ft` offset), required braced wall percentages by wind/SDC/stories, `WSP` / `CS-WSP` / `CS-PF` portal / Engineered Shear escalation with edge-nailing and `HDU` hold-down selection. |
