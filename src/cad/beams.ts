/**
 * Clean-Room MIT Procedural 3D CAD Builders for Structural Beams, TJI I-Joists,
 * and Prefabricated Open-Web Floor / Roof Trusses.
 *
 * Zero React, `@pascal-app/editor`, `@pascal-app/viewer`, or `next` imports.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import {
  BEAM_CATALOG,
  type BeamMaterialFamily,
  FEET_TO_METERS,
  INCHES_TO_METERS,
  type LumberSpecies,
  TJI_IJOIST_CATALOG,
  type TjiIJoistEntry,
} from '../irc/tables'
import {
  createStructuralMaterialPool,
  lumberMaterialForSpecies,
  type StructuralMaterialPool,
} from './materials'

export type BeamCadOptions = {
  /** Optional `BEAM_CATALOG` id (e.g., `'lvl-3-14'`, `'steel-w10x22'`, `'flitch-2x12-500'`) */
  beamId?: string
  family?: BeamMaterialFamily
  /** Overall beam length along X axis in meters (default 2.4384 m = 8 ft) */
  lengthM?: number
  /** Overall beam width along Z axis in inches */
  widthIn?: number
  /** Overall beam depth along Y axis in inches */
  depthIn?: number
  /** Number of laminated/built-up plies */
  plyCount?: number
  /** Lumber species for dimensional / flitch wood plies */
  species?: LumberSpecies
  /** Include 1/2" plywood spacer on 2-ply dimensional headers (default true for 2-ply dimensional) */
  includeSpacer?: boolean
  /** Steel finish for `steel-w` beams */
  steelFinish?: 'red-oxide' | 'mill-dark'
  /** Optional caller-owned material pool (otherwise a fresh pool is created per build call) */
  pool?: StructuralMaterialPool
}

export type IJoistCadOptions = {
  /** Optional `TJI_IJOIST_CATALOG` id (e.g. `'tji-230-11.875'`) */
  ijoistId?: string
  series?: TjiIJoistEntry['series']
  /** Length along X axis in meters (default 3.048 m = 10 ft) */
  lengthM?: number
  depthIn?: number
  flangeWidthIn?: number
  flangeDepthIn?: number
  webThicknessIn?: number
  knockoutDiaIn?: number
  minSupportClearanceIn?: number
  includeWebStiffeners?: boolean
  pool?: StructuralMaterialPool
}

export type TrussCadKind = 'open-web-floor' | 'fink-truss' | 'scissor-truss' | 'attic-truss'

export type TrussCadOptions = {
  trussKind: TrussCadKind
  /** Out-to-out bearing span along X axis in meters */
  spanM?: number
  /** Overall depth in meters for `'open-web-floor'` (default 16 in = 0.4064 m) */
  depthM?: number
  /** Roof slope rise-over-12 (e.g. 6 for 6:12 pitch) */
  pitch?: number
  /** Eave overhang length per side in meters (default 0.45 m) */
  overhangM?: number
  /** Raised energy heel height in meters (default 0.18 m) */
  heelHeightM?: number
  /** Lumber thickness along Z axis in meters (default 1.5 in = 0.0381 m) */
  memberThicknessM?: number
  /** Chord face width in meters (default 3.5 in = 0.0889 m) */
  chordWidthM?: number
  species?: LumberSpecies
  pool?: StructuralMaterialPool
}

