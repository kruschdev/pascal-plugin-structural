/**
 * Full-Building 3D IRC/AWC/NDS Structural Framing Skeleton Generator.
 *
 * Builds an InstancedMesh-batched 3D framing skeleton for an entire Pascal level:
 * - Every wall: PT bottom mudsill (door-interrupted), double top plates, studs @ 12"/16"/24" OC,
 *   3-stud corners, framed openings (king studs, jack studs, engineered LVL/Glulam headers,
 *   double sills, upper & lower cripples), and R302.11(2) 10 ft horizontal fire blocking.
 * - Floor system: perimeter rim boards + dimensional joists, TJI I-joists (LVL flanges + OSB web),
 *   or open-web floor trusses (chords + angled webs + galvanized plates).
 * - Roof system: stick rafters + structural ridge beam + ceiling joists + collar ties + gable studs,
 *   OR prefab Fink / Scissor / Attic trusses with galvanized truss connector plates.
 * - Foundation: continuous strip footings & stem walls below walls.
 * - Distributed 3D Simpson-class hardware: hurricane ties at every rafter/truss seat, framing angles
 *   at corners, SSTB16 anchor bolts + BP3x3 plate washers every 6 ft along mudsills, and HDU hold-downs.
 *
 * Render-safe & framework-free: Three.js + pure `./irc/*` math only (zero React or `@pascal-app/editor`).
 */

import {
  BoxGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { belongsToStructuralLevel, computeLevelBounds, extractWallOpenings } from '../irc/openings'
import {
  type FloorSystemKind,
  INCHES_TO_METERS,
  type LumberSpecies,
  type RoofSystemKind,
  type SceneNodeLike,
  type Vec2,
} from '../irc/tables'

type BucketId =
  | 'lumber'
  | 'pt-sill'
  | 'header-lvl'
  | 'osb-web'
  | 'galv-steel'
  | 'holddown-steel'
  | 'concrete'
  | 'firestop'

type MemberBox = {
  bucket: BucketId
  /** World-space center [x, y, z] in meters. */
  center: readonly [number, number, number]
  /** Box dimensions [sx, sy, sz] in meters (local axes before rotation). */
  size: readonly [number, number, number]
  /** Euler XYZ rotation in radians. */
  rotY?: number
  rotZ?: number
  rotX?: number
}

const SPECIES_LUMBER_HEX: Record<LumberSpecies, number> = {
  'df-l-2': 0xd49b5a,
  'spf-2': 0xe3cba5,
  'syp-2': 0xcf944d,
  'hem-fir-2': 0xdab98a,
}

const PLATE_THICK_M = 1.5 * INCHES_TO_METERS // 0.0381 m
const STUD_THICK_M = 1.5 * INCHES_TO_METERS // 0.0381 m
const TEN_FT_M = 10 * 12 * INCHES_TO_METERS // 3.048 m

function createSkeletonMaterials(species: LumberSpecies): Record<BucketId, MeshStandardMaterial> {
  const lumberHex = SPECIES_LUMBER_HEX[species] ?? SPECIES_LUMBER_HEX['df-l-2']
  return {
    lumber: new MeshStandardMaterial({ color: lumberHex, roughness: 0.78, metalness: 0.02 }),
    'pt-sill': new MeshStandardMaterial({ color: 0x6b8b52, roughness: 0.84, metalness: 0.02 }),
    'header-lvl': new MeshStandardMaterial({ color: 0xc2782d, roughness: 0.68, metalness: 0.05 }),
    'osb-web': new MeshStandardMaterial({ color: 0xb08647, roughness: 0.88, metalness: 0.01 }),
    'galv-steel': new MeshStandardMaterial({ color: 0xd1d8e0, roughness: 0.28, metalness: 0.84 }),
    'holddown-steel': new MeshStandardMaterial({ color: 0x64748b, roughness: 0.32, metalness: 0.82 }),
    concrete: new MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.94, metalness: 0.0 }),
    firestop: new MeshStandardMaterial({ color: 0xdc3f2e, roughness: 0.72, metalness: 0.04 }),
  }
}

function worldOnWall(
  sx: number,
  sz: number,
  ux: number,
  uz: number,
  nx: number,
  nz: number,
  u: number,
  y: number,
  nOff = 0,
): [number, number, number] {
  return [sx + ux * u + nx * nOff, y, sz + uz * u + nz * nOff]
}

