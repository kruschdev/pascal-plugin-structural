import { describe, expect, test } from 'bun:test'
import {
  type SceneNodeLike,
  auditStructuralScene,
  deriveRequiredFirestops,
  isApprovedFirestopMaterial,
} from '../irc'

describe('IRC R302.11 Fire Blocking & R302.12 Draftstopping Engine', () => {
  test('derives all required IRC R302.11(1)-(5) & R302.12 fire blocking & draftstop locations', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      // Tall 12 ft wall -> R302.11(2)
      w_tall: { id: 'w_tall', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 3.66, thickness: 0.165 },
      // Furred basement wall > 10 ft -> R302.11(2) horizontal
      w_furred: { id: 'w_furred', type: 'wall', parentId: 'lvl1', name: 'Basement Furred Wall', start: [0, 0], end: [0, 7], height: 2.74, thickness: 0.14 },
      // Kitchen soffit zone -> R302.11(1)
      z_kitchen: { id: 'z_kitchen', type: 'zone', parentId: 'lvl1', name: 'Kitchen Soffit', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      // Vertical plumbing chase -> R302.11(4)
      z_chase: { id: 'z_chase', type: 'zone', parentId: 'lvl1', name: 'Mechanical Chase', polygon: [[4, 0], [5, 0], [5, 1], [4, 1]] },
      // Stair run -> R302.11(3)
      st1: { id: 'st1', type: 'stair', parentId: 'lvl1', position: [3, 0, 2], width: 1.05, depth: 3.2, height: 2.74 },
      // Vertical plumbing stack penetrating sole & top plates -> R302.11(5)
      p1: { id: 'p1', type: 'plumbing:pipe-run', parentId: 'lvl1', path: [[2, -0.3, 0], [2, 3.0, 0]] },
      // Large 1,600 sq ft floor slab + 3,400 sq ft attic -> R302.12 & R302.12.1
      slab1: {
        id: 'slab1',
        type: 'slab',
        parentId: 'lvl1',
        polygon: [[0, 0], [18, 0], [18, 18], [0, 18]],
        elevation: 0,
      },
    }

    const derived = deriveRequiredFirestops({
      nodes,
      levelId: 'lvl1',
      floorSystem: 'open-web-truss',
      hasAttic: true,
    })

    const kinds = new Set(derived.map((d) => d.firestopKind))
    expect(kinds.has('wall-vertical-10ft')).toBe(true)
    expect(kinds.has('wall-horizontal-10ft')).toBe(true)
    expect(kinds.has('soffit-drop-ceiling')).toBe(true)
    expect(kinds.has('stair-stringer')).toBe(true)
    expect(kinds.has('chase-chimney-shaft')).toBe(true)
    expect(kinds.has('penetration-firestop')).toBe(true)
    expect(kinds.has('floor-draftstop')).toBe(true)
    expect(kinds.has('attic-draftstop')).toBe(true)
  })

  test('rejects unapproved materials and flags missing R302.11 fire blocking in audit', () => {
    expect(isApprovedFirestopMaterial('penetration-firestop', 'intumescent-collar')).toBe(true)
    expect(isApprovedFirestopMaterial('penetration-firestop', '2x-lumber')).toBe(false)

    const nodes: Record<string, SceneNodeLike> = {
      w_tall: { id: 'w_tall', type: 'wall', start: [0, 0], end: [5, 0], height: 3.66, thickness: 0.165 },
      bad_fs: {
        id: 'bad_fs',
        type: 'structural:firestop',
        firestopKind: 'penetration-firestop',
        material: '2x-lumber',
        start: [1, 0],
        end: [1.2, 0],
        elevationY: 2.7,
      },
    }
    const audit = auditStructuralScene(nodes)
    expect(audit.passed).toBe(false)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11.1')).toBe(true)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11(2)')).toBe(true)
  })
})
