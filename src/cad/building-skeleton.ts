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
  type CanonicalRoofSegment,
  type CanonicalWall,
  type SceneNodeLike as KernelSceneNodeLike,
  type RoofSegmentKind,
  clipSegmentToPolygon2D,
  distancePointToSegment2D,
  evaluateRoofSegmentSurfaceY,
  extractCanonicalRoofSegments,
  findImmediateLowerWalledLevel as kernelFindImmediateLowerWalledLevel,
  isOutdoorOrUnwalledSlab as kernelIsOutdoorOrUnwalledSlab,
  isPointEnclosedByWalls,
  pointInPolygon2D,
  polygonBounds2D,
} from '@kruschdev/pascal-mep-kernel'
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
  findLevelCommercialRtus,
  isHighestWalledLevelInBuilding,
  isLowestWalledLevelInBuilding,
  levelSortOrder,
  segmentIntersectsAabb2D,
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
  /** Raw local X dimension from Pascal `roof-segment`. */
  widthM: number
  /** Raw local Z dimension from Pascal `roof-segment`. */
  depthM: number
  pitchRad: number
  overhangM: number
  wallHeightM: number
  /**
   * Effective vertical heel depth from `cy` down to the actual bearing wall double top plate
   * (bridges both `wallHeightM` and any floor-to-floor stack vs. bearing wall height delta).
   */
  heelHeightM: number
  /** True when synthesized as a partial/full fallback roof (explicit user roofs always dominate fallbacks). */
  isFallback?: boolean
  /** Optional XZ enclosed-footprint predicate for fallback synthesized roofs (VIS-02 / VIS-V3-06). */
  footprintClip?: (x: number, z: number, marginM?: number) => boolean
  /** Underlying canonical segment from `@kruschdev/pascal-mep-kernel` for exact surface queries. */
  canonical?: CanonicalRoofSegment
}

type CanonicalRoofFrame = {
  effYaw: number
  effWidth: number
  effDepth: number
  halfW: number
  halfRun: number
  riseM: number
  effSlopeTan: number
  /** True when `hip`/`dutch`/`mansard` had `widthM < depthM` and rotated +90 deg so ridge runs along Z. */
  swappedAxes: boolean
}

/**
 * Canonical Pascal `roof-segment` local frame normalization:
 * - `gable` & `gambrel`: ridge along local X (`widthM`), `halfRun = depthM / 2`.
 * - `hip`, `dutch`, `mansard`: when `widthM < depthM`, ridge runs along local Z
 *   (rotate frame by `+Math.PI / 2`, swap `effWidth = depthM`, `effDepth = widthM`).
 * - `conical`: circular/octagonal turret with `radius = min(widthM, depthM) / 2`.
 * - `flat` (or `pitchRad <= 1e-4`): `riseM = 0`.
 * - `shed`: single slope from `-depthM/2` (high) to `+depthM/2` (low).
 */
function resolveCanonicalRoofFrame(seg: ExtractedRoofSegment): CanonicalRoofFrame {
  const isRidgeFollowsLongAxis =
    seg.roofType === 'hip' || seg.roofType === 'dutch' || seg.roofType === 'mansard'
  const swappedAxes = isRidgeFollowsLongAxis && seg.widthM < seg.depthM
  const effYaw = swappedAxes ? seg.yaw + Math.PI / 2 : seg.yaw
  const effWidth = swappedAxes ? seg.depthM : seg.widthM
  const effDepth = swappedAxes ? seg.widthM : seg.depthM
  const halfW = effWidth / 2
  const halfRun = effDepth / 2
  const slopeTan = Math.tan(seg.pitchRad)

  if (seg.roofType === 'flat' || seg.pitchRad <= 1e-4) {
    return { effYaw, effWidth, effDepth, halfW, halfRun, riseM: 0, effSlopeTan: 0, swappedAxes }
  }
  if (seg.roofType === 'shed') {
    const riseM = effDepth * slopeTan
    return { effYaw, effWidth, effDepth, halfW, halfRun, riseM, effSlopeTan: slopeTan, swappedAxes }
  }
  if (seg.roofType === 'conical') {
    const radius = Math.min(seg.widthM, seg.depthM) / 2
    const riseM = Math.max(0.25, radius * slopeTan)
    return {
      effYaw: seg.yaw,
      effWidth: seg.widthM,
      effDepth: seg.depthM,
      halfW: radius,
      halfRun: radius,
      riseM,
      effSlopeTan: riseM / Math.max(0.1, radius),
      swappedAxes: false,
    }
  }
  if (seg.roofType === 'mansard') {
    const inset = Math.min(effWidth, effDepth) * 0.18
    const riseM = Math.min(2.2, Math.max(0.25, inset * slopeTan))
    return {
      effYaw,
      effWidth,
      effDepth,
      halfW,
      halfRun,
      riseM,
      effSlopeTan: riseM / Math.max(0.1, inset),
      swappedAxes,
    }
  }
  if (seg.roofType === 'dutch') {
    const riseM = Math.max(0.25, Math.min(halfRun * slopeTan, halfRun * 1.35))
    return {
      effYaw,
      effWidth,
      effDepth,
      halfW,
      halfRun,
      riseM,
      effSlopeTan: riseM / Math.max(0.1, halfRun),
      swappedAxes,
    }
  }
  const riseM = Math.max(0.25, halfRun * slopeTan)
  return {
    effYaw,
    effWidth,
    effDepth,
    halfW,
    halfRun,
    riseM,
    effSlopeTan: riseM / Math.max(0.1, halfRun),
    swappedAxes,
  }
}

type Vec3Tuple = [number, number, number]

const OUTDOOR_SLAB_RE =
  /\b(pool|swimming|piscine|patio|deck|porch|terrace|balcony|yard|garden|lanai|courtyard|driveway|walkway|sidewalk|step|steps|stair|stairs|landing|apron|stoop|exterior|outdoor|lawn|plaza|paving)\b/i

function toCanonicalWallSeg(
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  len: number,
): CanonicalWall {
  const ux = (bx - ax) / len
  const uz = (bz - az) / len
  return {
    id,
    levelId: null,
    start: [ax, az],
    end: [bx, bz],
    lengthM: len,
    ux,
    uz,
    nx: -uz,
    nz: ux,
    heightM: 2.7,
    thicknessM: 0.14,
    visible: true,
    openings: [],
  }
}

function pointNearPolygonEdges2D(px: number, pz: number, poly: ReadonlyArray<Vec2>, maxDist: number): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    if (distancePointToSegment2D(px, pz, a[0], a[1], b[0], b[1]) <= maxDist) return true
  }
  return false
}

/**
 * Determine whether a slab is an outdoor/unwalled surface (pool, patio, deck, yard pad,
 * exterior step) that must be excluded from interior floor-joist synthesis (VIS-03).
 */
function isOutdoorOrUnwalledSlab(
  slab: SceneNodeLike,
  wallSegs: readonly CanonicalWall[],
  outdoorZonePolys: ReadonlyArray<ReadonlyArray<Vec2>>,
  baseWallElev: number,
): boolean {
  return kernelIsOutdoorOrUnwalledSlab(
    slab as KernelSceneNodeLike,
    wallSegs,
    outdoorZonePolys,
    baseWallElev,
  )
}

/**
 * Clip a 3D framing segment `pA -> pB` in XZ against an arbitrary enclosed-footprint predicate,
 * returning all contiguous inside sub-segments >= `minLenM`.
 */
function clipSegmentToFootprint3D(
  pA: readonly [number, number, number],
  pB: readonly [number, number, number],
  isInsideXZ: (x: number, z: number) => boolean,
  minLenM = 0.12,
): Array<{ start: Vec3Tuple; end: Vec3Tuple; clippedStart: boolean; clippedEnd: boolean }> {
  const totalLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2])
  if (totalLen < minLenM) return []

  const testAt = (t: number): boolean =>
    isInsideXZ(pA[0] + (pB[0] - pA[0]) * t, pA[2] + (pB[2] - pA[2]) * t)

  const refine = (tIn: number, tOut: number): number => {
    let lo = tIn
    let hi = tOut
    for (let iter = 0; iter < 12; iter++) {
      const mid = (lo + hi) * 0.5
      if (testAt(mid)) lo = mid
      else hi = mid
    }
    return lo
  }

  const N = 64
  const out: Array<{ start: Vec3Tuple; end: Vec3Tuple; clippedStart: boolean; clippedEnd: boolean }> = []
  let prevIn = testAt(0)
  let curStart = prevIn ? 0 : -1

  for (let i = 1; i <= N; i++) {
    const tPrev = (i - 1) / N
    const tCur = i / N
    const curIn = testAt(tCur)
    if (!prevIn && curIn) {
      curStart = refine(tCur, tPrev)
    } else if (prevIn && !curIn) {
      const tEnd = refine(tPrev, tCur)
      if ((tEnd - curStart) * totalLen >= minLenM) {
        out.push({
          start: lerpVec3(pA, pB, curStart),
          end: lerpVec3(pA, pB, tEnd),
          clippedStart: curStart > 0.002,
          clippedEnd: tEnd < 0.998,
        })
      }
      curStart = -1
    }
    prevIn = curIn
  }
  if (prevIn && curStart >= 0 && (1 - curStart) * totalLen >= minLenM) {
    out.push({
      start: lerpVec3(pA, pB, curStart),
      end: lerpVec3(pA, pB, 1),
      clippedStart: curStart > 0.002,
      clippedEnd: false,
    })
  }
  return out
}

function subtractInterval1D(
  intervals: ReadonlyArray<readonly [number, number]>,
  cutMin: number,
  cutMax: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [a, b] of intervals) {
    if (cutMax <= a || cutMin >= b) {
      out.push([a, b])
    } else {
      if (cutMin > a) out.push([a, cutMin])
      if (cutMax < b) out.push([cutMax, b])
    }
  }
  return out
}

const KERNEL_ROOF_KINDS: ReadonlySet<string> = new Set<RoofSegmentKind>([
  'flat',
  'shed',
  'gable',
  'hip',
  'dutch',
  'mansard',
  'conical',
])

function toCanonicalRoofSegment(seg: ExtractedRoofSegment): CanonicalRoofSegment {
  if (seg.canonical) return seg.canonical
  const frame = resolveCanonicalRoofFrame(seg)
  const roofType: RoofSegmentKind = KERNEL_ROOF_KINDS.has(seg.roofType)
    ? (seg.roofType as RoofSegmentKind)
    : 'gable'
  return {
    id: 'synthetic',
    levelId: null,
    adoptedFromWallLessLevel: false,
    cx: seg.cx,
    cz: seg.cz,
    eaveY: seg.cy,
    width: seg.widthM,
    depth: seg.depthM,
    wallHeightM: seg.wallHeightM,
    pitchDeg: (seg.pitchRad * 180) / Math.PI,
    pitchRad: seg.pitchRad,
    roofType,
    yaw: seg.yaw,
    cos: Math.cos(seg.yaw),
    sin: Math.sin(seg.yaw),
    effWidth: frame.effWidth,
    effDepth: frame.effDepth,
    effYaw: frame.effYaw,
    effCos: Math.cos(frame.effYaw),
    effSin: Math.sin(frame.effYaw),
    peakY: seg.cy + frame.riseM,
    overhangM: seg.overhangM,
  }
}

/**
 * Evaluate the top roof-plane elevation `y` of `seg` at world `(wx, wz)`, or `null`
 * if `(wx, wz)` falls outside `seg`'s plan footprint (including eave overhang).
 */
function evaluateRoofSurfaceY(seg: ExtractedRoofSegment, wx: number, wz: number): number | null {
  return evaluateRoofSegmentSurfaceY(toCanonicalRoofSegment(seg), wx, wz, {
    clampOverhangToEave: false,
    footprintPadM: 0.02,
  })
}

function roofSegmentPeakY(seg: ExtractedRoofSegment): number {
  return seg.cy + resolveCanonicalRoofFrame(seg).riseM
}

/**
 * Find sibling roof segments on the same level that dominate `seg` (higher peak, or equal
 * peak with larger footprint area) and overlap `seg` in plan — e.g. a main gable hosting a
 * perpendicular California over-framed cross-gable or dormer.
 */
function findDominatingHostRoofs(
  seg: ExtractedRoofSegment,
  segIdx: number,
  allSegments: readonly ExtractedRoofSegment[],
): ExtractedRoofSegment[] {
  if (allSegments.length <= 1) return []
  const segFrame = resolveCanonicalRoofFrame(seg)
  const segPeak = seg.cy + segFrame.riseM
  const segArea = segFrame.effWidth * segFrame.effDepth
  const cosR = Math.cos(segFrame.effYaw)
  const sinR = Math.sin(segFrame.effYaw)
  const hosts: ExtractedRoofSegment[] = []

  for (let oIdx = 0; oIdx < allSegments.length; oIdx++) {
    if (oIdx === segIdx) continue
    const other = allSegments[oIdx]!
    // Synthesized fallback roofs never clip explicit user-authored roof segments
    if (!seg.isFallback && other.isFallback) continue
    const otherFrame = resolveCanonicalRoofFrame(other)
    const otherPeak = other.cy + otherFrame.riseM
    const otherArea = otherFrame.effWidth * otherFrame.effDepth
    const dominates =
      otherPeak > segPeak + 0.04 ||
      (Math.abs(otherPeak - segPeak) <= 0.04 &&
        (otherArea > segArea + 0.1 || (Math.abs(otherArea - segArea) <= 0.1 && oIdx < segIdx)))
    if (!dominates) continue

    // Verify 2D plan overlap on a 5x5 grid over `seg`
    let overlaps = false
    for (let ix = -2; ix <= 2 && !overlaps; ix++) {
      const lx = segFrame.halfW * (ix / 2)
      for (let iz = -2; iz <= 2 && !overlaps; iz++) {
        const lz = segFrame.halfRun * (iz / 2)
        const wx = seg.cx + lx * cosR + lz * sinR
        const wz = seg.cz - lx * sinR + lz * cosR
        if (evaluateRoofSurfaceY(other, wx, wz) !== null) overlaps = true
      }
    }
    if (overlaps) hosts.push(other)
  }
  return hosts
}

function hostSurfaceYAt(wx: number, wz: number, hosts: readonly ExtractedRoofSegment[]): number | null {
  let maxY: number | null = null
  for (const h of hosts) {
    const hy = evaluateRoofSurfaceY(h, wx, wz)
    if (hy !== null && (maxY === null || hy > maxY)) maxY = hy
  }
  return maxY
}

function lerpVec3(pA: readonly [number, number, number], pB: readonly [number, number, number], t: number): Vec3Tuple {
  return [pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t, pA[2] + (pB[2] - pA[2]) * t]
}

