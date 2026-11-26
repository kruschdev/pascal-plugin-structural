/**
 * Shared Pascal wall-opening & level-footprint geometry extractor.
 *
 * Handles BOTH native `door`/`window` nodes AND Pascal's standard wall-attached
 * `item` nodes (`asset.category === 'door' | 'window'` with `asset.dimensions`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import type { SceneNodeLike, Vec2 } from './tables'

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

export function belongsToStructuralLevel(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  node: SceneNodeLike,
  levelId: string | null,
): boolean {
  if (!levelId) return true
  if (node.id === levelId || node.parentId === levelId) return true
  let cur: SceneNodeLike | undefined = node
  let guard = 0
  while (cur?.parentId && guard < 12) {
    if (cur.parentId === levelId) return true
    cur = nodes[cur.parentId]
    guard += 1
  }
  return false
}

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
  const wallHeightM = typeof wall.height === 'number' && wall.height > 0 ? wall.height : 2.55

  const childIds = new Set<string>(Array.isArray(wall.children) ? (wall.children as string[]) : [])
  const candidates: SceneNodeLike[] = []
  for (const n of Object.values(nodes)) {
    if (n.parentId === wall.id || childIds.has(n.id)) {
      candidates.push(n)
    }
  }

  const out: ExtractedWallOpening[] = []
  for (const o of candidates) {
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
    let uCenterM = wallLenM / 2
    if (pos && typeof pos[0] === 'number' && Number.isFinite(pos[0])) {
      const px = pos[0]
      const pz = typeof pos[2] === 'number' && Number.isFinite(pos[2]) ? pos[2] : 0
      if (Math.abs(pz) < 0.45 && px >= -0.25 && px <= wallLenM + 0.25) {
        uCenterM = px
      } else {
        const ux = (ex - sx) / wallLenM
        const uz = (ez - sz) / wallLenM
        uCenterM = (px - sx) * ux + (pz - sz) * uz
      }
    }
    uCenterM = Math.max(widthM / 2 + 0.08, Math.min(wallLenM - widthM / 2 - 0.08, uCenterM))

    const rawPosY = pos && typeof pos[1] === 'number' && Number.isFinite(pos[1]) ? pos[1] : 0
    const sillYM =
      kind === 'door'
        ? 0
        : Math.max(0.05, Math.min(wallHeightM - 0.5, rawPosY > 0.02 ? rawPosY : 0.9144))
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
 * Compute world-space XZ bounds of a level from its walls and slabs.
 */
export function computeLevelBounds(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  levelId: string | null,
): { minX: number; maxX: number; minZ: number; maxZ: number; avgWallHeightM: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hSum = 0
  let hCount = 0

  for (const n of Object.values(nodes)) {
    if (!belongsToStructuralLevel(nodes, n, levelId)) continue
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
      const h = typeof n.height === 'number' && n.height > 0 ? n.height : 2.55
      hSum += h
      hCount += 1
    } else if (n.type === 'slab' && Array.isArray(n.polygon)) {
      for (const pt of n.polygon as ReadonlyArray<Vec2>) {
        if (Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          minX = Math.min(minX, pt[0])
          maxX = Math.max(maxX, pt[0])
          minZ = Math.min(minZ, pt[1])
          maxZ = Math.max(maxZ, pt[1])
        }
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 9.144, minZ: 0, maxZ: 7.315, avgWallHeightM: 2.7432 }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    avgWallHeightM: hCount > 0 ? hSum / hCount : 2.55,
  }
}
