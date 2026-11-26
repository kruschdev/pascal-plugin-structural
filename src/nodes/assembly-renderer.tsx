/**
 * Live reactive React-Three-Fiber parametric renderer for `structural:assembly`.
 *
 * Subscribes to Pascal's `@pascal-app/core` `useScene` store (zero `@pascal-app/editor` imports —
 * 100% render-safe!) and renders the complete full-building 3D IRC/AWC/NDS framing skeleton
 * (walls, framed door/window openings with king/jack/header/sill/cripple studs, TJI/truss/dimensional
 * floor joists, stick rafters or prefab roof trusses, strip footings, and distributed Simpson-class
 * hardware) via high-speed batched `InstancedMesh` draw calls.
 */

import { useScene } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import type { Group, InstancedMesh, Material } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { classifyOpeningKind } from '../irc/openings'
import { type SceneNodeLike, belongsToLevel } from '../irc/tables'
import type { StructuralAssemblyNode } from './assembly'

/**
 * Compute a deterministic fingerprint of ONLY the scene properties that affect the
 * 3D framing skeleton (assembly config + walls, slabs, doors/windows, roofs, levels).
 * Moving unrelated furniture, paint, or MEP items produces an identical string so
 * `StructuralAssemblyRenderer` skips both React re-renders and GPU `InstancedMesh` rebuilds.
 */
export function computeSkeletonFingerprint(
  assembly: SceneNodeLike,
  nodes: Readonly<Record<string, SceneNodeLike>>,
): string {
  if (assembly.visible === false) return 'hidden'
  const parts: string[] = [
    JSON.stringify([
      assembly.id,
      assembly.parentId,
      assembly.species,
      assembly.studSize,
      assembly.studSpacingIn,
      assembly.floorSystem,
      assembly.roofSystem,
      assembly.joistDepthIn,
      assembly.wallHeightM,
      assembly.visibleSystems,
      assembly.wallOverrides,
    ]),
  ]

  const targetLevelId = typeof assembly.parentId === 'string' ? assembly.parentId : null
  const relevantIds: string[] = []
  const otherWalledLevelIds = new Set<string>()
  for (const [id, n] of Object.entries(nodes)) {
    const t = n.type
    if (t === 'level' || t === 'roof' || t === 'roof-segment') {
      relevantIds.push(id)
    } else if (t === 'wall') {
      if (!targetLevelId || belongsToLevel(nodes, n, targetLevelId)) {
        relevantIds.push(id)
      } else if (n.visible !== false && typeof n.parentId === 'string') {
        // Track only boolean wall presence on sibling levels so highest/lowest story checks stay reactive
        // without rebuilding this story's GPU skeleton when another story's walls move.
        otherWalledLevelIds.add(n.parentId)
      }
    } else if (
      t === 'slab' ||
      t === 'door' ||
      t === 'window' ||
      (t === 'structural:beam' && (n.role === 'header' || n.role === 'ridge-beam')) ||
      (t === 'item' && classifyOpeningKind(n) !== null)
    ) {
      if (!targetLevelId || belongsToLevel(nodes, n, targetLevelId)) {
        relevantIds.push(id)
      }
    }
  }
  relevantIds.sort()
  if (otherWalledLevelIds.size > 0) {
    parts.push(`walled:${[...otherWalledLevelIds].sort().join(',')}`)
  }

  for (const id of relevantIds) {
    const n = nodes[id]!
    const asset = n.asset as Record<string, unknown> | undefined
    parts.push(
      JSON.stringify([
        n.id,
        n.type,
        n.parentId,
        n.visible,
        n.level,
        n.start,
        n.end,
        n.height,
        n.elevation,
        n.thickness,
        n.polygon,
        n.position,
        n.rotation,
        n.scale,
        n.width,
        n.depth,
        n.sillHeight,
        n.pitch,
        n.overhang,
        n.wallHeight,
        n.roofType,
        n.role,
        n.hostWallId,
        n.openingId,
        n.elevationY,
        n.children,
        asset?.category,
        asset?.dimensions,
        asset?.offset,
      ]),
    )
  }

  return parts.join('|')
}

function disposeSkeletonGroup(group: Group): void {
  const seenMats = new Set<Material>()
  for (const child of group.children) {
    const mesh = child as InstancedMesh
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose()
    }
    const mat = mesh.material
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (!seenMats.has(m)) {
          seenMats.add(m)
          m.dispose()
        }
      }
    } else if (mat && !seenMats.has(mat)) {
      seenMats.add(mat)
      mat.dispose()
    }
  }
}

export function StructuralAssemblyRenderer({ node }: { node: StructuralAssemblyNode }) {
  const assembly = node as unknown as SceneNodeLike
  const fingerprint = useScene((s) =>
    computeSkeletonFingerprint(assembly, s.nodes as unknown as Readonly<Record<string, SceneNodeLike>>),
  )

  const group = useMemo(() => {
    if (!node.visible || fingerprint === 'hidden') return null
    const latestNodes = useScene.getState().nodes as unknown as Readonly<Record<string, SceneNodeLike>>
    return buildBuildingSkeletonGroup({
      assembly,
      nodes: latestNodes,
    })
  }, [node.visible, fingerprint])

  useEffect(() => {
    return () => {
      if (group) disposeSkeletonGroup(group)
    }
  }, [group])

  if (!node.visible || !group) return null
  return <primitive object={group} />
}

export default StructuralAssemblyRenderer