function addMesh(
  parent: Group,
  mesh: Mesh,
  x: number,
  y: number,
  z: number,
): Mesh {
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addMemberBetween(
  parent: Group,
  a: Vector3,
  b: Vector3,
  memberHeight: number,
  memberThickness: number,
  material: MeshStandardMaterial,
  zOffset = 0,
): Mesh | null {
  const dir = new Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.005) return null

  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5)
  const mesh = new Mesh(new BoxGeometry(len, memberHeight, memberThickness), material)
  mesh.position.set(mid.x, mid.y, zOffset)
  const quat = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.normalize())
  mesh.quaternion.copy(quat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addGangNailPlate(
  parent: Group,
  x: number,
  y: number,
  memberThickness: number,
  widthM: number,
  heightM: number,
  pool: StructuralMaterialPool,
  angleZ = 0,
): void {
  const plateThickness = 0.0022
  const zSide = memberThickness / 2 + plateThickness / 2 + 0.0004
  for (const sign of [-1, 1] as const) {
    const plate = new Mesh(
      new BoxGeometry(widthM, heightM, plateThickness),
      pool.galvanizedSteel,
    )
    plate.position.set(x, y, sign * zSide)
    plate.rotation.z = angleZ
    plate.castShadow = true
    plate.receiveShadow = true
    parent.add(plate)

    // Subtle stamped tooth-grid texture ribs on the outer face of each gang-nail plate
    const cols = Math.max(2, Math.floor(widthM / 0.032))
    const rows = Math.max(2, Math.floor(heightM / 0.028))
    const toothGeo = new BoxGeometry(0.008, 0.003, 0.0012)
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const lx = -widthM * 0.36 + (cols > 1 ? (c / (cols - 1)) * widthM * 0.72 : 0)
        const ly = -heightM * 0.34 + (rows > 1 ? (r / (rows - 1)) * heightM * 0.68 : 0)
        const tooth = new Mesh(toothGeo, pool.galvanizedAccent)
        tooth.position.set(lx, ly, sign * (plateThickness / 2 + 0.0005))
        plate.add(tooth)
      }
    }
  }
}

/**
 * Procedural 3D CAD builder for all 7 IRC/AWC/AISC structural beam families.
 * Beam spans along X (`-lengthM/2` to `+lengthM/2`), bottom face rests at `y = 0`.
 */