/**
 * Clip a 3D framing member segment `pA -> pB` so ONLY the portion resting on or above all
 * dominating host roof planes is kept. Prevents over-framed cross-gables & dormers from
 * plunging beneath the primary roof into the house interior.
 */
function clipSegmentAboveHosts(
  pA: readonly [number, number, number],
  pB: readonly [number, number, number],
  hosts: readonly ExtractedRoofSegment[],
  tol = 0.015,
): { start: Vec3Tuple; end: Vec3Tuple; clippedStart: boolean; clippedEnd: boolean } | null {
  if (hosts.length === 0) {
    return {
      start: [pA[0], pA[1], pA[2]],
      end: [pB[0], pB[1], pB[2]],
      clippedStart: false,
      clippedEnd: false,
    }
  }
  const totalLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2])
  if (totalLen < 0.02) return null

  const clearance = (t: number): number => {
    const x = pA[0] + (pB[0] - pA[0]) * t
    const y = pA[1] + (pB[1] - pA[1]) * t
    const z = pA[2] + (pB[2] - pA[2]) * t
    const hy = hostSurfaceYAt(x, z, hosts)
    return hy === null ? Number.POSITIVE_INFINITY : y - hy
  }

  const refineTransition = (tIn: number, tOut: number): number => {
    let lo = tIn
    let hi = tOut
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) * 0.5
      if (clearance(mid) >= -tol) lo = mid
      else hi = mid
    }
    return lo
  }

  const N = 64
  let bestT0 = -1
  let bestT1 = -1
  let curStart = -1
  let prevInside = clearance(0) >= -tol
  if (prevInside) curStart = 0

  for (let i = 1; i <= N; i++) {
    const tPrev = (i - 1) / N
    const tCur = i / N
    const curInside = clearance(tCur) >= -tol
    if (!prevInside && curInside) {
      curStart = refineTransition(tCur, tPrev)
    } else if (prevInside && !curInside) {
      const tEnd = refineTransition(tPrev, tCur)
      if (tEnd - curStart > bestT1 - bestT0) {
        bestT0 = curStart
        bestT1 = tEnd
      }
      curStart = -1
    }
    prevInside = curInside
  }
  if (prevInside && curStart >= 0) {
    if (1 - curStart > bestT1 - bestT0) {
      bestT0 = curStart
      bestT1 = 1
    }
  }

  if (bestT0 < 0 || (bestT1 - bestT0) * totalLen < 0.08) return null
  return {
    start: lerpVec3(pA, pB, bestT0),
    end: lerpVec3(pA, pB, bestT1),
    clippedStart: bestT0 > 0.002,
    clippedEnd: bestT1 < 0.998,
  }
}

/**
 * Find the immediately lower walled sibling level in the same building below `levelId`.
 */
function findImmediateLowerWalledLevel(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
): SceneNodeLike | null {
  return kernelFindImmediateLowerWalledLevel(
    nodes as Readonly<Record<string, KernelSceneNodeLike>>,
    levelId,
  ) as SceneNodeLike | null
}

/**
 * Inspect visible bearing walls (`h >= 1.8 m`) on `targetLevelId` overlapping the XZ box
 * `[minX, maxX] x [minZ, maxZ]` and return their bearing top height.
 * Prefers the minimum explicit wall height (`>= 1.8 m`) so roofs over scenes where `level.height`
 * exceeds exterior bearing `wall.height` (e.g. 2.80 m stack vs. 2.50 m walls) extend their knee walls
 * and gable rake studs cleanly wood-to-wood with zero air gap.
 */
function resolveBearingWallHeightInBox(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  targetLevelId: string | null,
  defaultWallHeightM: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): number {
  let minExplicitH = Number.POSITIVE_INFINITY
  for (const w of Object.values(nodes)) {
    if (w.type !== 'wall' || w.visible === false || !Array.isArray(w.start) || !Array.isArray(w.end)) continue
    if (!belongsToLevel(nodes, w, targetLevelId)) continue
    if (
      !segmentIntersectsAabb2D(
        Number(w.start[0]),
        Number(w.start[1]),
        Number(w.end[0]),
        Number(w.end[1]),
        minX,
        maxX,
        minZ,
        maxZ,
      )
    ) {
      continue
    }
    if (typeof w.height === 'number' && Number.isFinite(w.height) && w.height >= 1.8) {
      if (w.height < minExplicitH) minExplicitH = w.height
    }
  }
  return Number.isFinite(minExplicitH) ? minExplicitH : defaultWallHeightM
}

function extractLevelRoofSegments(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
  defaultWallHeightM: number,
  levelBaseY = 0,
): ExtractedRoofSegment[] {
  const out: ExtractedRoofSegment[] = []
  const isUpperLevel = !isLowestWalledLevelInBuilding(nodes, levelId)
  const lowerWalledLevel = isUpperLevel ? findImmediateLowerWalledLevel(nodes, levelId) : null

  // Always frame architectural roof-segments even when their shingle shell is hidden (visible === false)
  // in Framing X-Ray mode or persisted X-Ray scenes; structural roof framing has its own `visibleSystems.roof` toggle.
  const canonicalSegs = extractCanonicalRoofSegments(
    nodes as Readonly<Record<string, KernelSceneNodeLike>>,
    levelId,
    defaultWallHeightM,
    { includeHidden: true, levelBaseY },
  )

  for (const seg of canonicalSegs) {
    // Accumulate raw roof-container local Y to preserve exact Zero-Gap Bearing Extension heuristic
    let rawPy = 0
    let cur: SceneNodeLike | undefined = nodes[seg.id]
    for (let hop = 0; hop < 8 && cur; hop++) {
      if (Array.isArray(cur.position) && typeof cur.position[1] === 'number' && Number.isFinite(cur.position[1])) {
        rawPy += cur.position[1]
      }
      if (typeof cur.parentId !== 'string') break
      const parent = nodes[cur.parentId]
      if (!parent || parent.type !== 'roof') break
      cur = parent
    }

    const isDirectUpperWingRoof = !seg.adoptedFromWallLessLevel && isUpperLevel && rawPy <= 0.05
    const absCos = Math.abs(seg.cos)
    const absSin = Math.abs(seg.sin)
    const halfX = (seg.width * absCos + seg.depth * absSin) / 2
    const halfZ = (seg.width * absSin + seg.depth * absCos) / 2
    let heelHeightM = seg.wallHeightM

    // Zero-Gap Bearing Extension: bridge any floor-to-floor `level.height` vs. exterior bearing
    // `wall.height` band delta (e.g. 2.80m stack vs. 2.50m walls -> +0.30m) so raised-heel knee walls
    // and gable rake studs rest wood-to-wood directly on top of the actual double top plate.
    if (isDirectUpperWingRoof) {
      if (lowerWalledLevel) {
        const lowerStackH =
          typeof lowerWalledLevel.height === 'number' && lowerWalledLevel.height > 1.5
            ? lowerWalledLevel.height
            : defaultWallHeightM
        const lowerBearingH = resolveBearingWallHeightInBox(
          nodes,
          lowerWalledLevel.id,
          lowerStackH,
          seg.cx - halfX - 0.5,
          seg.cx + halfX + 0.5,
          seg.cz - halfZ - 0.5,
          seg.cz + halfZ + 0.5,
        )
        const bandGapM = Math.max(0, Math.min(0.65, lowerStackH - lowerBearingH))
        heelHeightM = seg.wallHeightM + bandGapM
      }
    } else if (rawPy <= 0.05) {
      const bearingH = resolveBearingWallHeightInBox(
        nodes,
        levelId,
        defaultWallHeightM,
        seg.cx - halfX - 0.5,
        seg.cx + halfX + 0.5,
        seg.cz - halfZ - 0.5,
        seg.cz + halfZ + 0.5,
      )
      const bandGapM = Math.max(0, Math.min(0.65, seg.eaveY - (levelBaseY + bearingH) - seg.wallHeightM))
      heelHeightM = seg.wallHeightM + bandGapM
    }

    out.push({
      cx: seg.cx,
      cy: seg.eaveY,
      cz: seg.cz,
      yaw: seg.yaw,
      roofType: seg.roofType,
      widthM: seg.width,
      depthM: seg.depth,
      pitchRad: seg.pitchRad,
      overhangM: seg.overhangM,
      wallHeightM: seg.wallHeightM,
      heelHeightM,
      canonical: seg,
    })
  }

  return out
}

