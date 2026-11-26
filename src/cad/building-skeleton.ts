/**
 * Full-Building 3D IRC/AWC/NDS Structural Framing Skeleton Generator.
 *
 * Uses exact point-to-point 3D basis orientation (`pushStrut`) and Pascal's
 * ground-truth coordinate conventions for walls, openings, slabs, and `roof-segment`s:
 * - Every wall: PT bottom mudsill (cut at doors), double top plates, studs @ 12"/16"/24" OC,
 *   3-stud corners, framed openings (king studs, jack studs, amber LVL/Glulam headers,
 *   double window sills, upper & lower cripples — zero studs piercing glass!), and
 *   R302.11(2) 10 ft horizontal fire blocking.
 * - Floor system: perimeter rim boards + dimensional joists, TJI I-joists (LVL flanges + OSB web),
 *   or Warren open-web floor trusses (chords + true diagonal zigzag webs + galvanized plates).
 * - Roof system: exact Pascal `roof-segment` extraction (ridge along local X `width`, slopes along
 *   `±Z` `depth/2`, pitch in degrees, downhill-only overhang, zero X-cross at peak) for Stick Rafters
 *   (with LVL ridge beam, ceiling joists, collar ties, gable rake studs) OR airtight Fink / Scissor /
 *   Attic trusses with galvanized steel peak, web & heel gusset connector plates.
 * - Foundation: continuous concrete strip footings & stem walls seated cleanly BELOW floor framing.
 * - Distributed 3D Simpson-class hardware: hurricane ties at every rafter/truss seat, framing angles
 *   at corners, SSTB16 anchor bolts + BP3x3 seismic plate washers @ 6 ft OC along mudsills, and HDU hold-downs.
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
import { clusterLevelFootprints, computeLevelBounds, extractWallOpenings } from '../irc/openings'
import {
  type FloorSystemKind,
  INCHES_TO_METERS,
  type LumberSpecies,
  type RoofSystemKind,
  type SceneNodeLike,
  type Vec2,
  belongsToLevel,
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
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  quat?: Quaternion
  rotY?: number
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

/**
 * Lazily allocate a fresh isolated MeshStandardMaterial for a single populated bucket
 * so zero unused materials are ever created or leaked when buckets are empty.
 */
function createBucketMaterial(bucketId: BucketId, species: LumberSpecies): MeshStandardMaterial {
  const lumberHex = SPECIES_LUMBER_HEX[species] ?? SPECIES_LUMBER_HEX['df-l-2']
  switch (bucketId) {
    case 'lumber':
      return new MeshStandardMaterial({ color: lumberHex, roughness: 0.78, metalness: 0.02 })
    case 'pt-sill':
      return new MeshStandardMaterial({ color: 0x6b8b52, roughness: 0.84, metalness: 0.02 })
    case 'header-lvl':
      return new MeshStandardMaterial({ color: 0xc2782d, roughness: 0.68, metalness: 0.05 })
    case 'osb-web':
      return new MeshStandardMaterial({ color: 0xb08647, roughness: 0.88, metalness: 0.01 })
    case 'galv-steel':
      return new MeshStandardMaterial({ color: 0xd1d8e0, roughness: 0.28, metalness: 0.84 })
    case 'holddown-steel':
      return new MeshStandardMaterial({ color: 0x64748b, roughness: 0.32, metalness: 0.82 })
    case 'concrete':
      return new MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.94, metalness: 0.0 })
    case 'firestop':
      return new MeshStandardMaterial({ color: 0xdc3f2e, roughness: 0.72, metalness: 0.04 })
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

/**
 * Exact right-handed basis quaternion for a structural member running from `pA` to `pB`,
 * with local +X along `(pB - pA)`, local +Z aligned to `sideHint` (member thickness),
 * and local +Y perpendicular to both (in-plane member depth).
 */
function strutQuaternion(
  pA: readonly [number, number, number],
  pB: readonly [number, number, number],
  sideHint: readonly [number, number, number],
): { center: [number, number, number]; length: number; quat: Quaternion } | null {
  const dx = pB[0] - pA[0]
  const dy = pB[1] - pA[1]
  const dz = pB[2] - pA[2]
  const length = Math.hypot(dx, dy, dz)
  if (length < 0.008) return null

  const xAxis = new Vector3(dx / length, dy / length, dz / length)
  const hint = new Vector3(sideHint[0], sideHint[1], sideHint[2])
  // Orthogonalize sideHint against xAxis -> zAxis
  const dot = hint.dot(xAxis)
  const zAxis = hint.clone().addScaledVector(xAxis, -dot)
  if (zAxis.lengthSq() < 1e-6) {
    zAxis.set(0, 0, 1).addScaledVector(xAxis, -xAxis.z)
    if (zAxis.lengthSq() < 1e-6) zAxis.set(1, 0, 0)
  }
  zAxis.normalize()
  // Right-hand rule: x × y = z  =>  y = z × x
  const yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize()
  const basis = new Matrix4().makeBasis(xAxis, yAxis, zAxis)
  const quat = new Quaternion().setFromRotationMatrix(basis)
  return {
    center: [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2],
    length,
    quat,
  }
}

