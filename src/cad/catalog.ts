/**
 * 62-Model Clean-Room MIT 3D Structural & Simpson-Class Connector CAD Catalog (`src/cad/catalog.ts`).
 * Editor-free and React-free: zero React, `@pascal-app/editor`, `@pascal-app/viewer`, or `next` imports.
 */

import type { Group } from 'three'
import type { AssemblyKind, FirestopKind } from '../irc/tables'
import { buildAssemblyPreviewCad, buildColumnCad, buildFirestopCad } from './assemblies'
import { buildBeamCad, buildIJoistCad, buildTrussCad, type TrussCadKind } from './beams'
import { buildConnectorCad } from './connectors'

export type StructuralCadCategory =
  | 'Engineered & Structural Beams'
  | 'I-Joists & Prefabricated Trusses'
  | 'Structural Columns & Footings'
  | 'Hurricane Ties & Framing Clips'
  | 'Joist & Engineered Beam Hangers'
  | 'Post Bases, Caps & Hold-Downs'
  | 'Fire Blocking & Assembly Cutaways'

export type StructuralCadPartEntry = {
  id: string
  name: string
  /** Alias matching plumbing catalog convention */
  title: string
  category: StructuralCadCategory
  description: string
  codeRef: string
  build: () => Group
}

const beamEntry = (
  id: string,
  beamId: string,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'Engineered & Structural Beams',
  description,
  codeRef,
  build: () => buildBeamCad({ beamId }),
})

const ijoistEntry = (
  id: string,
  ijoistId: string,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'I-Joists & Prefabricated Trusses',
  description,
  codeRef,
  build: () => buildIJoistCad({ ijoistId }),
})

const trussEntry = (
  id: string,
  trussKind: TrussCadKind,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'I-Joists & Prefabricated Trusses',
  description,
  codeRef,
  build: () => buildTrussCad({ trussKind }),
})

const colEntry = (
  id: string,
  columnId: string,
  name: string,
  description: string,
  codeRef: string,
  includeFooting = false,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'Structural Columns & Footings',
  description,
  codeRef,
  build: () => buildColumnCad({ columnId, includeFooting }),
})

const connEntry = (
  id: string,
  sku: string,
  category: StructuralCadCategory,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category,
  description,
  codeRef,
  build: () => buildConnectorCad({ sku }),
})

const firestopEntry = (
  id: string,
  firestopKind: FirestopKind,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'Fire Blocking & Assembly Cutaways',
  description,
  codeRef,
  build: () => buildFirestopCad({ firestopKind }),
})

const assemblyEntry = (
  id: string,
  assemblyKind: AssemblyKind,
  name: string,
  description: string,
  codeRef: string,
): StructuralCadPartEntry => ({
  id,
  name,
  title: name,
  category: 'Fire Blocking & Assembly Cutaways',
  description,
  codeRef,
  build: () => buildAssemblyPreviewCad({ assemblyKind }),
})

