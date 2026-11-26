/**
 * Shared Pascal wall-opening & level-footprint geometry extractor.
 *
 * Handles BOTH native `door`/`window` nodes AND Pascal's standard wall-attached
 * `item` nodes (`asset.category === 'door' | 'window'` with `asset.dimensions`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { type SceneNodeLike, type Vec2, belongsToLevel, resolveNodeLevelId } from './tables'

/**
 * Resolve a wall's true height in meters: explicit `wall.height` -> enclosing `level.height` -> fallback.
 * Commercial scenes (e.g. 5 m double-height halls) often omit `wall.height` and rely on `level.height`.
 */
export function resolveWallHeightM(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  wall: SceneNodeLike,
  fallbackM = 2.55,
): number {
  if (typeof wall.height === 'number' && Number.isFinite(wall.height) && wall.height > 0) {
    return wall.height
  }
  const hostLevelId = resolveNodeLevelId(nodes, wall)
  const hostLevel = hostLevelId
    ? nodes[hostLevelId]
    : typeof wall.parentId === 'string'
      ? nodes[wall.parentId]
      : undefined
  if (typeof hostLevel?.height === 'number' && Number.isFinite(hostLevel.height) && hostLevel.height > 0) {
    return hostLevel.height
  }
  return fallbackM
}

export type ExtractedWallOpening = {
  id: string
  wallId: string
  kind: 'door' | 'window'
  name: string
  /** Distance from wall.start along wall axis (meters). */
  uCenterM: number
  /** Rough opening width (meters). */
  widthM: number
  /** Rough opening height (meters). */
  heightM: number
  /** Sill elevation above wall base (meters, 0 for doors). */
  sillYM: number
  /** Head elevation above wall base (meters). */
  headYM: number
}

export type FootprintCluster = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  widthM: number
  depthM: number
  avgWallHeightM: number
  baseElevationM: number
}

/** Backwards-compatible alias for canonical `belongsToLevel` from `./tables`. */
export const belongsToStructuralLevel = belongsToLevel

export function classifyOpeningKind(node: SceneNodeLike): 'door' | 'window' | null {
  if (node.type === 'door') return 'door'
  if (node.type === 'window') return 'window'
  if (node.type === 'item') {
    const asset = node.asset as Record<string, unknown> | undefined
    const cat = typeof asset?.category === 'string' ? asset.category.toLowerCase() : ''
    if (cat === 'door') return 'door'
    if (cat === 'window') return 'window'
    const name = `${String(node.name ?? '')} ${String(asset?.id ?? '')}`.toLowerCase()
    if (/\bdoor\b|garage-door|sliding-door|patio-door/.test(name)) return 'door'
    if (/\bwindow\b/.test(name)) return 'window'
  }
  return null
}

/**
 * Extract all doors and windows hosted by a given wall node, normalized to wall-local
 * `(uCenterM, widthM, heightM, sillYM, headYM)`.
 */