type ExtractedRoofSegment = {
  cx: number
  cy: number
  cz: number
  yaw: number
  roofType: string
  /** Local X dimension (ridge length for gable/hip). */
  widthM: number
  /** Local Z dimension (eave-to-eave span across slopes). */
  depthM: number
  pitchRad: number
  overhangM: number
  wallHeightM: number
}

function levelSortOrder(level: SceneNodeLike): number {
  if (typeof level.level === 'number' && Number.isFinite(level.level)) return level.level
  if (typeof level.elevation === 'number' && Number.isFinite(level.elevation)) return level.elevation
  return 0
}

function shouldAdoptWallLessRoofLevel(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  targetLevelId: string,
  roofLevel: SceneNodeLike,
): boolean {
  const targetLevel = nodes[targetLevelId]
  if (!targetLevel) return false
  // Must belong to the same parent building (when parentIds are set)
  if (
    typeof targetLevel.parentId === 'string' &&
    typeof roofLevel.parentId === 'string' &&
    targetLevel.parentId !== roofLevel.parentId
  ) {
    return false
  }
  const allValues = Object.values(nodes)
  const roofLevelHasWalls = allValues.some(
    (w) => w.type === 'wall' && w.visible !== false && belongsToLevel(nodes, w, roofLevel.id),
  )
  if (roofLevelHasWalls) return false

  const roofOrder = levelSortOrder(roofLevel)
  const siblingWalledLevels = allValues
    .filter(
      (n) =>
        n.type === 'level' &&
        n.id !== roofLevel.id &&
        n.parentId === roofLevel.parentId &&
        allValues.some((w) => w.type === 'wall' && w.visible !== false && belongsToLevel(nodes, w, n.id)),
    )
    .sort((a, b) => levelSortOrder(a) - levelSortOrder(b))

  if (siblingWalledLevels.length === 0) return false
  // Adopt only onto the highest walled level strictly below (or equal if order tied) the wall-less roof level
  const belowRoof = siblingWalledLevels.filter((l) => levelSortOrder(l) <= roofOrder)
  const hostLevel = belowRoof.length > 0 ? belowRoof[belowRoof.length - 1]! : siblingWalledLevels[siblingWalledLevels.length - 1]!
  return hostLevel.id === targetLevelId
}