export function buildBeamCad(options: BeamCadOptions = {}): Group {
  const catalogEntry = options.beamId
    ? BEAM_CATALOG.find((b) => b.id === options.beamId)
    : undefined

  const family: BeamMaterialFamily = options.family ?? catalogEntry?.family ?? 'lvl'
  const lengthM = options.lengthM ?? 8 * FEET_TO_METERS
  const depthIn = options.depthIn ?? catalogEntry?.depthIn ?? 11.875
  const plyCount = Math.max(1, options.plyCount ?? catalogEntry?.plyCount ?? (family === 'lvl' ? 2 : 1))
  const widthIn = options.widthIn ?? catalogEntry?.widthIn ?? (family === 'lvl' ? 1.75 * plyCount : 3.5)
  const species: LumberSpecies = options.species ?? 'df-l-2'
  const pool = options.pool ?? createStructuralMaterialPool()

  const depthM = depthIn * INCHES_TO_METERS
  const widthM = widthIn * INCHES_TO_METERS

  const g = new Group()
  g.name = `structural-beam-${options.beamId ?? family}`

  switch (family) {
    case 'dimensional-built-up': {
      const woodMat = lumberMaterialForSpecies(pool, species)
      const useSpacer = options.includeSpacer ?? plyCount === 2
      const plyThick = 1.5 * INCHES_TO_METERS
      const spacerThick = useSpacer ? 0.5 * INCHES_TO_METERS : 0
      const seamGap = 0.0018
      const totalZ = plyCount * plyThick + spacerThick + (plyCount - 1) * seamGap
      let zCursor = -totalZ / 2

      for (let i = 0; i < plyCount; i++) {
        const zCenter = zCursor + plyThick / 2
        addMesh(
          g,
          new Mesh(new BoxGeometry(lengthM, depthM, plyThick - 0.0008), woodMat),
          0,
          depthM / 2,
          zCenter,
        )
        zCursor += plyThick

        // Optional 1/2" OSB/plywood header spacer between 2 plies to flush 3-1/2" wall thickness
        if (useSpacer && i === 0) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(lengthM - 0.004, depthM - 0.004, spacerThick - 0.001), pool.osbWeb),
            0,
            depthM / 2,
            zCursor + spacerThick / 2,
          )
          zCursor += spacerThick
        }

        if (i < plyCount - 1) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(lengthM + 0.0005, depthM + 0.0005, seamGap), pool.seamDark),
            0,
            depthM / 2,
            zCursor + seamGap / 2,
          )
          zCursor += seamGap
        }
      }

      // Staggered 16d framing nail rows along both outer faces (IRC R602.3(1) 16" OC)
      const nailPitch = 16 * INCHES_TO_METERS
      const nailGeo = new CylinderGeometry(0.0042, 0.0042, 0.0022, 8)
      nailGeo.rotateX(Math.PI / 2)
      const count = Math.max(2, Math.floor((lengthM - 0.16) / nailPitch) + 1)
      for (let n = 0; n < count; n++) {
        const x = -lengthM / 2 + 0.08 + (count > 1 ? (n / (count - 1)) * (lengthM - 0.16) : 0)
        for (const yFrac of [0.22, 0.5, 0.78]) {
          for (const side of [-1, 1] as const) {
            addMesh(
              g,
              new Mesh(nailGeo, pool.steelFastener),
              x,
              depthM * yFrac,
              side * (totalZ / 2 + 0.001),
            )
          }
        }
      }
      break
    }

    case 'lvl': {
      const seamGap = 0.0016
      const plyThick = (widthM - seamGap * Math.max(0, plyCount - 1)) / plyCount
      let zCursor = -widthM / 2

      for (let i = 0; i < plyCount; i++) {
        const zCenter = zCursor + plyThick / 2
        addMesh(
          g,
          new Mesh(new BoxGeometry(lengthM, depthM, plyThick - 0.0006), pool.lvlVeneer),
          0,
          depthM / 2,
          zCenter,
        )
        zCursor += plyThick
        if (i < plyCount - 1) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(lengthM + 0.0005, depthM + 0.0006, seamGap), pool.seamDark),
            0,
            depthM / 2,
            zCursor + seamGap / 2,
          )
          zCursor += seamGap
        }
      }

      // Thin rotary-peeled veneer lamination bands across side faces and end faces
      const veneerLayers = Math.max(6, Math.round(depthIn / 1.4))
      const veneerStripGeo = new BoxGeometry(lengthM + 0.0008, 0.0016, widthM + 0.0012)
      for (let v = 1; v < veneerLayers; v++) {
        const y = (v / veneerLayers) * depthM
        addMesh(g, new Mesh(veneerStripGeo, pool.seamDark), 0, y, 0)
      }

      // Structural SDS screw stitching along outer face when multi-ply
      if (plyCount >= 2) {
        const screwGeo = new CylinderGeometry(0.0055, 0.0055, 0.0045, 6)
        screwGeo.rotateX(Math.PI / 2)
        const pitchM = 12 * INCHES_TO_METERS
        const count = Math.max(2, Math.floor((lengthM - 0.16) / pitchM) + 1)
        for (let s = 0; s < count; s++) {
          const x = -lengthM / 2 + 0.08 + (count > 1 ? (s / (count - 1)) * (lengthM - 0.16) : 0)
          const rows = depthIn >= 14 ? [0.18, 0.5, 0.82] : [0.22, 0.78]
          for (const yf of rows) {
            addMesh(g, new Mesh(screwGeo, pool.steelFastener), x, depthM * yf, widthM / 2 + 0.002)
          }
        }
      }
      break
    }

    case 'psl': {
      // Heavy monolithic Parallam parallel-strand timber with subtle strand striations
      addMesh(g, new Mesh(new BoxGeometry(lengthM, depthM, widthM), pool.pslStrand), 0, depthM / 2, 0)
      const bands = Math.max(5, Math.round(depthIn / 2))
      const bandGeo = new BoxGeometry(lengthM + 0.0006, 0.0022, widthM + 0.001)
      for (let b = 1; b < bands; b++) {
        addMesh(g, new Mesh(bandGeo, pool.seamDark), 0, (b / bands) * depthM, 0)
      }
      // Subtle top & bottom eased arris bevel strips
      const bevelGeo = new BoxGeometry(lengthM, 0.004, widthM - 0.006)
      addMesh(g, new Mesh(bevelGeo, pool.glulamTimber), 0, depthM - 0.001, 0)
      addMesh(g, new Mesh(bevelGeo, pool.glulamTimber), 0, 0.001, 0)
      break
    }

    case 'lsl': {
      // TimberStrand LSL laminated strand lumber header
      addMesh(g, new Mesh(new BoxGeometry(lengthM, depthM, widthM), pool.osbWeb), 0, depthM / 2, 0)
      // Subtle top/bottom sealed edge coats and grade stamp band
      const capGeo = new BoxGeometry(lengthM, 0.005, widthM + 0.0006)
      addMesh(g, new Mesh(capGeo, pool.lvlVeneer), 0, depthM - 0.0025, 0)
      addMesh(g, new Mesh(capGeo, pool.lvlVeneer), 0, 0.0025, 0)
      const stripeGeo = new BoxGeometry(lengthM * 0.45, 0.004, widthM + 0.0012)
      addMesh(g, new Mesh(stripeGeo, pool.seamDark), 0, depthM * 0.5, 0)
      break
    }

    case 'glulam': {
      // Architectural 24F-V4/V8 Glulam built from stacked 1-1/2" horizontal laminations
      const lamNominalM = 1.5 * INCHES_TO_METERS
      const lamCount = Math.max(4, Math.round(depthM / lamNominalM))
      const lamHeight = depthM / lamCount
      const glueLineH = 0.002

      for (let l = 0; l < lamCount; l++) {
        const yBottom = l * lamHeight
        const lamMat = l % 2 === 0 ? pool.glulamTimber : pool.lvlVeneer
        addMesh(
          g,
          new Mesh(new BoxGeometry(lengthM, lamHeight - glueLineH, widthM), lamMat),
          0,
          yBottom + (lamHeight - glueLineH) / 2,
          0,
        )
        if (l < lamCount - 1) {
          addMesh(
            g,
            new Mesh(new BoxGeometry(lengthM + 0.0008, glueLineH, widthM - 0.002), pool.seamDark),
            0,
            yBottom + lamHeight - glueLineH / 2,
            0,
          )
        }
      }
      break
    }

    case 'steel-w': {
      // True AISC Wide-Flange I-Beam section: top flange, bottom flange, central web + root fillets
      const steelMat =
        options.steelFinish === 'mill-dark' ? pool.steelMillDark : pool.steelRedOxide
      const tf = Math.max(0.0085, Math.min(0.018, depthM * 0.055))
      const tw = Math.max(0.0062, Math.min(0.012, widthM * 0.065))
      const webH = Math.max(0.02, depthM - 2 * tf)

      // Bottom flange
      addMesh(g, new Mesh(new BoxGeometry(lengthM, tf, widthM), steelMat), 0, tf / 2, 0)
      // Top flange
      addMesh(g, new Mesh(new BoxGeometry(lengthM, tf, widthM), steelMat), 0, depthM - tf / 2, 0)
      // Central web
      addMesh(g, new Mesh(new BoxGeometry(lengthM, webH, tw), steelMat), 0, depthM / 2, 0)

      // Root fillet chamfers at all 4 web-to-flange junctions
      const fillet = Math.min(0.009, tf * 0.85)
      const filletGeo = new BoxGeometry(lengthM, fillet, fillet)
      for (const zSign of [-1, 1] as const) {
        const zf = zSign * (tw / 2 + fillet * 0.35)
        const botFillet = addMesh(g, new Mesh(filletGeo, steelMat), 0, tf + fillet * 0.35, zf)
        botFillet.rotation.x = Math.PI / 4
        const topFillet = addMesh(g, new Mesh(filletGeo, steelMat), 0, depthM - tf - fillet * 0.35, zf)
        topFillet.rotation.x = Math.PI / 4
      }

      // End bearing web stiffener plates on both sides of the web near beam ends
      const stiffW = (widthM - tw) / 2 - 0.004
      if (stiffW > 0.012) {
        const stiffGeo = new BoxGeometry(0.009, webH, stiffW)
        for (const xSign of [-1, 1] as const) {
          const xs = xSign * (lengthM / 2 - 0.06)
          for (const zSign of [-1, 1] as const) {
            addMesh(
              g,
              new Mesh(stiffGeo, steelMat),
              xs,
              depthM / 2,
              zSign * (tw / 2 + stiffW / 2),
            )
          }
        }
      }
      break
    }

    case 'flitch': {
      // Composite Flitch Beam: (2) outer wood plies + recessed A36 steel center plate + staggered through-bolts
      const woodMat = lumberMaterialForSpecies(pool, species)
      const plateThick = widthIn >= 3.45 ? 0.5 * INCHES_TO_METERS : 0.375 * INCHES_TO_METERS
      const woodPlyThick = Math.max(1.5 * INCHES_TO_METERS, (widthM - plateThick) / 2)
      const plateRecess = 0.25 * INCHES_TO_METERS
      const plateDepth = Math.max(0.05, depthM - 2 * plateRecess)
      const totalZ = woodPlyThick * 2 + plateThick

      // Recessed A36 steel center plate
      addMesh(
        g,
        new Mesh(new BoxGeometry(lengthM - 0.006, plateDepth, plateThick), pool.steelMillDark),
        0,
        depthM / 2,
        0,
      )

      // Left & right dimensional wood plies
      for (const zSign of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(new BoxGeometry(lengthM, depthM, woodPlyThick), woodMat),
          0,
          depthM / 2,
          zSign * (plateThick / 2 + woodPlyThick / 2),
        )
      }

      // Staggered 1/2" through-bolts with round washers + hex heads/nuts at 12" OC
      const boltSpacing = 12 * INCHES_TO_METERS
      const boltCount = Math.max(3, Math.floor((lengthM - 0.2) / boltSpacing) + 1)
      const washerGeo = new CylinderGeometry(0.017, 0.017, 0.003, 14)
      washerGeo.rotateX(Math.PI / 2)
      const hexGeo = new CylinderGeometry(0.011, 0.011, 0.011, 6)
      hexGeo.rotateX(Math.PI / 2)
      const studGeo = new CylinderGeometry(0.0065, 0.0065, totalZ + 0.032, 10)
      studGeo.rotateX(Math.PI / 2)

      for (let i = 0; i < boltCount; i++) {
        const x = -lengthM / 2 + 0.1 + (boltCount > 1 ? (i / (boltCount - 1)) * (lengthM - 0.2) : 0)
        // Double end bolts at first and last stations, staggered top/bottom along span
        const yFractions = i === 0 || i === boltCount - 1 ? [0.26, 0.74] : [i % 2 === 0 ? 0.28 : 0.72]
        for (const yf of yFractions) {
          const y = depthM * yf
          addMesh(g, new Mesh(studGeo, pool.steelFastener), x, y, 0)
          for (const zSign of [-1, 1] as const) {
            addMesh(g, new Mesh(washerGeo, pool.galvanizedSteel), x, y, zSign * (totalZ / 2 + 0.0015))
            addMesh(g, new Mesh(hexGeo, pool.steelFastener), x, y, zSign * (totalZ / 2 + 0.0085))
          }
        }
      }
      break
    }
  }

  return g
}