export function extractWallOpenings(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  wall: SceneNodeLike,
): ExtractedWallOpening[] {
  if (!Array.isArray(wall.start) || !Array.isArray(wall.end)) return []
  const sx = Number(wall.start[0])
  const sz = Number(wall.start[1])
  const ex = Number(wall.end[0])
  const ez = Number(wall.end[1])
  const wallLenM = Math.hypot(ex - sx, ez - sz)
  if (!Number.isFinite(wallLenM) || wallLenM < 0.3) return []
  const wallHeightM = resolveWallHeightM(nodes, wall, 2.55)

  const childIds = new Set<string>(Array.isArray(wall.children) ? (wall.children as string[]) : [])
  const candidates: SceneNodeLike[] = []
  for (const n of Object.values(nodes)) {
    if (n.parentId === wall.id || childIds.has(n.id)) {
      candidates.push(n)
    }
  }

  const out: ExtractedWallOpening[] = []
  for (const o of candidates) {
    if (o.visible === false) continue
    const kind = classifyOpeningKind(o)
    if (!kind) continue

    const asset = o.asset as Record<string, unknown> | undefined
    const dims = Array.isArray(asset?.dimensions) ? (asset.dimensions as number[]) : undefined
    const scale = Array.isArray(o.scale) ? (o.scale as number[]) : [1, 1, 1]
    const sxScale = typeof scale[0] === 'number' && scale[0] > 0 ? scale[0] : 1
    const syScale = typeof scale[1] === 'number' && scale[1] > 0 ? scale[1] : 1

    const rawW =
      typeof o.width === 'number' && o.width > 0
        ? o.width
        : dims && typeof dims[0] === 'number' && dims[0] > 0
          ? dims[0] * sxScale
          : kind === 'door'
            ? 0.9144
            : 1.2192
    const rawH =
      typeof o.height === 'number' && o.height > 0
        ? o.height
        : dims && typeof dims[1] === 'number' && dims[1] > 0
          ? dims[1] * syScale
          : kind === 'door'
            ? 2.0828
            : 1.2192

    const widthM = Math.max(0.45, Math.min(wallLenM - 0.15, rawW))
    const pos = Array.isArray(o.position) ? (o.position as number[]) : undefined
    const rot = Array.isArray(o.rotation) ? (o.rotation as number[]) : [0, 0, 0]
    const itemRotY = typeof rot[1] === 'number' && Number.isFinite(rot[1]) ? rot[1] : 0
    const assetOffset = Array.isArray(asset?.offset) ? (asset.offset as number[]) : undefined
    let uCenterM = wallLenM / 2
    if (pos && typeof pos[0] === 'number' && Number.isFinite(pos[0])) {
      const px = pos[0]
      const pz = typeof pos[2] === 'number' && Number.isFinite(pos[2]) ? pos[2] : 0
      if (Math.abs(pz) < 0.45 && px >= -0.25 && px <= wallLenM + 0.25) {
        uCenterM = px
        if (o.type === 'item' && assetOffset) {
          const ox = typeof assetOffset[0] === 'number' && Number.isFinite(assetOffset[0]) ? assetOffset[0] : 0
          const oz = typeof assetOffset[2] === 'number' && Number.isFinite(assetOffset[2]) ? assetOffset[2] : 0
          uCenterM += ox * Math.cos(itemRotY) + oz * Math.sin(itemRotY)
        }
      } else {
        const ux = (ex - sx) / wallLenM
        const uz = (ez - sz) / wallLenM
        uCenterM = (px - sx) * ux + (pz - sz) * uz
      }
    }
    uCenterM = Math.max(widthM / 2 + 0.08, Math.min(wallLenM - widthM / 2 - 0.08, uCenterM))

    const rawPosY = pos && typeof pos[1] === 'number' && Number.isFinite(pos[1]) ? pos[1] : 0
    const rawHeightClamped = Math.max(0.45, Math.min(wallHeightM - 0.18, rawH))
    // Native Pascal `window` stores center height in position[1]; legacy `item` stores base Y
    const sillYM =
      kind === 'door'
        ? 0
        : o.type === 'window'
          ? Math.max(
              0.08,
              Math.min(
                wallHeightM - rawHeightClamped - 0.12,
                typeof o.sillHeight === 'number'
                  ? o.sillHeight
                  : rawPosY > 0.05
                    ? rawPosY - rawHeightClamped / 2
                    : 0.9144,
              ),
            )
          : Math.max(0.08, Math.min(wallHeightM - 0.5, rawPosY > 0.02 ? rawPosY : 0.9144))
    const heightM = Math.max(0.45, Math.min(wallHeightM - sillYM - 0.12, rawH))
    const headYM = Math.min(wallHeightM - 0.1, sillYM + heightM)

    out.push({
      id: o.id,
      wallId: wall.id,
      kind,
      name: String(o.name ?? asset?.name ?? kind),
      uCenterM,
      widthM,
      heightM,
      sillYM,
      headYM,
    })
  }

  out.sort((a, b) => a.uCenterM - b.uCenterM)
  return out
}