function extractLevelRoofSegments(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
  defaultWallHeightM: number,
): ExtractedRoofSegment[] {
  const out: ExtractedRoofSegment[] = []

  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof-segment' || node.visible === false) continue

    const segPos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    let px = typeof segPos[0] === 'number' ? segPos[0] : 0
    let py = typeof segPos[1] === 'number' ? segPos[1] : 0
    let pz = typeof segPos[2] === 'number' ? segPos[2] : 0
    let yaw = typeof node.rotation === 'number' ? node.rotation : 0

    let curParentId = typeof node.parentId === 'string' ? node.parentId : null
    let belongsHere = false
    for (let hop = 0; hop < 6 && curParentId; hop++) {
      if (!levelId || curParentId === levelId) {
        belongsHere = true
        break
      }
      const parent = nodes[curParentId]
      if (!parent) break
      if (parent.type === 'level') {
        belongsHere = shouldAdoptWallLessRoofLevel(nodes, levelId, parent)
        break
      }
      if (parent.type === 'roof') {
        const rot = typeof parent.rotation === 'number' ? parent.rotation : 0
        const rp = Array.isArray(parent.position) ? (parent.position as number[]) : [0, 0, 0]
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        const nx = px * cos + pz * sin
        const nz = -px * sin + pz * cos
        px = nx + (typeof rp[0] === 'number' ? rp[0] : 0)
        py += typeof rp[1] === 'number' ? rp[1] : 0
        pz = nz + (typeof rp[2] === 'number' ? rp[2] : 0)
        yaw += rot
      }
      curParentId = typeof parent.parentId === 'string' ? parent.parentId : null
    }
    if (!belongsHere) continue

    const widthM = typeof node.width === 'number' && node.width > 0.2 ? node.width : 6.0
    const depthM = typeof node.depth === 'number' && node.depth > 0.2 ? node.depth : 6.0
    const rawPitch = typeof node.pitch === 'number' && Number.isFinite(node.pitch) ? node.pitch : 26.57
    // Pascal roof-segment stores pitch in DEGREES (e.g. 26.57 for 6:12); handle radians if <= 1.4
    const pitchRad =
      rawPitch <= 0
        ? 0
        : rawPitch > 1.4
          ? (Math.min(65, rawPitch) * Math.PI) / 180
          : Math.min((65 * Math.PI) / 180, rawPitch)
    const overhangM = typeof node.overhang === 'number' && node.overhang >= 0 ? node.overhang : 0.35
    const segWallH = typeof node.wallHeight === 'number' && node.wallHeight >= 0 ? node.wallHeight : 0
    // Seat roof eaves right on top of the level's double top plates and consistently honor segment knee-wall height
    const cy = py > 0.05 ? py + segWallH : defaultWallHeightM + segWallH

    out.push({
      cx: px,
      cy,
      cz: pz,
      yaw,
      roofType: typeof node.roofType === 'string' ? node.roofType : 'gable',
      widthM,
      depthM,
      pitchRad,
      overhangM,
      wallHeightM: segWallH,
    })
  }

  return out
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
  const showBeams = vis.beams !== false
  const showFoundation = vis.foundation !== false
  const showConnectors = vis.connectors !== false
  const showFirestop = vis.firestop !== false

  const wallOverrides =
    (assembly.wallOverrides as Record<
      string,
      { construction?: string; studSize?: string; studSpacingIn?: number } | string
    > | undefined) ?? {}

  const allLevelNodes = Object.values(nodes).filter((n) => belongsToLevel(nodes, n, levelId))
  const walls = allLevelNodes.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const slabs = allLevelNodes.filter(
    (n) => n.type === 'slab' && Array.isArray(n.polygon) && (n.polygon as Vec2[]).length >= 3,
  )
  // Index persisted `structural:beam` headers & ridge beams so skeleton never double-draws Z-fighting copies
  const levelBeams = allLevelNodes.filter((n) => n.type === 'structural:beam' && n.visible !== false)
  const persistedHeaderOpeningIds = new Set<string>()
  const persistedHeadersByWall = new Map<string, SceneNodeLike[]>()
  const persistedRidgeBeams: SceneNodeLike[] = []
  for (const b of levelBeams) {
    if (b.role === 'header') {
      if (typeof b.openingId === 'string' && b.openingId) persistedHeaderOpeningIds.add(b.openingId)
      if (typeof b.hostWallId === 'string' && b.hostWallId) {
        const arr = persistedHeadersByWall.get(b.hostWallId)
        if (arr) arr.push(b)
        else persistedHeadersByWall.set(b.hostWallId, [b])
      }
    } else if (b.role === 'ridge-beam') {
      persistedRidgeBeams.push(b)
    }
  }
  const levelNode = levelId ? nodes[levelId] : undefined
  const defaultWallHeightM =
    typeof levelNode?.height === 'number' && levelNode.height > 1.5
      ? levelNode.height
      : typeof assembly.wallHeightM === 'number' && assembly.wallHeightM > 1.5
        ? assembly.wallHeightM
        : 2.55
  const jDepthM = joistDepthIn * INCHES_TO_METERS

  const boxes: MemberBox[] = []

  const pushStrut = (
    bucket: BucketId,
    pA: readonly [number, number, number],
    pB: readonly [number, number, number],
    depthM: number,
    thickM: number,
    sideHint: readonly [number, number, number],
  ) => {
    const res = strutQuaternion(pA, pB, sideHint)
    if (!res) return
    boxes.push({
      bucket,
      center: res.center,
      size: [res.length, depthM, thickM],
      quat: res.quat,
    })
  }

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
  const fdnTopOffset = showFloor ? jDepthM + 0.02 : 0.02
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

    // Foundation stem wall + continuous strip footing seated cleanly BELOW floor framing
    if (showFoundation) {
      const stemTopY = baseY - fdnTopOffset
      const stemH = 0.28
      const ftgH = 0.20
      pushWallBox('concrete', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, stemTopY - stemH / 2, wallLenM + 0.16, stemH, 0.20)
      pushWallBox('concrete', sx, sz, ux, uz, nx, nz, rotY, wallLenM / 2, stemTopY - stemH - ftgH / 2, wallLenM + 0.40, ftgH, 0.44)
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
        const boltSpacing = 1.8288
        const bolts = Math.max(2, Math.floor(segLen / boltSpacing) + 1)
        for (let bi = 0; bi < bolts; bi++) {
          const uBolt =
            bolts === 1
              ? (s0 + s1) / 2
              : s0 + 0.18 + ((segLen - 0.36) * bi) / Math.max(1, bolts - 1)
          pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uBolt, baseY + PLATE_THICK_M + 0.005, 0.076, 0.01, 0.076)
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
          pushWallBox('holddown-steel', sx, sz, ux, uz, nx, nz, rotY, uCorner, studBaseY + 0.18, 0.07, 0.34, studDepthM + 0.014)
          pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uCorner, baseY + wallH - PLATE_THICK_M, 0.095, 0.09, studDepthM + 0.016)
        }
      }
    }

    // Frame EVERY door & window with kings, jacks, engineered LVL header, double sill & cripples
    const openExclusions: Array<{ u0: number; u1: number; uInner0: number; uInner1: number; sillY: number; headerTopY: number; kind: 'door' | 'window' }> = []
    for (const op of openings) {
      const halfW = op.widthM / 2
      const jacksEachEnd = op.widthM > 1.52 ? 2 : 1
      // Reserve corner-pack (2 studs) + king (1) + jacks so opening framing never overlaps end studs
      const minMargin = Math.min(wallLenM * 0.2, STUD_THICK_M * (jacksEachEnd + 3))
      const uLeft = Math.max(minMargin, op.uCenterM - halfW)
      const uRight = Math.min(wallLenM - minMargin, op.uCenterM + halfW)
      if (uRight - uLeft < 0.35) continue

      const headerDepthM = (op.widthM > 2.4 ? 11.875 : op.widthM > 1.5 ? 9.25 : 7.25) * INCHES_TO_METERS
      const headerBotY = Math.min(doubleTopBottomY - 0.12, baseY + op.headYM)
      const headerTopY = Math.min(doubleTopBottomY, headerBotY + headerDepthM)
      const actualHeaderH = Math.max(0.11, headerTopY - headerBotY)
      const jackH = Math.max(0.2, headerBotY - studBaseY)

      for (let j = 0; j < jacksEachEnd; j++) {
        const uJackL = uLeft - STUD_THICK_M * (j + 0.5)
        const uJackR = uRight + STUD_THICK_M * (j + 0.5)
        if (uJackL > STUD_THICK_M * 2) {
          pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uJackL, studBaseY + jackH / 2, STUD_THICK_M, jackH, studDepthM)
        }
        if (uJackR < wallLenM - STUD_THICK_M * 2) {
          pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uJackR, studBaseY + jackH / 2, STUD_THICK_M, jackH, studDepthM)
        }
      }

      const uKingL = uLeft - STUD_THICK_M * (jacksEachEnd + 0.5)
      const uKingR = uRight + STUD_THICK_M * (jacksEachEnd + 0.5)
      if (uKingL > STUD_THICK_M * 2) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uKingL, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      }
      if (uKingR < wallLenM - STUD_THICK_M * 2) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, uKingR, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      }

      const headerSpanM = uRight - uLeft + STUD_THICK_M * jacksEachEnd * 2
      const opMidWorld = worldOnWall(sx, sz, ux, uz, nx, nz, (uLeft + uRight) / 2, headerBotY + actualHeaderH / 2)
      const wallPersistedHeaders = persistedHeadersByWall.get(wall.id)
      const hasPersistedHeader =
        persistedHeaderOpeningIds.has(op.id) ||
        Boolean(
          wallPersistedHeaders?.some((hb) => {
            const bs = hb.start as Vec2 | undefined
            const be = hb.end as Vec2 | undefined
            if (!Array.isArray(bs) || !Array.isArray(be)) return false
            const bmx = (bs[0] + be[0]) / 2
            const bmz = (bs[1] + be[1]) / 2
            return Math.hypot(bmx - opMidWorld[0], bmz - opMidWorld[2]) <= 0.45
          }),
        )
      if (showBeams && !hasPersistedHeader) {
        pushWallBox('header-lvl', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, headerBotY + actualHeaderH / 2, headerSpanM, actualHeaderH, studDepthM + 0.004)
      }

      if (showConnectors && op.widthM >= 1.2) {
        pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uLeft, headerBotY + actualHeaderH * 0.4, 0.055, actualHeaderH * 0.75, studDepthM + 0.016)
        pushWallBox('galv-steel', sx, sz, ux, uz, nx, nz, rotY, uRight, headerBotY + actualHeaderH * 0.4, 0.055, actualHeaderH * 0.75, studDepthM + 0.016)
      }

      const sillY = baseY + op.sillYM
      if (op.kind === 'window' && sillY > studBaseY + PLATE_THICK_M * 2) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, sillY - PLATE_THICK_M * 0.5, uRight - uLeft, PLATE_THICK_M, studDepthM)
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, (uLeft + uRight) / 2, sillY - PLATE_THICK_M * 1.5, uRight - uLeft, PLATE_THICK_M, studDepthM)
      }

      openExclusions.push({
        u0: uKingL - STUD_THICK_M,
        u1: uKingR + STUD_THICK_M,
        uInner0: uLeft + STUD_THICK_M * 0.6,
        uInner1: uRight - STUD_THICK_M * 0.6,
        sillY,
        headerTopY,
        kind: op.kind,
      })
    }

    // Field common studs @ OC + strictly bounded upper/lower cripples (NEVER inside opening glass!)
    for (let u = spacingM; u < wallLenM - STUD_THICK_M * 2.5; u += spacingM) {
      const coveringOps = openExclusions.filter((op) => u >= op.u0 && u <= op.u1)
      if (coveringOps.length === 0) {
        pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, studBaseY + fullStudH / 2, STUD_THICK_M, fullStudH, studDepthM)
      } else {
        // Only emit cripples when u falls cleanly inside opening interiors and NOT inside any adjacent jamb/king zone
        const inAnyJambZone = coveringOps.some((op) => u < op.uInner0 || u > op.uInner1)
        if (!inAnyJambZone) {
          const maxHeaderTopY = coveringOps.reduce((m, op) => Math.max(m, op.headerTopY), studBaseY)
          const upperH = doubleTopBottomY - maxHeaderTopY
          if (upperH > 0.05) {
            pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, maxHeaderTopY + upperH / 2, STUD_THICK_M, upperH, studDepthM)
          }
          if (coveringOps.every((op) => op.kind === 'window')) {
            const minSillY = coveringOps.reduce((m, op) => Math.min(m, op.sillY), doubleTopBottomY)
            const lowerH = minSillY - PLATE_THICK_M * 2 - studBaseY
            if (lowerH > 0.05) {
              pushWallBox('lumber', sx, sz, ux, uz, nx, nz, rotY, u, studBaseY + lowerH / 2, STUD_THICK_M, lowerH, studDepthM)
            }
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
  // 2. FLOOR FRAMING SYSTEM (TJI I-JOISTS / WARREN OPEN-WEB TRUSSES / DIMENSIONAL)
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
        const slabThick = typeof slab.thickness === 'number' && slab.thickness > 0 ? slab.thickness : 0.05
        // Seat floor joists strictly below the slab soffit so plates/flanges never z-fight through finished flooring
        floorRegions.push({ minX, maxX, minZ, maxZ, topY: elev - slabThick - 0.015 })
      }
    }
    if (floorRegions.length === 0 && walls.length >= 2) {
      const b = computeLevelBounds(nodes, levelId)
      if (b.maxX - b.minX > 1 && b.maxZ - b.minZ > 1) {
        floorRegions.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, topY: -0.02 })
      }
    }

    const joistSpacingM = 16 * INCHES_TO_METERS

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

      const spanAlongX = spanX <= spanZ
      const runStart = spanAlongX ? reg.minZ + joistSpacingM : reg.minX + joistSpacingM
      const runEnd = spanAlongX ? reg.maxZ - 0.08 : reg.maxX - 0.08
      const joistLen = Math.max(0.4, (spanAlongX ? spanX : spanZ) - rimThick * 2)
      const joistMid = spanAlongX ? (reg.minX + reg.maxX) / 2 : (reg.minZ + reg.maxZ) / 2
      const rotY = spanAlongX ? 0 : Math.PI / 2
      const sideHint: [number, number, number] = spanAlongX ? [0, 0, 1] : [1, 0, 0]

      for (let pos = runStart; pos <= runEnd; pos += joistSpacingM) {
        const cx = spanAlongX ? joistMid : pos
        const cz = spanAlongX ? pos : joistMid

        if (floorSystem === 'tji-ijoist') {
          const flangeH = 0.0381
          const flangeW = 0.0635
          const webH = Math.max(0.08, jDepthM - flangeH * 2)
          boxes.push({ bucket: 'header-lvl', center: [cx, reg.topY - flangeH / 2, cz], size: [joistLen, flangeH, flangeW], rotY })
          boxes.push({ bucket: 'header-lvl', center: [cx, reg.topY - jDepthM + flangeH / 2, cz], size: [joistLen, flangeH, flangeW], rotY })
          boxes.push({ bucket: 'osb-web', center: [cx, jCenterY, cz], size: [joistLen, webH, 0.011], rotY })
        } else if (floorSystem === 'open-web-truss') {
          const chordH = 0.0381
          const chordW = 0.0889
          const topChordY = reg.topY - chordH / 2
          const botChordY = reg.topY - jDepthM + chordH / 2
          boxes.push({ bucket: 'lumber', center: [cx, topChordY, cz], size: [joistLen, chordH, chordW], rotY })
          boxes.push({ bucket: 'lumber', center: [cx, botChordY, cz], size: [joistLen, chordH, chordW], rotY })
          // True Warren zigzag diagonal webbing joining top & bottom chords cleanly
          const bays = Math.max(4, Math.min(12, Math.round(joistLen / 0.55)))
          for (let bi = 0; bi < bays; bi++) {
            const u0 = -joistLen / 2 + (joistLen * bi) / bays
            const u1 = -joistLen / 2 + (joistLen * (bi + 1)) / bays
            const y0 = bi % 2 === 0 ? botChordY : topChordY
            const y1 = bi % 2 === 0 ? topChordY : botChordY
            const p0: [number, number, number] = spanAlongX ? [cx + u0, y0, cz] : [cx, y0, cz + u0]
            const p1: [number, number, number] = spanAlongX ? [cx + u1, y1, cz] : [cx, y1, cz + u1]
            pushStrut('lumber', p0, p1, 0.038, 0.065, sideHint)
            if (bi > 0) {
              boxes.push({ bucket: 'galv-steel', center: p0, size: [0.065, 0.045, chordW + 0.008], rotY })
            }
          }
        } else {
          boxes.push({ bucket: 'lumber', center: [cx, jCenterY, cz], size: [joistLen, jDepthM, 0.0381], rotY })
        }

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
  // 3. ROOF FRAMING SYSTEM (EXACT PASCAL `roof-segment` AXES + POINT-TO-POINT TRUSSES)
  // ============================================================================
  if (showRoof) {
    let roofSegments = extractLevelRoofSegments(nodes, levelId, defaultWallHeightM)

    // Fallback when no roof-segment exists yet: synthesize gable roofs per transitively connected footprint cluster
    // (never stretching a single floating roof across empty yard between detached rooms/structures!)
    if (roofSegments.length === 0 && walls.length >= 2) {
      const clusters = clusterLevelFootprints(nodes, levelId, 0.35)
      for (const env of clusters) {
        const spanX = env.maxX - env.minX
        const spanZ = env.maxZ - env.minZ
        if (spanX > 1.5 && spanZ > 1.5) {
          const ridgeAlongX = spanX >= spanZ
          roofSegments.push({
            cx: (env.minX + env.maxX) / 2,
            cy: env.avgWallHeightM,
            cz: (env.minZ + env.maxZ) / 2,
            yaw: ridgeAlongX ? 0 : Math.PI / 2,
            roofType: 'gable',
            widthM: ridgeAlongX ? spanX : spanZ,
            depthM: ridgeAlongX ? spanZ : spanX,
            pitchRad: Math.atan(6 / 12),
            overhangM: 0.4,
            wallHeightM: 0,
          })
        }
      }
    }

    const isTruss =
      roofSystem === 'fink-truss' || roofSystem === 'scissor-truss' || roofSystem === 'attic-truss'
    const rafterSpacingM = (isTruss ? 24 : 16) * INCHES_TO_METERS
    const chordDepthM = (isTruss ? 5.5 : 7.25) * INCHES_TO_METERS
    const memberThickM = 0.0381

    for (const seg of roofSegments) {
      if (seg.widthM < 0.3 || seg.depthM < 0.3) continue
      const cosR = Math.cos(seg.yaw)
      const sinR = Math.sin(seg.yaw)
      // Pascal roof-segment local frame: +X = ridge direction (width), ±Z = slopes (depth)
      // Three.js Ry(yaw): (lx, ly, lz) -> (lx*cos + lz*sin, ly, -lx*sin + lz*cos)
      const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
        seg.cx + lx * cosR + lz * sinR,
        seg.cy + ly,
        seg.cz - lx * sinR + lz * cosR,
      ]
      const ridgeAxisWorld: [number, number, number] = [cosR, 0, -sinR]
      const slopeTan = Math.tan(seg.pitchRad)

      if (seg.roofType === 'shed') {
        // Single sloping plane from -depth/2 (high wall) down to +depth/2 (low eave)
        const riseM = seg.depthM * slopeTan
        const count = Math.max(2, Math.floor(seg.widthM / rafterSpacingM) + 1)
        for (let i = 0; i < count; i++) {
          const lx = -seg.widthM / 2 + (seg.widthM * i) / Math.max(1, count - 1)
          const pHigh = toWorld(lx, riseM + seg.overhangM * slopeTan, -seg.depthM / 2 - seg.overhangM)
          const pLow = toWorld(lx, -seg.overhangM * slopeTan, seg.depthM / 2 + seg.overhangM)
          pushStrut('lumber', pHigh, pLow, chordDepthM, memberThickM, ridgeAxisWorld)
          if (showConnectors) {
            boxes.push({ bucket: 'galv-steel', center: toWorld(lx, riseM, -seg.depthM / 2 + 0.04), size: [0.056, 0.14, 0.06], rotY: seg.yaw })
            boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.02, seg.depthM / 2 - 0.04), size: [0.056, 0.14, 0.06], rotY: seg.yaw })
          }
        }
        continue
      }

      // Gable / Hip: ridge along local X (widthM) at lz = 0; slopes face -Z and +Z (halfRun = depthM / 2)
      const halfRun = seg.depthM / 2
      const riseM = Math.max(0.25, halfRun * slopeTan)
      const ridgeHalfThick = isTruss ? 0 : 0.0445 // rafters butt cleanly against ridge beam face
      const eaveDropY = seg.overhangM * slopeTan

      // Structural LVL / Glulam Ridge Beam (for stick rafters & cathedral), honoring vis.beams & avoiding duplicates with persisted ridge beams
      const ridgeCenterWorld = toWorld(0, riseM - 0.09, 0)
      const hasPersistedRidge = persistedRidgeBeams.some((rb) => {
        const bs = rb.start as Vec2 | undefined
        const be = rb.end as Vec2 | undefined
        if (!Array.isArray(bs) || !Array.isArray(be)) return false
        const bmx = (bs[0] + be[0]) / 2
        const bmz = (bs[1] + be[1]) / 2
        return Math.hypot(bmx - ridgeCenterWorld[0], bmz - ridgeCenterWorld[2]) <= Math.max(seg.widthM * 0.6, 1.5)
      })
      if (!isTruss && showBeams && !hasPersistedRidge) {
        boxes.push({
          bucket: 'header-lvl',
          center: ridgeCenterWorld,
          size: [seg.widthM, 0.24, 0.089],
          rotY: seg.yaw,
        })
      }

      const count = Math.max(2, Math.floor(seg.widthM / rafterSpacingM) + 1)
      for (let i = 0; i < count; i++) {
        const lx = -seg.widthM / 2 + (seg.widthM * i) / Math.max(1, count - 1)

        // Exact peak & eave overhang endpoints (overhang extends ONLY downhill — zero X-cross at ridge!)
        const pPeakN = toWorld(lx, riseM, -ridgeHalfThick)
        const pPeakS = toWorld(lx, riseM, ridgeHalfThick)
        const pEaveN = toWorld(lx, -eaveDropY, -(halfRun + seg.overhangM))
        const pEaveS = toWorld(lx, -eaveDropY, halfRun + seg.overhangM)
        const pWallN = toWorld(lx, 0.06, -halfRun)
        const pWallS = toWorld(lx, 0.06, halfRun)

        // North (-Z) and South (+Z) sloped rafters / top truss chords
        pushStrut('lumber', pPeakN, pEaveN, chordDepthM, memberThickM, ridgeAxisWorld)
        pushStrut('lumber', pPeakS, pEaveS, chordDepthM, memberThickM, ridgeAxisWorld)

        // Ceiling joist / bottom truss chord
        if (roofSystem !== 'ridge-beam-cathedral') {
          if (roofSystem === 'scissor-truss') {
            const scPeak = toWorld(lx, riseM * 0.45, 0)
            pushStrut('lumber', pWallN, scPeak, 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', scPeak, pWallS, 0.089, memberThickM, ridgeAxisWorld)
          } else {
            pushStrut('lumber', pWallN, pWallS, 0.14, memberThickM, ridgeAxisWorld)
          }
        }

        if (isTruss) {
          // Exact airtight Fink W-truss triangulation:
          // Top midpoints MN, MS; bottom third-points BN, BS; peak P
          const pPeak = toWorld(lx, riseM, 0)
          const pMidN = toWorld(lx, riseM * 0.5, -halfRun * 0.5)
          const pMidS = toWorld(lx, riseM * 0.5, halfRun * 0.5)
          const botY = roofSystem === 'scissor-truss' ? riseM * 0.22 : 0.06
          const pBotN = toWorld(lx, botY, -halfRun / 3)
          const pBotS = toWorld(lx, botY, halfRun / 3)

          if (roofSystem === 'attic-truss') {
            // Attic room knee walls + collar ceiling beam
            const roomZ = halfRun * 0.45
            const roomTopY = riseM * (1 - 0.45)
            pushStrut('lumber', toWorld(lx, 0.06, -roomZ), toWorld(lx, roomTopY, -roomZ), 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', toWorld(lx, 0.06, roomZ), toWorld(lx, roomTopY, roomZ), 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', toWorld(lx, roomTopY, -roomZ), toWorld(lx, roomTopY, roomZ), 0.089, memberThickM, ridgeAxisWorld)
          } else {
            // Classic 4-strut Fink W-web: BN->MN, BN->Peak, BS->Peak, BS->MS
            pushStrut('lumber', pBotN, pMidN, 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', pBotN, pPeak, 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', pBotS, pPeak, 0.089, memberThickM, ridgeAxisWorld)
            pushStrut('lumber', pBotS, pMidS, 0.089, memberThickM, ridgeAxisWorld)
          }

          // Galvanized steel truss gusset connector plates at Peak, Heels & Panel Points
          boxes.push({ bucket: 'galv-steel', center: toWorld(lx, riseM - 0.06, 0), size: [0.048, 0.14, 0.22], rotY: seg.yaw })
          boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.07, -halfRun + 0.14), size: [0.048, 0.10, 0.20], rotY: seg.yaw })
          boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.07, halfRun - 0.14), size: [0.048, 0.10, 0.20], rotY: seg.yaw })
          boxes.push({ bucket: 'galv-steel', center: pBotN, size: [0.048, 0.11, 0.14], rotY: seg.yaw })
          boxes.push({ bucket: 'galv-steel', center: pBotS, size: [0.048, 0.11, 0.14], rotY: seg.yaw })
        } else if (roofSystem === 'stick-rafter' && i % 2 === 0 && halfRun > 1.2) {
          // Upper-third collar tie per IRC R802.4.6
          const tieZ = halfRun * 0.34
          const tieY = riseM * 0.66
          pushStrut('lumber', toWorld(lx, tieY, -tieZ), toWorld(lx, tieY, tieZ), 0.089, memberThickM, ridgeAxisWorld)
        }

        // Gable-end vertical rake studs at both end trusses/rafters (i === 0 and i === count - 1)
        if ((i === 0 || i === count - 1) && seg.roofType === 'gable') {
          const gableStep = 16 * INCHES_TO_METERS
          for (let gz = -halfRun + gableStep; gz < halfRun - 0.15; gz += gableStep) {
            const studTopY = riseM * (1 - Math.abs(gz) / halfRun) - 0.06
            if (studTopY > 0.22) {
              pushStrut('lumber', toWorld(lx, 0.08, gz), toWorld(lx, studTopY, gz), 0.089, memberThickM, ridgeAxisWorld)
            }
          }
        }

        // Distributed H2.5A / H10A Galvanized Hurricane Ties at EVERY rafter/truss bearing seat!
        if (showConnectors) {
          boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.02, -halfRun + 0.04), size: [0.058, 0.14, 0.06], rotY: seg.yaw })
          boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.02, halfRun - 0.04), size: [0.058, 0.14, 0.06], rotY: seg.yaw })
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

  const unitBox = new BoxGeometry(1, 1, 1)
  const mat4 = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const scale = new Vector3()
  const euler = new Euler(0, 0, 0, 'YXZ')

  for (const [bucketId, list] of byBucket.entries()) {
    if (list.length === 0) continue
    const geom = unitBox.clone()
    const mat = createBucketMaterial(bucketId, species)
    const inst = new InstancedMesh(geom, mat, list.length)
    inst.name = `structural-skeleton-${bucketId}`
    inst.castShadow = bucketId !== 'concrete'
    inst.receiveShadow = true
    // Make decorative skeleton framing non-blocking to pointer raycasts so clicks reach selectable scene nodes
    inst.raycast = () => {}
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!
      pos.set(m.center[0], m.center[1], m.center[2])
      if (m.quat) {
        quat.copy(m.quat)
      } else {
        euler.set(0, m.rotY ?? 0, 0, 'YXZ')
        quat.setFromEuler(euler)
      }
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
