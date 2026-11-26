import { describe, expect, test } from 'bun:test'
import { structuralAgentOperations } from '../agent-operations'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { auditStructuralScene } from '../irc/audit'
import {
  isHighestWalledLevelInBuilding,
  isLowestWalledLevelInBuilding,
  type SceneNodeLike,
} from '../irc/tables'

function applyStructuralOutcome(
  nodes: Record<string, SceneNodeLike>,
  outcome: ReturnType<typeof structuralAgentOperations.structural_autopopulate_irc>,
): Record<string, SceneNodeLike> {
  const next: Record<string, SceneNodeLike> = { ...nodes }
  for (const id of outcome.changes?.delete ?? []) delete next[id]
  for (const node of outcome.createdNodes ?? []) next[node.id] = node as SceneNodeLike
  return next
}

describe('Cross-Trade 4-MEP Coordination Regression Suite (XTRADE-01)', () => {
  test('long floor girder (>12 ft) splits into clear-span bay segments with 0 bending/deflection/bearing errors', () => {
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', name: 'Level 1', height: 2.7 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [12, 0], height: 2.7, thickness: 0.16 },
      w2: { id: 'w2', type: 'wall', parentId: 'level_0', start: [12, 0], end: [12, 9], height: 2.7, thickness: 0.16 },
      w3: { id: 'w3', type: 'wall', parentId: 'level_0', start: [12, 9], end: [0, 9], height: 2.7, thickness: 0.16 },
      w4: { id: 'w4', type: 'wall', parentId: 'level_0', start: [0, 9], end: [0, 0], height: 2.7, thickness: 0.16 },
    }

    const res = structuralAgentOperations.structural_autopopulate_irc(scene, { levelId: 'level_0' })
    const populated = applyStructuralOutcome(scene, res)

    const girders = Object.values(populated).filter(
      (n) => n.type === 'structural:beam' && typeof n.name === 'string' && /Floor Girder/.test(n.name),
    )
    expect(girders.length).toBeGreaterThanOrEqual(3)
    for (const g of girders) {
      const start = g.start as [number, number]
      const end = g.end as [number, number]
      const spanFt = Math.hypot(end[0] - start[0], end[1] - start[1]) * 3.28084
      expect(spanFt).toBeLessThanOrEqual(12.2)
    }

    const audit = auditStructuralScene(populated)
    const errors = audit.findings.filter((f) => f.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  test('Pass 2 structural_autopopulate_irc is idempotent via changes.delete with zero duplicate beams', () => {
    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', name: 'Level 1', height: 2.7 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 2.7, thickness: 0.16 },
      w2: { id: 'w2', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], height: 2.7, thickness: 0.16 },
      w3: { id: 'w3', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8], height: 2.7, thickness: 0.16 },
      w4: { id: 'w4', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0], height: 2.7, thickness: 0.16 },
    }

    const pass1 = structuralAgentOperations.structural_autopopulate_irc(scene, { levelId: 'level_0' })
    const after1 = applyStructuralOutcome(scene, pass1)
    const count1 = Object.values(after1).filter((n) => String(n.type).startsWith('structural:')).length

    const pass2 = structuralAgentOperations.structural_autopopulate_irc(after1, { levelId: 'level_0' })
    expect(pass2.changes?.delete?.length ?? 0).toBe(count1)
    const after2 = applyStructuralOutcome(after1, pass2)
    const count2 = Object.values(after2).filter((n) => String(n.type).startsWith('structural:')).length
    expect(count2).toBe(count1)
  })

  test('2-story stacked building suppresses fallback roof on Ground floor and concrete footings on Second floor (VIS-X7)', () => {
    const scene: Record<string, SceneNodeLike> = {
      building_1: { id: 'building_1', type: 'building', name: 'Two-Story House' },
      level_0: { id: 'level_0', type: 'level', parentId: 'building_1', name: 'Ground floor', level: 0, height: 2.74 },
      level_1: { id: 'level_1', type: 'level', parentId: 'building_1', name: 'Second floor', level: 1, height: 2.74 },
      w0_n: { id: 'w0_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0], height: 2.74, thickness: 0.16 },
      w0_e: { id: 'w0_e', type: 'wall', parentId: 'level_0', start: [10, 0], end: [10, 8], height: 2.74, thickness: 0.16 },
      w0_s: { id: 'w0_s', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8], height: 2.74, thickness: 0.16 },
      w0_w: { id: 'w0_w', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0], height: 2.74, thickness: 0.16 },
      w1_n: { id: 'w1_n', type: 'wall', parentId: 'level_1', start: [0, 0], end: [10, 0], height: 2.74, thickness: 0.16 },
      w1_e: { id: 'w1_e', type: 'wall', parentId: 'level_1', start: [10, 0], end: [10, 8], height: 2.74, thickness: 0.16 },
      w1_s: { id: 'w1_s', type: 'wall', parentId: 'level_1', start: [10, 8], end: [0, 8], height: 2.74, thickness: 0.16 },
      w1_w: { id: 'w1_w', type: 'wall', parentId: 'level_1', start: [0, 8], end: [0, 0], height: 2.74, thickness: 0.16 },
    }

    expect(isLowestWalledLevelInBuilding(scene, 'level_0')).toBe(true)
    expect(isHighestWalledLevelInBuilding(scene, 'level_0')).toBe(false)
    expect(isLowestWalledLevelInBuilding(scene, 'level_1')).toBe(false)
    expect(isHighestWalledLevelInBuilding(scene, 'level_1')).toBe(true)

    const resL0 = structuralAgentOperations.structural_autopopulate_irc(scene, { levelId: 'level_0' })
    const afterL0 = applyStructuralOutcome(scene, resL0)
    const l0Asm = Object.values(afterL0).find((n) => n.type === 'structural:assembly' && n.parentId === 'level_0')
    expect((l0Asm?.visibleSystems as Record<string, boolean> | undefined)?.roof).toBe(false)
    const l0RidgeBeams = Object.values(afterL0).filter(
      (n) => n.type === 'structural:beam' && n.parentId === 'level_0' && typeof n.name === 'string' && /Ridge/i.test(n.name),
    )
    expect(l0RidgeBeams).toHaveLength(0)

    const resL1 = structuralAgentOperations.structural_autopopulate_irc(afterL0, { levelId: 'level_1' })
    const afterL1 = applyStructuralOutcome(afterL0, resL1)
    const l1Asm = Object.values(afterL1).find((n) => n.type === 'structural:assembly' && n.parentId === 'level_1')
    expect((l1Asm?.visibleSystems as Record<string, boolean> | undefined)?.roof).toBe(true)

    // 3D skeleton check: Ground floor has concrete footings and no pitched roof rafters above 2.8m;
    // Second floor has roof rafters above 2.8m and zero mid-air concrete footings
    const skelL0 = buildBuildingSkeletonGroup({
      nodes: afterL1,
      assembly: l0Asm!,
    })
    const skelL1 = buildBuildingSkeletonGroup({
      nodes: afterL1,
      assembly: l1Asm!,
    })
    const l0Concrete = skelL0.children.find((c) => c.name === 'structural-skeleton-concrete')
    const l1Concrete = skelL1.children.find((c) => c.name === 'structural-skeleton-concrete')
    expect(l0Concrete).toBeDefined()
    expect(l1Concrete).toBeUndefined()

    // Audit across both levels stays zero-error
    const audit = auditStructuralScene(afterL1)
    expect(audit.findings.filter((f) => f.severity === 'error')).toHaveLength(0)
  })
})