/**
 * Merge overlapping/adjacent 2D axis-aligned boxes transitively (fixed-point connected components)
 * so room iteration order `[A, C, B]` always merges into one unified building envelope while
 * genuinely detached structures remain separate clusters.
 */
function mergeConnectedBoxes(
  boxes: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number }>,
  gapToleranceM: number,
): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const clusters = boxes.map((b) => ({ ...b }))
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i]!
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j]!
        if (
          a.minX <= b.maxX + gapToleranceM &&
          a.maxX >= b.minX - gapToleranceM &&
          a.minZ <= b.maxZ + gapToleranceM &&
          a.maxZ >= b.minZ - gapToleranceM
        ) {
          a.minX = Math.min(a.minX, b.minX)
          a.maxX = Math.max(a.maxX, b.maxX)
          a.minZ = Math.min(a.minZ, b.minZ)
          a.maxZ = Math.max(a.maxZ, b.maxZ)
          clusters.splice(j, 1)
          merged = true
          break
        }
      }
      if (merged) break
    }
  }
  return clusters
}

/**
 * Partition slabs and walls on a level into connected building footprint clusters.
 * Guarantees detached rooms/buildings on the same level never bridge empty yard with
 * a single giant roof, girder, or ridge beam.
 */
export function clusterLevelFootprints(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
  gapToleranceM = 0.35,
): FootprintCluster[] {
  const levelNodes = Object.values(nodes).filter((n) => belongsToLevel(nodes, n, levelId))
  const walls = levelNodes.filter(
    (n) => n.type === 'wall' && n.visible !== false && Array.isArray(n.start) && Array.isArray(n.end),
  )
  const slabs = levelNodes.filter(
    (n) => n.type === 'slab' && n.visible !== false && Array.isArray(n.polygon) && (n.polygon as Vec2[]).length >= 3,
  )

  const slabBoxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; elev: number }> = []
  for (const slab of slabs) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const [px, pz] of slab.polygon as ReadonlyArray<Vec2>) {
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (pz < minZ) minZ = pz
        if (pz > maxZ) maxZ = pz
      }
    }
    if (Number.isFinite(minX) && maxX - minX > 0.5 && maxZ - minZ > 0.5) {
      const elev = typeof slab.elevation === 'number' && Number.isFinite(slab.elevation) ? slab.elevation : 0
      slabBoxes.push({ minX, maxX, minZ, maxZ, elev })
    }
  }
  const seedBoxes = slabBoxes.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }))

  // Also include wall-only structures not covered by any slab
  const wallBoxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; height: number; elev: number }> = []
  for (const w of walls) {
    const sx = Number(w.start![0])
    const sz = Number(w.start![1])
    const ex = Number(w.end![0])
    const ez = Number(w.end![1])
    if (!Number.isFinite(sx) || !Number.isFinite(sz) || !Number.isFinite(ex) || !Number.isFinite(ez)) continue
    const wb = {
      minX: Math.min(sx, ex),
      maxX: Math.max(sx, ex),
      minZ: Math.min(sz, ez),
      maxZ: Math.max(sz, ez),
      height: resolveWallHeightM(nodes, w, 2.55),
      elev: typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0,
    }
    wallBoxes.push(wb)
    const touchesSlab = slabBoxes.some(
      (sb) =>
        wb.minX <= sb.maxX + gapToleranceM &&
        wb.maxX >= sb.minX - gapToleranceM &&
        wb.minZ <= sb.maxZ + gapToleranceM &&
        wb.maxZ >= sb.minZ - gapToleranceM,
    )
    if (!touchesSlab) {
      seedBoxes.push({ minX: wb.minX, maxX: wb.maxX, minZ: wb.minZ, maxZ: wb.maxZ })
    }
  }

  const merged = mergeConnectedBoxes(seedBoxes, gapToleranceM)
  if (merged.length === 0) {
    const b = computeLevelBounds(nodes, levelId)
    return [
      {
        minX: b.minX,
        maxX: b.maxX,
        minZ: b.minZ,
        maxZ: b.maxZ,
        widthM: Math.max(0, b.maxX - b.minX),
        depthM: Math.max(0, b.maxZ - b.minZ),
        avgWallHeightM: b.avgWallHeightM,
        baseElevationM: b.baseElevationM,
      },
    ]
  }

  const globalAvgH =
    wallBoxes.length > 0 ? wallBoxes.reduce((s, w) => s + w.height, 0) / wallBoxes.length : 2.55

  return merged
    .filter((c) => c.maxX - c.minX > 0.5 && c.maxZ - c.minZ > 0.5)
    .map((c) => {
      let hSum = 0
      let hCount = 0
      let minElev = Number.POSITIVE_INFINITY
      for (const wb of wallBoxes) {
        if (
          wb.minX <= c.maxX + gapToleranceM &&
          wb.maxX >= c.minX - gapToleranceM &&
          wb.minZ <= c.maxZ + gapToleranceM &&
          wb.maxZ >= c.minZ - gapToleranceM
        ) {
          hSum += wb.height
          hCount += 1
          if (wb.elev < minElev) minElev = wb.elev
        }
      }
      for (const sb of slabBoxes) {
        if (
          sb.minX <= c.maxX + gapToleranceM &&
          sb.maxX >= c.minX - gapToleranceM &&
          sb.minZ <= c.maxZ + gapToleranceM &&
          sb.maxZ >= c.minZ - gapToleranceM
        ) {
          if (sb.elev < minElev) minElev = sb.elev
        }
      }
      return {
        minX: c.minX,
        maxX: c.maxX,
        minZ: c.minZ,
        maxZ: c.maxZ,
        widthM: c.maxX - c.minX,
        depthM: c.maxZ - c.minZ,
        avgWallHeightM: hCount > 0 ? hSum / hCount : globalAvgH,
        baseElevationM: Number.isFinite(minElev) ? minElev : 0,
      }
    })
}