export type BuildingSkeletonOptions = {
  assembly: SceneNodeLike
  nodes: Readonly<Record<string, SceneNodeLike>>
}

export function buildBuildingSkeletonGroup(opts: BuildingSkeletonOptions): Group {
  const { assembly, nodes } = opts
  const group = new Group()
  group.name = `structural-skeleton-${assembly.id}`

  const levelId = typeof assembly.parentId === 'string' ? assembly.parentId : null
  const species = (
    typeof assembly.species === 'string' && assembly.species in SPECIES_LUMBER_HEX
      ? assembly.species
      : 'df-l-2'
  ) as LumberSpecies
  const defaultStudSize = assembly.studSize === '2x4' ? '2x4' : '2x6'
  const defaultSpacingIn =
    assembly.studSpacingIn === 12 || assembly.studSpacingIn === 24 ? assembly.studSpacingIn : 16
  const floorSystem = (assembly.floorSystem as FloorSystemKind | undefined) ?? 'tji-ijoist'
  const roofSystem = (assembly.roofSystem as RoofSystemKind | undefined) ?? 'stick-rafter'
  const joistDepthIn =
    typeof assembly.joistDepthIn === 'number' && assembly.joistDepthIn >= 5.5
      ? assembly.joistDepthIn
      : 11.875
  const vis = (assembly.visibleSystems as Record<string, boolean> | undefined) ?? {}
  const showWalls = vis.walls !== false
  const showFloor = vis.floor !== false
  const showRoof = vis.roof !== false
  const showFoundation = vis.foundation !== false
  const showConnectors = vis.connectors !== false
  const showFirestop = vis.firestop !== false

  const wallOverrides =
    (assembly.wallOverrides as Record<
      string,
      { construction?: string; studSize?: string; studSpacingIn?: number } | string
    > | undefined) ?? {}

  const allLevelNodes = Object.values(nodes).filter((n) => belongsToStructuralLevel(nodes, n, levelId))
  const walls = allLevelNodes.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const slabs = allLevelNodes.filter((n) => n.type === 'slab' && Array.isArray(n.polygon) && (n.polygon as Vec2[]).length >= 3)
  const levelNode = levelId ? nodes[levelId] : undefined
  const defaultWallHeightM =
    typeof levelNode?.height === 'number' && levelNode.height > 1.5
      ? levelNode.height
      : typeof assembly.wallHeightM === 'number' && assembly.wallHeightM > 1.5
        ? assembly.wallHeightM
        : 2.55

  const boxes: MemberBox[] = []

  // Helper to push a box aligned to a wall (rotY = -atan2(uz, ux))
  const pushWallBox = (
    bucket: BucketId,
    sx: number,
    sz: number,
    ux: number,
    uz: number,
    nx: number,
    nz: number,
    rotY: number,
    uCenter: number,
    yCenter: number,
    lenAlongWall: number,
    heightY: number,
    depthAcrossWall: number,
    nOff = 0,
  ) => {
    if (lenAlongWall <= 0.005 || heightY <= 0.005 || depthAcrossWall <= 0.005) return
    boxes.push({
      bucket,
      center: worldOnWall(sx, sz, ux, uz, nx, nz, uCenter, yCenter, nOff),
      size: [lenAlongWall, heightY, depthAcrossWall],
      rotY,
    })
  }

  // ============================================================================
  // 1. WALL FRAMING + FRAMED OPENINGS + FOUNDATION + DISTRIBUTED WALL HARDWARE
  // ============================================================================
  for (const wall of walls) {
    const rawOv = wallOverrides[wall.id]
    const ov = typeof rawOv === 'string' ? { construction: rawOv } : rawOv
    if (ov?.construction === 'skip') continue

    const sx = Number(wall.start![0])
    const sz = Number(wall.start![1])
    const ex = Number(wall.end![0])
    const ez = Number(wall.end![1])
    const wallLenM = Math.hypot(ex - sx, ez - sz)
    if (!Number.isFinite(wallLenM) || wallLenM < 0.25) continue

    const ux = (ex - sx) / wallLenM
    const uz = (ez - sz) / wallLenM
    const nx = -uz
    const nz = ux
    const rotY = -Math.atan2(uz, ux)

    const wallH = typeof wall.height === 'number' && wall.height > 1.2 ? wall.height : defaultWallHeightM
    const baseY = typeof wall.elevation === 'number' && Number.isFinite(wall.elevation) ? wall.elevation : 0
    const studSz =
      ov?.studSize === '2x4' || ov?.studSize === '2x6'
        ? ov.studSize
        : typeof wall.thickness === 'number' && wall.thickness > 0
          ? wall.thickness >= 0.13
            ? '2x6'
            : '2x4'
          : defaultStudSize
    const studDepthM = (studSz === '2x6' ? 5.5 : 3.5) * INCHES_TO_METERS
    const spacingIn =
      ov?.studSpacingIn === 12 || ov?.studSpacingIn === 16 || ov?.studSpacingIn === 24
        ? ov.studSpacingIn
        : defaultSpacingIn
    const spacingM = spacingIn * INCHES_TO_METERS

    // Foundation stem wall + continuous strip footing beneath wall
    if (showFoundation) {
      // Stem wall (8" wide x 12" deep below slab)
      pushWallBox('concrete', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, baseY - 0.16, wallLenM + 0.18, 0.30, 0.20)
      // Continuous strip footing (18" wide x 8" thick)
      pushWallBox('concrete', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, baseY - 0.41, wallLenM + 0.42, 0.20, 0.46)
    }

    if (!showWalls) continue

    if (ov?.construction === 'cmu') {
      pushWallBox('concrete', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, baseY + wallH / 2, wallLenM, wallH, 0.19)
      continue
    }

    const openings = extractWallOpenings(nodes, wall)
    const doubleTopBottomY = baseY + wallH - PLATE_THICK_M * 2
    const studBaseY = baseY + PLATE_THICK_M
    const fullStudH = Math.max(0.2, doubleTopBottomY - studBaseY)

    // Double top plates (continuous full length)
    pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, baseY + wallH - PLATE_THICK_M * 0.5, wallLenM, PLATE_THICK_M, studDepthM)
    pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, baseY + wallH - PLATE_THICK_M * 1.5, wallLenM, PLATE_THICK_M, studDepthM)

    // PT Bottom mudsill plate — interrupted cleanly across door openings
    const doorRanges = openings
      .filter((o) => o.kind === 'door')
      .map((o) => [Math.max(0, o.uCenterM - o.widthM / 2), Math.min(wallLenM, o.uCenterM + o.widthM / 2)] as [number, number])
      .sort((a, b) => a[0] - b[0])

    let sillCursor = 0
    const sillSpans: Array<[number, number]> = []
    for (const [d0, d1] of doorRanges) {
      if (d0 > sillCursor + 0.05) sillSpans.push([sillCursor, d0])
      sillCursor = Math.max(sillCursor, d1)
    }
    if (sillCursor < wallLenM - 0.05) sillSpans.push([sillCursor, wallLenM])

    for (const [s0, s1] of sillSpans) {
      const segLen = s1 - s0
      pushWallBox('pt-sill', sx, sz, ux, uz, nx, nz, rotY, (s0 + s1) / 2, baseY + PLATE_THICK_M / 2, segLen, PLATE_THICK_M, studDepthM)

      // Distributed SSTB16 anchor bolts + BP3x3 plate washers @ 6 ft OC along PT mudsill
      if (showConnectors && segLen >= 0.35) {
        const boltSpacing = 1.8288 // 6 ft per IRC R403.1.6
        const bolts = Math.max(2, Math.floor(segLen / boltSpacing) + 1)
        for (let bi = 0; bi < bolts; bi++) {
          const uBolt =
            bolts === 1
              ? (s0 + s1) / 2
              : s0 + 0.18 + ((segLen - 0.36) * bi) / Math.max(1, bolts - 1)
          // BP3x3 3"x3"x1/4" galvanized plate washer
          pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uBolt, baseY + PLATE_THICK_M + 0.005, 0.076, 0.01, 0.076)
          // Anchor bolt nut & threaded stem
          pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uBolt, baseY + PLATE_THICK_M + 0.025, 0.024, 0.036, 0.024)
        }
      }
    }

    // End / California 3-stud corner packs
    const endPositions = [STUD_THICK_M / 2, STUD_THICK_M * 1.5, wallLenM - STUD_THICK_M * 1.5, wallLenM - STUD_THICK_M / 2]
    for (const uEnd of endPositions) {
      if (uEnd > 0 && uEnd < wallLenM) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uEnd, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      }
    }

    // Wall-end HDU hold-downs + A35 top-plate framing angles
    if (showConnectors) {
      for (const uCorner of [0.11, wallLenM - 0.11]) {
        if (uCorner > 0.05 && uCorner < wallLenM - 0.05) {
          // HDU hold-down bracket at stud base
          pushWallBox('holddown-steel', sx, sz, ux, uz, nx, nz, rotY, uCorner, studBaseY + 0.18, 0.07, 0.34, studDepthM + 0.014)
          // A35 / LTP4 corner framing angle at double top plate
          pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uCorner, baseY + wallH - PLATE_THICK_M, 0.095, 0.09, studDepthM + 0.016)
        }
      }
    }

    // Build rough opening exclusions + frame EVERY door & window with kings, jacks, LVL header, sill & cripples
    const openExclusions: Array<{ u0: number; u1: number; sillY: number; headerTopY: number; kind: 'door' | 'window' }> = []
    for (const op of openings) {
      const halfW = op.widthM / 2
      const uLeft = Math.max(STUD_THICK_M * 3, op.uCenterM - halfW)
      const uRight = Math.min(wallLenM - STUD_THICK_M * 3, op.uCenterM + halfW)
      if (uRight - uLeft < 0.35) continue

      const jacksEachEnd = op.widthM > 1.52 ? 2 : 1
      const headerDepthM = (op.widthM > 2.4 ? 11.875 : op.widthM > 1.5 ? 9.25 : 7.25) * INCHES_TO_METERS
      const headerBotY = Math.min(doubleTopBottomY - 0.12, baseY + op.headYM)
      const headerTopY = Math.min(doubleTopBottomY, headerBotY + headerDepthM)
      const actualHeaderH = Math.max(0.11, headerTopY - headerBotY)
      const jackH = Math.max(0.2, headerBotY - studBaseY)

      // Jack (trimmer) studs supporting header at left & right jambs
      for (let j = 0; j < jacksEachEnd; j++) {
        const uJackL = uLeft - STUD_THICK_M * (j + 0.5)
        const uJackR = uRight + STUD_THICK_M * (j + 0.5)
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uJackL, studBaseY + jackH / 2, STUD_THICK_M, jackH, studDepthM)
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uJackR, studBaseY + jackH / 2, STUD_THICK_M, jackH, studDepthM)
      }

      // Full-height king studs flanking the jacks
      const uKingL = uLeft - STUD_THICK_M * (jacksEachEnd + 0.5)
      const uKingR = uRight + STUD_THICK_M * (jacksEachEnd + 0.5)
      pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uKingL, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uKingR, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)

      // Engineered LVL / Glulam / built-up header spanning jack-to-jack
      const headerSpanM = uRight - uLeft + STUD_THICK_M * jacksEachEnd * 2
      pushWallBox('header-lvl', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, headerBotY + actualHeaderH / 2, headerSpanM, actualHeaderH, studDepthM + 0.004)

      // Header end-hanger / framing clips on wide headers (> 4 ft)
      if (showConnectors && op.widthM >= 1.2) {
        pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uLeft, headerBotY + actualHeaderH * 0.4, 0.055, actualHeaderH * 0.75, studDepthM + 0.016)
        pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uRight, headerBotY + actualHeaderH * 0.4, 0.055, actualHeaderH * 0.75, studDepthM + 0.016)
      }

      // Double rough sill plate under windows
      const sillY = baseY + op.sillYM
      if (op.kind === 'window' && sillY > studBaseY + PLATE_THICK_M * 2) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, sillY - PLATE_THICK_M * 0.5, uRight - uLeft, PLATE_THICK_M, studDepthM)
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, sillY - PLATE_THICK_M * 1.5, uRight - uLeft, PLATE_THICK_M, studDepthM)
      }

      openExclusions.push({
        u0: uKingL - STUD_THICK_M,
        u1: uKingR + STUD_THICK_M,
        sillY,
        headerTopY,
        kind: op.kind,
      })
    }

    // Field common studs @ OC + upper/lower cripples aligned to the exact OC grid
    for (let u = spacingM; u < wallLenM - STUD_THICK_M * 2.5; u += spacingM) {
      const hitOp = openExclusions.find((op) => u >= op.u0 && u <= op.u1)
      if (!hitOp) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      } else {
        // Upper cripple above header
        const upperH = doubleTopBottomY - hitOp.headerTopY
        if (upperH > 0.06) {
          pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, hitOp.headerTopY + upperH / 2, STUD_THICK_M, upperH, studDepthM)
        }
        // Lower cripple below window sill
        if (hitOp.kind === 'window') {
          const lowerH = hitOp.sillY - PLATE_THICK_M * 2 - studBaseY
          if (lowerH > 0.06) {
            pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, studBaseY + lowerH / 2, STUD_THICK_M, lowerH, studDepthM)
          }
        }
      }
    }

    // IRC R302.11(2): Horizontal fire blocking every <= 10 ft on tall walls (> 10 ft)
    if (showFirestop && wallH > TEN_FT_M) {
      const tiers = Math.floor(wallH / TEN_FT_M)
      for (let t = 1; t <= tiers; t++) {
        const fbY = baseY + t * TEN_FT_M
        if (fbY < doubleTopBottomY - 0.05) {
          pushWallBox('firestop', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, fbY, wallLenM - STUD_THICK_M * 4, PLATE_THICK_M * 1.1, studDepthM + 0.008)
        }
      }
    }
  }

  // ============================================================================
  // 2. FLOOR FRAMING SYSTEM (TJI I-JOISTS / OPEN-WEB TRUSSES / DIMENSIONAL)
  // ============================================================================
  if (showFloor) {
    const floorRegions: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; topY: number }> = []
    for (const slab of slabs) {
      const poly = slab.polygon as ReadonlyArray<Vec2>
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      for (const [px, pz] of poly) {
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (pz < minZ) minZ = pz
        if (pz > maxZ) maxZ = pz
      }
      if (Number.isFinite(minX) && maxX - minX > 0.5 && maxZ - minZ > 0.5) {
        const elev = typeof slab.elevation === 'number' ? slab.elevation : 0
        floorRegions.push({ minX, maxX, minZ, maxZ, topY: elev - 0.02 })
      }
    }
    if (floorRegions.length === 0 && walls.length >= 2) {
      const b = computeLevelBounds(nodes, levelId)
      if (b.maxX - b.minX > 1 && b.maxZ - b.minZ > 1) {
        floorRegions.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, topY: -0.02 })
      }
    }

    const jDepthM = joistDepthIn * INCHES_TO_METERS
    const joistSpacingM = 16 * INCHES_TO_METERS // 0.4064 m

    for (const reg of floorRegions) {
      const spanX = reg.maxX - reg.minX
      const spanZ = reg.maxZ - reg.minZ
      const jCenterY = reg.topY - jDepthM / 2
      const rimThick = 0.0381

      // 4 perimeter rim boards
      boxes.push({ bucket: 'osb-web', center: [(reg.minX + reg.maxX) / 2, jCenterY, reg.minZ + rimThick / 2], size: [spanX, jDepthM, rimThick] })
      boxes.push({ bucket: 'osb-web', center: [(reg.minX + reg.maxX) / 2, jCenterY, reg.maxZ - rimThick / 2], size: [spanX, jDepthM, rimThick] })
      boxes.push({ bucket: 'osb-web', center: [reg.minX + rimThick / 2, jCenterY, (reg.minZ + reg.maxZ) / 2], size: [rimThick, jDepthM, spanZ] })
      boxes.push({ bucket: 'osb-web', center: [reg.maxX - rimThick / 2, jCenterY, (reg.minZ + reg.maxZ) / 2], size: [rimThick, jDepthM, spanZ] })

      // Span joists across the shorter axis
      const spanAlongX = spanX <= spanZ
      const runStart = spanAlongX ? reg.minZ + joistSpacingM : reg.minX + joistSpacingM
      const runEnd = spanAlongX ? reg.maxZ - 0.08 : reg.maxX - 0.08
      const joistLen = Math.max(0.4, (spanAlongX ? spanX : spanZ) - rimThick * 2)
      const joistMid = spanAlongX ? (reg.minX + reg.maxX) / 2 : (reg.minZ + reg.maxZ) / 2
      const rotY = spanAlongX ? 0 : Math.PI / 2

      for (let pos = runStart; pos <= runEnd; pos += joistSpacingM) {
        const cx = spanAlongX ? joistMid : pos
        const cz = spanAlongX ? pos : joistMid

        if (floorSystem === 'tji-ijoist') {
          const flangeH = 0.0381
          const flangeW = 0.0635 // 2-1/2" LVL flange
          const webH = Math.max(0.08, jDepthM - flangeH * 2)
          // Top & bottom LVL flanges + OSB web
          boxes.push({ bucket: 'header-lvl', center: [cx, reg.topY - flangeH / 2, cz], size: [joistLen, flangeH, flangeW], rotY })
          boxes.push({ bucket: 'header-lvl', center: [cx, reg.topY - jDepthM + flangeH / 2, cz], size: [joistLen, flangeH, flangeW], rotY })
          boxes.push({ bucket: 'osb-web', center: [cx, jCenterY, cz], size: [joistLen, webH, 0.011], rotY })
        } else if (floorSystem === 'open-web-truss') {
          const chordH = 0.0381
          const chordW = 0.0889 // 2x4 flat chord
          boxes.push({ bucket: 'lumber', center: [cx, reg.topY - chordH / 2, cz], size: [joistLen, chordH, chordW], rotY })
          boxes.push({ bucket: 'lumber', center: [cx, reg.topY - jDepthM + chordH / 2, cz], size: [joistLen, chordH, chordW], rotY })
          // Vertical web posts + galvanized connector plates along truss
          const bays = Math.max(3, Math.min(10, Math.round(joistLen / 0.65)))
          for (let bi = 1; bi < bays; bi++) {
            const offset = -joistLen / 2 + (joistLen * bi) / bays
            const wx = spanAlongX ? cx + offset : cx
            const wz = spanAlongX ? cz : cz + offset
            boxes.push({ bucket: 'lumber', center: [wx, jCenterY, wz], size: [0.038, jDepthM - chordH * 2, 0.065], rotY })
            boxes.push({ bucket: 'galv-steel', center: [wx, reg.topY - chordH, wz], size: [0.075, 0.05, chordW + 0.008], rotY })
          }
        } else {
          // Solid sawn dimensional joists
          boxes.push({ bucket: 'lumber', center: [cx, jCenterY, cz], size: [joistLen, jDepthM, 0.0381], rotY })
        }

        // Joist hangers at both rim ends
        if (showConnectors) {
          const endOffset = joistLen / 2 - 0.02
          for (const dir of [-1, 1]) {
            const hx = spanAlongX ? cx + dir * endOffset : cx
            const hz = spanAlongX ? cz : cz + dir * endOffset
            boxes.push({ bucket: 'galv-steel', center: [hx, jCenterY - 0.02, hz], size: [0.05, jDepthM * 0.72, 0.072], rotY })
          }
        }
      }
    }
  }

  // ============================================================================
  // 3. ROOF FRAMING SYSTEM (STICK RAFTERS / RIDGE BEAM OR PREFAB TRUSSES + TIES)
  // ============================================================================
  if (showRoof) {
    // Include roofs on this level, plus roofs sitting directly on an upper wall-less roof level
    const allRoofs = Object.values(nodes).filter((n) => n.type === 'roof')
    const roofs = allRoofs.filter((r) => {
      if (belongsToStructuralLevel(nodes, r, levelId)) return true
      const rLevelId = typeof r.parentId === 'string' ? r.parentId : null
      if (!rLevelId) return false
      const parentHasWalls = Object.values(nodes).some(
        (w) => w.type === 'wall' && belongsToStructuralLevel(nodes, w, rLevelId),
      )
      return !parentHasWalls
    })
    const roofTargets: Array<{
      cx: number
      cz: number
      baseY: number
      lengthM: number
      leftWidthM: number
      rightWidthM: number
      riseM: number
      rotY: number
    }> = []

    for (const r of roofs) {
      const pos = Array.isArray(r.position) ? (r.position as number[]) : null
      if (!pos) continue
      const lenM = typeof r.length === 'number' && r.length > 0.5 ? r.length : 5.5
      const leftWidthM = typeof r.leftWidth === 'number' && r.leftWidth > 0.3 ? r.leftWidth : 3.0
      const rightWidthM = typeof r.rightWidth === 'number' && r.rightWidth > 0.3 ? r.rightWidth : leftWidthM
      const avgHalf = (leftWidthM + rightWidthM) / 2
      const riseM = typeof r.height === 'number' && r.height > 0.3 ? r.height : avgHalf * 0.45
      const rotY = typeof r.rotation === 'number' ? r.rotation : 0
      const roofBaseY = typeof pos[1] === 'number' && pos[1] > 1.5 ? pos[1] : defaultWallHeightM
      roofTargets.push({ cx: pos[0]!, cz: pos[2]!, baseY: roofBaseY, lengthM: lenM, leftWidthM, rightWidthM, riseM, rotY })
    }

    // If no explicit roof node exists on this level, frame a roof over the main slab/wall envelope
    if (roofTargets.length === 0 && walls.length >= 2) {
      const b = computeLevelBounds(nodes, levelId)
      const spanX = b.maxX - b.minX
      const spanZ = b.maxZ - b.minZ
      if (spanX > 1.5 && spanZ > 1.5) {
        const ridgeAlongX = spanX >= spanZ
        const halfSpanM = (ridgeAlongX ? spanZ : spanX) / 2
        roofTargets.push({
          cx: (b.minX + b.maxX) / 2,
          cz: (b.minZ + b.maxZ) / 2,
          baseY: b.avgWallHeightM,
          lengthM: ridgeAlongX ? spanX : spanZ,
          leftWidthM: halfSpanM,
          rightWidthM: halfSpanM,
          riseM: Math.max(0.9, halfSpanM * (6 / 12)),
          rotY: ridgeAlongX ? Math.PI / 2 : 0,
        })
      }
    }

    const isTruss =
      roofSystem === 'fink-truss' || roofSystem === 'scissor-truss' || roofSystem === 'attic-truss'
    const rafterSpacingM = (isTruss ? 24 : 16) * INCHES_TO_METERS
    const rafterDepthM = (isTruss ? 5.5 : 7.25) * INCHES_TO_METERS

    for (const rt of roofTargets) {
      const cosR = Math.cos(rt.rotY)
      const sinR = Math.sin(rt.rotY)
      // Local ridge runs along Z; left slope runs along -X, right slope along +X
      const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
        rt.cx + lx * cosR + lz * sinR,
        rt.baseY + ly,
        rt.cz - lx * sinR + lz * cosR,
      ]

      const leftAngle = Math.atan2(rt.riseM, rt.leftWidthM)
      const rightAngle = Math.atan2(rt.riseM, rt.rightWidthM)
      const leftSlopeLen = Math.hypot(rt.leftWidthM, rt.riseM) + 0.30
      const rightSlopeLen = Math.hypot(rt.rightWidthM, rt.riseM) + 0.30
      const totalSpanM = rt.leftWidthM + rt.rightWidthM
      const spanMidX = (rt.rightWidthM - rt.leftWidthM) / 2

      // Structural LVL / Glulam Ridge Beam (for stick rafters & cathedral)
      if (!isTruss) {
        boxes.push({
          bucket: 'header-lvl',
          center: toWorld(0, rt.riseM - 0.08, 0),
          size: [0.089, 0.24, rt.lengthM],
          rotY: rt.rotY,
        })
      }

      const count = Math.max(2, Math.floor(rt.lengthM / rafterSpacingM) + 1)
      for (let i = 0; i < count; i++) {
        const lz = -rt.lengthM / 2 + (rt.lengthM * i) / Math.max(1, count - 1)
        const midY = rt.riseM / 2

        // Exact asymmetric left & right sloped rafters / top truss chords
        boxes.push({
          bucket: 'lumber',
          center: toWorld(-rt.leftWidthM / 2, midY, lz),
          size: [leftSlopeLen, rafterDepthM, 0.0381],
          rotY: rt.rotY,
          rotZ: leftAngle,
        })
        boxes.push({
          bucket: 'lumber',
          center: toWorld(rt.rightWidthM / 2, midY, lz),
          size: [rightSlopeLen, rafterDepthM, 0.0381],
          rotY: rt.rotY,
          rotZ: -rightAngle,
        })

        // Ceiling joist / bottom chord (except cathedral ridge)
        if (roofSystem !== 'ridge-beam-cathedral') {
          if (roofSystem === 'scissor-truss') {
            const scLeftA = leftAngle * 0.45
            const scRightA = rightAngle * 0.45
            const scPeakY = Math.min(rt.leftWidthM * Math.tan(scLeftA), rt.rightWidthM * Math.tan(scRightA))
            const scLeftLen = Math.hypot(rt.leftWidthM, scPeakY)
            const scRightLen = Math.hypot(rt.rightWidthM, scPeakY)
            boxes.push({ bucket: 'lumber', center: toWorld(-rt.leftWidthM / 2, scPeakY / 2, lz), size: [scLeftLen, 0.089, 0.0381], rotY: rt.rotY, rotZ: Math.atan2(scPeakY, rt.leftWidthM) })
            boxes.push({ bucket: 'lumber', center: toWorld(rt.rightWidthM / 2, scPeakY / 2, lz), size: [scRightLen, 0.089, 0.0381], rotY: rt.rotY, rotZ: -Math.atan2(scPeakY, rt.rightWidthM) })
          } else {
            boxes.push({ bucket: 'lumber', center: toWorld(spanMidX, 0.06, lz), size: [totalSpanM, 0.14, 0.0381], rotY: rt.rotY })
          }
        }

        // Collar tie (stick-rafter) OR W-web diagonals + galvanized truss gusset plates (truss)
        if (isTruss) {
          boxes.push({ bucket: 'galv-steel', center: toWorld(0, rt.riseM - 0.07, lz), size: [0.22, 0.14, 0.046], rotY: rt.rotY })
          const webH = Math.max(0.25, rt.riseM * 0.52)
          boxes.push({ bucket: 'lumber', center: toWorld(-rt.leftWidthM * 0.35, webH * 0.55, lz), size: [0.038, webH, 0.089], rotY: rt.rotY, rotZ: -0.38 })
          boxes.push({ bucket: 'lumber', center: toWorld(rt.rightWidthM * 0.35, webH * 0.55, lz), size: [0.038, webH, 0.089], rotY: rt.rotY, rotZ: 0.38 })
          boxes.push({ bucket: 'galv-steel', center: toWorld(-rt.leftWidthM + 0.12, 0.08, lz), size: [0.18, 0.10, 0.046], rotY: rt.rotY })
          boxes.push({ bucket: 'galv-steel', center: toWorld(rt.rightWidthM - 0.12, 0.08, lz), size: [0.18, 0.10, 0.046], rotY: rt.rotY })
        } else if (roofSystem === 'stick-rafter' && i % 2 === 0) {
          boxes.push({ bucket: 'lumber', center: toWorld(spanMidX * 0.32, rt.riseM * 0.68, lz), size: [totalSpanM * 0.34, 0.089, 0.0381], rotY: rt.rotY })
        }

        // Distributed H2.5A / H10A Galvanized Hurricane Ties at EVERY rafter/truss seat!
        if (showConnectors) {
          boxes.push({ bucket: 'galv-steel', center: toWorld(-rt.leftWidthM + 0.04, 0.03, lz), size: [0.06, 0.14, 0.056], rotY: rt.rotY })
          boxes.push({ bucket: 'galv-steel', center: toWorld(rt.rightWidthM - 0.04, 0.03, lz), size: [0.06, 0.14, 0.056], rotY: rt.rotY })
        }
      }
    }
  }

  // ============================================================================
  // 4. BATCH INTO INSTANCED MESHES (<= 8 DRAW CALLS FOR THE ENTIRE HOUSE!)
  // ============================================================================
  const byBucket = new Map<BucketId, MemberBox[]>()
  for (const b of boxes) {
    const arr = byBucket.get(b.bucket)
    if (arr) arr.push(b)
    else byBucket.set(b.bucket, [b])
  }

  const mats = createSkeletonMaterials(species)
  const unitBox = new BoxGeometry(1, 1, 1)
  const mat4 = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const scale = new Vector3()
  const euler = new Euler(0, 0, 0, 'YXZ')

  for (const [bucketId, list] of byBucket.entries()) {
    if (list.length === 0) continue
    const geom = unitBox.clone()
    const inst = new InstancedMesh(geom, mats[bucketId], list.length)
    inst.name = `structural-skeleton-${bucketId}`
    inst.castShadow = bucketId !== 'concrete'
    inst.receiveShadow = true
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!
      pos.set(m.center[0], m.center[1], m.center[2])
      euler.set(m.rotX ?? 0, m.rotY ?? 0, m.rotZ ?? 0, 'YXZ')
      quat.setFromEuler(euler)
      scale.set(m.size[0], m.size[1], m.size[2])
      mat4.compose(pos, quat, scale)
      inst.setMatrixAt(i, mat4)
    }
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
    group.add(inst)
  }

  unitBox.dispose()
  return group
}
