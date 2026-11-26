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
import type { SceneNodeLike } from '../irc/tables'
import type { StructuralAssemblyNode } from './assembly'

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
  const nodes = useScene((s) => s.nodes) as unknown as Readonly<Record<string, SceneNodeLike>>

  const group = useMemo(() => {
    if (!node.visible) return null
    return buildBuildingSkeletonGroup({
      assembly: node as unknown as SceneNodeLike,
      nodes,
    })
  }, [node, nodes])

  useEffect(() => {
    return () => {
      if (group) disposeSkeletonGroup(group)
    }
  }, [group])

  if (!node.visible || !group) return null
  return <primitive object={group} />
}

export default StructuralAssemblyRenderer