/**
 * Compute world-space XZ bounds of a level from its walls and slabs.
 */
export function computeLevelBounds(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
): { minX: number; maxX: number; minZ: number; maxZ: number; avgWallHeightM: number; baseElevationM: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hSum = 0
  let hCount = 0
  let minElev = Number.POSITIVE_INFINITY

  for (const n of Object.values(nodes)) {
    if (!belongsToLevel(nodes, n, levelId)) continue
    if (n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end)) {
      const sx = Number(n.start[0])
      const sz = Number(n.start[1])
      const ex = Number(n.end[0])
      const ez = Number(n.end[1])
      if (Number.isFinite(sx) && Number.isFinite(sz) && Number.isFinite(ex) && Number.isFinite(ez)) {
        minX = Math.min(minX, sx, ex)
        maxX = Math.max(maxX, sx, ex)
        minZ = Math.min(minZ, sz, ez)
        maxZ = Math.max(maxZ, sz, ez)
      }
      const h = resolveWallHeightM(nodes, n, 2.55)
      hSum += h
      hCount += 1
      const e = typeof n.elevation === 'number' && Number.isFinite(n.elevation) ? n.elevation : 0
      if (e < minElev) minElev = e
    } else if (n.type === 'slab' && Array.isArray(n.polygon)) {
      for (const pt of n.polygon as ReadonlyArray<Vec2>) {
        if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          minX = Math.min(minX, pt[0])
          maxX = Math.max(maxX, pt[0])
          minZ = Math.min(minZ, pt[1])
          maxZ = Math.max(maxZ, pt[1])
        }
      }
      const e = typeof n.elevation === 'number' && Number.isFinite(n.elevation) ? n.elevation : 0
      if (e < minElev) minElev = e
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 9.144, minZ: 0, maxZ: 7.315, avgWallHeightM: 2.7432, baseElevationM: 0 }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    avgWallHeightM: hCount > 0 ? hSum / hCount : 2.55,
    baseElevationM: Number.isFinite(minElev) ? minElev : 0,
  }
}