export const STRUCTURAL_CAD_CATALOG: readonly StructuralCadPartEntry[] = [
  // Category 1: Engineered & Structural Beams (10)
  beamEntry('beam-dim-2-2x10', 'dim-2-2x10', '(2) 2x10 Built-Up Header w/ Spacer', '2-ply DF-L #2 built-up window/door header with 1/2" OSB spacer and staggered 16d nailing', 'IRC R602.7(1)'),
  beamEntry('beam-dim-3-2x12', 'dim-3-2x12', '(3) 2x12 Built-Up Floor Girder', '3-ply DF-L #2 stitched dimensional girder with visible ply seams and 16d nail schedule', 'IRC R502.5'),
  beamEntry('beam-lsl-3.5x11.875', 'lsl-3.5x11.875', '3-1/2"x11-7/8" 1.55E LSL Header', 'TimberStrand 1.55E laminated strand lumber single-member structural header', 'AWC NDS / IRC R602.7'),
  beamEntry('beam-lvl-2-11.875', 'lvl-2-11.875', '(2) 1-3/4"x11-7/8" 2.0E LVL', '2-ply 2600Fb laminated veneer lumber beam with rotary veneer seams and SDS ply screws', 'AWC NDS'),
  beamEntry('beam-lvl-3-14', 'lvl-3-14', '(3) 1-3/4"x14" 2.0E LVL Girder', '3-ply heavy 14" LVL floor/ridge girder with stitched structural screw schedule', 'AWC NDS'),
  beamEntry('beam-psl-5.25x14', 'psl-5.25x14', '5-1/4"x14" 2.0E PSL Transfer Beam', 'Parallam 2900Fb monolithic parallel-strand lumber heavy transfer girder', 'AWC NDS'),
  beamEntry('beam-glulam-5.125x15', 'glulam-5.125x15', '5-1/8"x15" 24F-V4 Glulam Beam', 'Architectural laminated honey-timber 24F-V4 glulam beam with horizontal lam glue-lines', 'AWC NDS / ANSI A190.1'),
  beamEntry('beam-flitch-2x12-500', 'flitch-2x12-500', '(2) 2x12 + 1/2"x11" A36 Flitch Beam', 'Composite wood/steel flitch girder with recessed A36 center plate and staggered 1/2" through-bolts', 'AWC NDS / AISC 360'),
  beamEntry('beam-steel-w10x22', 'steel-w10x22', 'W10x22 A992 Structural Steel Beam', 'Red-oxide primed wide-flange W10x22 I-beam with root fillets and end bearing stiffeners', 'AISC 360'),
  beamEntry('beam-steel-w12x40', 'steel-w12x40', 'W12x40 A992 Heavy Steel Girder', 'Heavy wide-flange W12x40 long-span transfer girder with full-depth bearing stiffeners', 'AISC 360'),

  // Category 2: I-Joists & Prefabricated Trusses (7)
  ijoistEntry('ijoist-tji-110-9.5', 'tji-110-9.5', 'TJI-110 9-1/2" Engineered I-Joist', '1-3/4" LVL flanges with 3/8" OSB web, stamped circular knockouts, and bearing stiffeners', 'IRC R502.1.2'),
  ijoistEntry('ijoist-tji-230-11.875', 'tji-230-11.875', 'TJI-230 11-7/8" Engineered I-Joist', '2-5/16" LVL flanges with 3/8" OSB web and 12" OC factory knockouts outside support zones', 'IRC R502.1.2'),
  ijoistEntry('ijoist-tji-560-16', 'tji-560-16', 'TJI-560 16" Heavy Engineered I-Joist', '3-1/2" wide LVL flanges with 7/16" OSB web for long residential spans up to 28.5 ft', 'IRC R502.1.2'),
  trussEntry('truss-open-web-floor', 'open-web-floor', '16" Open-Web Parallel-Chord Floor Truss', 'Parallel-chord Warren open-web floor truss with galvanized toothed gang-nail connector plates', 'IRC R502.11 / TPI 1'),
  trussEntry('truss-fink-roof', 'fink-truss', '24 ft Fink (W-Web) Pitched Roof Truss', '6:12 pitched Fink W-web roof truss with raised energy heels, overhangs, and gang-nail plates', 'IRC R802.10 / TPI 1'),
  trussEntry('truss-scissor-roof', 'scissor-truss', '24 ft Scissor Vaulted Roof Truss', '7:12 top / 3.5:12 vaulted bottom-chord scissor truss with king post and connector plates', 'IRC R802.10 / TPI 1'),
  trussEntry('truss-attic-roof', 'attic-truss', '28 ft Room-in-Attic Habitable Roof Truss', '9:12 habitable room-in-attic truss with floor-rated bottom chord, knee walls, and collar tie', 'IRC R802.10 / TPI 1'),

  // Category 3: Structural Columns & Footings (6)
  colEntry('col-4x4-dfl', 'col-4x4-dfl', '4x4 DF-L #2 Solid Wood Post', 'Solid 4x4 Douglas Fir-Larch post with ABU44Z 1"-standoff base and BC4 post cap', 'IRC R407.3 / R502.9', false),
  colEntry('col-3-2x6-king', 'col-3-2x6', '(3) 2x6 Built-Up King Post', '3-ply stitched 2x6 built-up load-bearing post with ABU66Z standoff base and LPC6Z cap', 'IRC R602.7', false),
  colEntry('col-psl-5.25', 'col-psl-5.25', '5-1/4"x5-1/4" 1.8E PSL Column', 'High-capacity Parallam PSL column with CB66 embedded base and CCQ66 SDS column cap', 'AWC NDS', false),
  colEntry('col-glulam-5.5', 'col-glulam-5.5', '5-1/2"x5-1/2" Architectural Glulam Column', 'Multi-lamination architectural glulam column with concrete pad footing and CCQ66 cap', 'AWC NDS / IRC R407', true),
  colEntry('col-steel-lally-3.5', 'col-steel-lally-3.5', '3-1/2" Concrete-Filled Steel Lally Column', 'Schedule 40 red-oxide steel pipe filled with concrete, welded cap/base plates, and pad footing', 'IRC R407.3 / AISC', true),
  colEntry('col-steel-hss-4x4', 'col-steel-hss-4x4', 'HSS 4x4x1/4 Steel Column w/ Pad Footing', 'A500 Gr C square hollow structural steel column with welded bearing plates and concrete footing', 'AISC 360', true),

  // Category 4: Hurricane Ties & Framing Clips (9)
  connEntry('conn-h1', 'H1', 'Hurricane Ties & Framing Clips', 'H1 Gusseted U-Tie Hurricane Clip', 'U-shaped rafter/truss-to-top-plate hurricane tie with twin wrap flanges', 'IRC R802.11'),
  connEntry('conn-h25a', 'H2.5A', 'Hurricane Ties & Framing Clips', 'H2.5A Rafter-to-Plate Hurricane Tie', 'Standard seismic & coastal asymmetric wrap rafter-to-double-top-plate tie', 'IRC R802.11'),
  connEntry('conn-h10a', 'H10A', 'Hurricane Ties & Framing Clips', 'H10A High-Uplift Double-Gusset Tie', 'Heavy double-sided gusseted hurricane tie rated 1,340 lb uplift for >=130 mph wind', 'IRC R802.11 / WFCM'),
  connEntry('conn-hga10', 'HGA10', 'Hurricane Ties & Framing Clips', 'HGA10 Heavy SDS Gusset Angle', 'Heavy 14-ga dual-gusset uplift angle fastened with (8) 1/4"x3" SDS hex screws', 'IRC R802.11 / WFCM'),
  connEntry('conn-mts16', 'MTS16', 'Hurricane Ties & Framing Clips', 'MTS16 16" Twisted Uplift Strap', '16" galvanized 90-deg helical twist strap tying roof truss directly to wall stud below', 'IRC R802.11'),
  connEntry('conn-hts20', 'HTS20', 'Hurricane Ties & Framing Clips', 'HTS20 20" Heavy Twisted Uplift Strap', '20" heavy-gauge twisted coastal/HVHZ uplift strap rated 1,625 lb uplift', 'WFCM / HVHZ'),
  connEntry('conn-a35', 'A35', 'Hurricane Ties & Framing Clips', 'A35 3-Way Shear Framing Angle', 'Multi-purpose bent 3-way shear transfer and blocking framing clip', 'IRC R602.10'),
  connEntry('conn-ltp4', 'LTP4', 'Hurricane Ties & Framing Clips', 'LTP4 Lateral Shear Tie Plate', 'Stamped galvanized lateral tie plate with stiffening ribs for rim-to-plate shear transfer', 'IRC R602.10.8'),
  connEntry('conn-ls50', 'LS50', 'Hurricane Ties & Framing Clips', 'LS50 Field-Skewable Framing Angle', '0-135 degree field-skewable reinforcing angle for hips, valleys, and gable framing', 'IRC R802.3'),

  // Category 5: Joist & Engineered Beam Hangers (7)
  connEntry('conn-lus210', 'LUS210', 'Joist & Engineered Beam Hangers', 'LUS210 Double-Shear Face Joist Hanger', 'Double-shear 2x10/2x12 face-mount joist hanger with slant-nail embossments', 'IRC R502.6.2'),
  connEntry('conn-hus210', 'HUS210', 'Joist & Engineered Beam Hangers', 'HUS210 Heavy Face-Mount Joist Hanger', 'Heavy-duty double-shear 2x10/2x12 hanger rated 3,825 lb download', 'IRC R502.6.2'),
  connEntry('conn-lssu210', 'LSSU210', 'Joist & Engineered Beam Hangers', 'LSSU210 Sloped & Skewed Rafter Hanger', 'Field-adjustable sloped seat and skewed cheek hanger for hip/valley rafters', 'IRC R802.3'),
  connEntry('conn-ius-11.88', 'IUS2.56/11.88', 'Joist & Engineered Beam Hangers', 'IUS2.56/11.88 I-Joist Face Hanger', 'Full-height face-mount TJI I-joist hanger with snap-in diamond locating tabs', 'IRC R502.1.2'),
  connEntry('conn-mit-11.88', 'MIT411.88', 'Joist & Engineered Beam Hangers', 'MIT411.88 Top-Flange I-Joist Hanger', 'Top-flange engineered I-joist hanger bearing directly over LVL/Glulam girders', 'IRC R502.1.2'),
  connEntry('conn-hgus550-12', 'HGUS5.50/12', 'Joist & Engineered Beam Hangers', 'HGUS5.50/12 Extra-Heavy Girder Hanger', '12-ga extra-heavy double-shear 3-ply LVL/Glulam girder hanger (10,850 lb download)', 'AWC NDS'),
  connEntry('conn-hucq410-sds', 'HUCQ410-SDS', 'Joist & Engineered Beam Hangers', 'HUCQ410-SDS Concealed-Flange Hanger', 'Concealed inward-flange architectural beam hanger fastened with 1/4" SDS screws', 'AWC NDS'),

  // Category 6: Post Bases, Caps & Hold-Downs (13)
  connEntry('conn-abu44z', 'ABU44Z', 'Post Bases, Caps & Hold-Downs', 'ABU44Z 4x4 1"-Standoff Post Base', 'Adjustable 4x4 galvanized post base with 1" moisture-standoff platform and anchor bolt', 'IRC R407.3 / R317.1'),
  connEntry('conn-abu66z', 'ABU66Z', 'Post Bases, Caps & Hold-Downs', 'ABU66Z 6x6 1"-Standoff Post Base', 'Adjustable 6x6 moisture-standoff post base rated 10,945 lb download', 'IRC R407.3 / R317.1'),
  connEntry('conn-cb66', 'CB66', 'Post Bases, Caps & Hold-Downs', 'CB66 Embedded Heavy 6x6 Column Base', 'Cast-in-place heavy embedded 6x6 column base with concrete anchor legs and machine bolts', 'IRC R407.3'),
  connEntry('conn-bc4', 'BC4', 'Post Bases, Caps & Hold-Downs', 'BC4 4x4 Stamped Post-to-Beam Cap', 'Stamped 18-ga U-saddle post cap tying 4x girder directly to 4x4 post', 'IRC R502.9'),
  connEntry('conn-lpc6z', 'LPC6Z', 'Post Bases, Caps & Hold-Downs', 'LPC6Z 6x Adjustable Retrofit Post Cap', 'Two-piece adjustable L-cap pair for 5-1/4" to 6x beams over 6x6 posts', 'IRC R502.9'),
  connEntry('conn-ccq66', 'CCQ66', 'Post Bases, Caps & Hold-Downs', 'CCQ66 Heavy Welded SDS Column Cap', '7-ga welded heavy steel T-column cap with 1/4" SDS screws (34,200 lb download)', 'AWC NDS'),
  connEntry('conn-hdu2', 'HDU2-SDS2.5', 'Post Bases, Caps & Hold-Downs', 'HDU2-SDS2.5 Light Overturning Hold-Down', 'Gusseted bucket hold-down with 6 SDS screws, bearing block, and 5/8" anchor rod (3,075 lb)', 'IRC R602.10.6.2'),
  connEntry('conn-hdu5', 'HDU5-SDS2.5', 'Post Bases, Caps & Hold-Downs', 'HDU5-SDS2.5 Seismic Shear-Wall Hold-Down', 'Standard SDC D0-D2 gusseted hold-down with 14 SDS screws and anchor rod (5,645 lb)', 'IRC R602.10 / SDC D0-D2'),
  connEntry('conn-hdu11', 'HDU11-SDS2.5', 'Post Bases, Caps & Hold-Downs', 'HDU11-SDS2.5 Extra-Heavy Hold-Down', 'Extra-heavy multi-storey overturning hold-down with 30 SDS screws and 1" rod (11,175 lb)', 'Engineered Shear Wall'),
  connEntry('conn-sthd14', 'STHD14', 'Post Bases, Caps & Hold-Downs', 'STHD14 Embedded Stemwall Strap Hold-Down', 'Cast-in-place stemwall strap-tie hold-down for braced corners and portal frames', 'IRC R602.10.6.4'),
  connEntry('conn-mstc40', 'MSTC40', 'Post Bases, Caps & Hold-Downs', 'MSTC40 40" Heavy Continuous Tension Strap', '40" wide 16-ga perforated continuous load-path multi-storey tension strap (4,185 lb)', 'WFCM / SDC D0-D2'),
  connEntry('conn-bp3x3', 'BP3x3', 'Post Bases, Caps & Hold-Downs', 'BP3x3 3"x3"x0.229" Seismic Plate Washer', 'Mandatory IRC R602.11.1 heavy square seismic bearing plate washer with hex nut', 'IRC R602.11.1'),
  connEntry('conn-sstb16', 'SSTB16', 'Post Bases, Caps & Hold-Downs', 'SSTB16 5/8"x17-5/8" Cast-in-Place Anchor Bolt', 'High-capacity cast-in-place hold-down anchor bolt with forged T-head, washer, and hex nut', 'IRC R403.1.6'),

  // Category 7: Fire Blocking, Draftstopping & Assembly Cutaways (10)
  firestopEntry('firestop-wall-cavity', 'wall-vertical-10ft', 'IRC R302.11(2) Stud Cavity Fire Blocking', 'Horizontal 2x fire-blocking board sealing concealed vertical stud cavity at <=10 ft intervals', 'IRC R302.11(2)'),
  firestopEntry('firestop-soffit-drop', 'soffit-drop-ceiling', 'IRC R302.11(1) Soffit / Drop-Ceiling Fire Blocking', '23/32" OSB fire-blocking diaphragm isolating concealed wall-to-soffit interconnection', 'IRC R302.11(1)'),
  firestopEntry('firestop-chase-wool', 'chase-chimney-shaft', 'IRC R302.11(4) Chase Mineral-Wool Firestop', 'Floor-plane mechanical/chimney chase packed with mineral wool batt and galvanized collar', 'IRC R302.11(4)'),
  firestopEntry('firestop-intumescent-collar', 'penetration-firestop', 'IRC R302.11(5) Intumescent Firestop Collar', 'UL-listed red steel-jacketed intumescent firestop collar around pipe passing double top plate', 'IRC R302.11(5)'),
  firestopEntry('firestop-floor-draftstop', 'floor-draftstop', 'IRC R302.12 Open-Web Floor Draftstop', '1/2" Type X gypsum board draftstop membrane dividing concealed floor-ceiling cavity (<=1,000 sf)', 'IRC R302.12'),
  assemblyEntry('assembly-wall-framing', 'wall-framing', 'IRC Exterior Wall Framing & Window Header Cutaway', '8 ft x 8 ft 2x6 wall framing cutaway with PT sill, double 2x10 header, jacks, kings, and fire blocking', 'IRC R602.3 / R602.7'),
  assemblyEntry('assembly-floor-system', 'floor-system', 'TJI I-Joist & LVL Girder Floor System Cutaway', '2-ply LVL carrying girder, TJI-230 I-joists on IUS hangers, rim board, and partial OSB subfloor', 'IRC R502.1.2 / R502.6'),
  assemblyEntry('assembly-roof-system', 'roof-system', 'Fink Roof Truss & Hurricane-Tie Cutaway', 'Double top plates, 24" OC Fink trusses, H2.5A hurricane ties at heels, and partial OSB roof deck', 'IRC R802.10 / R802.11'),
  assemblyEntry('assembly-braced-wall-line', 'braced-wall-line', 'IRC R602.10 Seismic Braced Shear Wall Cutaway', '48" braced wall panel on stemwall with dual HDU5 hold-downs, BP3x3 plate washers, and OSB sheathing', 'IRC R602.10 / R602.11'),
  assemblyEntry('assembly-foundation-system', 'foundation-system', 'Foundation Stemwall, Pad Footing & Post-Base Cutaway', 'Continuous strip footing, stemwall, PT sill w/ BP3x3 washers, interior pad footing, ABU66Z, and girder', 'IRC R403 / R407.3'),
] as const

export function buildStructuralCadPart(partId: string): Group | null {
  const entry = STRUCTURAL_CAD_CATALOG.find((p) => p.id === partId)
  return entry ? entry.build() : null
}
