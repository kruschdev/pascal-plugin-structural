import { describe, expect, test } from 'bun:test'
import {
  type SceneNodeLike,
  auditStructuralScene,
  autopopulateStructuralScene,
  generateStructuralSchedulePack,
} from '../irc'

function makeTwoStoreyHouseScene(): Record<string, SceneNodeLike> {
  return {
    lvl1: { id: 'lvl1', type: 'level', name: 'Ground Floor' },
    w_south: { id: 'w_south', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0], height: 3.35, thickness: 0.165, frontSide: 'exterior' },
    w_north: { id: 'w_north', type: 'wall', parentId: 'lvl1', start: [0, 9], end: [12, 9], height: 3.35, thickness: 0.165, frontSide: 'exterior' },
    w_west: { id: 'w_west', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [0, 9], height: 3.35, thickness: 0.165, frontSide: 'exterior' },
    w_east: { id: 'w_east', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 9], height: 3.35, thickness: 0.165, frontSide: 'exterior' },
    d_garage: { id: 'd_garage', type: 'door', parentId: 'w_south', width: 4.88, height: 2.13, position: [3.2, 0, 0] },
    win_living: { id: 'win_living', type: 'window', parentId: 'w_north', width: 2.44, height: 1.52, sillHeight: 0.91, position: [6, 0, 0] },
    slab1: { id: 'slab1', type: 'slab', parentId: 'lvl1', polygon: [[0, 0], [12, 0], [12, 9], [0, 9]], elevation: 0 },
    z_kitchen: { id: 'z_kitchen', type: 'zone', parentId: 'lvl1', name: 'Kitchen Soffit', polygon: [[7, 4], [12, 4], [12, 9], [7, 9]] },
    st1: { id: 'st1', type: 'stair', parentId: 'lvl1', position: [6, 0, 3], width: 1.05, depth: 3.2, height: 3.35 },
    roof1: { id: 'roof1', type: 'roof', parentId: 'lvl1', pitch: Math.atan(2.5 / 12) }, // <3:12 -> structural ridge beam!
  }
}

describe('Structural Auto-Populate, IRC Audit, Schedule Pack & Priced BOM', () => {
  test('autopopulates complete structural skeleton with LVL/Glulam beams, columns, connectors, and fire blocking', () => {
    const base = makeTwoStoreyHouseScene()
    const res = autopopulateStructuralScene(base, {
      levelId: 'lvl1',
      floorSystem: 'tji-ijoist',
      roofSystem: 'stick-rafter',
      design: {
        species: 'df-l-2',
        groundSnowPsf: 50,
        windMph: 135,
        exposure: 'C',
        seismicCategory: 'D1',
        storiesAbove: 1,
      },
    })

    expect(res.summary.assemblies).toBe(1)
    expect(res.summary.beams).toBeGreaterThanOrEqual(3) // garage header + window header + floor girder + structural ridge beam
    expect(res.summary.columns).toBeGreaterThanOrEqual(2)
    expect(res.summary.connectors).toBeGreaterThanOrEqual(6)
    expect(res.summary.firestops).toBeGreaterThanOrEqual(4)

    const combined: Record<string, SceneNodeLike> = { ...base }
    for (const n of res.createdNodes) combined[n.id] = n

    const pack = generateStructuralSchedulePack(combined)
    expect(pack.beams.length).toBeGreaterThanOrEqual(3)
    expect(pack.connectors.some((c) => c.sku === 'H10A')).toBe(true)
    expect(pack.connectors.some((c) => c.sku === 'A35')).toBe(true)
    expect(pack.connectors.some((c) => c.sku === 'LTP4')).toBe(true)
    expect(pack.connectors.some((c) => c.sku === 'BP3x3')).toBe(true)
    expect(pack.bom.totalMaterialCostUsd).toBeGreaterThan(1000)
    expect(pack.bom.csv).toContain('Category,SKU,Description')
    expect(pack.bom.markdown).toContain('| **TOTAL** |')
  })

  test('detects Priority #1 structural right-of-way violation when plumbing pipe bores an LVL beam', () => {
    const nodes: Record<string, SceneNodeLike> = {
      bm_lvl: {
        id: 'bm_lvl',
        type: 'structural:beam',
        name: 'Main LVL Girder',
        start: [0, 4],
        end: [8, 4],
        elevationY: 2.4,
        beamType: 'lvl',
        designation: '(3) 1-3/4"x11-7/8" 2.0E LVL',
        widthIn: 5.25,
        depthIn: 11.875,
        bearingLengthIn: 3.5,
      },
      pipe_clash: {
        id: 'pipe_clash',
        type: 'plumbing:pipe-run',
        path: [[4, 2.4, 2], [4, 2.4, 6]], // cuts right through LVL girder at y=2.4, z=4!
      },
    }
    const audit = auditStructuralScene(nodes)
    expect(audit.passed).toBe(false)
    expect(audit.findings.some((f) => f.category === 'mep-clash')).toBe(true)
  })
})