/**
 * Procedural 3D CAD builder for TJI engineered wood I-joists (LVL flanges + OSB web + stamped knockouts).
 * Joist spans along X (`-lengthM/2` to `+lengthM/2`), bottom flange rests at `y = 0`.
 */
export function buildIJoistCad(options: IJoistCadOptions = {}): Group {
  const entry = options.ijoistId
    ? TJI_IJOIST_CATALOG.find((t) => t.id === options.ijoistId)
    : options.series
      ? TJI_IJOIST_CATALOG.find((t) => t.series === options.series)
      : TJI_IJOIST_CATALOG[2] // default TJI-230 11-7/8"

  const lengthM = options.lengthM ?? 10 * FEET_TO_METERS
  const depthM = (options.depthIn ?? entry?.depthIn ?? 11.875) * INCHES_TO_METERS
  const flangeW = (options.flangeWidthIn ?? entry?.flangeWidthIn ?? 2.3125) * INCHES_TO_METERS
  const flangeD = (options.flangeDepthIn ?? entry?.flangeDepthIn ?? 1.375) * INCHES_TO_METERS
  const webT = (options.webThicknessIn ?? entry?.webThicknessIn ?? 0.375) * INCHES_TO_METERS
  const knockoutR = ((options.knockoutDiaIn ?? entry?.knockoutDiaIn ?? 1.5) * INCHES_TO_METERS) / 2
  const clearanceM = (options.minSupportClearanceIn ?? entry?.minSupportClearanceIn ?? 14) * INCHES_TO_METERS
  const pool = options.pool ?? createStructuralMaterialPool()

  const g = new Group()
  g.name = `structural-ijoist-${options.ijoistId ?? entry?.id ?? 'tji'}`

  const webH = Math.max(0.05, depthM - 2 * flangeD)

  // Bottom LVL flange
  addMesh(g, new Mesh(new BoxGeometry(lengthM, flangeD, flangeW), pool.lvlVeneer), 0, flangeD / 2, 0)
  // Top LVL flange
  addMesh(g, new Mesh(new BoxGeometry(lengthM, flangeD, flangeW), pool.lvlVeneer), 0, depthM - flangeD / 2, 0)
  // Recessed OSB structural web
  addMesh(g, new Mesh(new BoxGeometry(lengthM, webH + 0.008, webT), pool.osbWeb), 0, depthM / 2, 0)

  // Subtle dark dado glue lines where OSB web seats into LVL flanges
  const grooveGeo = new BoxGeometry(lengthM + 0.0005, 0.002, webT + 0.004)
  addMesh(g, new Mesh(grooveGeo, pool.seamDark), 0, flangeD, 0)
  addMesh(g, new Mesh(grooveGeo, pool.seamDark), 0, depthM - flangeD, 0)

  // Stamped circular factory knockouts spaced every 12" OC outside the support clearance zones
  const usableStart = -lengthM / 2 + clearanceM
  const usableEnd = lengthM / 2 - clearanceM
  if (usableEnd > usableStart) {
    const koPitch = 12 * INCHES_TO_METERS
    const ringOuterGeo = new CylinderGeometry(knockoutR + 0.0025, knockoutR + 0.0025, webT + 0.0024, 16)
    ringOuterGeo.rotateX(Math.PI / 2)
    const ringInnerGeo = new CylinderGeometry(knockoutR * 0.86, knockoutR * 0.86, webT + 0.003, 16)
    ringInnerGeo.rotateX(Math.PI / 2)

    for (let x = usableStart; x <= usableEnd + 0.001; x += koPitch) {
      addMesh(g, new Mesh(ringOuterGeo, pool.seamDark), x, depthM / 2, 0)
      addMesh(g, new Mesh(ringInnerGeo, pool.osbWeb), x, depthM / 2, 0)
    }
  }

  // Optional OSB web stiffeners at bearing ends (required for high point loads / hanger reactions)
  if (options.includeWebStiffeners ?? true) {
    const stiffThick = Math.max(0.012, (flangeW - webT) / 2 - 0.003)
    const stiffH = Math.max(0.03, webH - 0.006)
    const stiffGeo = new BoxGeometry(0.088, stiffH, stiffThick)
    for (const xSign of [-1, 1] as const) {
      const xs = xSign * (lengthM / 2 - 0.055)
      for (const zSign of [-1, 1] as const) {
        addMesh(
          g,
          new Mesh(stiffGeo, pool.osbWeb),
          xs,
          depthM / 2,
          zSign * (webT / 2 + stiffThick / 2),
        )
      }
    }
  }

  return g
}

