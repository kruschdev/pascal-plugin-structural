/**
 * Clean-Room MIT Procedural 3D CAD Builders for Structural Columns + Footings,
 * IRC R302.11/R302.12 Fire Blocking / Intumescent Firestop Collars / Draftstopping,
 * and Modular Wall / Floor / Roof / Braced-Wall / Foundation Framing Previews.
 *
 * Zero React, `@pascal-app/editor`, `@pascal-app/viewer`, or `next` imports.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  Shape,
} from 'three'
import {
  type AssemblyKind,
  COLUMN_CATALOG,
  type ColumnType,
  FEET_TO_METERS,
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  INCHES_TO_METERS,
  type LumberSpecies,
} from '../irc/tables'
import { buildBeamCad, buildIJoistCad, buildTrussCad } from './beams'
import { buildConnectorCad, getPostCapSeatOffsetM } from './connectors'
import {
  createStructuralMaterialPool,
  firestopMaterialForKind,
  lumberMaterialForSpecies,
  type StructuralMaterialPool,
} from './materials'

export type ColumnCadOptions = {
  /** Optional `COLUMN_CATALOG` id (e.g., `'col-4x4-dfl'`, `'col-psl-5.25'`, `'col-steel-hss-4x4'`) */
  columnId?: string
  columnType?: ColumnType
  /** Column shaft width in inches */
  widthIn?: number
  /** Column shaft depth in inches */
  depthIn?: number
  /** Column height in meters (default 2.4384 m = 8 ft) */
  heightM?: number
  /** Include poured concrete spread pad footing underneath (default false) */
  includeFooting?: boolean
  /** When true (default), place footing + pier below y = 0 so column shaft starts at y = 0. Set false for grounded catalog displays. */
  footingBelowGrade?: boolean
  footingWidthM?: number
  footingThicknessM?: number
  /** Attach Simpson-class base connector at bottom of column (default true) */
  includeBaseHardware?: boolean
  /** Attach Simpson-class cap connector at top of column (default true) */
  includeCapHardware?: boolean
  baseSku?: string
  capSku?: string
  species?: LumberSpecies
  pool?: StructuralMaterialPool
}

export type FirestopCadOptions = {
  firestopKind: FirestopKind
  material?: FirestopMaterial
  /** Overall bay/assembly width in meters */
  widthM?: number
  /** Vertical height in meters (honored in live mode) */
  heightM?: number
  /** Overall framing cavity depth in meters (default 3.5 in or 5.5 in) */
  depthM?: number
  /** Pipe outer diameter in meters for `'penetration-firestop'` (default 3.5 in = 3" Sch 40 PVC OD) */
  pipeOdM?: number
  /** `'live'` builds clean proportional geometry honoring widthM/heightM/depthM; `'cutaway'` (default) builds demo catalog assemblies. */
  mode?: 'live' | 'cutaway'
  pool?: StructuralMaterialPool
}

export type AssemblyPreviewCadOptions = {
  assemblyKind: AssemblyKind
  /** Overall cutaway length along X in meters (default 2.4384 m = 8 ft) */
  lengthM?: number
  /** Wall/cutaway height in meters (default 2.4384 m = 8 ft for walls) */
  heightM?: number
  species?: LumberSpecies
  pool?: StructuralMaterialPool
}