export type BuildingSkeletonOptions = {
  assembly: SceneNodeLike
  nodes: Readonly<Record<string, SceneNodeLike>>
  /** Roof / ceiling IDs temporarily hidden by Framing X-Ray so structural roof framing remains rendered. */
  xrayHiddenIds?: ReadonlySet<string>
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
  const maxExplicitWallH = walls.reduce(
    (m, w) => Math.max(m, typeof w.height === 'number' && Number.isFinite(w.height) && w.height > 1.2 ? w.height : 0),
    0,
  )
  const defaultWallHeightM =
    typeof levelNode?.height === 'number' && levelNode.height > 1.5
      ? levelNode.height
      : maxExplicitWallH > 1.5
        ? maxExplicitWallH
        : typeof assembly.wallHeightM === 'number' && assembly.wallHeightM > 1.5
          ? assembly.wallHeightM
          : 2.7
  const jDepthM = joistDepthIn * INCHES_TO_METERS

  // Precompute visible wall segments and outdoor zone polygons for enclosed-footprint & slab filtering (VIS-02 / VIS-03)
  const visibleWallSegs: CanonicalWall[] = []
  let minWallElev = Number.POSITIVE_INFINITY
  for (const w of walls) {
    if (w.visible === false) continue
    const ax = Number(w.start![0])
    const az = Number(w.start![1])
    const bx = Number(w.end![0])
    const bz = Number(w.end![1])
    const len = Math.hypot(bx - ax, bz - az)
    if (Number.isFinite(len) && len >= 0.25) {
      visibleWallSegs.push(toCanonicalWallSeg(w.id, ax, az, bx, bz, len))
      const elev = typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0
      if (elev < minWallElev) minWallElev = elev
    }
  }
  const baseWallElev = Number.isFinite(minWallElev) ? minWallElev : 0
  const levelZones = allLevelNodes.filter(
    (n) => (n.type === 'zone' || n.type === 'room') && n.visible !== false && Array.isArray(n.polygon) && (n.polygon as Vec2[]).length >= 3,
  )
  const outdoorZonePolys: Array<ReadonlyArray<Vec2>> = []
  const indoorZonePolys: Array<ReadonlyArray<Vec2>> = []
  for (const z of levelZones) {
    const poly = z.polygon as ReadonlyArray<Vec2>
    if (OUTDOOR_SLAB_RE.test(String(z.name ?? ''))) outdoorZonePolys.push(poly)
    else indoorZonePolys.push(poly)
  }
  const interiorSlabs = slabs.filter(
    (s) => s.visible !== false && !isOutdoorOrUnwalledSlab(s, visibleWallSegs, outdoorZonePolys, baseWallElev),
  )

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
    // (only beneath the lowest walled story so upper floors never emit mid-air concrete footings)
    if (showFoundation && isLowestWalledLevelInBuilding(nodes, levelId)) {
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

    // IRC R302.11(2): Horizontal fire blocking every <= 10 ft on tall walls (> 10 ft),
    // split cleanly around door/window openings so firestop bands never cross storefront glazing (VIS-V3-07)
    if (showFirestop && wallH > TEN_FT_M) {
      const tiers = Math.floor(wallH / TEN_FT_M)
      for (let t = 1; t <= tiers; t++) {
        const fbY = baseY + t * TEN_FT_M
        if (fbY < doubleTopBottomY - 0.05) {
          let fbIntervals: Array<[number, number]> = [[STUD_THICK_M * 2, wallLenM - STUD_THICK_M * 2]]
          for (const op of openings) {
            const opBotY = baseY + op.sillYM - 0.04
            const opTopY = baseY + op.headYM + 0.04
            if (fbY >= opBotY && fbY <= opTopY) {
              fbIntervals = subtractInterval1D(fbIntervals, op.uCenterM - op.widthM / 2, op.uCenterM + op.widthM / 2)
            }
          }
          for (const [u0, u1] of fbIntervals) {
            const spanM = u1 - u0
            if (spanM < 0.12) continue
            pushWallBox(
              'firestop',
              sx,
              sz,
              ux,
              uz,
              nx,
              nz,
              rotY,
              (u0 + u1) / 2,
              fbY,
              spanM,
              PLATE_THICK_M * 1.1,
              studDepthM + 0.008,
            )
          }
        }
      }
    }
  }

  // ============================================================================
  // 2. FLOOR FRAMING SYSTEM (TJI I-JOISTS / WARREN OPEN-WEB TRUSSES / DIMENSIONAL)
  // ============================================================================
  if (showFloor) {
    type FloorRegion = {
      poly: ReadonlyArray<Vec2>
      minX: number
      maxX: number
      minZ: number
      maxZ: number
      topY: number
      clipToWalls: boolean
    }
    const floorRegions: FloorRegion[] = []
    for (const slab of interiorSlabs) {
      const poly = slab.polygon as ReadonlyArray<Vec2>
      const b = polygonBounds2D(poly)
      if (b && b.maxX - b.minX > 0.5 && b.maxZ - b.minZ > 0.5) {
        const elev = typeof slab.elevation === 'number' && Number.isFinite(slab.elevation) ? slab.elevation : 0
        const slabThick = typeof slab.thickness === 'number' && slab.thickness > 0 ? slab.thickness : 0.05
        // Seat floor joists strictly below the slab soffit so plates/flanges never z-fight through finished flooring
        floorRegions.push({
          poly,
          minX: b.minX,
          maxX: b.maxX,
          minZ: b.minZ,
          maxZ: b.maxZ,
          topY: elev - slabThick - 0.015,
          clipToWalls: false,
        })
      }
    }
    if (floorRegions.length === 0 && visibleWallSegs.length >= 2) {
      let wMinX = Number.POSITIVE_INFINITY
      let wMaxX = Number.NEGATIVE_INFINITY
      let wMinZ = Number.POSITIVE_INFINITY
      let wMaxZ = Number.NEGATIVE_INFINITY
      for (const ws of visibleWallSegs) {
        wMinX = Math.min(wMinX, ws.start[0], ws.end[0])
        wMaxX = Math.max(wMaxX, ws.start[0], ws.end[0])
        wMinZ = Math.min(wMinZ, ws.start[1], ws.end[1])
        wMaxZ = Math.max(wMaxZ, ws.start[1], ws.end[1])
      }
      if (Number.isFinite(wMinX) && wMaxX - wMinX > 1 && wMaxZ - wMinZ > 1) {
        floorRegions.push({
          poly: [
            [wMinX, wMinZ],
            [wMaxX, wMinZ],
            [wMaxX, wMaxZ],
            [wMinX, wMaxZ],
          ],
          minX: wMinX,
          maxX: wMaxX,
          minZ: wMinZ,
          maxZ: wMaxZ,
          topY: baseWallElev - 0.02,
          clipToWalls: visibleWallSegs.length >= 3,
        })
      }
    }

    const joistSpacingM = 16 * INCHES_TO_METERS

    for (const reg of floorRegions) {
      const spanX = reg.maxX - reg.minX
      const spanZ = reg.maxZ - reg.minZ
      const jCenterY = reg.topY - jDepthM / 2
      const rimThick = 0.0381

      // Exact polygon-perimeter rim boards (strictly follows rotated/L-shaped slab edges, never an oversized AABB)
      if (!reg.clipToWalls) {
        for (let ei = 0; ei < reg.poly.length; ei++) {
          const v0 = reg.poly[ei]!
          const v1 = reg.poly[(ei + 1) % reg.poly.length]!
          const eLen = Math.hypot(v1[0] - v0[0], v1[1] - v0[1])
          if (!Number.isFinite(eLen) || eLen < 0.08) continue
          const ux = (v1[0] - v0[0]) / eLen
          const uz = (v1[1] - v0[1]) / eLen
          const nx = -uz
          const nz = ux
          const eRotY = -Math.atan2(uz, ux)
          pushWallBox('osb-web', v0[0], v0[1], ux, uz, nx, nz, eRotY, eLen / 2, jCenterY, eLen, jDepthM, rimThick)
        }
      } else {
        // Wall-only fallback: align rim joists along actual wall footprints instead of an oversized AABB
        for (const ws of visibleWallSegs) {
          const eRotY = -Math.atan2(ws.uz, ws.ux)
          pushWallBox('osb-web', ws.start[0], ws.start[1], ws.ux, ws.uz, ws.nx, ws.nz, eRotY, ws.lengthM / 2, jCenterY, ws.lengthM, jDepthM, rimThick)
        }
      }

      const spanAlongX = spanX <= spanZ
      const runStart = spanAlongX ? reg.minZ + joistSpacingM : reg.minX + joistSpacingM
      const runEnd = spanAlongX ? reg.maxZ - 0.08 : reg.maxX - 0.08
      const rotY = spanAlongX ? 0 : Math.PI / 2
      const sideHint: [number, number, number] = spanAlongX ? [0, 0, 1] : [1, 0, 0]

      for (let pos = runStart; pos <= runEnd; pos += joistSpacingM) {
        const lineA: Vec2 = spanAlongX ? [reg.minX - 0.05, pos] : [pos, reg.minZ - 0.05]
        const lineB: Vec2 = spanAlongX ? [reg.maxX + 0.05, pos] : [pos, reg.maxZ + 0.05]
        const polyIntervals = clipSegmentToPolygon2D(lineA, lineB, reg.poly)

        const subSegments: Array<[Vec2, Vec2]> = []
        for (const [t0, t1] of polyIntervals) {
          const ax = lineA[0] + (lineB[0] - lineA[0]) * t0
          const az = lineA[1] + (lineB[1] - lineA[1]) * t0
          const bx = lineA[0] + (lineB[0] - lineA[0]) * t1
          const bz = lineA[1] + (lineB[1] - lineA[1]) * t1
          if (reg.clipToWalls) {
            const clipped = clipSegmentToFootprint3D(
              [ax, jCenterY, az],
              [bx, jCenterY, bz],
              (x, z) => isPointEnclosedByWalls(x, z, visibleWallSegs),
              0.25,
            )
            for (const c of clipped) {
              subSegments.push([
                [c.start[0], c.start[2]],
                [c.end[0], c.end[2]],
              ])
            }
          } else {
            subSegments.push([
              [ax, az],
              [bx, bz],
            ])
          }
        }

        for (const [sA, sB] of subSegments) {
          const rawLen = Math.hypot(sB[0] - sA[0], sB[1] - sA[1])
          const joistLen = rawLen - rimThick * 2
          if (joistLen < 0.25) continue
          const cx = (sA[0] + sB[0]) / 2
          const cz = (sA[1] + sB[1]) / 2

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
  }

  // ============================================================================
  // 3. ROOF FRAMING SYSTEM (EXACT PASCAL `roof-segment` AXES + POINT-TO-POINT TRUSSES)
  // ============================================================================
  if (showRoof) {
    const levelBounds = computeLevelBounds(nodes, levelId)
    const roofSegments = extractLevelRoofSegments(
      nodes,
      levelId,
      defaultWallHeightM,
      levelBounds.baseElevationM,
    )
    const explicitRoofSegments = [...roofSegments]

    const levelRtus = findLevelCommercialRtus(nodes, levelId)

    const isTruss =
      roofSystem === 'fink-truss' || roofSystem === 'scissor-truss' || roofSystem === 'attic-truss'
    const rafterSpacingM = (isTruss ? 24 : 16) * INCHES_TO_METERS
    const studSpacingM = defaultSpacingIn * INCHES_TO_METERS
    const chordDepthM = (isTruss ? 5.5 : 7.25) * INCHES_TO_METERS
    const memberThickM = 0.0381

    const isInsideRoofSet = (
      segs: readonly ExtractedRoofSegment[],
      x: number,
      z: number,
      extraMargin = 0.35,
    ): boolean => {
      for (const seg of segs) {
        const cosR = Math.cos(seg.yaw)
        const sinR = Math.sin(seg.yaw)
        const dx = x - seg.cx
        const dz = z - seg.cz
        const lx = dx * cosR - dz * sinR
        const lz = dx * sinR + dz * cosR
        if (seg.roofType === 'conical') {
          const r = Math.min(seg.widthM, seg.depthM) / 2
          if (Math.hypot(lx, lz) <= Math.max(0.1, r + seg.overhangM + extraMargin)) return true
        } else {
          const halfX = Math.max(0.1, seg.widthM / 2 + seg.overhangM + extraMargin)
          const halfZ = Math.max(0.1, seg.depthM / 2 + seg.overhangM + extraMargin)
          if (Math.abs(lx) <= halfX && Math.abs(lz) <= halfZ) return true
        }
      }
      return false
    }

    // Fallback when no roof-segment exists yet (VIS-02/VIS-04) OR when explicit roof-segments cover
    // < 75% of a walled cluster's enclosed footprint on the highest walled story (VIS-V3-06).
    if (walls.length >= 2 && isHighestWalledLevelInBuilding(nodes, levelId)) {
      const clusters = clusterLevelFootprints(nodes, levelId, 0.35)
      for (const env of clusters) {
        const clusterWalls = walls.filter((w) => {
          if (w.visible === false) return false
          const sx = Number(w.start![0])
          const sz = Number(w.start![1])
          const ex = Number(w.end![0])
          const ez = Number(w.end![1])
          const wMinX = Math.min(sx, ex)
          const wMaxX = Math.max(sx, ex)
          const wMinZ = Math.min(sz, ez)
          const wMaxZ = Math.max(sz, ez)
          return (
            wMinX <= env.maxX + 0.45 &&
            wMaxX >= env.minX - 0.45 &&
            wMinZ <= env.maxZ + 0.45 &&
            wMaxZ >= env.minZ - 0.45
          )
        })
        if (clusterWalls.length < 2) continue

        // VIS-02: Compute true walled footprint bounds & perimeter/tallest wall height (NEVER average low interior partitions!)
        let cMinX = Number.POSITIVE_INFINITY
        let cMaxX = Number.NEGATIVE_INFINITY
        let cMinZ = Number.POSITIVE_INFINITY
        let cMaxZ = Number.NEGATIVE_INFINITY
        const clusterWallSegs: CanonicalWall[] = []
        for (const w of clusterWalls) {
          const ax = Number(w.start![0])
          const az = Number(w.start![1])
          const bx = Number(w.end![0])
          const bz = Number(w.end![1])
          const len = Math.hypot(bx - ax, bz - az)
          if (!Number.isFinite(len) || len < 0.25) continue
          clusterWallSegs.push(toCanonicalWallSeg(w.id, ax, az, bx, bz, len))
          cMinX = Math.min(cMinX, ax, bx)
          cMaxX = Math.max(cMaxX, ax, bx)
          cMinZ = Math.min(cMinZ, az, bz)
          cMaxZ = Math.max(cMaxZ, az, bz)
        }
        if (!Number.isFinite(cMinX)) continue

        const clusterInteriorPolys: Array<ReadonlyArray<Vec2>> = []
        for (const s of interiorSlabs) {
          const poly = s.polygon as ReadonlyArray<Vec2>
          const sb = polygonBounds2D(poly)
          if (sb && sb.minX <= cMaxX + 0.45 && sb.maxX >= cMinX - 0.45 && sb.minZ <= cMaxZ + 0.45 && sb.maxZ >= cMinZ - 0.45) {
            clusterInteriorPolys.push(poly)
          }
        }
        for (const zp of indoorZonePolys) {
          const zb = polygonBounds2D(zp)
          if (zb && zb.minX <= cMaxX + 0.45 && zb.maxX >= cMinX - 0.45 && zb.minZ <= cMaxZ + 0.45 && zb.maxZ >= cMinZ - 0.45) {
            clusterInteriorPolys.push(zp)
          }
        }

        const tolPerim = 0.45
        let maxPerimH = 0
        let maxClusterH = 0
        for (const w of clusterWalls) {
          const wh = typeof w.height === 'number' && Number.isFinite(w.height) && w.height > 1.2 ? w.height : defaultWallHeightM
          if (wh > maxClusterH) maxClusterH = wh
          const mx = (Number(w.start![0]) + Number(w.end![0])) / 2
          const mz = (Number(w.start![1]) + Number(w.end![1])) / 2
          const isPerim =
            w.frontSide === 'exterior' ||
            w.backSide === 'exterior' ||
            Math.abs(mx - cMinX) <= tolPerim ||
            Math.abs(mx - cMaxX) <= tolPerim ||
            Math.abs(mz - cMinZ) <= tolPerim ||
            Math.abs(mz - cMaxZ) <= tolPerim
          if (isPerim && wh > maxPerimH) maxPerimH = wh
        }
        const roofSeatH = maxPerimH > 1.5 ? maxPerimH : maxClusterH > 1.5 ? maxClusterH : defaultWallHeightM

        const spanX = cMaxX - cMinX
        const spanZ = cMaxZ - cMinZ
        if (spanX <= 1.5 || spanZ <= 1.5) continue

        const hasFootprintClip = clusterInteriorPolys.length > 0 || clusterWallSegs.length >= 3
        const isInsideClusterFootprint = (x: number, z: number, marginM = 0): boolean => {
          if (!hasFootprintClip) return true
          if (clusterInteriorPolys.some((p) => pointInPolygon2D(x, z, p, 0.02))) return true
          if (clusterWallSegs.length >= 3 && isPointEnclosedByWalls(x, z, clusterWallSegs)) return true
          if (marginM > 0) {
            for (const ws of clusterWallSegs) {
              if (distancePointToSegment2D(x, z, ws.start[0], ws.start[1], ws.end[0], ws.end[1]) <= marginM) return true
            }
            for (const p of clusterInteriorPolys) {
              if (pointNearPolygonEdges2D(x, z, p, marginM)) return true
            }
          }
          return false
        }

        // VIS-V3-06 / Polish A: Only explicit roof segments seated near the TOP of this story's walls
        // (`cy >= env.baseElevationM + roofSeatH - 0.6`) count as covering this story's top roof plane.
        // Lower-story porch/wing roofs parented onto an upper story at y = 0 do NOT suppress the upper story's roof!
        const topExplicitRoofs = explicitRoofSegments.filter(
          (seg) => seg.cy >= env.baseElevationM + roofSeatH - 0.6,
        )
        if (topExplicitRoofs.length > 0) {
          const gridStep = 0.8
          let insideTotal = 0
          let uncoveredCount = 0
          let uMinX = Number.POSITIVE_INFINITY
          let uMaxX = Number.NEGATIVE_INFINITY
          let uMinZ = Number.POSITIVE_INFINITY
          let uMaxZ = Number.NEGATIVE_INFINITY
          for (let gx = cMinX + gridStep * 0.5; gx <= cMaxX - 0.1; gx += gridStep) {
            for (let gz = cMinZ + gridStep * 0.5; gz <= cMaxZ - 0.1; gz += gridStep) {
              if (!isInsideClusterFootprint(gx, gz, 0)) continue
              insideTotal += 1
              if (!isInsideRoofSet(topExplicitRoofs, gx, gz, 0.35)) {
                uncoveredCount += 1
                if (gx < uMinX) uMinX = gx
                if (gx > uMaxX) uMaxX = gx
                if (gz < uMinZ) uMinZ = gz
                if (gz > uMaxZ) uMaxZ = gz
              }
            }
          }
          const uncoveredRatio = insideTotal > 0 ? uncoveredCount / insideTotal : 0
          if (
            uncoveredRatio > 0.25 &&
            Number.isFinite(uMinX) &&
            uMaxX - uMinX >= 2.0 &&
            uMaxZ - uMinZ >= 2.0
          ) {
            const fMinX = Math.max(cMinX, uMinX - gridStep * 0.5)
            const fMaxX = Math.min(cMaxX, uMaxX + gridStep * 0.5)
            const fMinZ = Math.max(cMinZ, uMinZ - gridStep * 0.5)
            const fMaxZ = Math.min(cMaxZ, uMaxZ + gridStep * 0.5)
            const fSpanX = fMaxX - fMinX
            const fSpanZ = fMaxZ - fMinZ
            const ridgeAlongX = fSpanX >= fSpanZ
            roofSegments.push({
              cx: (fMinX + fMaxX) / 2,
              cy: env.baseElevationM + roofSeatH,
              cz: (fMinZ + fMaxZ) / 2,
              yaw: ridgeAlongX ? 0 : Math.PI / 2,
              roofType: 'gable',
              widthM: ridgeAlongX ? fSpanX : fSpanZ,
              depthM: ridgeAlongX ? fSpanZ : fSpanX,
              pitchRad: Math.atan(6 / 12),
              overhangM: 0.4,
              wallHeightM: 0,
              heelHeightM: 0,
              isFallback: true,
              footprintClip: (x, z, margin = 0) =>
                isInsideClusterFootprint(x, z, margin) && !isInsideRoofSet(topExplicitRoofs, x, z, -0.15),
            })
          }
          continue
        }

        // VIS-04 / VIS-V3-11 / Polish C: Commercial flat/low-slope roof deck (24" OC joists) with framed RTU curb opening
        const clusterRtus = levelRtus.filter(
          (rtu) =>
            Array.isArray(rtu.position) &&
            rtu.position.length >= 3 &&
            rtu.position[0] >= cMinX - 0.5 &&
            rtu.position[0] <= cMaxX + 0.5 &&
            rtu.position[2] >= cMinZ - 0.5 &&
            rtu.position[2] <= cMaxZ + 0.5,
        )
        if (clusterRtus.length > 0) {
          const deckBaseY = env.baseElevationM + roofSeatH
          const flatDepthM = Math.min(spanX, spanZ) > 5.5 ? 0.2858 : 0.2413
          const deckCenterY = deckBaseY + flatDepthM / 2
          const flatSpacingM = 24 * INCHES_TO_METERS
          const spanAlongX = spanX <= spanZ
          const rotY = spanAlongX ? 0 : Math.PI / 2

          // Build curb opening boxes in XZ around every RTU so zero roof joists slice through the RTU
          const rtuOpenings = clusterRtus.map((rtu) => {
            const p = rtu.position!
            const rot =
              typeof rtu.rotation === 'number' && Number.isFinite(rtu.rotation)
                ? rtu.rotation
                : Array.isArray(rtu.rotation) &&
                    typeof rtu.rotation[1] === 'number' &&
                    Number.isFinite(rtu.rotation[1])
                  ? rtu.rotation[1]
                  : 0
            const w =
              typeof rtu.widthM === 'number' && rtu.widthM > 0.2
                ? rtu.widthM
                : typeof rtu.width === 'number' && rtu.width > 0.2
                  ? rtu.width
                  : 1.55
            const d =
              typeof rtu.depthM === 'number' && rtu.depthM > 0.2
                ? rtu.depthM
                : typeof rtu.depth === 'number' && rtu.depth > 0.2
                  ? rtu.depth
                  : 1.15
            const halfX = (Math.abs(w * Math.cos(rot)) + Math.abs(d * Math.sin(rot))) / 2 + 0.12
            const halfZ = (Math.abs(w * Math.sin(rot)) + Math.abs(d * Math.cos(rot))) / 2 + 0.12
            return {
              minX: p[0] - halfX,
              maxX: p[0] + halfX,
              minZ: p[2] - halfZ,
              maxZ: p[2] + halfZ,
            }
          })

          // Perimeter rim joists seated on top of perimeter walls
          for (const ws of clusterWallSegs) {
            const eRotY = -Math.atan2(ws.uz, ws.ux)
            pushWallBox('osb-web', ws.start[0], ws.start[1], ws.ux, ws.uz, ws.nx, ws.nz, eRotY, ws.lengthM / 2, deckCenterY, ws.lengthM, flatDepthM, memberThickM)
          }

          // Flat roof joists clipped to enclosed footprint and split cleanly around every RTU curb opening
          const runStart = spanAlongX ? cMinZ + flatSpacingM : cMinX + flatSpacingM
          const runEnd = spanAlongX ? cMaxZ - 0.08 : cMaxX - 0.08
          for (let pos = runStart; pos <= runEnd; pos += flatSpacingM) {
            const segA: Vec3Tuple = spanAlongX ? [cMinX, deckCenterY, pos] : [pos, deckCenterY, cMinZ]
            const segB: Vec3Tuple = spanAlongX ? [cMaxX, deckCenterY, pos] : [pos, deckCenterY, cMaxZ]
            const fpSegs = clipSegmentToFootprint3D(segA, segB, (x, z) => isInsideClusterFootprint(x, z, 0.04), 0.25)

            for (const fp of fpSegs) {
              const s0 = spanAlongX ? Math.min(fp.start[0], fp.end[0]) : Math.min(fp.start[2], fp.end[2])
              const s1 = spanAlongX ? Math.max(fp.start[0], fp.end[0]) : Math.max(fp.start[2], fp.end[2])
              let intervals: Array<[number, number]> = [[s0, s1]]
              for (const op of rtuOpenings) {
                const oMinTrans = spanAlongX ? op.minZ : op.minX
                const oMaxTrans = spanAlongX ? op.maxZ : op.maxX
                const oMinSpan = spanAlongX ? op.minX : op.minZ
                const oMaxSpan = spanAlongX ? op.maxX : op.maxZ
                // Skip field joists colliding with full-span double LVL trimmer bands; split tail joists cleanly at double headers
                const inLeftTrimmer = pos >= oMinTrans - memberThickM * 2.5 && pos <= oMinTrans + memberThickM * 0.5
                const inRightTrimmer = pos >= oMaxTrans - memberThickM * 0.5 && pos <= oMaxTrans + memberThickM * 2.5
                if (inLeftTrimmer || inRightTrimmer) {
                  intervals = []
                  break
                }
                if (pos > oMinTrans + memberThickM * 0.5 && pos < oMaxTrans - memberThickM * 0.5) {
                  intervals = subtractInterval1D(intervals, oMinSpan - memberThickM * 2, oMaxSpan + memberThickM * 2)
                }
              }
              for (const [a0, a1] of intervals) {
                const jLen = a1 - a0 - memberThickM
                if (jLen < 0.2) continue
                const mid = (a0 + a1) / 2
                const cx = spanAlongX ? mid : pos
                const cz = spanAlongX ? pos : mid
                boxes.push({ bucket: 'lumber', center: [cx, deckCenterY, cz], size: [jLen, flatDepthM, memberThickM], rotY })
                if (showConnectors) {
                  const endOff = jLen / 2 - 0.02
                  for (const dir of [-1, 1]) {
                    const hx = spanAlongX ? cx + dir * endOff : cx
                    const hz = spanAlongX ? cz : cz + dir * endOff
                    boxes.push({ bucket: 'galv-steel', center: [hx, deckBaseY + 0.02, hz], size: [0.056, 0.14, 0.06], rotY })
                  }
                }
              }
            }
          }

          // Framed RTU curb openings: double trimmers (parallel to joists) + double headers (perpendicular) + curb frame
          for (const op of rtuOpenings) {
            const oMinTrans = spanAlongX ? op.minZ : op.minX
            const oMaxTrans = spanAlongX ? op.maxZ : op.maxX
            const oMinSpan = spanAlongX ? op.minX : op.minZ
            const oMaxSpan = spanAlongX ? op.maxX : op.maxZ
            const headerLen = Math.max(0.25, oMaxTrans - oMinTrans)
            const headerRotY = spanAlongX ? Math.PI / 2 : 0

            // 1. Double trimmer joists along BOTH sides of the RTU opening (full span clipped to enclosed footprint)
            for (const side of [
              { edge: oMinTrans, dir: -1 },
              { edge: oMaxTrans, dir: 1 },
            ]) {
              for (let ply = 0; ply < 2; ply++) {
                const tPos = side.edge + side.dir * memberThickM * (ply + 0.5)
                const tA: Vec3Tuple = spanAlongX ? [cMinX, deckCenterY, tPos] : [tPos, deckCenterY, cMinZ]
                const tB: Vec3Tuple = spanAlongX ? [cMaxX, deckCenterY, tPos] : [tPos, deckCenterY, cMaxZ]
                const tSegs = clipSegmentToFootprint3D(tA, tB, (x, z) => isInsideClusterFootprint(x, z, 0.04), 0.25)
                for (const ts of tSegs) {
                  const tLen = Math.hypot(ts.end[0] - ts.start[0], ts.end[2] - ts.start[2]) - memberThickM * 2
                  if (tLen < 0.25) continue
                  boxes.push({
                    bucket: 'header-lvl',
                    center: [(ts.start[0] + ts.end[0]) / 2, deckCenterY, (ts.start[2] + ts.end[2]) / 2],
                    size: [tLen, flatDepthM, memberThickM],
                    rotY,
                  })
                }
              }
            }

            // 2. Double header joists across BOTH ends of the RTU opening (between inner faces of double trimmers)
            const transMid = (oMinTrans + oMaxTrans) / 2
            for (const end of [
              { edge: oMinSpan, dir: -1 },
              { edge: oMaxSpan, dir: 1 },
            ]) {
              for (let ply = 0; ply < 2; ply++) {
                const hPos = end.edge + end.dir * memberThickM * (ply + 0.5)
                const cx = spanAlongX ? hPos : transMid
                const cz = spanAlongX ? transMid : hPos
                boxes.push({
                  bucket: 'header-lvl',
                  center: [cx, deckCenterY, cz],
                  size: [headerLen, flatDepthM, memberThickM],
                  rotY: headerRotY,
                })
              }
              // Galvanized heavy header hangers at trimmer connections
              if (showConnectors) {
                for (const tEdge of [oMinTrans + 0.02, oMaxTrans - 0.02]) {
                  const hx = spanAlongX ? end.edge + end.dir * memberThickM : tEdge
                  const hz = spanAlongX ? tEdge : end.edge + end.dir * memberThickM
                  boxes.push({
                    bucket: 'galv-steel',
                    center: [hx, deckCenterY, hz],
                    size: [0.06, flatDepthM * 0.85, 0.09],
                    rotY: headerRotY,
                  })
                }
              }
            }

            // 3. Raised PT roof curb frame sitting cleanly on top of the framed opening perimeter
            const curbH = 0.14
            const curbY = deckBaseY + flatDepthM + curbH / 2
            const curbSpanX = op.maxX - op.minX
            const curbSpanZ = op.maxZ - op.minZ
            boxes.push({ bucket: 'pt-sill', center: [(op.minX + op.maxX) / 2, curbY, op.minZ - memberThickM / 2], size: [curbSpanX + memberThickM * 2, curbH, memberThickM] })
            boxes.push({ bucket: 'pt-sill', center: [(op.minX + op.maxX) / 2, curbY, op.maxZ + memberThickM / 2], size: [curbSpanX + memberThickM * 2, curbH, memberThickM] })
            boxes.push({ bucket: 'pt-sill', center: [op.minX - memberThickM / 2, curbY, (op.minZ + op.maxZ) / 2], size: [memberThickM, curbH, curbSpanZ] })
            boxes.push({ bucket: 'pt-sill', center: [op.maxX + memberThickM / 2, curbY, (op.minZ + op.maxZ) / 2], size: [memberThickM, curbH, curbSpanZ] })
          }
          continue
        }

        const ridgeAlongX = spanX >= spanZ
        roofSegments.push({
          cx: (cMinX + cMaxX) / 2,
          cy: env.baseElevationM + roofSeatH,
          cz: (cMinZ + cMaxZ) / 2,
          yaw: ridgeAlongX ? 0 : Math.PI / 2,
          roofType: 'gable',
          widthM: ridgeAlongX ? spanX : spanZ,
          depthM: ridgeAlongX ? spanZ : spanX,
          pitchRad: Math.atan(6 / 12),
          overhangM: 0.4,
          wallHeightM: 0,
          heelHeightM: 0,
          isFallback: true,
          footprintClip: hasFootprintClip ? isInsideClusterFootprint : undefined,
        })
      }
    }

    // Flat-roof joists (24" OC) over uncovered 1-story connecting wings on lower stories
    // (e.g. a central flat-roofed living/kitchen bar with no upper story and no pitched roof above it).
    // Never emits over outdoor zones (pools, lanais, patios, decks, balconies) or under upper stories / pitched roofs.
    const emitUncoveredLowerWingFlatRoof = (targetLowerLevelId: string, yOffsetM: number) => {
      const lowerLvlNode = nodes[targetLowerLevelId]
      if (!lowerLvlNode || lowerLvlNode.type !== 'level') return
      const lowerOrder = levelSortOrder(lowerLvlNode)
      const lowerBldgId = typeof lowerLvlNode.parentId === 'string' ? lowerLvlNode.parentId : null

      const allVals = Object.values(nodes)
      const lowerNodes = allVals.filter((n) => belongsToLevel(nodes, n, targetLowerLevelId))
      const lowerWalls = lowerNodes.filter(
        (n) => n.type === 'wall' && n.visible !== false && Array.isArray(n.start) && Array.isArray(n.end),
      )
      if (lowerWalls.length < 3) return

      const lowerWallSegs: CanonicalWall[] = []
      let lMinX = Number.POSITIVE_INFINITY
      let lMaxX = Number.NEGATIVE_INFINITY
      let lMinZ = Number.POSITIVE_INFINITY
      let lMaxZ = Number.NEGATIVE_INFINITY
      let lMinElev = Number.POSITIVE_INFINITY
      for (const w of lowerWalls) {
        const ax = Number(w.start![0])
        const az = Number(w.start![1])
        const bx = Number(w.end![0])
        const bz = Number(w.end![1])
        const len = Math.hypot(bx - ax, bz - az)
        if (!Number.isFinite(len) || len < 0.25) continue
        lowerWallSegs.push(toCanonicalWallSeg(w.id, ax, az, bx, bz, len))
        lMinX = Math.min(lMinX, ax, bx)
        lMaxX = Math.max(lMaxX, ax, bx)
        lMinZ = Math.min(lMinZ, az, bz)
        lMaxZ = Math.max(lMaxZ, az, bz)
        const e = typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0
        if (e < lMinElev) lMinElev = e
      }
      if (!Number.isFinite(lMinX) || lMaxX - lMinX < 2.0 || lMaxZ - lMinZ < 2.0) return
      const lowerBaseY = Number.isFinite(lMinElev) ? lMinElev : 0
      const lowerStackH =
        typeof lowerLvlNode.height === 'number' && lowerLvlNode.height > 1.5
          ? lowerLvlNode.height
          : defaultWallHeightM

      const lowerOutdoorPolys: Array<ReadonlyArray<Vec2>> = []
      const lowerIndoorPolys: Array<ReadonlyArray<Vec2>> = []
      for (const z of lowerNodes) {
        if ((z.type === 'zone' || z.type === 'room') && z.visible !== false && Array.isArray(z.polygon) && (z.polygon as Vec2[]).length >= 3) {
          const poly = z.polygon as ReadonlyArray<Vec2>
          if (OUTDOOR_SLAB_RE.test(String(z.name ?? ''))) lowerOutdoorPolys.push(poly)
          else lowerIndoorPolys.push(poly)
        }
      }
      const lowerInteriorSlabs = lowerNodes.filter(
        (n) =>
          n.type === 'slab' &&
          n.visible !== false &&
          Array.isArray(n.polygon) &&
          (n.polygon as Vec2[]).length >= 3 &&
          !isOutdoorOrUnwalledSlab(n, lowerWallSegs, lowerOutdoorPolys, lowerBaseY),
      )

      // Gather upper-story walled footprints & slabs (strictly above `targetLowerLevelId` in same building)
      const upperLevels = allVals.filter((n) => {
        if (n.type !== 'level' || n.id === targetLowerLevelId) return false
        const nParent = typeof n.parentId === 'string' ? n.parentId : null
        if (lowerBldgId && nParent && nParent !== lowerBldgId) return false
        return levelSortOrder(n) > lowerOrder
      })
      const upperWallSegs: CanonicalWall[] = []
      const upperCoverPolys: Array<ReadonlyArray<Vec2>> = []
      const upperLevelIds = new Set<string>()
      for (const ul of upperLevels) {
        const ulNodes = allVals.filter((n) => belongsToLevel(nodes, n, ul.id))
        const ulWalls = ulNodes.filter(
          (n) => n.type === 'wall' && n.visible !== false && Array.isArray(n.start) && Array.isArray(n.end),
        )
        if (ulWalls.length === 0) continue
        upperLevelIds.add(ul.id)
        for (const w of ulWalls) {
          const ax = Number(w.start![0])
          const az = Number(w.start![1])
          const bx = Number(w.end![0])
          const bz = Number(w.end![1])
          const len = Math.hypot(bx - ax, bz - az)
          if (Number.isFinite(len) && len >= 0.25) upperWallSegs.push(toCanonicalWallSeg(w.id, ax, az, bx, bz, len))
        }
        for (const n of ulNodes) {
          if (
            (n.type === 'slab' || n.type === 'zone' || n.type === 'room') &&
            n.visible !== false &&
            Array.isArray(n.polygon) &&
            (n.polygon as Vec2[]).length >= 3 &&
            !OUTDOOR_SLAB_RE.test(String(n.name ?? ''))
          ) {
            upperCoverPolys.push(n.polygon as ReadonlyArray<Vec2>)
          }
        }
      }
      if (upperLevelIds.size === 0) return

      // Gather all explicit roof-segments covering `targetLowerLevelId` (on lower level, adopted onto lower level,
      // OR directly parented to any upper level at py <= 0.05)
      const explicitCoverRoofs: ExtractedRoofSegment[] = [
        ...extractLevelRoofSegments(nodes, targetLowerLevelId, lowerStackH, lowerBaseY),
      ]
      for (const ulId of upperLevelIds) {
        for (const node of allVals) {
          if (node.type !== 'roof-segment') continue
          const segPos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
          let px = typeof segPos[0] === 'number' ? segPos[0] : 0
          let py = typeof segPos[1] === 'number' ? segPos[1] : 0
          let pz = typeof segPos[2] === 'number' ? segPos[2] : 0
          let yaw = typeof node.rotation === 'number' ? node.rotation : 0
          let curParentId = typeof node.parentId === 'string' ? node.parentId : null
          let directOnUpper = false
          for (let hop = 0; hop < 6 && curParentId; hop++) {
            if (curParentId === ulId) {
              directOnUpper = true
              break
            }
            const p = nodes[curParentId]
            if (!p || p.type === 'level') break
            if (p.type === 'roof') {
              const rot = typeof p.rotation === 'number' ? p.rotation : 0
              const rp = Array.isArray(p.position) ? (p.position as number[]) : [0, 0, 0]
              const c = Math.cos(rot)
              const s = Math.sin(rot)
              const nx = px * c + pz * s
              const nz = -px * s + pz * c
              px = nx + (typeof rp[0] === 'number' ? rp[0] : 0)
              py += typeof rp[1] === 'number' ? rp[1] : 0
              pz = nz + (typeof rp[2] === 'number' ? rp[2] : 0)
              yaw += rot
            }
            curParentId = typeof p.parentId === 'string' ? p.parentId : null
          }
          if (!directOnUpper || py > 0.05) continue
          const widthM = typeof node.width === 'number' && node.width > 0.2 ? node.width : 6.0
          const depthM = typeof node.depth === 'number' && node.depth > 0.2 ? node.depth : 6.0
          const overhangM = typeof node.overhang === 'number' && node.overhang >= 0 ? node.overhang : 0.35
          explicitCoverRoofs.push({
            cx: px,
            cy: lowerBaseY,
            cz: pz,
            yaw,
            roofType: typeof node.roofType === 'string' ? node.roofType : 'gable',
            widthM,
            depthM,
            pitchRad: 0,
            overhangM,
            wallHeightM: 0,
            heelHeightM: 0,
          })
        }
      }

      const isInsideLowerIndoor = (x: number, z: number, wallMarginM = 0): boolean => {
        if (lowerOutdoorPolys.some((p) => pointInPolygon2D(x, z, p, 0.02))) return false
        if (lowerIndoorPolys.some((p) => pointInPolygon2D(x, z, p, 0.02))) return true
        if (lowerInteriorSlabs.some((s) => pointInPolygon2D(x, z, s.polygon as ReadonlyArray<Vec2>, 0.02))) return true
        if (lowerWallSegs.length >= 3 && isPointEnclosedByWalls(x, z, lowerWallSegs)) return true
        if (wallMarginM > 0) {
          for (const ws of lowerWallSegs) {
            if (distancePointToSegment2D(x, z, ws.start[0], ws.start[1], ws.end[0], ws.end[1]) <= wallMarginM) return true
          }
        }
        return false
      }

      const isCoveredByUpperOrRoof = (x: number, z: number, padM = 0.15): boolean => {
        if (upperCoverPolys.some((p) => pointInPolygon2D(x, z, p, padM))) return true
        if (upperWallSegs.length >= 3 && isPointEnclosedByWalls(x, z, upperWallSegs)) return true
        if (padM > 0 && upperWallSegs.some((ws) => distancePointToSegment2D(x, z, ws.start[0], ws.start[1], ws.end[0], ws.end[1]) <= padM)) {
          return true
        }
        if (explicitCoverRoofs.length > 0 && isInsideRoofSet(explicitCoverRoofs, x, z, padM)) return true
        return false
      }

      const gridStep = 0.8
      let uncoveredCount = 0
      let uMinX = Number.POSITIVE_INFINITY
      let uMaxX = Number.NEGATIVE_INFINITY
      let uMinZ = Number.POSITIVE_INFINITY
      let uMaxZ = Number.NEGATIVE_INFINITY
      for (let gx = lMinX + gridStep * 0.5; gx <= lMaxX - 0.1; gx += gridStep) {
        for (let gz = lMinZ + gridStep * 0.5; gz <= lMaxZ - 0.1; gz += gridStep) {
          if (!isInsideLowerIndoor(gx, gz, 0)) continue
          if (isCoveredByUpperOrRoof(gx, gz, 0.15)) continue
          uncoveredCount += 1
          if (gx < uMinX) uMinX = gx
          if (gx > uMaxX) uMaxX = gx
          if (gz < uMinZ) uMinZ = gz
          if (gz > uMaxZ) uMaxZ = gz
        }
      }
      if (uncoveredCount < 6 || !Number.isFinite(uMinX) || uMaxX - uMinX < 2.0 || uMaxZ - uMinZ < 2.0) {
        return
      }

      const fMinX = Math.max(lMinX, uMinX - 0.45)
      const fMaxX = Math.min(lMaxX, uMaxX + 0.45)
      const fMinZ = Math.max(lMinZ, uMinZ - 0.45)
      const fMaxZ = Math.min(lMaxZ, uMaxZ + 0.45)
      const lowerBearingH = resolveBearingWallHeightInBox(
        nodes,
        targetLowerLevelId,
        lowerStackH,
        fMinX,
        fMaxX,
        fMinZ,
        fMaxZ,
      )
      const flatDepthM = 0.2413
      const deckBaseY = lowerBaseY + lowerBearingH + yOffsetM
      const deckCenterY = deckBaseY + flatDepthM / 2
      const flatSpacingM = 24 * INCHES_TO_METERS
      const spanX = fMaxX - fMinX
      const spanZ = fMaxZ - fMinZ
      const spanAlongX = spanX <= spanZ
      const rotY = spanAlongX ? 0 : Math.PI / 2

      const inUncoveredWing = (x: number, z: number): boolean =>
        isInsideLowerIndoor(x, z, 0.06) && !isCoveredByUpperOrRoof(x, z, -0.05)

      const runStart = spanAlongX ? fMinZ + flatSpacingM * 0.5 : fMinX + flatSpacingM * 0.5
      const runEnd = spanAlongX ? fMaxZ - 0.08 : fMaxX - 0.08
      for (let pos = runStart; pos <= runEnd; pos += flatSpacingM) {
        const segA: Vec3Tuple = spanAlongX ? [fMinX, deckCenterY, pos] : [pos, deckCenterY, fMinZ]
        const segB: Vec3Tuple = spanAlongX ? [fMaxX, deckCenterY, pos] : [pos, deckCenterY, fMaxZ]
        const fpSegs = clipSegmentToFootprint3D(segA, segB, inUncoveredWing, 0.35)
        for (const fp of fpSegs) {
          const rawLen = Math.hypot(fp.end[0] - fp.start[0], fp.end[2] - fp.start[2])
          const jLen = rawLen - memberThickM
          if (jLen < 0.25) continue
          const cx = (fp.start[0] + fp.end[0]) / 2
          const cz = (fp.start[2] + fp.end[2]) / 2
          boxes.push({ bucket: 'lumber', center: [cx, deckCenterY, cz], size: [jLen, flatDepthM, memberThickM], rotY })
          if (showConnectors) {
            const endOff = jLen / 2 - 0.02
            for (const dir of [-1, 1]) {
              const hx = spanAlongX ? cx + dir * endOff : cx
              const hz = spanAlongX ? cz : cz + dir * endOff
              boxes.push({ bucket: 'galv-steel', center: [hx, deckBaseY + 0.02, hz], size: [0.056, 0.14, 0.06], rotY })
            }
          }
        }
      }

      // Perimeter rim joists seated cleanly on top of walls bordering the uncovered 1-story wing
      for (const ws of lowerWallSegs) {
        const rimSegs = clipSegmentToFootprint3D(
          [ws.start[0], deckCenterY, ws.start[1]],
          [ws.end[0], deckCenterY, ws.end[1]],
          (x, z) =>
            isInsideLowerIndoor(x, z, 0.15) &&
            !isCoveredByUpperOrRoof(x, z, 0.05) &&
            (inUncoveredWing(x + ws.nx * 0.25, z + ws.nz * 0.25) !== inUncoveredWing(x - ws.nx * 0.25, z - ws.nz * 0.25)),
          0.35,
        )
        const eRotY = -Math.atan2(ws.uz, ws.ux)
        for (const rs of rimSegs) {
          const rLen = Math.hypot(rs.end[0] - rs.start[0], rs.end[2] - rs.start[2])
          if (rLen < 0.25) continue
          boxes.push({
            bucket: 'osb-web',
            center: [(rs.start[0] + rs.end[0]) / 2, deckCenterY, (rs.start[2] + rs.end[2]) / 2],
            size: [rLen, flatDepthM, memberThickM],
            rotY: eRotY,
          })
        }
      }
    }

    if (levelId && !isHighestWalledLevelInBuilding(nodes, levelId)) {
      emitUncoveredLowerWingFlatRoof(levelId, 0)
    } else if (levelId && !isLowestWalledLevelInBuilding(nodes, levelId)) {
      // When the lower story's structural:assembly has `visibleSystems.roof === false` (standard for
      // multi-story auto-framed scenes per VIS-X7), emit the uncovered 1-story flat-roofed wing joists
      // from the upper story's roof pass at exact lower-story top-plate elevation (zero duplication!).
      const lowerLvl = findImmediateLowerWalledLevel(nodes, levelId)
      if (lowerLvl) {
        const lowerHasRoofEnabledAsm = Object.values(nodes).some(
          (n) =>
            n.type === 'structural:assembly' &&
            n.visible !== false &&
            belongsToLevel(nodes, n, lowerLvl.id) &&
            (n.visibleSystems as Record<string, boolean> | undefined)?.roof !== false,
        )
        if (!lowerHasRoofEnabledAsm) {
          const lowerStackH =
            typeof lowerLvl.height === 'number' && lowerLvl.height > 1.5
              ? lowerLvl.height
              : defaultWallHeightM
          emitUncoveredLowerWingFlatRoof(lowerLvl.id, -lowerStackH)
        }
      }
    }

    for (let segIdx = 0; segIdx < roofSegments.length; segIdx++) {
      const seg = roofSegments[segIdx]!
      if (seg.widthM < 0.3 || seg.depthM < 0.3) continue
      const frame = resolveCanonicalRoofFrame(seg)
      const effYaw = frame.effYaw
      const effWidth = frame.effWidth
      const effDepth = frame.effDepth
      const halfW = frame.halfW
      const halfRun = frame.halfRun
      const cosR = Math.cos(effYaw)
      const sinR = Math.sin(effYaw)
      // Canonical roof-segment local frame: +X = ridge direction (effWidth), ±Z = primary slopes (effDepth)
      // Three.js Ry(effYaw): (lx, ly, lz) -> (lx*cos + lz*sin, ly, -lx*sin + lz*cos)
      const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
        seg.cx + lx * cosR + lz * sinR,
        seg.cy + ly,
        seg.cz - lx * sinR + lz * cosR,
      ]
      const ridgeAxisWorld: [number, number, number] = [cosR, 0, -sinR]
      const slopeAxisWorld: [number, number, number] = [sinR, 0, cosR]
      const fpClip = seg.footprintClip

      // Detect dominating host roof planes (e.g. main gable hosting a perpendicular cross-gable or dormer)
      // so secondary roof rafters, ridge beam, webs & rake studs clip cleanly along California valley lines
      // and NEVER plunge below the primary roof into the house interior.
      const hostRoofs = findDominatingHostRoofs(seg, segIdx, roofSegments)
      const isOverFramed = hostRoofs.length > 0
      const isPointAboveHosts = (pt: readonly [number, number, number], tol = 0.03): boolean => {
        if (!isOverFramed) return true
        const hy = hostSurfaceYAt(pt[0], pt[2], hostRoofs)
        return hy === null || pt[1] >= hy - tol
      }
      const inFootprint = (pt: readonly [number, number, number], marginM = 0.15): boolean =>
        !fpClip || fpClip(pt[0], pt[2], marginM)

      const pushClippedStrut = (
        bucket: BucketId,
        pA: readonly [number, number, number],
        pB: readonly [number, number, number],
        depthM: number,
        thickM: number,
        sideHint: readonly [number, number, number],
        fpMarginM = seg.overhangM,
      ): boolean => {
        const hostClip = clipSegmentAboveHosts(pA, pB, hostRoofs, 0.015)
        if (!hostClip) return false
        if (!fpClip) {
          pushStrut(bucket, hostClip.start, hostClip.end, depthM, thickM, sideHint)
          return true
        }
        const subSegs = clipSegmentToFootprint3D(
          hostClip.start,
          hostClip.end,
          (x, z) => fpClip(x, z, fpMarginM),
          0.14,
        )
        for (const ss of subSegs) {
          pushStrut(bucket, ss.start, ss.end, depthM, thickM, sideHint)
        }
        return subSegs.length > 0
      }

      // Polish B + Zero-Gap Bearing Extension: Frame Pascal's raised-heel perimeter knee-wall
      // (`seg.heelHeightM > 0.03`) from y = -seg.heelHeightM (actual double top plate, bridging both
      // `wallHeightM` and any floor-stack vs. bearing-wall band delta) up to y = 0 (eave bearing seat).
      const emitRaisedHeelEdge = (
        lx0: number,
        lz0: number,
        lx1: number,
        lz1: number,
        wallNormalHint: readonly [number, number, number],
      ) => {
        const wh = seg.heelHeightM
        if (wh <= 0.03) return
        const edgeLen = Math.hypot(lx1 - lx0, lz1 - lz0)
        if (edgeLen < 0.08) return
        const plateThick = 0.0381
        const plateWidth = 0.089
        const botPlateY = -wh + plateThick * 0.5
        const topPlateY = -plateThick * 0.5
        pushClippedStrut('lumber', toWorld(lx0, botPlateY, lz0), toWorld(lx1, botPlateY, lz1), plateThick, plateWidth, wallNormalHint, 0.15)
        if (wh > plateThick * 1.6) {
          pushClippedStrut('lumber', toWorld(lx0, topPlateY, lz0), toWorld(lx1, topPlateY, lz1), plateThick, plateWidth, wallNormalHint, 0.15)
        }
        const studBotY = -wh + plateThick
        const studTopY = -plateThick
        if (studTopY - studBotY > 0.04) {
          const studCount = Math.max(2, Math.floor(edgeLen / studSpacingM) + 1)
          const edgeAxisWorld: Vec3Tuple = [
            ((lx1 - lx0) * cosR + (lz1 - lz0) * sinR) / edgeLen,
            0,
            (-(lx1 - lx0) * sinR + (lz1 - lz0) * cosR) / edgeLen,
          ]
          for (let si = 0; si < studCount; si++) {
            const frac = si / Math.max(1, studCount - 1)
            const sx = lx0 + (lx1 - lx0) * frac
            const sz = lz0 + (lz1 - lz0) * frac
            const pBot = toWorld(sx, studBotY, sz)
            const pTop = toWorld(sx, studTopY, sz)
            if (fpClip && !fpClip(pTop[0], pTop[2], 0.15)) continue
            if (!isPointAboveHosts(pBot, 0.04) || !isPointAboveHosts(pTop, 0.04)) continue
            pushStrut('lumber', pBot, pTop, plateWidth, memberThickM, edgeAxisWorld)
          }
        }
      }

      // 3a. FLAT ROOF (or zero-pitch segment): flat roof joists & perimeter rim boards at y = 0 (riseM = 0)
      if (seg.roofType === 'flat' || seg.pitchRad <= 1e-4) {
        const flatDepthM = Math.min(effWidth, effDepth) > 5.5 ? 0.2858 : 0.2413
        const deckY = flatDepthM / 2
        const cNW = toWorld(-halfW, deckY, -halfRun)
        const cNE = toWorld(halfW, deckY, -halfRun)
        const cSE = toWorld(halfW, deckY, halfRun)
        const cSW = toWorld(-halfW, deckY, halfRun)
        pushClippedStrut('osb-web', cNW, cNE, flatDepthM, memberThickM, slopeAxisWorld, 0.12)
        pushClippedStrut('osb-web', cSW, cSE, flatDepthM, memberThickM, slopeAxisWorld, 0.12)
        pushClippedStrut('osb-web', cNW, cSW, flatDepthM, memberThickM, ridgeAxisWorld, 0.12)
        pushClippedStrut('osb-web', cNE, cSE, flatDepthM, memberThickM, ridgeAxisWorld, 0.12)

        const spanAlongX = effWidth <= effDepth
        const runSpan = spanAlongX ? effDepth : effWidth
        const joistCount = Math.max(2, Math.floor(runSpan / rafterSpacingM) + 1)
        for (let i = 1; i < joistCount - 1; i++) {
          const offset = -runSpan / 2 + (runSpan * i) / Math.max(1, joistCount - 1)
          const pA = spanAlongX
            ? toWorld(-halfW + memberThickM, deckY, offset)
            : toWorld(offset, deckY, -halfRun + memberThickM)
          const pB = spanAlongX
            ? toWorld(halfW - memberThickM, deckY, offset)
            : toWorld(offset, deckY, halfRun - memberThickM)
          const hint = spanAlongX ? slopeAxisWorld : ridgeAxisWorld
          pushClippedStrut('lumber', pA, pB, flatDepthM, memberThickM, hint, 0.12)
        }
        emitRaisedHeelEdge(-halfW, -halfRun, halfW, -halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, halfRun, halfW, halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, -halfRun, -halfW, halfRun, ridgeAxisWorld)
        emitRaisedHeelEdge(halfW, -halfRun, halfW, halfRun, ridgeAxisWorld)
        continue
      }

      // 3b. CONICAL TURRET ROOF: segmented octagonal ring plate + central king post + 12-16 radial rafters
      if (seg.roofType === 'conical') {
        const radius = frame.halfRun
        const riseM = frame.riseM
        const eaveDropY = seg.overhangM * frame.effSlopeTan

        // Octagonal wall ring plate at y = 0.04 + raised-heel octagonal drum knee-wall if wallHeightM > 0.03
        const ringSides = 8
        for (let s = 0; s < ringSides; s++) {
          const a0 = (s * Math.PI * 2) / ringSides
          const a1 = ((s + 1) * Math.PI * 2) / ringSides
          const x0 = radius * Math.cos(a0)
          const z0 = radius * Math.sin(a0)
          const x1 = radius * Math.cos(a1)
          const z1 = radius * Math.sin(a1)
          const p0 = toWorld(x0, 0.04, z0)
          const p1 = toWorld(x1, 0.04, z1)
          const midA = (a0 + a1) * 0.5
          const radialHint: Vec3Tuple = [
            Math.cos(midA) * cosR + Math.sin(midA) * sinR,
            0,
            -Math.cos(midA) * sinR + Math.sin(midA) * cosR,
          ]
          pushClippedStrut('lumber', p0, p1, 0.076, 0.089, radialHint, 0.15)
          emitRaisedHeelEdge(x0, z0, x1, z1, radialHint)
        }

        // Central king post from ring plane up to conical apex
        const kingBot = toWorld(0, 0.04, 0)
        const kingTop = toWorld(0, riseM, 0)
        pushClippedStrut('lumber', kingBot, kingTop, 0.114, 0.114, ridgeAxisWorld, 0.15)

        // 12-16 radial rafters from central apex down to circular eave overhang (ZERO rectangular overhang!)
        const radialCount = Math.max(12, Math.min(16, Math.round((2 * Math.PI * radius) / rafterSpacingM)))
        const pApex = toWorld(0, riseM, 0)
        for (let k = 0; k < radialCount; k++) {
          const theta = (k * Math.PI * 2) / radialCount
          const ct = Math.cos(theta)
          const st = Math.sin(theta)
          const pEave = toWorld((radius + seg.overhangM) * ct, -eaveDropY, (radius + seg.overhangM) * st)
          const tangentHint: Vec3Tuple = [
            -st * cosR + ct * sinR,
            0,
            st * sinR + ct * cosR,
          ]
          const emitted = pushClippedStrut('lumber', pApex, pEave, chordDepthM, memberThickM, tangentHint, seg.overhangM)
          if (showConnectors && emitted) {
            const pTie = toWorld(radius * ct, 0.02, radius * st)
            if (isPointAboveHosts(pTie, 0.06) && inFootprint(pTie, 0.25)) {
              boxes.push({ bucket: 'galv-steel', center: pTie, size: [0.058, 0.14, 0.06], rotY: effYaw - theta })
            }
          }
        }
        continue
      }

      // 3c. MANSARD ROOF: steep lower perimeter slopes around all 4 sides + flat/low-slope upper cap joists
      if (seg.roofType === 'mansard') {
        const inset = Math.min(effWidth, effDepth) * 0.18
        const innerHalfW = Math.max(0.15, halfW - inset)
        const innerHalfD = Math.max(0.15, halfRun - inset)
        const riseM = frame.riseM
        const eaveDropY = Math.min(0.45, seg.overhangM * frame.effSlopeTan)

        // 4 corner mansard hip rafters
        for (const sx of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            const pTop = toWorld(sx * innerHalfW, riseM, sz * innerHalfD)
            const pBot = toWorld(sx * (halfW + seg.overhangM), -eaveDropY, sz * (halfRun + seg.overhangM))
            const diagHint: Vec3Tuple = [
              -sz * cosR + sx * sinR,
              0,
              sz * sinR + sx * cosR,
            ]
            pushClippedStrut('lumber', pTop, pBot, chordDepthM, memberThickM * 1.25, diagHint, seg.overhangM)
          }
        }

        // Upper cap perimeter rim beams at y = riseM
        const capNW = toWorld(-innerHalfW, riseM, -innerHalfD)
        const capNE = toWorld(innerHalfW, riseM, -innerHalfD)
        const capSE = toWorld(innerHalfW, riseM, innerHalfD)
        const capSW = toWorld(-innerHalfW, riseM, innerHalfD)
        pushClippedStrut('header-lvl', capNW, capNE, 0.18, 0.05, slopeAxisWorld, 0.15)
        pushClippedStrut('header-lvl', capSW, capSE, 0.18, 0.05, slopeAxisWorld, 0.15)
        pushClippedStrut('header-lvl', capNW, capSW, 0.18, 0.05, ridgeAxisWorld, 0.15)
        pushClippedStrut('header-lvl', capNE, capSE, 0.18, 0.05, ridgeAxisWorld, 0.15)

        // Steep lower perimeter rafters along -Z and +Z faces + flat upper deck joists across inner cap
        const xCount = Math.max(2, Math.floor((innerHalfW * 2) / rafterSpacingM) + 1)
        for (let i = 0; i < xCount; i++) {
          const lx = -innerHalfW + (innerHalfW * 2 * i) / Math.max(1, xCount - 1)
          const pTopN = toWorld(lx, riseM, -innerHalfD)
          const pBotN = toWorld(lx, -eaveDropY, -(halfRun + seg.overhangM))
          const pTopS = toWorld(lx, riseM, innerHalfD)
          const pBotS = toWorld(lx, -eaveDropY, halfRun + seg.overhangM)
          pushClippedStrut('lumber', pTopN, pBotN, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)
          pushClippedStrut('lumber', pTopS, pBotS, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)
          // Flat upper deck joist spanning inner cap
          if (i > 0 && i < xCount - 1) {
            pushClippedStrut(
              'lumber',
              toWorld(lx, riseM - 0.06, -innerHalfD + 0.03),
              toWorld(lx, riseM - 0.06, innerHalfD - 0.03),
              0.18,
              memberThickM,
              ridgeAxisWorld,
              0.12,
            )
          }
          // Ceiling joist at plate level
          if (roofSystem !== 'ridge-beam-cathedral') {
            pushClippedStrut(
              'lumber',
              toWorld(lx, 0.06, -halfRun),
              toWorld(lx, 0.06, halfRun),
              0.14,
              memberThickM,
              ridgeAxisWorld,
              0.12,
            )
          }
        }

        // Steep lower perimeter rafters along -X and +X end faces
        const zCount = Math.max(2, Math.floor((innerHalfD * 2) / rafterSpacingM) + 1)
        for (let i = 0; i < zCount; i++) {
          const lz = -innerHalfD + (innerHalfD * 2 * i) / Math.max(1, zCount - 1)
          for (const sx of [-1, 1] as const) {
            const pTop = toWorld(sx * innerHalfW, riseM, lz)
            const pBot = toWorld(sx * (halfW + seg.overhangM), -eaveDropY, lz)
            pushClippedStrut('lumber', pTop, pBot, chordDepthM, memberThickM, slopeAxisWorld, seg.overhangM)
          }
        }
        emitRaisedHeelEdge(-halfW, -halfRun, halfW, -halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, halfRun, halfW, halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, -halfRun, -halfW, halfRun, ridgeAxisWorld)
        emitRaisedHeelEdge(halfW, -halfRun, halfW, halfRun, ridgeAxisWorld)
        continue
      }

      // 3d. SHED ROOF: single sloping plane from -depth/2 (high wall) down to +depth/2 (low eave)
      if (seg.roofType === 'shed') {
        const riseM = frame.riseM
        const slopeTan = frame.effSlopeTan
        const count = Math.max(2, Math.floor(effWidth / rafterSpacingM) + 1)
        for (let i = 0; i < count; i++) {
          const lx = -halfW + (effWidth * i) / Math.max(1, count - 1)
          const pHigh = toWorld(lx, riseM + seg.overhangM * slopeTan, -halfRun - seg.overhangM)
          const pLow = toWorld(lx, -seg.overhangM * slopeTan, halfRun + seg.overhangM)
          const clipped = clipSegmentAboveHosts(pHigh, pLow, hostRoofs, 0.015)
          if (!clipped) continue
          pushStrut('lumber', clipped.start, clipped.end, chordDepthM, memberThickM, ridgeAxisWorld)
          if (showConnectors) {
            if (!clipped.clippedStart) {
              boxes.push({ bucket: 'galv-steel', center: toWorld(lx, riseM, -halfRun + 0.04), size: [0.056, 0.14, 0.06], rotY: effYaw })
            }
            if (!clipped.clippedEnd) {
              boxes.push({ bucket: 'galv-steel', center: toWorld(lx, 0.02, halfRun - 0.04), size: [0.056, 0.14, 0.06], rotY: effYaw })
            }
          }
        }
        emitRaisedHeelEdge(-halfW, -halfRun, halfW, -halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, halfRun, halfW, halfRun, slopeAxisWorld)
        continue
      }

      // 3e. HIP & DUTCH ROOFS: canonical long-axis ridge inset by `hipInset = min(halfRun, halfW)`,
      // 4 diagonal hip rafters, common rafters along ridge, and tapered jack rafters on both side & end slopes
      if (seg.roofType === 'hip' || seg.roofType === 'dutch') {
        const riseM = frame.riseM
        const effSlopeTan = frame.effSlopeTan
        const ridgeHalfThick = isTruss ? 0 : 0.0445
        const eaveDropY = seg.overhangM * effSlopeTan
        const hipInset = Math.min(halfRun, halfW)
        const ridgeEndX = Math.max(0, halfW - hipInset)

        // Ridge beam spanning ONLY [-ridgeEndX, +ridgeEndX] (zero ridge beam for square pyramid hip!)
        if (ridgeEndX > 0.06) {
          const ridgeTopStart = toWorld(-ridgeEndX, riseM, 0)
          const ridgeTopEnd = toWorld(ridgeEndX, riseM, 0)
          const ridgeClip = clipSegmentAboveHosts(ridgeTopStart, ridgeTopEnd, hostRoofs, 0.015)
          if (ridgeClip && !isTruss && showBeams) {
            const ridgeCenterWorld: [number, number, number] = [
              (ridgeClip.start[0] + ridgeClip.end[0]) / 2,
              (ridgeClip.start[1] + ridgeClip.end[1]) / 2 - 0.09,
              (ridgeClip.start[2] + ridgeClip.end[2]) / 2,
            ]
            const hasPersistedRidge = persistedRidgeBeams.some((rb) => {
              const bs = rb.start as Vec2 | undefined
              const be = rb.end as Vec2 | undefined
              if (!Array.isArray(bs) || !Array.isArray(be)) return false
              const bdx = be[0] - bs[0]
              const bdz = be[1] - bs[1]
              const bLen = Math.hypot(bdx, bdz)
              if (bLen < 0.2) return false
              const dirDot = Math.abs((bdx / bLen) * ridgeAxisWorld[0] + (bdz / bLen) * ridgeAxisWorld[2])
              if (dirDot < 0.85) return false
              const bmx = (bs[0] + be[0]) / 2
              const bmz = (bs[1] + be[1]) / 2
              const ox = bmx - ridgeCenterWorld[0]
              const oz = bmz - ridgeCenterWorld[2]
              const alongDist = Math.abs(ox * ridgeAxisWorld[0] + oz * ridgeAxisWorld[2])
              const perpDist = Math.abs(ox * slopeAxisWorld[0] + oz * slopeAxisWorld[2])
              return perpDist <= 0.6 && alongDist <= Math.max(effWidth * 0.6, 1.5)
            })
            if (!hasPersistedRidge) {
              const ridgeParts = fpClip
                ? clipSegmentToFootprint3D(ridgeClip.start, ridgeClip.end, (x, z) => fpClip(x, z, 0.25), 0.12)
                : [{ start: ridgeClip.start, end: ridgeClip.end }]
              for (const rp of ridgeParts) {
                const rLen = Math.hypot(rp.end[0] - rp.start[0], rp.end[1] - rp.start[1], rp.end[2] - rp.start[2])
                if (rLen > 0.12) {
                  boxes.push({
                    bucket: 'header-lvl',
                    center: [
                      (rp.start[0] + rp.end[0]) / 2,
                      (rp.start[1] + rp.end[1]) / 2 - 0.09,
                      (rp.start[2] + rp.end[2]) / 2,
                    ],
                    size: [rLen, 0.24, 0.089],
                    rotY: effYaw,
                  })
                }
              }
            }
          }
        }

        // 4 diagonal hip rafters from ridge ends (±ridgeEndX, riseM, 0) through corners (±halfW, 0, ±halfRun) to overhang corners
        for (const sx of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            const pHipTop = toWorld(sx * ridgeEndX, riseM, 0)
            const pHipBot = toWorld(sx * (halfW + seg.overhangM), -eaveDropY, sz * (halfRun + seg.overhangM))
            const hipPerpWorld: Vec3Tuple = [
              -sz * cosR + sx * sinR,
              0,
              sz * sinR + sx * cosR,
            ]
            pushClippedStrut('lumber', pHipTop, pHipBot, chordDepthM * 1.15, memberThickM * 1.25, hipPerpWorld, seg.overhangM)
          }
        }

        // Build sorted stations along local X: common stations across [-ridgeEndX, +ridgeEndX] + side-slope hip jacks
        const xStations: number[] = []
        if (ridgeEndX > 0.06) {
          const commonCount = Math.max(2, Math.floor((ridgeEndX * 2) / rafterSpacingM) + 1)
          for (let i = 0; i < commonCount; i++) {
            xStations.push(-ridgeEndX + (ridgeEndX * 2 * i) / Math.max(1, commonCount - 1))
          }
        } else {
          xStations.push(0)
        }
        for (let d = rafterSpacingM; d < hipInset - 0.14; d += rafterSpacingM) {
          xStations.push(-(ridgeEndX + d), ridgeEndX + d)
        }
        xStations.sort((a, b) => a - b)

        for (let si = 0; si < xStations.length; si++) {
          const lx = xStations[si]!
          const absLx = Math.abs(lx)
          if (absLx <= ridgeEndX + 1e-4) {
            // Common rafter station along the central ridge
            const pPeakCenter = toWorld(lx, riseM, 0)
            if (!isPointAboveHosts(pPeakCenter, 0.015)) continue
            const pPeakN = toWorld(lx, riseM, -ridgeHalfThick)
            const pPeakS = toWorld(lx, riseM, ridgeHalfThick)
            const pEaveN = toWorld(lx, -eaveDropY, -(halfRun + seg.overhangM))
            const pEaveS = toWorld(lx, -eaveDropY, halfRun + seg.overhangM)
            const pWallN = toWorld(lx, 0.06, -halfRun)
            const pWallS = toWorld(lx, 0.06, halfRun)

            const emittedN = pushClippedStrut('lumber', pPeakN, pEaveN, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)
            const emittedS = pushClippedStrut('lumber', pPeakS, pEaveS, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)

            const ceilingAboveHosts =
              !isOverFramed ||
              (isPointAboveHosts(pWallN, 0.08) &&
                isPointAboveHosts(pWallS, 0.08) &&
                isPointAboveHosts(toWorld(lx, 0.06, 0), 0.08))
            if (roofSystem !== 'ridge-beam-cathedral' && ceilingAboveHosts) {
              pushClippedStrut('lumber', pWallN, pWallS, 0.14, memberThickM, ridgeAxisWorld, 0.12)
            }
            if (isTruss) {
              const pPeak = toWorld(lx, riseM, 0)
              const pMidN = toWorld(lx, riseM * 0.5, -halfRun * 0.5)
              const pMidS = toWorld(lx, riseM * 0.5, halfRun * 0.5)
              const pBotN = toWorld(lx, 0.06, -halfRun / 3)
              const pBotS = toWorld(lx, 0.06, halfRun / 3)
              pushClippedStrut('lumber', pBotN, pMidN, 0.089, memberThickM, ridgeAxisWorld, 0.12)
              pushClippedStrut('lumber', pBotN, pPeak, 0.089, memberThickM, ridgeAxisWorld, 0.12)
              pushClippedStrut('lumber', pBotS, pPeak, 0.089, memberThickM, ridgeAxisWorld, 0.12)
              pushClippedStrut('lumber', pBotS, pMidS, 0.089, memberThickM, ridgeAxisWorld, 0.12)
            } else if (roofSystem === 'stick-rafter' && si % 2 === 0 && halfRun > 1.2) {
              const tieZ = halfRun * 0.34
              const tieY = riseM * 0.66
              pushClippedStrut('lumber', toWorld(lx, tieY, -tieZ), toWorld(lx, tieY, tieZ), 0.089, memberThickM, ridgeAxisWorld, 0.12)
            }
            if (showConnectors) {
              const pTieN = toWorld(lx, 0.02, -halfRun + 0.04)
              const pTieS = toWorld(lx, 0.02, halfRun - 0.04)
              if (emittedN && isPointAboveHosts(pTieN, 0.06) && inFootprint(pTieN, 0.25)) {
                boxes.push({ bucket: 'galv-steel', center: pTieN, size: [0.058, 0.14, 0.06], rotY: effYaw })
              }
              if (emittedS && isPointAboveHosts(pTieS, 0.06) && inFootprint(pTieS, 0.25)) {
                boxes.push({ bucket: 'galv-steel', center: pTieS, size: [0.058, 0.14, 0.06], rotY: effYaw })
              }
            }
          } else {
            // Side-slope hip jack rafters strictly tapered to the diagonal hip plane (ZERO gable protrusion!)
            const dX = halfW - absLx
            if (dX < 0.14) continue
            const lzHip = Math.max(0.02, halfRun - dX)
            const yHip = dX * effSlopeTan
            const pJackTopN = toWorld(lx, yHip, -lzHip)
            const pJackBotN = toWorld(lx, -eaveDropY, -(halfRun + seg.overhangM))
            const pJackTopS = toWorld(lx, yHip, lzHip)
            const pJackBotS = toWorld(lx, -eaveDropY, halfRun + seg.overhangM)

            const emittedN = pushClippedStrut('lumber', pJackTopN, pJackBotN, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)
            const emittedS = pushClippedStrut('lumber', pJackTopS, pJackBotS, chordDepthM, memberThickM, ridgeAxisWorld, seg.overhangM)
            if (roofSystem !== 'ridge-beam-cathedral' && yHip > 0.18) {
              pushClippedStrut('lumber', toWorld(lx, 0.06, -halfRun + 0.08), toWorld(lx, 0.06, halfRun - 0.08), 0.14, memberThickM, ridgeAxisWorld, 0.12)
            }
            if (showConnectors) {
              const pTieN = toWorld(lx, 0.02, -halfRun + 0.04)
              const pTieS = toWorld(lx, 0.02, halfRun - 0.04)
              if (emittedN && isPointAboveHosts(pTieN, 0.06) && inFootprint(pTieN, 0.25)) {
                boxes.push({ bucket: 'galv-steel', center: pTieN, size: [0.058, 0.14, 0.06], rotY: effYaw })
              }
              if (emittedS && isPointAboveHosts(pTieS, 0.06) && inFootprint(pTieS, 0.25)) {
                boxes.push({ bucket: 'galv-steel', center: pTieS, size: [0.058, 0.14, 0.06], rotY: effYaw })
              }
            }
          }
        }

        // End-slope hip jack rafters at BOTH hip ends (spanning along local X from hip rafters down to ±halfW eaves)
        const endZStations: number[] = [0]
        for (let zOff = rafterSpacingM; zOff < halfRun - 0.14; zOff += rafterSpacingM) {
          endZStations.push(-zOff, zOff)
        }
        for (const sx of [-1, 1] as const) {
          for (const lz of endZStations) {
            const dZ = halfRun - Math.abs(lz)
            if (dZ < 0.14) continue
            const lxHip = sx * (halfW - dZ)
            const yHip = dZ * effSlopeTan
            const pTop = toWorld(lxHip, yHip, lz)
            const pBot = toWorld(sx * (halfW + seg.overhangM), -eaveDropY, lz)
            const emitted = pushClippedStrut('lumber', pTop, pBot, chordDepthM, memberThickM, slopeAxisWorld, seg.overhangM)
            if (showConnectors && emitted) {
              const pTie = toWorld(sx * (halfW - 0.04), 0.02, lz)
              if (isPointAboveHosts(pTie, 0.06) && inFootprint(pTie, 0.25)) {
                boxes.push({ bucket: 'galv-steel', center: pTie, size: [0.058, 0.14, 0.06], rotY: effYaw + Math.PI / 2 })
              }
            }
          }
        }
        emitRaisedHeelEdge(-halfW, -halfRun, halfW, -halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, halfRun, halfW, halfRun, slopeAxisWorld)
        emitRaisedHeelEdge(-halfW, -halfRun, -halfW, halfRun, ridgeAxisWorld)
        emitRaisedHeelEdge(halfW, -halfRun, halfW, halfRun, ridgeAxisWorld)
        continue
      }

      // 3f. GABLE & GAMBREL ROOFS: ridge along local X (widthM) at lz = 0; slopes face -Z and +Z (halfRun = depthM / 2)
      const riseM = frame.riseM
      const slopeTan = frame.effSlopeTan
      const ridgeHalfThick = isTruss ? 0 : 0.0445 // rafters butt cleanly against ridge beam face
      const eaveDropY = seg.overhangM * slopeTan

      // Clip ridge line against any dominating host roof so over-framed ridges stop flush on the valley intersection
      const ridgeTopStart = toWorld(-halfW, riseM, 0)
      const ridgeTopEnd = toWorld(halfW, riseM, 0)
      const ridgeClip = clipSegmentAboveHosts(ridgeTopStart, ridgeTopEnd, hostRoofs, 0.015)
      if (!ridgeClip) continue

      // Structural LVL / Glulam Ridge Beam (for stick rafters & cathedral), honoring vis.beams & avoiding duplicates with persisted ridge beams
      const ridgeCenterWorld: [number, number, number] = [
        (ridgeClip.start[0] + ridgeClip.end[0]) / 2,
        (ridgeClip.start[1] + ridgeClip.end[1]) / 2 - 0.09,
        (ridgeClip.start[2] + ridgeClip.end[2]) / 2,
      ]
      const hasPersistedRidge = persistedRidgeBeams.some((rb) => {
        const bs = rb.start as Vec2 | undefined
        const be = rb.end as Vec2 | undefined
        if (!Array.isArray(bs) || !Array.isArray(be)) return false
        const bdx = be[0] - bs[0]
        const bdz = be[1] - bs[1]
        const bLen = Math.hypot(bdx, bdz)
        if (bLen < 0.2) return false
        // Require direction alignment (|dot| >= 0.85) so a main E-W ridge never suppresses a perpendicular N-S cross-gable ridge
        const dirDot = Math.abs((bdx / bLen) * ridgeAxisWorld[0] + (bdz / bLen) * ridgeAxisWorld[2])
        if (dirDot < 0.85) return false
        const bmx = (bs[0] + be[0]) / 2
        const bmz = (bs[1] + be[1]) / 2
        const ox = bmx - ridgeCenterWorld[0]
        const oz = bmz - ridgeCenterWorld[2]
        const alongDist = Math.abs(ox * ridgeAxisWorld[0] + oz * ridgeAxisWorld[2])
        const perpDist = Math.abs(ox * slopeAxisWorld[0] + oz * slopeAxisWorld[2])
        return perpDist <= 0.6 && alongDist <= Math.max(effWidth * 0.6, 1.5)
      })
      if (!isTruss && showBeams && !hasPersistedRidge) {
        const ridgeParts = fpClip
          ? clipSegmentToFootprint3D(
              ridgeClip.start,
              ridgeClip.end,
              (x, z) => fpClip(x, z, 0.25),
              0.12,
            )
          : [{ start: ridgeClip.start, end: ridgeClip.end }]
        for (const rp of ridgeParts) {
          const rLen = Math.hypot(
            rp.end[0] - rp.start[0],
            rp.end[1] - rp.start[1],
            rp.end[2] - rp.start[2],
          )
          if (rLen > 0.12) {
            boxes.push({
              bucket: 'header-lvl',
              center: [
                (rp.start[0] + rp.end[0]) / 2,
                (rp.start[1] + rp.end[1]) / 2 - 0.09,
                (rp.start[2] + rp.end[2]) / 2,
              ],
              size: [rLen, 0.24, 0.089],
              rotY: effYaw,
            })
          }
        }
      }

      const valleyPtsN: Vec3Tuple[] = []
      const valleyPtsS: Vec3Tuple[] = []

      const count = Math.max(2, Math.floor(effWidth / rafterSpacingM) + 1)
      for (let i = 0; i < count; i++) {
        const lx = -halfW + (effWidth * i) / Math.max(1, count - 1)

        // Skip stations whose ridge peak is buried completely underneath a dominating host roof
        const pPeakCenter = toWorld(lx, riseM, 0)
        if (!isPointAboveHosts(pPeakCenter, 0.015)) continue

        // Exact peak & eave overhang endpoints (overhang extends ONLY downhill — zero X-cross at ridge!)
        const pPeakN = toWorld(lx, riseM, -ridgeHalfThick)
        const pPeakS = toWorld(lx, riseM, ridgeHalfThick)
        const pEaveN = toWorld(lx, -eaveDropY, -(halfRun + seg.overhangM))
        const pEaveS = toWorld(lx, -eaveDropY, halfRun + seg.overhangM)
        const pWallN = toWorld(lx, 0.06, -halfRun)
        const pWallS = toWorld(lx, 0.06, halfRun)

        // North (-Z) and South (+Z) sloped rafters / valley jack rafters (clipped to host roof planes AND fallback enclosed footprint!)
        const clipN = clipSegmentAboveHosts(pPeakN, pEaveN, hostRoofs, 0.015)
        const clipS = clipSegmentAboveHosts(pPeakS, pEaveS, hostRoofs, 0.015)
        const emitFootprintClipped = (
          clip: { start: Vec3Tuple; end: Vec3Tuple; clippedEnd: boolean } | null,
          depthM: number,
          marginM: number,
          valleyPts?: Vec3Tuple[],
        ): boolean => {
          if (!clip) return false
          if (!fpClip) {
            pushStrut('lumber', clip.start, clip.end, depthM, memberThickM, ridgeAxisWorld)
            if (valleyPts && isOverFramed && clip.clippedEnd) valleyPts.push(clip.end)
            return true
          }
          const subSegs = clipSegmentToFootprint3D(clip.start, clip.end, (x, z) => fpClip(x, z, marginM), 0.14)
          for (const ss of subSegs) {
            pushStrut('lumber', ss.start, ss.end, depthM, memberThickM, ridgeAxisWorld)
          }
          return subSegs.length > 0
        }

        const emittedN = emitFootprintClipped(clipN, chordDepthM, seg.overhangM, valleyPtsN)
        const emittedS = emitFootprintClipped(clipS, chordDepthM, seg.overhangM, valleyPtsS)

        // Ceiling joist / bottom truss chord (omit when buried inside an over-framed host roof cavity; clip to enclosed footprint on fallback!)
        const ceilingAboveHosts =
          !isOverFramed ||
          (isPointAboveHosts(pWallN, 0.08) &&
            isPointAboveHosts(pWallS, 0.08) &&
            isPointAboveHosts(toWorld(lx, 0.06, 0), 0.08))
        if (roofSystem !== 'ridge-beam-cathedral' && ceilingAboveHosts) {
          if (roofSystem === 'scissor-truss') {
            const scPeak = toWorld(lx, riseM * 0.45, 0)
            if (fpClip) {
              for (const ss of clipSegmentToFootprint3D(pWallN, scPeak, (x, z) => fpClip(x, z, 0.12), 0.14)) {
                pushStrut('lumber', ss.start, ss.end, 0.089, memberThickM, ridgeAxisWorld)
              }
              for (const ss of clipSegmentToFootprint3D(scPeak, pWallS, (x, z) => fpClip(x, z, 0.12), 0.14)) {
                pushStrut('lumber', ss.start, ss.end, 0.089, memberThickM, ridgeAxisWorld)
              }
            } else {
              pushStrut('lumber', pWallN, scPeak, 0.089, memberThickM, ridgeAxisWorld)
              pushStrut('lumber', scPeak, pWallS, 0.089, memberThickM, ridgeAxisWorld)
            }
          } else if (fpClip) {
            for (const ss of clipSegmentToFootprint3D(pWallN, pWallS, (x, z) => fpClip(x, z, 0.12), 0.14)) {
              pushStrut('lumber', ss.start, ss.end, 0.14, memberThickM, ridgeAxisWorld)
            }
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

          const pushClippedWeb = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
            const c = clipSegmentAboveHosts(a, b, hostRoofs, 0.015)
            if (!c) return
            if (fpClip) {
              for (const ss of clipSegmentToFootprint3D(c.start, c.end, (x, z) => fpClip(x, z, 0.12), 0.14)) {
                pushStrut('lumber', ss.start, ss.end, 0.089, memberThickM, ridgeAxisWorld)
              }
            } else {
              pushStrut('lumber', c.start, c.end, 0.089, memberThickM, ridgeAxisWorld)
            }
          }

          if (roofSystem === 'attic-truss') {
            // Attic room knee walls + collar ceiling beam
            const roomZ = halfRun * 0.45
            const roomTopY = riseM * (1 - 0.45)
            pushClippedWeb(toWorld(lx, 0.06, -roomZ), toWorld(lx, roomTopY, -roomZ))
            pushClippedWeb(toWorld(lx, 0.06, roomZ), toWorld(lx, roomTopY, roomZ))
            pushClippedWeb(toWorld(lx, roomTopY, -roomZ), toWorld(lx, roomTopY, roomZ))
          } else {
            // Classic 4-strut Fink W-web: BN->MN, BN->Peak, BS->Peak, BS->MS
            pushClippedWeb(pBotN, pMidN)
            pushClippedWeb(pBotN, pPeak)
            pushClippedWeb(pBotS, pPeak)
            pushClippedWeb(pBotS, pMidS)
          }

          // Galvanized steel truss gusset connector plates at Peak, Heels & Panel Points (only where above host roofs & inside footprint)
          const pPeakPlate = toWorld(lx, riseM - 0.06, 0)
          const pHeelN = toWorld(lx, 0.07, -halfRun + 0.14)
          const pHeelS = toWorld(lx, 0.07, halfRun - 0.14)
          if (isPointAboveHosts(pPeakPlate, 0.08) && inFootprint(pPeakPlate, 0.15)) {
            boxes.push({ bucket: 'galv-steel', center: pPeakPlate, size: [0.048, 0.14, 0.22], rotY: effYaw })
          }
          if (isPointAboveHosts(pHeelN, 0.08) && inFootprint(pHeelN, 0.15)) {
            boxes.push({ bucket: 'galv-steel', center: pHeelN, size: [0.048, 0.10, 0.20], rotY: effYaw })
          }
          if (isPointAboveHosts(pHeelS, 0.08) && inFootprint(pHeelS, 0.15)) {
            boxes.push({ bucket: 'galv-steel', center: pHeelS, size: [0.048, 0.10, 0.20], rotY: effYaw })
          }
          if (isPointAboveHosts(pBotN, 0.05) && inFootprint(pBotN, 0.15)) {
            boxes.push({ bucket: 'galv-steel', center: pBotN, size: [0.048, 0.11, 0.14], rotY: effYaw })
          }
          if (isPointAboveHosts(pBotS, 0.05) && inFootprint(pBotS, 0.15)) {
            boxes.push({ bucket: 'galv-steel', center: pBotS, size: [0.048, 0.11, 0.14], rotY: effYaw })
          }
        } else if (roofSystem === 'stick-rafter' && i % 2 === 0 && halfRun > 1.2) {
          // Upper-third collar tie per IRC R802.4.6 (only emit when fully clear above host roof & inside enclosed footprint)
          const tieZ = halfRun * 0.34
          const tieY = riseM * 0.66
          const tieA = toWorld(lx, tieY, -tieZ)
          const tieB = toWorld(lx, tieY, tieZ)
          const tieClip = clipSegmentAboveHosts(tieA, tieB, hostRoofs, 0.015)
          if (tieClip && !tieClip.clippedStart && !tieClip.clippedEnd) {
            if (fpClip) {
              for (const ss of clipSegmentToFootprint3D(tieClip.start, tieClip.end, (x, z) => fpClip(x, z, 0.12), 0.14)) {
                pushStrut('lumber', ss.start, ss.end, 0.089, memberThickM, ridgeAxisWorld)
              }
            } else {
              pushStrut('lumber', tieClip.start, tieClip.end, 0.089, memberThickM, ridgeAxisWorld)
            }
          }
        }

        // VIS-V3-08 / Polish B / Zero-Gap Bearing Extension: Gable-end vertical rake studs at exposed
        // exterior gable/gambrel ends extending continuously down to `-seg.heelHeightM` (resting directly
        // on the double top plate!) up to the sloped rafter underside (suppressing interior valley throats).
        if ((i === 0 || i === count - 1) && (seg.roofType === 'gable' || seg.roofType === 'gambrel')) {
          const rakeBotY = seg.heelHeightM > 0.03 ? -seg.heelHeightM : 0
          let emittedAnyRakeStud = false
          for (let gz = -halfRun + studSpacingM; gz <= halfRun - studSpacingM + 1e-4; gz += studSpacingM) {
            const studTopY = riseM * (1 - Math.abs(gz) / halfRun) - chordDepthM * 0.5
            if (studTopY - rakeBotY <= 0.18) continue
            const studTopWorld = toWorld(lx, studTopY, gz)
            if (fpClip && !fpClip(studTopWorld[0], studTopWorld[2], 0.15)) continue
            if (!isPointAboveHosts(studTopWorld, 0.03)) continue
            const hostY = isOverFramed ? hostSurfaceYAt(studTopWorld[0], studTopWorld[2], hostRoofs) : null
            // If this gable end sits mid-slope above the host roof (interior valley termination), do NOT block the attic throat!
            // Keep exterior flush gable ends where hostY is null or sits right at eave/plate level (hostY <= seg.cy + 0.12).
            if (hostY !== null && hostY > seg.cy + 0.12) continue
            pushStrut('lumber', toWorld(lx, rakeBotY, gz), studTopWorld, 0.089, memberThickM, ridgeAxisWorld)
            emittedAnyRakeStud = true
          }
          if (seg.heelHeightM > 0.03 && emittedAnyRakeStud) {
            const botPlateY = -seg.heelHeightM + 0.019
            pushClippedStrut('lumber', toWorld(lx, botPlateY, -halfRun), toWorld(lx, botPlateY, halfRun), 0.0381, 0.089, ridgeAxisWorld, 0.15)
          }
        }

        // Distributed H2.5A / H10A Galvanized Hurricane Ties at wall bearing seats (skip mid-roof valley terminations & unenclosed cutouts!)
        if (showConnectors) {
          const pTieN = toWorld(lx, 0.02, -halfRun + 0.04)
          const pTieS = toWorld(lx, 0.02, halfRun - 0.04)
          if (
            emittedN &&
            clipN &&
            (!fpClip || fpClip(pTieN[0], pTieN[2], 0.25)) &&
            (!isOverFramed || (!clipN.clippedEnd && isPointAboveHosts(pTieN, 0.06)))
          ) {
            boxes.push({ bucket: 'galv-steel', center: pTieN, size: [0.058, 0.14, 0.06], rotY: effYaw })
          }
          if (
            emittedS &&
            clipS &&
            (!fpClip || fpClip(pTieS[0], pTieS[2], 0.25)) &&
            (!isOverFramed || (!clipS.clippedEnd && isPointAboveHosts(pTieS, 0.06)))
          ) {
            boxes.push({ bucket: 'galv-steel', center: pTieS, size: [0.058, 0.14, 0.06], rotY: effYaw })
          }
        }
      }

      // Polish B: Raised-heel eave knee-walls along both gable/gambrel bearing eaves when `wallHeightM > 0.03`
      emitRaisedHeelEdge(-halfW, -halfRun, halfW, -halfRun, slopeAxisWorld)
      emitRaisedHeelEdge(-halfW, halfRun, halfW, halfRun, slopeAxisWorld)

      // Emit diagonal California Over-Frame Valley Sleepers / Valley Rafters joining the clipped jack rafters
      // cleanly from the low eave valley corner up to every ridge-to-host apex (handles one-sided, two-sided
      // U/saddle, AND equal-peak L/T intersections where ridge endpoints touch the host surface at t=0 or t=1).
      if (isOverFramed) {
        const startHostY = hostSurfaceYAt(ridgeClip.start[0], ridgeClip.start[2], hostRoofs)
        const endHostY = hostSurfaceYAt(ridgeClip.end[0], ridgeClip.end[2], hostRoofs)
        const startTouchesHost =
          ridgeClip.clippedStart || (startHostY !== null && Math.abs(ridgeClip.start[1] - startHostY) <= 0.08)
        const endTouchesHost =
          ridgeClip.clippedEnd || (endHostY !== null && Math.abs(ridgeClip.end[1] - endHostY) <= 0.08)

        const emitValleySleeper = (pts: Vec3Tuple[]) => {
          if (pts.length === 0) return
          let lowPt = pts[0]!
          let highPt = pts[0]!
          for (const pt of pts) {
            if (pt[1] < lowPt[1]) lowPt = pt
            if (pt[1] > highPt[1]) highPt = pt
          }
          const pairs: Array<[Vec3Tuple, Vec3Tuple]> = []
          if (startTouchesHost && endTouchesHost) {
            pairs.push([ridgeClip.start, lowPt], [lowPt, ridgeClip.end])
          } else if (startTouchesHost) {
            pairs.push([ridgeClip.start, lowPt])
          } else if (endTouchesHost) {
            pairs.push([lowPt, ridgeClip.end])
          } else if (pts.length >= 2) {
            pairs.push([highPt, lowPt])
          }
          for (const [p0, p1] of pairs) {
            if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) >= 0.25) {
              pushStrut('header-lvl', p0, p1, 0.14, 0.05, slopeAxisWorld)
            }
          }
        }
        emitValleySleeper(valleyPtsN)
        emitValleySleeper(valleyPtsS)
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
