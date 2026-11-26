import { describe, expect, test } from 'bun:test'
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { structuralAgentOperations } from '../agent-operations'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { clusterLevelFootprints, extractWallOpenings } from '../irc/openings'
import { type SceneNodeLike, belongsToLevel } from '../irc/tables'
import { computeSkeletonFingerprint } from '../nodes/assembly-renderer'
import { belongsToLevel as panelBelongsToLevel } from '../ui/structural-panel'

function getInstancedCenters(group: ReturnType<typeof buildBuildingSkeletonGroup>, bucketName: string): Vector3[] {
  const mesh = group.children.find((c) => c.name === `structural-skeleton-${bucketName}`) as InstancedMesh | undefined
  if (!mesh) return []
  const out: Vector3[] = []
  const m = new Matrix4()
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m)
    out.push(new Vector3().setFromMatrixPosition(m))
  }
  return out
}

describe('Round 2 Audit Regression Suite (R2-BUG-01..07, R2-OPT-01..03, R2-CON-01..03)', () => {
  test('R2-BUG-01: buildBuildingSkeletonGroup lazily allocates ONLY populated bucket materials (zero unused material leaks)', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg1', height: 2.55 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [4, 0], height: 2.55 },
    }
    const assembly: SceneNodeLike = {
      id: 'strasm_1',
      type: 'structural:assembly',
      parentId: 'lvl1',
      species: 'df-l-2',
      visibleSystems: {
        walls: true,
        floor: false,
        roof: false,
        foundation: false,
        connectors: false,
        firestop: false,
      },
    }
    const group = buildBuildingSkeletonGroup({ assembly, nodes })
    // Only lumber and pt-sill should exist (no concrete, osb-web, galv-steel, holddown-steel, firestop, header-lvl)
    const bucketNames = group.children.map((c) => c.name).sort()
    expect(bucketNames).toEqual(['structural-skeleton-lumber', 'structural-skeleton-pt-sill'])
    // Each child gets its own distinct disposable MeshStandardMaterial instance
    const mats = group.children.map((c) => (c as InstancedMesh).material)
    expect(new Set(mats).size).toBe(bucketNames.length)
  })

  test('R2-BUG-02: clusterLevelFootprints transitively merges 3 rooms regardless of iteration order [A, C, B] while keeping detached buildings separate', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg1', height: 2.74 },
      // 3 connected rooms iterated out of order: left [0..4], right [8..12], middle [4..8]
      slabA: { id: 'slabA', type: 'slab', parentId: 'lvl1', polygon: [[0, 0], [4, 0], [4, 6], [0, 6]] },
      slabC: { id: 'slabC', type: 'slab', parentId: 'lvl1', polygon: [[8, 0], [12, 0], [12, 6], [8, 6]] },
      slabB: { id: 'slabB', type: 'slab', parentId: 'lvl1', polygon: [[4, 0], [8, 0], [8, 6], [4, 6]] },
      // Detached studio across empty yard at [16..20, 8..14]
      slabDetached: { id: 'slabDetached', type: 'slab', parentId: 'lvl1', polygon: [[16, 8], [20, 8], [20, 14], [16, 14]] },
    }
    const clusters = clusterLevelFootprints(nodes, 'lvl1')
    expect(clusters.length).toBe(2)
    const main = clusters.find((c) => c.minX === 0)
    const detached = clusters.find((c) => c.minX === 16)
    expect(main).toBeDefined()
    expect(main!.maxX).toBe(12)
    expect(main!.maxZ).toBe(6)
    expect(detached).toBeDefined()
    expect(detached!.maxX).toBe(20)
    expect(detached!.minZ).toBe(8)
    expect(detached!.maxZ).toBe(14)
  })

  test('R2-BUG-03 & R2-CON-02: multi-structure autopopulate keeps girders, columns, exterior walls & ridge beams strictly inside each building and attaches hangers to all bay girders', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg1', height: 2.74 },
      // Building 1: 32x24 ft ([0..9.75, 0..7.32]) -> needs floor girder with bays
      slab1: { id: 'slab1', type: 'slab', parentId: 'lvl1', polygon: [[0, 0], [9.75, 0], [9.75, 7.32], [0, 7.32]] },
      w1_east: { id: 'w1_east', type: 'wall', parentId: 'lvl1', start: [9.75, 0], end: [9.75, 7.32], height: 2.74 },
      w1_south: { id: 'w1_south', type: 'wall', parentId: 'lvl1', start: [0, 7.32], end: [9.75, 7.32], height: 2.74 },
      // Building 2: detached 16x22 ft ([14..18.88, 9..15.7]) across empty yard (x: 9.75..14)
      slab2: { id: 'slab2', type: 'slab', parentId: 'lvl1', polygon: [[14, 9], [18.88, 9], [18.88, 15.7], [14, 15.7]] },
      w2_west: { id: 'w2_west', type: 'wall', parentId: 'lvl1', start: [14, 9], end: [14, 15.7], height: 2.74 },
    }
    const res = autopopulateStructuralScene(nodes, {
      levelId: 'lvl1',
      floorSystem: 'dimensional',
      roofSystem: 'ridge-beam-cathedral',
    })
    const asm = res.createdNodes.find((n) => n.type === 'structural:assembly')!
    const overrides = asm.wallOverrides as Record<string, { isLoadBearing?: boolean }>
    // Facing exterior walls of BOTH detached buildings must be classified as exterior/load-bearing
    expect(overrides.w1_east?.isLoadBearing).toBe(true)
    expect(overrides.w2_west?.isLoadBearing).toBe(true)

    // No floor girder or ridge beam should span across the empty yard gap x in (9.9 .. 13.8)
    const beams = res.createdNodes.filter((n) => n.type === 'structural:beam')
    expect(beams.length).toBeGreaterThanOrEqual(2)
    for (const b of beams) {
      const s = b.start as [number, number]
      const e = b.end as [number, number]
      const minX = Math.min(s[0], e[0])
      const maxX = Math.max(s[0], e[0])
      const bridgesYard = minX < 9.9 && maxX > 13.8
      expect(bridgesYard).toBe(false)
    }

    // R2-CON-02: Joist hangers attach to ALL bay girder IDs of a multi-bay girder
    const floorGirders = beams.filter((b) => b.role === 'floor-girder')
    expect(floorGirders.length).toBeGreaterThanOrEqual(2)
    const joistHanger = res.createdNodes.find(
      (n) => n.type === 'structural:connector' && String(n.name ?? '').includes('Joist Hangers'),
    )
    expect(joistHanger).toBeDefined()
    const attached = joistHanger!.attachedNodeIds as string[]
    expect(attached.filter((id) => id.startsWith('strbm_')).length).toBeGreaterThanOrEqual(2)
  })

  test('R2-BUG-04: multi-story wall-less roof level adopts ONLY onto the top walled level (never cuts through lower story) and honors segWallH', () => {
    const nodes: Record<string, SceneNodeLike> = {
      bldg1: { id: 'bldg1', type: 'building' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg1', level: 0, height: 2.74 },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg1', level: 1, height: 2.74 },
      lvl2_roof: { id: 'lvl2_roof', type: 'level', parentId: 'bldg1', level: 2, height: 2.74 },
      w0: { id: 'w0', type: 'wall', parentId: 'lvl0', start: [0, 0], end: [6, 0], height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      roof0: { id: 'roof0', type: 'roof', parentId: 'lvl2_roof', position: [3, 0, 3], rotation: 0 },
      rseg0: {
        id: 'rseg0',
        type: 'roof-segment',
        parentId: 'roof0',
        position: [0, 0, 0],
        width: 6,
        depth: 6,
        pitch: 26.57,
        wallHeight: 0.5,
        roofType: 'gable',
      },
    }
    const baseAsm = {
      type: 'structural:assembly',
      roofSystem: 'stick-rafter',
      visibleSystems: { walls: false, floor: false, roof: true, foundation: false, connectors: false, firestop: false },
    }
    // Level 0 (ground floor below Level 1) must NOT adopt Level 2's wall-less roof!
    const g0 = buildBuildingSkeletonGroup({ assembly: { ...baseAsm, id: 'strasm_0', parentId: 'lvl0' }, nodes })
    expect(getInstancedCenters(g0, 'header-lvl').length).toBe(0)

    // Level 1 (highest walled level below Level 2) MUST adopt Level 2's roof AND add segWallH (0.5m) to defaultWallHeightM (2.74m)
    const g1 = buildBuildingSkeletonGroup({ assembly: { ...baseAsm, id: 'strasm_1', parentId: 'lvl1' }, nodes })
    const ridgeCenters = getInstancedCenters(g1, 'header-lvl')
    expect(ridgeCenters.length).toBe(1)
    // cy = 2.74 + 0.5 = 3.24; rise = 3 * tan(26.57 deg) ~= 1.50; ridge center Y = cy + rise - 0.09 ~= 4.65
    expect(ridgeCenters[0]!.y).toBeGreaterThan(4.4)
  })

  test('R2-BUG-05: paired adjacent windows & wide near-corner openings emit zero studs piercing opening glass', () => {
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.74 },
      wall1: { id: 'wall1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      win1: { id: 'win1', type: 'window', parentId: 'wall1', position: [1.5, 1.5, 0], width: 1.2, height: 1.2 },
      win2: { id: 'win2', type: 'window', parentId: 'wall1', position: [2.85, 1.5, 0], width: 1.2, height: 1.2 },
    }
    const group = buildBuildingSkeletonGroup({
      assembly: {
        id: 'strasm_1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        studSpacingIn: 16,
        visibleSystems: { walls: true, floor: false, roof: false, foundation: false, connectors: false, firestop: false },
      },
      nodes,
    })
    const mesh = group.children.find((c) => c.name === 'structural-skeleton-lumber') as InstancedMesh
    expect(mesh).toBeDefined()
    const m = new Matrix4()
    const pos = new Vector3()
    const scale = new Vector3()
    const dummyQ = new Quaternion()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      m.decompose(pos, dummyQ, scale)
      // Check no vertical stud passes through window 1 glass [0.95..2.05, y: 0.95..2.05] or window 2 glass [2.30..3.40, y: 0.95..2.05]
      const inWin1X = pos.x > 0.98 && pos.x < 2.02
      const inWin2X = pos.x > 2.33 && pos.x < 3.37
      const yMin = pos.y - scale.y / 2
      const yMax = pos.y + scale.y / 2
      const crossesGlassY = yMin < 1.95 && yMax > 1.05
      if (inWin1X || inWin2X) {
        expect(crossesGlassY).toBe(false)
      }
    }
  })

  test('R2-BUG-06: extractWallOpenings skips visible=false openings and projects full 2D rotated asset.offset (ox, oz)', () => {
    const nodes: Record<string, SceneNodeLike> = {
      wall1: { id: 'wall1', type: 'wall', start: [0, 0], end: [6, 0], height: 2.74 },
      hiddenWin: { id: 'hiddenWin', type: 'window', parentId: 'wall1', visible: false, position: [2, 1.5, 0], width: 1.2, height: 1.2 },
      rotatedItemDoor: {
        id: 'rotatedItemDoor',
        type: 'item',
        parentId: 'wall1',
        position: [3.0, 0, 0],
        rotation: [0, Math.PI / 2, 0],
        asset: { category: 'door', dimensions: [0.9, 2.1, 0.1], offset: [0, 0, 0.25] },
      },
    }
    const openings = extractWallOpenings(nodes, nodes.wall1!)
    expect(openings.length).toBe(1)
    expect(openings[0]!.id).toBe('rotatedItemDoor')
    // At rotY = pi/2: ox*cos + oz*sin = 0 + 0.25*1 = +0.25 -> uCenterM = 3.25
    expect(openings[0]!.uCenterM).toBeCloseTo(3.25, 3)
  })

  test('R2-BUG-07 & R2-CON-01: canonical belongsToLevel stops at level boundaries, clears nested structural nodes, and all 5 agent ops emit changes', () => {
    expect(panelBelongsToLevel).toBe(belongsToLevel)
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg1' },
      lvl2: { id: 'lvl2', type: 'level', parentId: 'bldg1' },
      wall1: { id: 'wall1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [5, 0], height: 2.74 },
      strbm_nested: { id: 'strbm_nested', type: 'structural:beam', parentId: 'wall1', start: [1, 0], end: [3, 0] },
      strbm_lvl2: { id: 'strbm_lvl2', type: 'structural:beam', parentId: 'lvl2', start: [1, 0], end: [3, 0] },
    }
    expect(belongsToLevel(nodes, nodes.strbm_nested!, 'lvl1')).toBe(true)
    expect(belongsToLevel(nodes, nodes.strbm_lvl2!, 'lvl1')).toBe(false)

    const autoRes = structuralAgentOperations.structural_autopopulate_irc(nodes, { levelId: 'lvl1' })
    expect(autoRes.changes?.delete).toContain('strbm_nested')
    expect(autoRes.changes?.delete).not.toContain('strbm_lvl2')
    expect((autoRes.changes?.create?.length ?? 0)).toBeGreaterThan(0)

    const beamRes = structuralAgentOperations.structural_place_beam(nodes, { levelId: 'lvl1', start: [0, 0], end: [3, 0] })
    const colRes = structuralAgentOperations.structural_place_column(nodes, { levelId: 'lvl1', position: [1, 0, 1] })
    const conRes = structuralAgentOperations.structural_place_connector(nodes, { levelId: 'lvl1', sku: 'H2.5A', position: [1, 2.7, 0] })
    const fsRes = structuralAgentOperations.structural_place_firestop(nodes, { levelId: 'lvl1', firestopKind: 'soffit-drop-ceiling', start: [0, 0], end: [2, 0] })

    expect(beamRes.changes?.create?.length).toBe(beamRes.createdNodes?.length)
    expect(colRes.changes?.create?.length).toBe(colRes.createdNodes?.length)
    expect(conRes.changes?.create?.length).toBe(conRes.createdNodes?.length)
    expect(fsRes.changes?.create?.length).toBe(fsRes.createdNodes?.length)
  })

  test('R2-OPT-01: computeSkeletonFingerprint ignores unrelated furniture/paint edits and invalidates on wall/opening changes', () => {
    const assembly: SceneNodeLike = { id: 'strasm_1', type: 'structural:assembly', parentId: 'lvl1', species: 'df-l-2' }
    const baseNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      sofa: { id: 'sofa_1', type: 'item', parentId: 'lvl1', position: [2, 0, 2], asset: { category: 'furniture' } },
    }
    const fp1 = computeSkeletonFingerprint(assembly, baseNodes)
    // Move unrelated sofa -> fingerprint MUST stay identical (0 skeleton rebuilds!)
    const movedSofaNodes: Record<string, SceneNodeLike> = {
      ...baseNodes,
      sofa: { ...baseNodes.sofa!, position: [4, 0, 3] },
    }
    expect(computeSkeletonFingerprint(assembly, movedSofaNodes)).toBe(fp1)

    // Move wall -> fingerprint MUST change!
    const movedWallNodes: Record<string, SceneNodeLike> = {
      ...baseNodes,
      w1: { ...baseNodes.w1!, end: [7, 0] },
    }
    expect(computeSkeletonFingerprint(assembly, movedWallNodes)).not.toBe(fp1)
  })
})