function addMesh(parent: Group, mesh: Mesh, x: number, y: number, z: number): Mesh {
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/**
 * Procedural 3D CAD builder for solid wood, built-up king post, PSL, Glulam, Steel HSS,
 * and concrete-filled Steel Lally columns, with optional pad footing and Simpson-class base/cap hardware.
 */
export function buildColumnCad(options: ColumnCadOptions = {}): Group {
  const entry = options.columnId
    ? COLUMN_CATALOG.find((c) => c.id === options.columnId)
    : undefined

  const colType: ColumnType = options.columnType ?? entry?.columnType ?? 'wood-solid'
  const effWidthIn = options.widthIn ?? entry?.widthIn ?? 5.5
  const effDepthIn = options.depthIn ?? entry?.depthIn ?? 5.5
  const widthM = effWidthIn * INCHES_TO_METERS
  const depthM = effDepthIn * INCHES_TO_METERS
  const heightM = options.heightM ?? 8 * FEET_TO_METERS
  const includeFooting = options.includeFooting ?? false
  const footingBelowGrade = options.footingBelowGrade ?? true
  const footingW = options.footingWidthM ?? Math.max(0.61, widthM * 4.5)
  const footingT = options.footingThicknessM ?? 0.254 // 10" concrete pad footing
  const includeBase = options.includeBaseHardware ?? true
  const includeCap = options.includeCapHardware ?? true
  const pool = options.pool ?? createStructuralMaterialPool()

  const g = new Group()
  g.name = `structural-column-${options.columnId ?? colType}`

  let yBase = 0
  if (includeFooting) {
    const pierW = Math.max(widthM + 0.14, 0.28)
    const pierH = 0.08
    if (footingBelowGrade) {
      // Spread pad footing + grout pedestal placed below y = 0 so column shaft starts cleanly at y = 0
      addMesh(g, new Mesh(new BoxGeometry(footingW, footingT, footingW), pool.concrete), 0, -(pierH + footingT / 2), 0)
      addMesh(g, new Mesh(new BoxGeometry(pierW, pierH, pierW), pool.concrete), 0, -pierH / 2, 0)
      yBase = 0
    } else {
      // Concrete spread pad footing resting on y = 0 + raised grout pedestal collar (grounded catalog display)
      addMesh(g, new Mesh(new BoxGeometry(footingW, footingT, footingW), pool.concrete), 0, footingT / 2, 0)
      addMesh(g, new Mesh(new BoxGeometry(pierW, pierH, pierW), pool.concrete), 0, footingT + pierH / 2, 0)
      yBase = footingT + pierH
    }
  }

  // Size-matched default Simpson-class hardware SKUs when caller omits explicit SKUs
  const defaultBaseSku =
    effWidthIn <= 3.75 && effDepthIn <= 3.75
      ? 'ABU44Z'
      : effWidthIn <= 3.75 && effDepthIn > 4.5
        ? 'ABU46Z'
        : 'ABU66Z'
  const defaultCapSku =
    effWidthIn <= 3.75 && effDepthIn <= 3.75
      ? 'BC4'
      : effWidthIn <= 3.75 && effDepthIn > 4.5
        ? 'CCQ46'
        : 'CCQ66'
  const baseSku = options.baseSku ?? entry?.recommendedBaseSku ?? defaultBaseSku
  const capSku = options.capSku ?? entry?.recommendedCapSku ?? defaultCapSku
  const isWood =
    colType === 'wood-solid' ||
    colType === 'wood-built-up' ||
    colType === 'psl' ||
    colType === 'glulam'

  const standoffOffset =
    isWood && includeBase && baseSku.toUpperCase().startsWith('ABU') ? 1.0 * INCHES_TO_METERS : 0
  const shaftY0 = yBase + standoffOffset
  const shaftH = Math.max(0.3, heightM - standoffOffset)

  switch (colType) {
    case 'wood-solid': {
      const mat = lumberMaterialForSpecies(pool, options.species ?? 'df-l-2')
      addMesh(g, new Mesh(new BoxGeometry(widthM, shaftH, depthM), mat), 0, shaftY0 + shaftH / 2, 0)
      break
    }

    case 'wood-built-up': {
      const mat = lumberMaterialForSpecies(pool, options.species ?? 'df-l-2')
      const plyCount = Math.max(2, Math.round(widthM / (1.5 * INCHES_TO_METERS)))
      const seam = 0.0016
      const plyW = (widthM - seam * (plyCount - 1)) / plyCount
      let xCursor = -widthM / 2
      for (let i = 0; i < plyCount; i++) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(plyW - 0.0006, shaftH, depthM), mat),
          xCursor + plyW / 2,
          shaftY0 + shaftH / 2,
          0,
        )
        xCursor += plyW
        if (i < plyCount - 1) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(seam, shaftH, depthM + 0.0006), pool.seamDark),
            xCursor + seam / 2,
            shaftY0 + shaftH / 2,
            0,
          )
          xCursor += seam
        }
      }
      // Vertical stitch nail rows along outer faces
      const nailGeo = new CylinderGeometry(0.0038, 0.0038, 0.0022, 8)
      nailGeo.rotateZ(Math.PI / 2)
      const count = Math.max(4, Math.floor(shaftH / 0.3))
      for (let i = 0; i < count; i++) {
        const y = shaftY0 + 0.14 + (count > 1 ? (i / (count - 1)) * (shaftH - 0.28) : 0)
        for (const side of [-1, 1] as const) {
          addMesh(g, new Mesh(nailGeo, pool.steelFastener), side * (widthM / 2 + 0.001), y, 0)
        }
      }
      break
    }

    case 'psl': {
      addMesh(g, new Mesh(new BoxGeometry(widthM, shaftH, depthM), pool.pslStrand), 0, shaftY0 + shaftH / 2, 0)
      // Subtle vertical strand seam texture lines
      const striGeo = new BoxGeometry(0.0022, shaftH, depthM + 0.001)
      for (const xf of [-0.28, 0, 0.28]) {
        addMesh(g, new Mesh(striGeo, pool.seamDark), widthM * xf, shaftY0 + shaftH / 2, 0)
      }
      break
    }

    case 'glulam': {
      const lamCount = Math.max(3, Math.round(widthM / (1.375 * INCHES_TO_METERS)))
      const lamW = widthM / lamCount
      const glue = 0.0018
      for (let i = 0; i < lamCount; i++) {
        const x = -widthM / 2 + (i + 0.5) * lamW
        const mat = i % 2 === 0 ? pool.glulamTimber : pool.lvlVeneer
        addMesh(g, new Mesh(new BoxGeometry(lamW - glue, shaftH, depthM), mat), x, shaftY0 + shaftH / 2, 0)
        if (i < lamCount - 1) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(glue, shaftH, depthM + 0.0005), pool.seamDark),
            -widthM / 2 + (i + 1) * lamW,
            shaftY0 + shaftH / 2,
            0,
          )
        }
      }
      break
    }

    case 'steel-hss': {
      const plateT = 0.0127 // 1/2" welded cap & base bearing plates
      const plateW = widthM + 0.09
      const plateD = depthM + 0.09
      const tubeH = Math.max(0.25, shaftH - plateT * 2)

      // Welded steel bottom baseplate + 4 anchor bolts
      addMesh(g, new Mesh(new BoxGeometry(plateW, plateT, plateD), pool.steelMillDark), 0, yBase + plateT / 2, 0)
      const boltGeo = new CylinderGeometry(0.0085, 0.0085, 0.022, 6)
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          addMesh(
            g,
            new Mesh(boltGeo, pool.steelFastener),
            sx * (plateW / 2 - 0.024),
            yBase + plateT + 0.011,
            sz * (plateD / 2 - 0.024),
          )
        }
      }

      // Main HSS square structural steel tube
      addMesh(
        g,
        new Mesh(new BoxGeometry(widthM, tubeH, depthM), pool.steelMillDark),
        0,
        yBase + plateT + tubeH / 2,
        0,
      )

      // Welded steel top beam-bearing cap plate + 4 bolt holes/studs
      addMesh(
        g,
        new Mesh(new BoxGeometry(plateW, plateT, plateD), pool.steelMillDark),
        0,
        yBase + plateT + tubeH + plateT / 2,
        0,
      )
      break
    }

    case 'steel-lally': {
      const plateT = 0.01
      const plateW = Math.max(0.18, widthM + 0.08)
      const r = widthM / 2
      const pipeH = Math.max(0.25, shaftH - plateT * 2)

      // Bottom welded square steel baseplate + 4 anchor bolts
      addMesh(g, new Mesh(new BoxGeometry(plateW, plateT, plateW), pool.steelMillDark), 0, yBase + plateT / 2, 0)
      const boltGeo = new CylinderGeometry(0.0075, 0.0075, 0.018, 6)
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          addMesh(
            g,
            new Mesh(boltGeo, pool.steelFastener),
            sx * (plateW / 2 - 0.022),
            yBase + plateT + 0.009,
            sz * (plateW / 2 - 0.022),
          )
        }
      }

      // Red-oxide primed Sch 40 steel cylinder shell + visible concrete core ring at top weld seam
      addMesh(
        g,
        new Mesh(new CylinderGeometry(r, r, pipeH, 24), pool.steelRedOxide),
        0,
        yBase + plateT + pipeH / 2,
        0,
      )
      addMesh(
        g,
        new Mesh(new CylinderGeometry(r * 0.88, r * 0.88, 0.008, 20), pool.concrete),
        0,
        yBase + plateT + pipeH - 0.002,
        0,
      )

      // Top welded steel beam-bearing plate
      addMesh(
        g,
        new Mesh(new BoxGeometry(plateW, plateT, plateW), pool.steelMillDark),
        0,
        yBase + plateT + pipeH + plateT / 2,
        0,
      )
      break
    }
  }

  // Attach Simpson-class base and cap connectors on wood/engineered columns
  if (isWood && includeBase) {
    const baseConn = buildConnectorCad({ sku: baseSku, pool })
    baseConn.position.set(0, yBase, 0)
    g.add(baseConn)
  }
  if (isWood && includeCap) {
    const capConn = buildConnectorCad({ sku: capSku, pool })
    // Seat the cap horizontal bearing plate underside flush on top of the column shaft (shaftY0 + shaftH, 0 mm float)
    capConn.position.set(0, shaftY0 + shaftH - getPostCapSeatOffsetM(capSku), 0)
    g.add(capConn)
  }

  return g
}

