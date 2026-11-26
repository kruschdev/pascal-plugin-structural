import { describe, expect, test } from 'bun:test'
import { structuralAgentOperations } from '../agent-operations'
import { auditStructuralScene } from '../irc/audit'
import type { SceneNodeLike } from '../irc/tables'

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
})