/**
 * Procedural 3D CAD builder for prefabricated wood trusses:
 * - `'open-web-floor'` (parallel chord Warren floor truss)
 * - `'fink-truss'` (classic W-web pitched roof truss)
 * - `'scissor-truss'` (vaulted pitched bottom-chord roof truss)
 * - `'attic-truss'` (habitable room-in-attic roof truss)
 *
 * Truss spans along X, sits on bearing line `y = 0`.
 */
export function buildTrussCad(options: TrussCadOptions): Group {
  const { trussKind } = options
  const pool = options.pool ?? createStructuralMaterialPool()
  const woodMat = lumberMaterialForSpecies(pool, options.species ?? 'spf-2')
  const t = options.memberThicknessM ?? 1.5 * INCHES_TO_METERS
  const cw = options.chordWidthM ?? 3.5 * INCHES_TO_METERS

  const g = new Group()
  g.name = `structural-truss-${trussKind}`

  if (trussKind === 'open-web-floor') {
    const spanM = options.spanM ?? 14 * FEET_TO_METERS
    const depthM = options.depthM ?? 16 * INCHES_TO_METERS
    const halfSpan = spanM / 2
    const yBot = cw / 2
    const yTop = depthM - cw / 2

    // Flat top and bottom 2x4 chords (oriented flat on 3.5" face or edge; visually crisp parallel chords)
    const chordH = 2.0 * INCHES_TO_METERS
    const chordZ = 3.5 * INCHES_TO_METERS
    addMesh(g, new Mesh(new BoxGeometry(spanM, chordH, chordZ), woodMat), 0, chordH / 2, 0)
    addMesh(g, new Mesh(new BoxGeometry(spanM, chordH, chordZ), woodMat), 0, depthM - chordH / 2, 0)

    // Vertical end bearing blocks
    const endBlockW = 0.088
    const innerH = Math.max(0.05, depthM - 2 * chordH)
    for (const sign of [-1, 1] as const) {
      addMesh(
        g,
        new Mesh(new BoxGeometry(endBlockW, innerH, chordZ * 0.92), woodMat),
        sign * (halfSpan - endBlockW / 2),
        depthM / 2,
        0,
      )
    }

    // Triangulated Warren-truss diagonal webs + galvanized gang-nail plates at every panel point
    const panelCount = Math.max(6, Math.round(spanM / 0.48))
    const usableSpan = spanM - endBlockW * 2
    const dx = usableSpan / panelCount
    const startX = -usableSpan / 2
    const webH = 0.045
    const webZ = chordZ * 0.82

    for (let i = 0; i < panelCount; i++) {
      const x0 = startX + i * dx
      const x1 = startX + (i + 1) * dx
      const isUp = i % 2 === 0
      const pA = new Vector3(x0, isUp ? chordH : depthM - chordH, 0)
      const pB = new Vector3(x1, isUp ? depthM - chordH : chordH, 0)
      addMemberBetween(g, pA, pB, webH, webZ, woodMat)

      // Galvanized gang-nail connector plate at each panel node
      addGangNailPlate(g, x0, isUp ? yBot * 0.9 : yTop + 0.015, chordZ, 0.11, 0.075, pool)
    }
    // Closing node plate
    addGangNailPlate(
      g,
      startX + panelCount * dx,
      panelCount % 2 === 0 ? yBot * 0.9 : yTop + 0.015,
      chordZ,
      0.11,
      0.075,
      pool,
    )
    return g
  }

  // Pitched roof trusses (Fink / Scissor / Attic)
  const spanM = options.spanM ?? (trussKind === 'attic-truss' ? 28 : 24) * FEET_TO_METERS
  const halfSpan = spanM / 2
  const pitch = options.pitch ?? (trussKind === 'attic-truss' ? 9 : trussKind === 'scissor-truss' ? 7 : 6)
  const slope = pitch / 12
  const overhangM = options.overhangM ?? 0.45
  const heelH = options.heelHeightM ?? 0.18
  const peakY = heelH + halfSpan * slope

  const leftEave = new Vector3(-halfSpan - overhangM, Math.max(0.02, heelH - overhangM * slope), 0)
  const rightEave = new Vector3(halfSpan + overhangM, Math.max(0.02, heelH - overhangM * slope), 0)
  const leftHeel = new Vector3(-halfSpan, heelH, 0)
  const rightHeel = new Vector3(halfSpan, heelH, 0)
  const peak = new Vector3(0, peakY, 0)
  const leftBear = new Vector3(-halfSpan, cw / 2, 0)
  const rightBear = new Vector3(halfSpan, cw / 2, 0)

  // Sloped top chords (with overhanging rafter tails)
  addMemberBetween(g, leftEave, peak, cw, t, woodMat)
  addMemberBetween(g, rightEave, peak, cw, t, woodMat)

  // Raised heel vertical wedges
  if (heelH > cw * 0.9) {
    addMemberBetween(g, new Vector3(-halfSpan + cw * 0.4, cw / 2, 0), new Vector3(-halfSpan + cw * 0.4, heelH, 0), cw * 0.85, t, woodMat)
    addMemberBetween(g, new Vector3(halfSpan - cw * 0.4, cw / 2, 0), new Vector3(halfSpan - cw * 0.4, heelH, 0), cw * 0.85, t, woodMat)
  }

  // Ridge peak gang-nail plate
  addGangNailPlate(g, 0, peakY - cw * 0.35, t, 0.24, 0.16, pool)
  // Heel gang-nail plates
  addGangNailPlate(g, -halfSpan + 0.12, heelH * 0.55, t, 0.22, 0.14, pool)
  addGangNailPlate(g, halfSpan - 0.12, heelH * 0.55, t, 0.22, 0.14, pool)

  if (trussKind === 'fink-truss') {
    // Horizontal bottom chord
    addMemberBetween(g, leftBear, rightBear, cw, t, woodMat)

    // Classic W-web nodes: bottom third points and top chord midpoints
    const bLeft = new Vector3(-spanM / 6, cw / 2, 0)
    const bRight = new Vector3(spanM / 6, cw / 2, 0)
    const tLeft = new Vector3(-halfSpan / 2, heelH + (halfSpan / 2) * slope, 0)
    const tRight = new Vector3(halfSpan / 2, heelH + (halfSpan / 2) * slope, 0)

    const webW = cw * 0.82
    addMemberBetween(g, bLeft, tLeft, webW, t, woodMat)
    addMemberBetween(g, bLeft, peak, webW, t, woodMat)
    addMemberBetween(g, bRight, peak, webW, t, woodMat)
    addMemberBetween(g, bRight, tRight, webW, t, woodMat)

    // Connector plates at interior panel nodes
    for (const pt of [bLeft, bRight, tLeft, tRight]) {
      addGangNailPlate(g, pt.x, pt.y, t, 0.16, 0.11, pool)
    }
  } else if (trussKind === 'scissor-truss') {
    // Vaulted bottom chords pitched at roughly half the roof slope
    const innerSlope = slope * 0.5
    const innerPeakY = cw / 2 + halfSpan * innerSlope
    const innerPeak = new Vector3(0, innerPeakY, 0)

    addMemberBetween(g, leftBear, innerPeak, cw, t, woodMat)
    addMemberBetween(g, rightBear, innerPeak, cw, t, woodMat)

    // Vertical king post + symmetric scissor diagonals
    const webW = cw * 0.82
    addMemberBetween(g, innerPeak, peak, webW, t, woodMat)

    const tLeft = new Vector3(-halfSpan / 2, heelH + (halfSpan / 2) * slope, 0)
    const tRight = new Vector3(halfSpan / 2, heelH + (halfSpan / 2) * slope, 0)
    const bLeft = new Vector3(-halfSpan * 0.45, cw / 2 + halfSpan * 0.55 * innerSlope, 0)
    const bRight = new Vector3(halfSpan * 0.45, cw / 2 + halfSpan * 0.55 * innerSlope, 0)

    addMemberBetween(g, bLeft, tLeft, webW, t, woodMat)
    addMemberBetween(g, bLeft, peak, webW, t, woodMat)
    addMemberBetween(g, bRight, peak, webW, t, woodMat)
    addMemberBetween(g, bRight, tRight, webW, t, woodMat)

    for (const pt of [innerPeak, bLeft, bRight, tLeft, tRight]) {
      addGangNailPlate(g, pt.x, pt.y, t, 0.17, 0.12, pool)
    }
  } else {
    // 'attic-truss': heavy floor-rated bottom chord + knee walls + collar tie + upper king post
    const floorChordH = 5.5 * INCHES_TO_METERS // 2x6 or 2x8 bottom chord for habitable attic floor
    addMemberBetween(
      g,
      new Vector3(-halfSpan, floorChordH / 2, 0),
      new Vector3(halfSpan, floorChordH / 2, 0),
      floorChordH,
      t,
      woodMat,
    )

    const roomHalfW = halfSpan * 0.48
    const kneeTopY = heelH + (halfSpan - roomHalfW) * slope
    const ceilingY = Math.min(peakY - 0.45, kneeTopY + 0.65)
    const collarHalfW = Math.max(0.35, (peakY - ceilingY) / slope)

    const kneeBotL = new Vector3(-roomHalfW, floorChordH / 2, 0)
    const kneeTopL = new Vector3(-roomHalfW, kneeTopY, 0)
    const kneeBotR = new Vector3(roomHalfW, floorChordH / 2, 0)
    const kneeTopR = new Vector3(roomHalfW, kneeTopY, 0)
    const collarL = new Vector3(-collarHalfW, ceilingY, 0)
    const collarR = new Vector3(collarHalfW, ceilingY, 0)
    const collarMid = new Vector3(0, ceilingY, 0)

    const webW = cw * 0.92
    // Knee wall verticals
    addMemberBetween(g, kneeBotL, kneeTopL, webW, t, woodMat)
    addMemberBetween(g, kneeBotR, kneeTopR, webW, t, woodMat)
    // Attic ceiling collar tie
    addMemberBetween(g, collarL, collarR, webW, t, woodMat)
    // Upper king post
    addMemberBetween(g, collarMid, peak, webW * 0.85, t, woodMat)
    // Side eave triangle stabilizing diagonals
    const eaveMidL = new Vector3((-halfSpan - roomHalfW) / 2, heelH + ((halfSpan - roomHalfW) / 2) * slope, 0)
    const eaveMidR = new Vector3((halfSpan + roomHalfW) / 2, heelH + ((halfSpan - roomHalfW) / 2) * slope, 0)
    addMemberBetween(g, kneeBotL, eaveMidL, webW * 0.8, t, woodMat)
    addMemberBetween(g, kneeBotR, eaveMidR, webW * 0.8, t, woodMat)

    for (const pt of [kneeBotL, kneeTopL, kneeBotR, kneeTopR, collarL, collarR, collarMid]) {
      addGangNailPlate(g, pt.x, pt.y, t, 0.18, 0.12, pool)
    }
  }

  return g
}