/**
 * Procedural 3D CAD builder for IRC R302.11 fire blocking, UL intumescent firestop collars,
 * and IRC R302.12 floor/attic draftstopping assemblies.
 */
export function buildFirestopCad(options: FirestopCadOptions): Group {
  const { firestopKind } = options
  const rule = FIRESTOP_RULES[firestopKind]
  const matKind: FirestopMaterial = options.material ?? rule.defaultMaterial
  const pool = options.pool ?? createStructuralMaterialPool()
  const fsMat = firestopMaterialForKind(pool, matKind)

  const g = new Group()
  g.name = `structural-firestop-${firestopKind}`

  const studT = 1.5 * INCHES_TO_METERS
  const bayW = options.widthM ?? 16 * INCHES_TO_METERS
  const cavD = options.depthM ?? 5.5 * INCHES_TO_METERS

  // Live scene mode: build clean proportional firestop/draftstop geometry honoring exact widthM, heightM, depthM
  // (keeps demo framing cutaways strictly in the standalone CAD catalog .glb exports).
  if (options.mode === 'live') {
    const liveW = Math.max(0.06, options.widthM ?? 1.0)
    const liveH = Math.max(0.03, options.heightM ?? 0.3)
    const liveD = Math.max(0.01, options.depthM ?? 0.089)

    if (firestopKind === 'penetration-firestop') {
      const collarOuterR = Math.max(0.03, Math.min(liveW, liveD) / 2)
      const innerR = Math.max(0.015, collarOuterR * 0.72)
      addMesh(
        g,
        new Mesh(new CylinderGeometry(collarOuterR, collarOuterR, liveH, 20), pool.firestopIntumescentRed),
        0,
        liveH / 2,
        0,
      )
      addMesh(
        g,
        new Mesh(new CylinderGeometry(innerR, innerR, liveH + 0.002, 20), pool.steelMillDark),
        0,
        liveH / 2,
        0,
      )
      return g
    }

    if (firestopKind === 'attic-draftstop') {
      const tri = new Shape()
      tri.moveTo(-liveW / 2, 0)
      tri.lineTo(liveW / 2, 0)
      tri.lineTo(0, liveH)
      tri.closePath()
      const triGeo = new ExtrudeGeometry(tri, { depth: liveD, bevelEnabled: false })
      triGeo.translate(0, 0, -liveD / 2)
      addMesh(g, new Mesh(triGeo, fsMat), 0, 0, 0)
      return g
    }

    // Proportional firestop/draftstop block (wall, soffit, stair, chase, floor-draftstop)
    if (firestopKind === 'chase-chimney-shaft') {
      // Stack mineral-wool / gypsum shaft block cleanly above the bottom galvanized retaining plate (zero coplanar Z-fighting)
      const plateH = Math.min(0.004, liveH * 0.1)
      const blockH = Math.max(0.005, liveH - plateH)
      addMesh(
        g,
        new Mesh(new BoxGeometry(liveW + 0.002, plateH, liveD + 0.002), pool.galvanizedSteel),
        0,
        plateH / 2,
        0,
      )
      addMesh(g, new Mesh(new BoxGeometry(liveW, blockH, liveD), fsMat), 0, plateH + blockH / 2, 0)
    } else {
      addMesh(g, new Mesh(new BoxGeometry(liveW, liveH, liveD), fsMat), 0, liveH / 2, 0)
      // High-visibility red IRC R302.11 / R302.12 code-compliance inspection band proud of stud faces
      const stripeH = Math.min(0.036, Math.max(0.016, liveH * 0.38))
      addMesh(
        g,
        new Mesh(new BoxGeometry(liveW + 0.002, stripeH, liveD + 0.010), pool.firestopIntumescentRed),
        0,
        liveH / 2,
        0,
      )
    }
    return g
  }

  switch (firestopKind) {
    case 'wall-vertical-10ft':
    case 'wall-horizontal-10ft': {
      // Stud cavity framing cutaway with horizontal (or vertical) IRC R302.11(2) fire blocking
      const h = 1.05
      const clearW = bayW - studT
      // Left & right 2x framing studs
      for (const sx of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(studT, h, cavD), pool.lumberSpf), sx * (bayW / 2), h / 2, 0)
      }
      if (firestopKind === 'wall-vertical-10ft') {
        const blockH =
          matKind === 'double-1x'
            ? 1.5 * INCHES_TO_METERS
            : matKind === '23/32-osb'
              ? 0.72 * INCHES_TO_METERS
              : matKind === '1/2-gypsum'
                ? 0.5 * INCHES_TO_METERS
                : matKind === 'mineral-wool-batt'
                  ? 3.5 * INCHES_TO_METERS
                  : 1.5 * INCHES_TO_METERS
        addMesh(g, new Mesh(new BoxGeometry(clearW, blockH, cavD), fsMat), 0, h * 0.52, 0)
        // Red fireblock inspection band / toenails
        addMesh(
          g,
          new Mesh(new BoxGeometry(clearW * 0.96, 0.006, cavD + 0.002), pool.firestopIntumescentRed),
          0,
          h * 0.52 + blockH / 2 + 0.003,
          0,
        )
      } else {
        // Horizontal furred cavity vertical divider block
        addMesh(g, new Mesh(new BoxGeometry(bayW + studT, studT, cavD), pool.lumberSpf), 0, studT / 2, 0)
        addMesh(g, new Mesh(new BoxGeometry(bayW + studT, studT, cavD), pool.lumberSpf), 0, h - studT / 2, 0)
        addMesh(g, new Mesh(new BoxGeometry(studT, h - 2 * studT, cavD), fsMat), 0, h / 2, 0)
      }
      break
    }

    case 'soffit-drop-ceiling': {
      // Concealed vertical stud cavity intersecting horizontal dropped soffit with OSB/2x baffle
      const wallH = 1.1
      const soffitD = 0.55
      const soffitY = 0.55
      // Back wall framing studs
      for (const sx of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(studT, wallH, cavD), pool.lumberSpf), sx * (bayW / 2), wallH / 2, 0)
      }
      // Dropped soffit ledger & front ladder frame
      addMesh(g, new Mesh(new BoxGeometry(bayW + studT, studT, studT), pool.lumberSpf), 0, soffitY, cavD / 2 + soffitD)
      for (const sx of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(studT, studT, soffitD), pool.lumberSpf),
          sx * (bayW / 2),
          soffitY,
          cavD / 2 + soffitD / 2,
        )
        addMesh(
          g,
          new Mesh(new BoxGeometry(studT, wallH - soffitY, studT), pool.lumberSpf),
          sx * (bayW / 2),
          soffitY + (wallH - soffitY) / 2,
          cavD / 2 + soffitD,
        )
      }
      // IRC R302.11(1) horizontal fireblock sealing the wall-to-soffit interconnection
      addMesh(
        g,
        new Mesh(new BoxGeometry(bayW - studT, 0.022, cavD + 0.02), fsMat),
        0,
        soffitY + 0.011,
        0.01,
      )
      // Vertical soffit fire-blocking diaphragm
      addMesh(
        g,
        new Mesh(new BoxGeometry(bayW - studT, wallH - soffitY, 0.019), fsMat),
        0,
        soffitY + (wallH - soffitY) / 2,
        cavD / 2 + 0.01,
      )
      break
    }

    case 'stair-stringer': {
      // Pair of notched stair stringers with top & bottom IRC R302.11(3) fire blocking
      const spanX = 1.15
      const riseY = 0.72
      const strW = 0.42
      const shape = new Shape()
      shape.moveTo(0, 0)
      shape.lineTo(0.28, 0)
      shape.lineTo(spanX, riseY - 0.18)
      shape.lineTo(spanX, riseY)
      // 3 sawtooth treads/risers stepping down
      const steps = 3
      const dx = spanX / steps
      const dy = riseY / steps
      for (let s = steps - 1; s >= 0; s--) {
        shape.lineTo((s + 1) * dx - dx, (s + 1) * dy)
        shape.lineTo(s * dx, s * dy)
      }
      shape.closePath()
      const strGeo = new ExtrudeGeometry(shape, { depth: studT, bevelEnabled: false })
      strGeo.translate(-spanX / 2, 0, -studT / 2)

      for (const sz of [-1, 1] as const) {
        addMesh(g, new Mesh(strGeo, pool.lumberDfl), 0, 0, sz * (strW / 2))
      }
      // Bottom & top fire-blocking boards spanning tightly between stringers
      addMesh(
        g,
        new Mesh(new BoxGeometry(studT, 0.19, strW - studT), fsMat),
        -spanX / 2 + 0.14,
        0.095,
        0,
      )
      addMesh(
        g,
        new Mesh(new BoxGeometry(studT, 0.24, strW - studT), fsMat),
        spanX / 2 - 0.04,
        riseY - 0.12,
        0,
      )
      break
    }

    case 'chase-chimney-shaft': {
      // Floor-plane chase box packed with non-combustible mineral wool + galvanized retaining angles
      const chaseW = options.widthM ?? 0.52
      const chaseD = options.depthM ?? 0.52
      const joistH = 9.25 * INCHES_TO_METERS

      // Surrounding floor-framing chase rim joists
      for (const sz of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(chaseW + studT * 2, joistH, studT), pool.lumberDfl),
          0,
          joistH / 2,
          sz * (chaseD / 2 + studT / 2),
        )
      }
      for (const sx of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(studT, joistH, chaseD), pool.lumberDfl),
          sx * (chaseW / 2 + studT / 2),
          joistH / 2,
          0,
        )
      }
      // Dense mineral-wool firestop packing batt + 26-ga galvanized sheet-metal bottom retainer
      addMesh(g, new Mesh(new BoxGeometry(chaseW, 0.004, chaseD), pool.galvanizedSteel), 0, 0.012, 0)
      addMesh(
        g,
        new Mesh(new BoxGeometry(chaseW - 0.004, 0.11, chaseD - 0.004), pool.firestopMineralWool),
        0,
        0.068,
        0,
      )
      // Central double-wall B-vent / flue pipe passing through firestop collar
      addMesh(
        g,
        new Mesh(new CylinderGeometry(0.085, 0.085, joistH + 0.24, 20), pool.galvanizedSteel),
        0,
        joistH / 2 + 0.04,
        0,
      )
      // Red intumescent perimeter firestop sealant collar around flue
      addMesh(
        g,
        new Mesh(new CylinderGeometry(0.105, 0.105, 0.032, 20), pool.firestopIntumescentRed),
        0,
        0.13,
        0,
      )
      break
    }

    case 'penetration-firestop': {
      // Double 2x6 top plate penetrated by vertical pipe + UL-listed red intumescent split firestop collar
      const plateW = 0.56
      const plateD = 5.5 * INCHES_TO_METERS
      const pipeR = (options.pipeOdM ?? 3.5 * INCHES_TO_METERS) / 2
      const doublePlateH = studT * 2

      // Double top plates (lower + upper with seam)
      addMesh(g, new Mesh(new BoxGeometry(plateW, studT - 0.001, plateD), pool.lumberSpf), 0, studT / 2, 0)
      addMesh(g, new Mesh(new BoxGeometry(plateW, studT - 0.001, plateD), pool.lumberSpf), 0, studT * 1.5, 0)

      // Penetrating vertical DWV/riser pipe passing through plate bore
      addMesh(
        g,
        new Mesh(new CylinderGeometry(pipeR, pipeR, 0.42, 24), pool.gypsumBoard),
        0,
        0.16,
        0,
      )

      // UL-listed red steel-jacketed intumescent firestop collar seated flush against top plate
      const collarH = 0.056
      const collarOuterR = pipeR + 0.016
      addMesh(
        g,
        new Mesh(new CylinderGeometry(collarOuterR, collarOuterR, collarH, 24), pool.firestopIntumescentRed),
        0,
        doublePlateH + collarH / 2,
        0,
      )
      // Inner intumescent graphite/red seal lip
      addMesh(
        g,
        new Mesh(new CylinderGeometry(pipeR + 0.007, pipeR + 0.007, collarH + 0.008, 24), pool.steelMillDark),
        0,
        doublePlateH + collarH / 2,
        0,
      )
      // 4 galvanized anchoring mounting tabs + fasteners around collar base
      const tabGeo = new BoxGeometry(0.028, 0.004, 0.022)
      const screwGeo = new CylinderGeometry(0.0045, 0.0045, 0.006, 6)
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2 + Math.PI / 4
        const tx = Math.cos(ang) * (collarOuterR + 0.01)
        const tz = Math.sin(ang) * (collarOuterR + 0.01)
        const tab = addMesh(g, new Mesh(tabGeo, pool.galvanizedSteel), tx, doublePlateH + 0.002, tz)
        tab.rotation.y = -ang
        addMesh(g, new Mesh(screwGeo, pool.steelFastener), tx, doublePlateH + 0.006, tz)
      }
      // Red intumescent fireblock caulk bead at bottom plate penetration
      addMesh(
        g,
        new Mesh(new CylinderGeometry(pipeR + 0.012, pipeR + 0.016, 0.014, 20), pool.firestopIntumescentRed),
        0,
        -0.004,
        0,
      )
      break
    }

    case 'floor-draftstop': {
      // IRC R302.12 floor-ceiling draftstop (1/2" Type X gypsum dividing open-web floor trusses)
      const trussDepth = 14 * INCHES_TO_METERS
      const baySpan = 0.61 // 24" OC truss bay
      const runLen = 1.2
      // Twin flanking floor joists/truss chords
      for (const sz of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(runLen, trussDepth, studT), pool.lumberSpf), 0, trussDepth / 2, sz * (baySpan / 2))
      }
      // Full-depth 1/2" gypsum draftstop partition spanning across the bay + wood nailer cleats
      const gypT = 0.5 * INCHES_TO_METERS
      addMesh(
        g,
        new Mesh(new BoxGeometry(gypT, trussDepth - 0.004, baySpan - studT), fsMat),
        0,
        trussDepth / 2,
        0,
      )
      for (const sz of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(0.032, trussDepth - 0.02, 0.032), pool.lumberSpf),
          gypT / 2 + 0.016,
          trussDepth / 2,
          sz * (baySpan / 2 - studT / 2 - 0.016),
        )
      }
      // Red code-compliance draftstop seam tape
      addMesh(
        g,
        new Mesh(new BoxGeometry(gypT + 0.004, 0.02, baySpan - studT), pool.firestopIntumescentRed),
        0,
        trussDepth * 0.5,
        0,
      )
      break
    }

    case 'attic-draftstop': {
      // IRC R302.12.1 triangular attic truss-bay gable draftstop membrane
      const w = options.widthM ?? 2.4
      const h = 0.85
      const gypT = 0.5 * INCHES_TO_METERS
      const tri = new Shape()
      tri.moveTo(-w / 2, 0)
      tri.lineTo(w / 2, 0)
      tri.lineTo(0, h)
      tri.closePath()
      const triGeo = new ExtrudeGeometry(tri, { depth: gypT, bevelEnabled: false })
      triGeo.translate(0, 0, -gypT / 2)
      addMesh(g, new Mesh(triGeo, fsMat), 0, 0.04, 0)

      // Bottom framing plate & side framing cleats
      addMesh(g, new Mesh(new BoxGeometry(w, 0.04, 0.089), pool.lumberSpf), 0, 0.02, 0)
      addMesh(g, new Mesh(new BoxGeometry(0.04, h * 0.92, 0.04), pool.lumberSpf), 0, h * 0.46 + 0.04, gypT / 2 + 0.02)
      break
    }
  }

  return g
}

