/**
 * Shared Pascal wall-opening & level-footprint geometry extractor.
 *
 * Delegates canonical spatial anatomy extraction to `@kruschdev/pascal-mep-kernel`
 * while preserving 100% backwards-compatible structural framing exports & signatures.
 * Handles BOTH native `door`/`window` nodes AND Pascal's standard wall-attached
 * `item` nodes (`asset.category === 'door' | 'window'` with `asset.dimensions`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type CanonicalWallOpening,
  type SceneNodeLike as KernelSceneNodeLike,
  classifyOpeningKind as kernelClassifyOpeningKind,
  clusterLevelFootprints as kernelClusterLevelFootprints,
  extractCanonicalWallOpenings,
  resolveWallHeightM as kernelResolveWallHeightM,
} from '@kruschdev/pascal-mep-kernel'
import { type SceneNodeLike, belongsToLevel } from './tables'

/**
 * Resolve a wall's true height in meters: explicit `wall.height` -> enclosing `level.height` -> fallback.
 * Commercial scenes (e.g. 5 m double-height halls) often omit `wall.height` and rely on `level.height`.
 */
export function resolveWallHeightM(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  wall: SceneNodeLike,
  fallbackM = 2.55,
): number {
  return kernelResolveWallHeightM(
    nodes as Readonly<Record<string, KernelSceneNodeLike>>,
    wall as KernelSceneNodeLike,
    fallbackM,
  )
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
  return kernelClassifyOpeningKind(node as KernelSceneNodeLike)
}

/**
 * Normalize pre-extracted kernel `CanonicalWallOpening[]` into structural framing
 * `(uCenterM, widthM, heightM, sillYM, headYM)` dimensions without rescanning the scene.
 */
export function normalizeCanonicalWallOpenings(
  canonical: readonly CanonicalWallOpening[],
  wallLenM: number,
  wallHeightM: number,
): ExtractedWallOpening[] {
  if (!Number.isFinite(wallLenM) || wallLenM < 0.3 || canonical.length === 0) return []
  return canonical.map((op) => {
    const widthM = Math.max(0.45, Math.min(wallLenM - 0.15, op.widthM))
    const uCenterM = Math.max(widthM / 2 + 0.08, Math.min(wallLenM - widthM / 2 - 0.08, op.uCenterM))
    const sillYM =
      op.kind === 'door'
        ? 0
        : Math.min(Math.max(0.08, wallHeightM - 0.5), op.framedSillYM)
    const heightM = Math.max(0.45, Math.min(wallHeightM - sillYM - 0.12, op.heightM))
    const headYM = Math.min(wallHeightM - 0.1, sillYM + heightM)
    return {
      id: op.id,
      wallId: op.wallId,
      kind: op.kind,
      name: op.name ?? op.kind,
      uCenterM,
      widthM,
      heightM,
      sillYM,
      headYM,
    }
  })
}

/**
 * Extract all doors and windows hosted by a given wall node, normalized to wall-local
 * `(uCenterM, widthM, heightM, sillYM, headYM)`.
 * Uses `framedSillYM` from `@kruschdev/pascal-mep-kernel` so IRC cripple-stud framing stays exact.
 */
export function extractWallOpenings(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  wall: SceneNodeLike,
): ExtractedWallOpening[] {
  if (!Array.isArray(wall.start) || !Array.isArray(wall.end)) return []
  const wallLenM = Math.hypot(
    Number(wall.end[0]) - Number(wall.start[0]),
    Number(wall.end[1]) - Number(wall.start[1]),
  )
  if (!Number.isFinite(wallLenM) || wallLenM < 0.3) return []
  const wallHeightM = resolveWallHeightM(nodes, wall, 2.55)

  const canonical = extractCanonicalWallOpenings(
    nodes as Readonly<Record<string, KernelSceneNodeLike>>,
    wall as KernelSceneNodeLike,
    { wallHeightM },
  )

  return normalizeCanonicalWallOpenings(canonical, wallLenM, wallHeightM)
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
  const clusters = kernelClusterLevelFootprints(
    nodes as Readonly<Record<string, KernelSceneNodeLike>>,
    levelId,
    gapToleranceM,
  )
  if (clusters.length === 0) {
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
  return clusters.map((c) => ({
    minX: c.minX,
    maxX: c.maxX,
    minZ: c.minZ,
    maxZ: c.maxZ,
    widthM: c.widthM,
    depthM: c.depthM,
    avgWallHeightM: c.avgWallHeightM,
    baseElevationM: c.baseElevationM,
  }))
}

/**
 * Compute world-space XZ bounds, average wall height, and base elevation of a level
 * from its visible walls and slabs in a single O(N) pass.
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
    if (n.visible === false) continue
    if (!belongsToLevel(nodes, n, levelId)) continue

    if (n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end)) {
      const sx = Number(n.start[0])
      const sz = Number(n.start[1])
      const ex = Number(n.end[0])
      const ez = Number(n.end[1])
      if (Number.isFinite(sx) && Number.isFinite(sz) && Number.isFinite(ex) && Number.isFinite(ez)) {
        if (sx < minX) minX = sx
        if (ex < minX) minX = ex
        if (sx > maxX) maxX = sx
        if (ex > maxX) maxX = ex
        if (sz < minZ) minZ = sz
        if (ez < minZ) minZ = ez
        if (sz > maxZ) maxZ = sz
        if (ez > maxZ) maxZ = ez
      }
      hSum += resolveWallHeightM(nodes, n, 2.55)
      hCount += 1
      const e = typeof n.elevation === 'number' && Number.isFinite(n.elevation) ? n.elevation : 0
      if (e < minElev) minElev = e
    } else if (n.type === 'slab' && Array.isArray(n.polygon)) {
      for (const pt of n.polygon) {
        if (!Array.isArray(pt) || pt.length < 2) continue
        const x = Number(pt[0])
        const z = Number(pt[1])
        if (Number.isFinite(x) && Number.isFinite(z)) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
        }
      }
      const e = typeof n.elevation === 'number' && Number.isFinite(n.elevation) ? n.elevation : 0
      if (e < minElev) minElev = e
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) {
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
