import { describe, expect, test } from 'bun:test'
import { type SceneNodeLike, evaluateBracedWallLines, traceStructuralLoadPaths } from '../irc'

describe('Continuous Gravity/Uplift Load-Path & IRC R602.10 Braced Wall Lines', () => {
  test('detects broken gravity load path when girder end floats with no column or bearing wall', () => {
    const nodes: Record<string, SceneNodeLike> = {
      bm1: {
        id: 'bm1',
        type: 'structural:beam',
        role: 'floor-girder',
        start: [0, 3],
        end: [5, 3],
        elevationY: 2.4,
        endReactionLbs: 4800,
      },
      col1: {
        id: 'col1',
        type: 'structural:column',
        position: [0, 0, 3],
        heightM: 2.4,
        axialLoadLbs: 4800,
        footingWidthIn: 30,
      },
      // End at (5, 3) has NO column and NO wall -> broken!
    }
    const report = traceStructuralLoadPaths({ nodes })
    expect(report.brokenLoadPaths).toBeGreaterThanOrEqual(1)
    expect(report.gravityLinks.some((l) => !l.continuous)).toBe(true)
  })

  test('flags missing TJI squash blocks under concentrated column load', () => {
    const nodes: Record<string, SceneNodeLike> = {
      asm1: { id: 'asm1', type: 'structural:assembly', floorSystem: 'tji-ijoist' },
      bm1: { id: 'bm1', type: 'structural:beam', role: 'floor-girder', start: [0, 0], end: [4, 0], elevationY: 2.4 },
      col1: { id: 'col1', type: 'structural:column', position: [0, 0, 0], heightM: 2.4, hasSquashBlocks: false, footingWidthIn: 24 },
      col2: { id: 'col2', type: 'structural:column', position: [4, 0, 0], heightM: 2.4, hasSquashBlocks: true, footingWidthIn: 24 },
    }
    const report = traceStructuralLoadPaths({ nodes })
    expect(report.gravityLinks.some((l) => l.requiresSquashBlock)).toBe(true)
  })

  test('evaluates IRC R602.10 braced wall lines and escalates seismic SDC D2 walls with HDU hold-downs & BP3x3 washers', () => {
    const nodes: Record<string, SceneNodeLike> = {
      w1: { id: 'w1', type: 'wall', start: [0, 0], end: [10, 0], height: 2.74 },
      d1: { id: 'd1', type: 'door', parentId: 'w1', width: 4.88 }, // 16 ft garage door
      w2: { id: 'w2', type: 'wall', start: [0, 8], end: [10, 8], height: 2.74 },
    }
    const bwls = evaluateBracedWallLines({
      nodes,
      design: { seismicCategory: 'D2', windMph: 135, storiesAbove: 1 },
    })
    expect(bwls.length).toBeGreaterThanOrEqual(2)
    const garageLine = bwls.find((b) => b.wallIds.includes('w1'))!
    expect(garageLine.requiresPlateWashers).toBe(true)
    expect(garageLine.requiredHoldDownSku).toMatch(/^HDU/)
  })
})