/**
 * Modular 3D CAD cutaway preview builder for all 5 structural assembly kinds
 * (`wall-framing`, `floor-system`, `roof-system`, `braced-wall-line`, `foundation-system`).
 */
export function buildAssemblyPreviewCad(options: AssemblyPreviewCadOptions): Group {
  const { assemblyKind } = options
  const pool = options.pool ?? createStructuralMaterialPool()
  const woodMat = lumberMaterialForSpecies(pool, options.species ?? 'spf-2')
  const studT = 1.5 * INCHES_TO_METERS
  const studD = 5.5 * INCHES_TO_METERS // 2x6 exterior framing default

  const g = new Group()
  g.name = `structural-assembly-${assemblyKind}`

  switch (assemblyKind) {
    case 'wall-framing': {
      // Complete 8' x 8' IRC exterior wall cutaway with framed window opening (header, jacks, kings, sill, cripples)
      const len = options.lengthM ?? 8 * FEET_TO_METERS
      const h = options.heightM ?? 8 * FEET_TO_METERS
      const studH = h - studT * 3

      // Pressure-treated bottom sill plate + double top plates
      addMesh(g, new Mesh(new BoxGeometry(len, studT, studD), pool.lumberPt), 0, studT / 2, 0)
      addMesh(g, new Mesh(new BoxGeometry(len, studT, studD), woodMat), 0, h - studT * 1.5, 0)
      addMesh(g, new Mesh(new BoxGeometry(len, studT, studD), woodMat), 0, h - studT * 0.5, 0)

      // Window rough opening centered in wall: 36" wide x 48" tall
      const roW = 36 * INCHES_TO_METERS
      const sillY = 32 * INCHES_TO_METERS
      const headY = 80 * INCHES_TO_METERS
      const headerDepth = 9.25 * INCHES_TO_METERS

      // End studs + king studs + jack (trimmer) studs
      const endX = len / 2 - studT / 2
      const jackX = roW / 2 + studT / 2
      const kingX = jackX + studT
      for (const sx of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(studT, studH, studD), woodMat), sx * endX, studT + studH / 2, 0)
        addMesh(g, new Mesh(new BoxGeometry(studT, studH, studD), woodMat), sx * kingX, studT + studH / 2, 0)
        // Jack stud bearing under header
        const jackH = headY - studT
        addMesh(g, new Mesh(new BoxGeometry(studT, jackH, studD), pool.lumberDfl), sx * jackX, studT + jackH / 2, 0)
        // Mid-bay stud between end and king stud
        const midX = (endX + kingX) / 2
        if (Math.abs(endX - kingX) > 0.35) {
          addMesh(g, new Mesh(new BoxGeometry(studT, studH, studD), woodMat), sx * midX, studT + studH / 2, 0)
        }
      }

      // Built-up (2) 2x10 window header using buildBeamCad
      const header = buildBeamCad({
        beamId: 'dim-2-2x10',
        lengthM: roW + studT * 2,
        pool,
      })
      header.position.set(0, headY, 0)
      g.add(header)

      // Double window sill + lower cripple studs
      addMesh(g, new Mesh(new BoxGeometry(roW, studT, studD), woodMat), 0, sillY - studT / 2, 0)
      const crippleH = sillY - studT * 2
      for (const cx of [-roW * 0.25, 0, roW * 0.25]) {
        addMesh(g, new Mesh(new BoxGeometry(studT, crippleH, studD), woodMat), cx, studT + crippleH / 2, 0)
      }

      // Upper cripples above header
      const topCrippleH = h - studT * 2 - (headY + headerDepth)
      if (topCrippleH > 0.02) {
        for (const cx of [-roW * 0.25, 0, roW * 0.25]) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(studT, topCrippleH, studD), woodMat),
            cx,
            headY + headerDepth + topCrippleH / 2,
            0,
          )
        }
      }

      // Horizontal IRC R302.11 fire blocking in outer stud bays
      const outerBayW = Math.max(0.1, endX - kingX - studT)
      for (const sx of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(outerBayW, studT, studD), pool.lumberDfl),
          sx * ((endX + kingX) / 2),
          h * 0.5,
          0,
        )
      }
      break
    }

    case 'floor-system': {
      // LVL carrying girder + TJI I-joists hung with IUS galvanized hangers + rim board + partial OSB deck
      const spanX = options.lengthM ?? 2.4
      const joistLen = 1.8
      const joistDepth = 11.875 * INCHES_TO_METERS

      // Carrying 2-ply 11-7/8" LVL flush girder along X at z = -joistLen/2
      const girder = buildBeamCad({
        beamId: 'lvl-2-11.875',
        lengthM: spanX,
        pool,
      })
      girder.position.set(0, 0, -joistLen / 2 - 0.05)
      g.add(girder)

      // Opposite rim board along X at z = +joistLen/2
      addMesh(
        g,
        new Mesh(new BoxGeometry(spanX, joistDepth, 0.032), pool.osbWeb),
        0,
        joistDepth / 2,
        joistLen / 2 + 0.016,
      )

      // 5 TJI-230 I-joists at 16" OC running along Z + IUS hangers at girder face
      const spacing = 16 * INCHES_TO_METERS
      const count = 5
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * spacing
        const ijoist = buildIJoistCad({
          ijoistId: 'tji-230-11.875',
          lengthM: joistLen,
          includeWebStiffeners: false,
          pool,
        })
        ijoist.rotation.y = Math.PI / 2
        ijoist.position.set(x, 0, 0)
        g.add(ijoist)

        const hanger = buildConnectorCad({ sku: 'IUS2.56/11.88', pool })
        hanger.position.set(x, -0.002, -joistLen / 2)
        g.add(hanger)
      }

      // Partial 23/32" T&G OSB subfloor sheathing cutaway on left half
      addMesh(
        g,
        new Mesh(new BoxGeometry(spanX * 0.48, 0.019, joistLen + 0.08), pool.osbWeb),
        -spanX * 0.25,
        joistDepth + 0.0095,
        0,
      )
      break
    }

    case 'roof-system': {
      // Double top-plate walls + 3 Fink roof trusses at 24" OC + H2.5A hurricane ties + partial OSB roof deck
      const spanM = 3.6
      const spacing = 24 * INCHES_TO_METERS
      const trussCount = 3
      const runZ = (trussCount - 1) * spacing + 0.4
      const plateH = studT * 2

      // Left & right bearing double top plates
      for (const sx of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(studD, plateH, runZ), woodMat), sx * (spanM / 2), plateH / 2, 0)
      }

      for (let i = 0; i < trussCount; i++) {
        const z = (i - (trussCount - 1) / 2) * spacing
        const truss = buildTrussCad({
          trussKind: 'fink-truss',
          spanM,
          pitch: 6,
          overhangM: 0.35,
          heelHeightM: 0.16,
          pool,
        })
        truss.position.set(0, plateH, z)
        g.add(truss)

        // H2.5A hurricane ties at both bearing heels
        for (const sx of [-1, 1] as const) {
          const tie = buildConnectorCad({ sku: 'H2.5A', pool })
          tie.position.set(sx * (spanM / 2), plateH - 0.06, z + 0.025)
          g.add(tie)
        }
      }

      // Partial OSB roof deck panel on left slope
      const slopeAngle = Math.atan(6 / 12)
      const deckLen = Math.hypot(spanM / 2 + 0.35, (spanM / 2 + 0.35) * 0.5)
      const deck = addMesh(
        g,
        new Mesh(new BoxGeometry(deckLen, 0.016, runZ * 0.52), pool.osbWeb),
        -(spanM / 4 + 0.1),
        plateH + 0.16 + (spanM / 4) * 0.5 + 0.045,
        -runZ * 0.22,
      )
      deck.rotation.z = slopeAngle
      break
    }

    case 'braced-wall-line': {
      // IRC R602.10 seismic shear wall panel: concrete stemwall + HDU5 hold-downs + BP3x3 plate washers + OSB sheathing
      const wallW = 4 * FEET_TO_METERS // 48" braced wall panel
      const wallH = 8 * FEET_TO_METERS
      const stemH = 0.22
      const studH = wallH - studT * 3

      // Concrete foundation stemwall
      addMesh(g, new Mesh(new BoxGeometry(wallW + 0.3, stemH, 0.2), pool.concrete), 0, stemH / 2, 0)

      // Pressure-treated bottom sill plate + double top plates
      addMesh(g, new Mesh(new BoxGeometry(wallW, studT, studD), pool.lumberPt), 0, stemH + studT / 2, 0)
      addMesh(g, new Mesh(new BoxGeometry(wallW, studT, studD), woodMat), 0, stemH + wallH - studT * 1.5, 0)
      addMesh(g, new Mesh(new BoxGeometry(wallW, studT, studD), woodMat), 0, stemH + wallH - studT * 0.5, 0)

      // Double end hold-down posts + intermediate studs at 16" OC
      for (const sx of [-1, 1] as const) {
        addMesh(g, new Mesh(new BoxGeometry(studT * 2, studH, studD), pool.lumberDfl), sx * (wallW / 2 - studT), stemH + studT + studH / 2, 0)
        // HDU5-SDS2.5 seismic overturning hold-down bolted at each end post
        const hd = buildConnectorCad({ sku: 'HDU5-SDS2.5', pool })
        hd.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2
        hd.position.set(sx * (wallW / 2 - studT * 2 - 0.002), stemH + studT, 0)
        g.add(hd)
      }
      for (const ix of [-wallW / 6, wallW / 6]) {
        addMesh(g, new Mesh(new BoxGeometry(studT, studH, studD), woodMat), ix, stemH + studT + studH / 2, 0)
      }

      // IRC R602.11.1 BP3x3 seismic plate washers + anchor bolts along sill plate
      for (const ax of [-wallW * 0.25, 0, wallW * 0.25]) {
        const bp = buildConnectorCad({ sku: 'BP3x3', pool })
        bp.position.set(ax, stemH + studT, 0)
        g.add(bp)
      }

      // Structural 15/32" OSB shear sheathing on rear face (so front hold-downs stay clearly visible)
      addMesh(
        g,
        new Mesh(new BoxGeometry(wallW, wallH, 0.012), pool.osbWeb),
        0,
        stemH + wallH / 2,
        -studD / 2 - 0.006,
      )
      break
    }

    case 'foundation-system': {
      // Concrete strip footing + stemwall + SSTB16 anchor bolts + BP3x3 washers + PT sill + interior pad footing & 6x6 post
      const len = options.lengthM ?? 2.4
      const footH = 0.203 // 8" footing
      const stemH = 0.45

      // Continuous strip footing + stemwall along X at z = -0.55
      addMesh(g, new Mesh(new BoxGeometry(len, footH, 0.46), pool.concrete), 0, footH / 2, -0.55)
      addMesh(g, new Mesh(new BoxGeometry(len, stemH, 0.203), pool.concrete), 0, footH + stemH / 2, -0.55)

      // Pressure-treated 2x6 sill plate + BP3x3 washers + anchor bolts
      const sillY = footH + stemH
      addMesh(g, new Mesh(new BoxGeometry(len, studT, studD), pool.lumberPt), 0, sillY + studT / 2, -0.55)
      for (const ax of [-len * 0.35, 0, len * 0.35]) {
        const bp = buildConnectorCad({ sku: 'BP3x3', pool })
        bp.position.set(ax, sillY + studT, -0.55)
        g.add(bp)
      }

      // Interior spread pad footing + ABU66Z standoff post base + 6x6 girder column + built-up girder segment
      const col = buildColumnCad({
        columnId: 'col-6x6-dfl',
        heightM: 1.05,
        includeFooting: true,
        footingBelowGrade: false,
        footingWidthM: 0.66,
        footingThicknessM: 0.22,
        includeBaseHardware: true,
        includeCapHardware: true,
        pool,
      })
      col.position.set(0, 0, 0.48)
      g.add(col)

      const girder = buildBeamCad({
        beamId: 'dim-3-2x10',
        lengthM: len * 0.85,
        pool,
      })
      girder.position.set(0, 1.35, 0.48)
      g.add(girder)
      break
    }
  }

  return g
}
