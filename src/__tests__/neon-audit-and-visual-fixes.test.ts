import { describe, expect, test } from 'bun:test'
import { type InstancedMesh, Matrix4, Vector3 } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { auditStructuralScene } from '../irc/audit'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { evaluateBracedWallLines, traceStructuralLoadPaths } from '../irc/load-path'
import {
  CONNECTOR_CATALOG,
  type SceneNodeLike,
  isHoldDownConnector,
  resolveHoldDownUpliftLbs,
} from '../irc/tables'

function mergeCreated(
  base: Readonly<Record<string, SceneNodeLike>>,
  created: ReadonlyArray<SceneNodeLike>,
): Record<string, SceneNodeLike> {
  const out: Record<string, SceneNodeLike> = { ...base }
  for (const n of created) out[n.id] = n
  return out
}

function extractBucketInstances(group: ReturnType<typeof buildBuildingSkeletonGroup>, bucketName: string) {
  const inst = group.children.find((c) => c.name === `structural-skeleton-${bucketName}`) as InstancedMesh | undefined
  if (!inst) return []
  const out: Array<{ center: Vector3; corners: Vector3[] }> = []
  const mat = new Matrix4()
  const localCorners = [
    new Vector3(-0.5, -0.5, -0.5),
    new Vector3(-0.5, -0.5, 0.5),
    new Vector3(-0.5, 0.5, -0.5),
    new Vector3(-0.5, 0.5, 0.5),
    new Vector3(0.5, -0.5, -0.5),
    new Vector3(0.5, -0.5, 0.5),
    new Vector3(0.5, 0.5, -0.5),
    new Vector3(0.5, 0.5, 0.5),
  ]
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, mat)
    const center = new Vector3().setFromMatrixPosition(mat)
    const corners = localCorners.map((c) => c.clone().applyMatrix4(mat))
    out.push({ center, corners })
  }
  return out
}

function pointInPoly2D(x: number, z: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0]
    const zi = poly[i]![1]
    const xj = poly[j]![0]
    const zj = poly[j]![1]
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-18) + xi
    if (hit) inside = !inside
  }
  return inside
}

describe('Structural Audit & 3D Visual QA Regression Suite (STR-BUG-01..04, STR-CON-01..02, VIS-02/03/04/07)', () => {
  test('STR-BUG-01: BWL hold-down remediation enforces viable shear pier, catalog uplift capacity >= demand, and quantity >= 2', () => {
    // 2-story Engineered-Shear wall line (storiesAbove: 1, SDC D1 -> 45% required, 7,200 lb overturning demand):
    // 8m wall (2.74m tall) with two 3.0m doors leaving a 1.6m center WSP pier (20% < 45% required, no CS-PF sliver -> Engineered-Shear!)
    const baseScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w_shear: { id: 'w_shear', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [8, 0], height: 2.7432 },
      d1: { id: 'd1', type: 'door', parentId: 'w_shear', width: 3.0, height: 2.13, position: [1.7, 0, 0] },
      d2: { id: 'd2', type: 'door', parentId: 'w_shear', width: 3.0, height: 2.13, position: [6.3, 0, 0] },
    }
    const design2Story = { storiesAbove: 1 as const, seismicCategory: 'D1' as const, windMph: 130 }

    // 1. Undersized HDU2-SDS2.5 (3,075 lbs < 7,200 lbs) with qty 2 MUST FAIL
    const undersized = {
      ...baseScene,
      hd_small: {
        id: 'hd_small',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU2-SDS2.5',
        quantity: 2,
        attachedNodeIds: ['w_shear'],
      },
    }
    const bwlUnder = evaluateBracedWallLines({ nodes: undersized, design: design2Story, levelId: 'lvl1' })[0]!
    expect(bwlUnder.bracingMethod).toBe('Engineered-Shear')
    expect(bwlUnder.overturningUpliftLbs).toBe(7200)
    expect(bwlUnder.passes).toBe(false)

    // 2. Unlisted 0-lb SKU HDU-FAKE with qty 2 MUST FAIL
    const fakeSku = {
      ...baseScene,
      hd_fake: {
        id: 'hd_fake',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU-FAKE',
        quantity: 2,
        attachedNodeIds: ['w_shear'],
      },
    }
    expect(evaluateBracedWallLines({ nodes: fakeSku, design: design2Story, levelId: 'lvl1' })[0]!.passes).toBe(false)

    // 3. Single-end HDU8-SDS2.5 (7,870 lbs >= 7,200 lbs, but quantity: 1 < 2) MUST FAIL
    const singleEnd = {
      ...baseScene,
      hd_one: {
        id: 'hd_one',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU8-SDS2.5',
        quantity: 1,
        attachedNodeIds: ['w_shear'],
      },
    }
    expect(evaluateBracedWallLines({ nodes: singleEnd, design: design2Story, levelId: 'lvl1' })[0]!.passes).toBe(false)

    // 4. Autopopulate MUST NOT be blocked by an undersized hold-down and MUST emit compliant HDU8-SDS2.5 (qty 2)
    const autoFromUnder = autopopulateStructuralScene(undersized, { levelId: 'lvl1', design: design2Story })
    expect(
      autoFromUnder.createdNodes.some(
        (n) => n.type === 'structural:connector' && n.sku === 'HDU8-SDS2.5' && (n.quantity as number) >= 2,
      ),
    ).toBe(true)

    // 5. Qualifying dual-end HDU8-SDS2.5 (7,870 lbs >= 7,200 lbs, quantity: 2) on viable solid pier PASSES
    const compliant = {
      ...baseScene,
      hd_ok: {
        id: 'hd_ok',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU8-SDS2.5',
        quantity: 2,
        attachedNodeIds: ['w_shear'],
      },
    }
    expect(evaluateBracedWallLines({ nodes: compliant, design: design2Story, levelId: 'lvl1' })[0]!.passes).toBe(true)

    // 6. All-glazed wall line lacking ANY viable solid shear pier (< H/3.5 = 0.78m) MUST FAIL even with HDU8-SDS2.5 x2
    const allGlazed: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w_glass: { id: 'w_glass', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.7432 },
      d_full: { id: 'd_full', type: 'door', parentId: 'w_glass', width: 5.7, height: 2.13, position: [3, 0, 0] },
      hd_big: {
        id: 'hd_big',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU8-SDS2.5',
        quantity: 2,
        attachedNodeIds: ['w_glass'],
      },
    }
    expect(evaluateBracedWallLines({ nodes: allGlazed, design: design2Story, levelId: 'lvl1' })[0]!.passes).toBe(false)
  })

  test('STR-BUG-02: column standing ON TOP of floor (y=0) is never credited as supporting a floor girder below', () => {
    // Floor girder sits flush under floor y=0 (elevationY = -0.15, depthIn = 11.875 -> bottomY = -0.30).
    // A column standing ON TOP of the floor at y = 0..2.74 bears onto the girder rather than supporting it from below!
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      bm_girder: {
        id: 'bm_girder',
        type: 'structural:beam',
        parentId: 'lvl1',
        role: 'floor-girder',
        start: [0, 7],
        end: [6, 7],
        elevationY: -0.151,
        depthIn: 11.875,
      },
      col_below_start: {
        id: 'col_below_start',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [0, -2.743, 7],
        heightM: 2.44,
        footingWidthIn: 24,
      },
      col_on_top_end: {
        id: 'col_on_top_end',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [6, 0, 7],
        heightM: 2.743,
        footingWidthIn: 24,
      },
    }
    const lp = traceStructuralLoadPaths({ nodes: scene })
    const end2Link = lp.gravityLinks.find((l) => l.fromNodeId === 'bm_girder' && Math.abs(l.position[0] - 6) < 1e-6)
    expect(end2Link).toBeDefined()
    expect(end2Link?.continuous).toBe(false)
    expect(end2Link?.toType).toBe('unverified-support')

    // Autopopulate on an L-shaped floor with an interior post standing ON TOP of the floor at the open girder end (18, 0, 7)
    // MUST STILL emit the required below-floor girder end-support post!
    const lScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w_s: { id: 'w_s', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [18, 0], height: 2.7432 },
      w_el: { id: 'w_el', type: 'wall', parentId: 'lvl1', start: [18, 0], end: [18, 5], height: 2.7432 },
      w_sh: { id: 'w_sh', type: 'wall', parentId: 'lvl1', start: [18, 5], end: [9, 5], height: 2.7432 },
      w_sv: { id: 'w_sv', type: 'wall', parentId: 'lvl1', start: [9, 5], end: [9, 14], height: 2.7432 },
      w_nw: { id: 'w_nw', type: 'wall', parentId: 'lvl1', start: [9, 14], end: [0, 14], height: 2.7432 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'lvl1', start: [0, 14], end: [0, 0], height: 2.7432 },
      col_above_floor: {
        id: 'col_above_floor',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [18, 0, 7],
        heightM: 2.7432,
        footingWidthIn: 24,
      },
    }
    const res = autopopulateStructuralScene(lScene, { levelId: 'lvl1', floorSystem: 'tji-ijoist', includeFoundation: true })
    const endPosts = res.createdNodes.filter(
      (n) => n.type === 'structural:column' && typeof n.name === 'string' && n.name.includes('End Support Post'),
    )
    expect(endPosts.length).toBeGreaterThanOrEqual(1)
  })

  test('STR-BUG-03: upper-story posts (includeFoundation=false) wire transfersToNodeId to aligned lower-story columns with 0 R403.1 errors', () => {
    const twoStoryL: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 0, height: 2.7432 },
      lvl2: { id: 'lvl2', type: 'level', parentId: 'bldg', level: 1, height: 2.7432 },
      // Level 1 L-shape
      w1_s: { id: 'w1_s', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [18, 0], height: 2.7432 },
      w1_el: { id: 'w1_el', type: 'wall', parentId: 'lvl1', start: [18, 0], end: [18, 5], height: 2.7432 },
      w1_sh: { id: 'w1_sh', type: 'wall', parentId: 'lvl1', start: [18, 5], end: [9, 5], height: 2.7432 },
      w1_sv: { id: 'w1_sv', type: 'wall', parentId: 'lvl1', start: [9, 5], end: [9, 14], height: 2.7432 },
      w1_nw: { id: 'w1_nw', type: 'wall', parentId: 'lvl1', start: [9, 14], end: [0, 14], height: 2.7432 },
      w1_w: { id: 'w1_w', type: 'wall', parentId: 'lvl1', start: [0, 14], end: [0, 0], height: 2.7432 },
      // Level 2 matching L-shape
      w2_s: { id: 'w2_s', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [18, 0], height: 2.7432 },
      w2_el: { id: 'w2_el', type: 'wall', parentId: 'lvl2', start: [18, 0], end: [18, 5], height: 2.7432 },
      w2_sh: { id: 'w2_sh', type: 'wall', parentId: 'lvl2', start: [18, 5], end: [9, 5], height: 2.7432 },
      w2_sv: { id: 'w2_sv', type: 'wall', parentId: 'lvl2', start: [9, 5], end: [9, 14], height: 2.7432 },
      w2_nw: { id: 'w2_nw', type: 'wall', parentId: 'lvl2', start: [9, 14], end: [0, 14], height: 2.7432 },
      w2_w: { id: 'w2_w', type: 'wall', parentId: 'lvl2', start: [0, 14], end: [0, 0], height: 2.7432 },
    }

    const r1 = autopopulateStructuralScene(twoStoryL, { levelId: 'lvl1', floorSystem: 'tji-ijoist', includeFoundation: true })
    const afterL1 = mergeCreated(twoStoryL, r1.createdNodes)
    const l1Cols = new Set(r1.createdNodes.filter((n) => n.type === 'structural:column').map((n) => n.id))
    expect(l1Cols.size).toBeGreaterThanOrEqual(2)

    const r2 = autopopulateStructuralScene(afterL1, { levelId: 'lvl2', floorSystem: 'tji-ijoist', includeFoundation: false })
    const l2Cols = r2.createdNodes.filter((n) => n.type === 'structural:column')
    expect(l2Cols.length).toBeGreaterThanOrEqual(2)
    for (const c of l2Cols) {
      expect(typeof c.transfersToNodeId).toBe('string')
      expect(l1Cols.has(c.transfersToNodeId as string)).toBe(true)
    }

    const afterL2 = mergeCreated(afterL1, r2.createdNodes)
    const audit = auditStructuralScene(afterL2)
    expect(audit.findings.filter((f) => f.category === 'column-footing' || f.category === 'load-path')).toHaveLength(0)
    expect(audit.passed).toBe(true)
  })

  test('STR-BUG-04: unwalled-level firestop skip is scoped per building and still audits R302.11(3) stairs & R302.11(5) MEP penetrations', () => {
    const twoBldgScene: Record<string, SceneNodeLike> = {
      bldg_a: { id: 'bldg_a', type: 'building' },
      lvl_a0: { id: 'lvl_a0', type: 'level', parentId: 'bldg_a', level: 0, height: 2.74 },
      lvl_a1_deck: { id: 'lvl_a1_deck', type: 'level', parentId: 'bldg_a', level: 1, height: 2.74 },
      w_a1: { id: 'w_a1', type: 'wall', parentId: 'lvl_a0', start: [0, 0], end: [8, 0], height: 2.74 },
      w_a2: { id: 'w_a2', type: 'wall', parentId: 'lvl_a0', start: [8, 0], end: [8, 6], height: 2.74 },
      w_a3: { id: 'w_a3', type: 'wall', parentId: 'lvl_a0', start: [8, 6], end: [0, 6], height: 2.74 },
      w_a4: { id: 'w_a4', type: 'wall', parentId: 'lvl_a0', start: [0, 6], end: [0, 0], height: 2.74 },
      // Building A unwalled deck has a large slab (draftstop suppressed) PLUS a stair & vertical pipe penetration (MUST be audited!)
      slab_a_deck: { id: 'slab_a_deck', type: 'slab', parentId: 'lvl_a1_deck', polygon: [[0, 0], [18, 0], [18, 18], [0, 18]] },
      roof_a_deck: { id: 'roof_a_deck', type: 'roof', parentId: 'lvl_a1_deck', pitch: 26.57 },
      stair_a_deck: { id: 'stair_a_deck', type: 'stair', parentId: 'lvl_a1_deck', position: [3, 0, 3], width: 1.0, depth: 3.0, height: 2.74 },
      pipe_a_deck: { id: 'pipe_a_deck', type: 'plumbing:pipe-run', parentId: 'lvl_a1_deck', path: [[4, -0.3, 4], [4, 3.0, 4]] },

      // Building B is a SEPARATE unframed building whose unwalled level has a large slab + roof (MUST NOT be suppressed by Building A!)
      bldg_b: { id: 'bldg_b', type: 'building' },
      lvl_b0: { id: 'lvl_b0', type: 'level', parentId: 'bldg_b', level: 0, height: 2.74 },
      slab_b: { id: 'slab_b', type: 'slab', parentId: 'lvl_b0', polygon: [[30, 0], [50, 0], [50, 20], [30, 20]] },
      roof_b: { id: 'roof_b', type: 'roof', parentId: 'lvl_b0', pitch: 26.57 },
    }

    const rA = autopopulateStructuralScene(twoBldgScene, { levelId: 'lvl_a0', floorSystem: 'open-web-truss' })
    const combined = mergeCreated(twoBldgScene, rA.createdNodes)
    const audit = auditStructuralScene(combined)

    // Building A's unwalled roof deck MUST still flag R302.11(3) stair and R302.11(5) MEP penetration
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11(3)')).toBe(true)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11(5)')).toBe(true)
    // Building B's unframed level MUST still be audited for R302.12.1 attic draftstop (no cross-building leakage from Building A!)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.12.1')).toBe(true)
  })

  test('STR-CON-01: shared catalog-backed isHoldDownConnector & resolveHoldDownUpliftLbs stay aligned across load-path and catalog', () => {
    expect(CONNECTOR_CATALOG.length).toBe(47)
    // Cataloged HDU5-SDS2.5 WITHOUT explicit category is recognized consistently
    const hduNoCat: SceneNodeLike = {
      id: 'hd1',
      type: 'structural:connector',
      sku: 'HDU5-SDS2.5',
      quantity: 2,
      attachedNodeIds: ['w1'],
    }
    expect(isHoldDownConnector(hduNoCat)).toBe(true)
    expect(resolveHoldDownUpliftLbs(hduNoCat)).toBe(5645)

    // Unlisted HTT4 without category is NOT accepted by catalog-backed predicate
    const unlistedHtt: SceneNodeLike = { id: 'hd_htt', type: 'structural:connector', sku: 'HTT4' }
    expect(isHoldDownConnector(unlistedHtt)).toBe(false)
    expect(resolveHoldDownUpliftLbs(unlistedHtt)).toBe(0)

    // Non-hold-down catalog SKU (H2.5A) is NEVER misclassified even if category is tampered
    const hurricaneTie: SceneNodeLike = { id: 'ht1', type: 'structural:connector', sku: 'H2.5A', category: 'hold-down' }
    expect(isHoldDownConnector(hurricaneTie)).toBe(false)
    expect(resolveHoldDownUpliftLbs(hurricaneTie)).toBe(0)

    // High-wind / SDC D2 uplift continuity in traceStructuralLoadPaths recognizes cataloged HDU5-SDS2.5 without category field
    const upliftScene: Record<string, SceneNodeLike> = {
      w1: { id: 'w1', type: 'wall', start: [0, 0], end: [6, 0], height: 2.74 },
      hd1: hduNoCat,
      strap1: { id: 'strap1', type: 'structural:connector', category: 'tension-strap', sku: 'MSTA36' },
    }
    const lp = traceStructuralLoadPaths({
      nodes: upliftScene,
      design: { seismicCategory: 'D2', windMph: 135, storiesAbove: 0 },
    })
    expect(lp.upliftFindings.some((u) => /hold-down/i.test(u))).toBe(false)
  })

  test('STR-CON-02: includeFoundation=false omits cast-in-place SSTB16 anchor bolts and emits HDU4/HDU5-SDS2.5 instead of STHD14', () => {
    // Storefront CS-PF wall line that normally selects STHD14 + SSTB16 on ground floor
    const upperStoryScene: Record<string, SceneNodeLike> = {
      lvl2: { id: 'lvl2', type: 'level', level: 1, height: 2.7432 },
      w_glass: { id: 'w_glass', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [8, 0], height: 2.7432 },
      d1: { id: 'd1', type: 'door', parentId: 'w_glass', width: 3.4, height: 2.13, position: [2.0, 0, 0] },
      d2: { id: 'd2', type: 'door', parentId: 'w_glass', width: 3.4, height: 2.13, position: [6.0, 0, 0] },
      w_n: { id: 'w_n', type: 'wall', parentId: 'lvl2', start: [0, 6], end: [8, 6], height: 2.7432 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [0, 6], height: 2.7432 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'lvl2', start: [8, 0], end: [8, 6], height: 2.7432 },
    }

    const res = autopopulateStructuralScene(upperStoryScene, {
      levelId: 'lvl2',
      includeFoundation: false,
    })
    const connectors = res.createdNodes.filter((n) => n.type === 'structural:connector')
    expect(connectors.some((c) => c.sku === 'SSTB16')).toBe(false)
    expect(connectors.some((c) => c.sku === 'STHD14')).toBe(false)
    expect(connectors.some((c) => c.sku === 'HDU4-SDS2.5' || c.sku === 'HDU5-SDS2.5')).toBe(true)

    const combined = mergeCreated(upperStoryScene, res.createdNodes)
    const bwl = evaluateBracedWallLines({ nodes: combined, levelId: 'lvl2' }).find((b) =>
      b.wallIds.includes('w_glass'),
    )!
    expect(bwl.passes).toBe(true)
  })

  test('VIS-02: fallback roof uses perimeter/tallest wall height (not averaged with 2.5m partitions) and clips to L-shaped enclosed footprint', () => {
    // Bouldering-Gym-style L-shaped hall: 4.8m tall perimeter walls + four 2.5m restroom partition walls,
    // with empty cutout quadrant [0..10, 8..16].
    const gymL: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: 4.8 },
      // Tall 4.8m L-shaped perimeter walls: [0..20, 0..8] U [10..20, 8..16]
      w_s: { id: 'w_s', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [20, 0], height: 4.8 },
      w_e: { id: 'w_e', type: 'wall', parentId: 'lvl1', start: [20, 0], end: [20, 16], height: 4.8 },
      w_ne: { id: 'w_ne', type: 'wall', parentId: 'lvl1', start: [20, 16], end: [10, 16], height: 4.8 },
      w_step_v: { id: 'w_step_v', type: 'wall', parentId: 'lvl1', start: [10, 16], end: [10, 8], height: 4.8 },
      w_step_h: { id: 'w_step_h', type: 'wall', parentId: 'lvl1', start: [10, 8], end: [0, 8], height: 4.8 },
      w_w: { id: 'w_w', type: 'wall', parentId: 'lvl1', start: [0, 8], end: [0, 0], height: 4.8 },
      // Low 2.5m interior restroom partitions (must NOT drag roof seat down below 4.8m!)
      w_p1: { id: 'w_p1', type: 'wall', parentId: 'lvl1', start: [12, 2], end: [16, 2], height: 2.5 },
      w_p2: { id: 'w_p2', type: 'wall', parentId: 'lvl1', start: [16, 2], end: [16, 6], height: 2.5 },
      w_p3: { id: 'w_p3', type: 'wall', parentId: 'lvl1', start: [16, 6], end: [12, 6], height: 2.5 },
      w_p4: { id: 'w_p4', type: 'wall', parentId: 'lvl1', start: [12, 6], end: [12, 2], height: 2.5 },
    }
    const asm: SceneNodeLike = {
      id: 'strasm_gym',
      type: 'structural:assembly',
      parentId: 'lvl1',
      roofSystem: 'stick-rafter',
      visibleSystems: { walls: false, floor: false, roof: true, beams: true, connectors: true, foundation: false },
    }

    const skel = buildBuildingSkeletonGroup({ assembly: asm, nodes: gymL })
    const lumber = extractBucketInstances(skel, 'lumber')
    expect(lumber.length).toBeGreaterThan(20)

    // 1. Roof seat height MUST sit at ~4.8m (allowing small eave drop of 0.4 * 0.5 = 0.20m + half rafter depth ~0.10m -> minY >= 4.45m, NEVER down at ~3.4m!)
    const minRoofY = Math.min(...lumber.flatMap((m) => m.corners.map((c) => c.y)))
    expect(minRoofY).toBeGreaterThan(4.4)

    // 2. ZERO rafters or ceiling joists may extend deep into the empty cutout quadrant [0..9.2, 8.8..16]!
    const strayInCutout = lumber.filter((m) =>
      m.corners.some((c) => c.x < 9.2 && c.z > 8.8),
    )
    expect(strayInCutout).toHaveLength(0)
  })

  test('VIS-03: excludes outdoor/pool/patio/exterior-step slabs and clips floor joists strictly to rotated/L-shaped slab polygons', () => {
    // Rotated ~30-degree interior room polygon + outdoor swimming pool + detached patio + exterior step (elev 0.35m)
    const cos = Math.cos(Math.PI / 6)
    const sin = Math.sin(Math.PI / 6)
    const rotPt = (lx: number, lz: number): [number, number] => [
      Number((lx * cos - lz * sin).toFixed(4)),
      Number((lx * sin + lz * cos).toFixed(4)),
    ]
    const p0 = rotPt(0, 0)
    const p1 = rotPt(8, 0)
    const p2 = rotPt(8, 5)
    const p3 = rotPt(0, 5)
    const rotatedPoly: Array<[number, number]> = [p0, p1, p2, p3]

    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: p0, end: p1, height: 2.74 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: p1, end: p2, height: 2.74 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: p2, end: p3, height: 2.74 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: p3, end: p0, height: 2.74 },
      slab_interior: {
        id: 'slab_interior',
        type: 'slab',
        parentId: 'lvl1',
        name: 'Living Room Floor',
        elevation: 0,
        polygon: rotatedPoly,
      },
      // Outdoor named pool slab
      slab_pool: {
        id: 'slab_pool',
        type: 'slab',
        parentId: 'lvl1',
        name: 'Swimming Pool Deck',
        elevation: 0,
        polygon: [[12, 0], [18, 0], [18, 5], [12, 5]],
      },
      // Unnamed detached yard slab completely outside the walls
      slab_yard_unnamed: {
        id: 'slab_yard_unnamed',
        type: 'slab',
        parentId: 'lvl1',
        name: 'Slab 3',
        elevation: 0,
        polygon: [[-10, -8], [-4, -8], [-4, -3], [-10, -3]],
      },
      // Unnamed small elevated exterior step outside the front wall (elev 0.35m)
      slab_step: {
        id: 'slab_step',
        type: 'slab',
        parentId: 'lvl1',
        name: 'Slab 4',
        elevation: 0.35,
        polygon: [[1, -2.0], [3, -2.0], [3, -0.5], [1, -0.5]],
      },
    }

    const asm: SceneNodeLike = {
      id: 'strasm_floor',
      type: 'structural:assembly',
      parentId: 'lvl1',
      floorSystem: 'dimensional',
      visibleSystems: { walls: false, floor: true, roof: false, beams: false, connectors: false, foundation: false },
    }
    const skel = buildBuildingSkeletonGroup({ assembly: asm, nodes: scene })
    const joists = extractBucketInstances(skel, 'lumber')
    expect(joists.length).toBeGreaterThan(5)

    // 1. ZERO joists may appear over the pool (x > 11), yard slab (x < -3.5), or exterior step (z < -0.4)!
    expect(joists.some((j) => j.center.x > 11)).toBe(false)
    expect(joists.some((j) => j.center.x < -3.5)).toBe(false)
    expect(joists.some((j) => j.center.z < -0.4)).toBe(false)

    // 2. EVERY synthesized joist center MUST lie strictly inside the rotated interior slab polygon!
    for (const j of joists) {
      expect(pointInPoly2D(j.center.x, j.center.z, rotatedPoly)).toBe(true)
    }
  })

  test('VIS-04: commercial building with RTU and 0 pitched roof-segments gets flat roof deck + framed RTU curb opening (double trimmers/headers, 0 joists through RTU)', () => {
    const dentalOffice: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: 3.0 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0], height: 3.0 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 9], height: 3.0 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [12, 9], end: [0, 9], height: 3.0 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 9], end: [0, 0], height: 3.0 },
      rtu1: {
        id: 'rtu1',
        type: 'hvac:equipment',
        parentId: 'lvl1',
        name: 'Packaged RTU (5-Ton)',
        equipmentKind: 'rooftop-package-unit',
        position: [6, 3.15, 4.5],
        widthM: 1.55,
        depthM: 1.15,
        heightM: 1.05,
      },
    }
    const asm: SceneNodeLike = {
      id: 'strasm_dental',
      type: 'structural:assembly',
      parentId: 'lvl1',
      roofSystem: 'stick-rafter',
      visibleSystems: { walls: false, floor: false, roof: true, beams: true, connectors: true, foundation: false },
    }
    const skel = buildBuildingSkeletonGroup({ assembly: asm, nodes: dentalOffice })
    const lumber = extractBucketInstances(skel, 'lumber')
    const lvlFraming = extractBucketInstances(skel, 'header-lvl')
    const curbFrame = extractBucketInstances(skel, 'pt-sill')

    // 1. Flat commercial roof deck stays near wallH = 3.0..3.45m (NEVER a pitched gable peak at ~5.25m!)
    const maxLumberY = Math.max(...lumber.flatMap((m) => m.corners.map((c) => c.y)))
    expect(maxLumberY).toBeLessThan(3.5)
    expect(maxLumberY).toBeGreaterThan(3.05)

    // 2. Double trimmers (4 plies) + double headers (4 plies) = 8 LVL opening framing members + 4 curb sill pieces
    expect(lvlFraming.length).toBeGreaterThanOrEqual(8)
    expect(curbFrame.length).toBe(4)

    // 3. ZERO lumber roof joists slice through the interior of the RTU box [6-0.75..6+0.75, 4.5-0.55..4.5+0.55]!
    const slicingThroughRtu = lumber.filter((m) => {
      const minX = Math.min(...m.corners.map((c) => c.x))
      const maxX = Math.max(...m.corners.map((c) => c.x))
      const minZ = Math.min(...m.corners.map((c) => c.z))
      const maxZ = Math.max(...m.corners.map((c) => c.z))
      return maxX > 6 - 0.72 && minX < 6 + 0.72 && maxZ > 4.5 - 0.52 && minZ < 4.5 + 0.52
    })
    expect(slicingThroughRtu).toHaveLength(0)

    // 4. Audit does NOT false-flag the RTU as piercing a pitched roof!
    const audit = auditStructuralScene(dentalOffice)
    expect(audit.findings.some((f) => f.nodeId === 'rtu1')).toBe(false)
  })

  test('VIS-07: detects roof-rafter-plane & exterior-envelope MEP intrusions while respecting legitimate exceptions', () => {
    const house: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 0, height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [10, 0], height: 2.74 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [10, 0], end: [10, 8], height: 2.74 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [10, 8], end: [0, 8], height: 2.74 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 8], end: [0, 0], height: 2.74 },

      // BAD 1: Indoor duct near eave (z = 0.5) poking high above 6:12 roof plane (roofY ≈ 2.74 + 0.25 = 2.99m, duct top = 3.7m -> +0.71m error!)
      bad_duct_roof: {
        id: 'bad_duct_roof',
        type: 'hvac:duct-run',
        parentId: 'lvl1',
        name: 'Supply Trunk Near Eave',
        shape: 'rectangular',
        width: 12,
        height: 10,
        path: [
          [2, 3.57, 0.5],
          [8, 3.57, 0.5],
        ],
      },
      // BAD 2: Indoor air handler perched outside the east wall (x = 11.2 > 10 + 0.15)
      bad_equip_ext: {
        id: 'bad_equip_ext',
        type: 'hvac:equipment',
        parentId: 'lvl1',
        name: 'Indoor Air Handler',
        equipmentKind: 'air-handler',
        position: [11.2, 0, 4],
        heightM: 1.22,
      },
      // GOOD 1: Main DWV vent stack going through roof -> MUST NOT flag!
      good_vent_stack: {
        id: 'good_vent_stack',
        type: 'plumbing:pipe-run',
        parentId: 'lvl1',
        name: 'Main DWV Soil & Vent Stack (Through Roof)',
        isMainVentStack: true,
        nominalSize: '3',
        path: [
          [5, 0, 4],
          [5, 5.5, 4],
        ],
      },
      // GOOD 2: Outdoor heat pump condenser in yard -> MUST NOT flag!
      good_condenser: {
        id: 'good_condenser',
        type: 'hvac:equipment',
        parentId: 'lvl1',
        name: 'Outdoor Heat Pump Condenser',
        equipmentKind: 'heat-pump-outdoor',
        position: [12.0, 0, 4],
        heightM: 0.9,
      },
      // GOOD 3: Exterior refrigerant lineset running out to condenser -> MUST NOT flag!
      good_lineset: {
        id: 'good_lineset',
        type: 'hvac:duct-run',
        parentId: 'lvl1',
        name: 'Refrigerant Lineset',
        system: 'refrigerant-lineset',
        path: [
          [8, 1.0, 4],
          [12.0, 0.5, 4],
        ],
      },
    }

    const audit = auditStructuralScene(house)
    const roofDuctFinding = audit.findings.find((f) => f.nodeId === 'bad_duct_roof')
    expect(roofDuctFinding).toBeDefined()
    expect(roofDuctFinding!.severity).toBe('error')
    expect(roofDuctFinding!.category).toBe('mep-clash')

    const extEquipFinding = audit.findings.find((f) => f.nodeId === 'bad_equip_ext')
    expect(extEquipFinding).toBeDefined()
    expect(extEquipFinding!.category).toBe('mep-clash')

    // Legitimate exceptions MUST produce zero findings!
    expect(audit.findings.some((f) => f.nodeId === 'good_vent_stack' && f.category === 'mep-clash')).toBe(false)
    expect(audit.findings.some((f) => f.nodeId === 'good_condenser')).toBe(false)
    expect(audit.findings.some((f) => f.nodeId === 'good_lineset')).toBe(false)

    // Lower story beneath a higher walled story MUST NOT trigger pitched-roof protrusion findings!
    const twoStory: Record<string, SceneNodeLike> = {
      ...house,
      lvl2: { id: 'lvl2', type: 'level', parentId: 'bldg', level: 1, height: 2.74 },
      w2_1: { id: 'w2_1', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [10, 0], height: 2.74 },
      w2_2: { id: 'w2_2', type: 'wall', parentId: 'lvl2', start: [10, 0], end: [10, 8], height: 2.74 },
    }
    const twoStoryAudit = auditStructuralScene(twoStory)
    expect(twoStoryAudit.findings.some((f) => f.nodeId === 'bad_duct_roof')).toBe(false)
  })

  test('R2-STR-01: waived <4 ft interior nib wall cannot chain as prevPassing across a >60 ft BWL span', () => {
    // True passing perimeter BWLs sit 22m (> 60 ft / 18.29m maxBwlSpacingM) apart at z=0 and z=22.
    // A short <4.0 ft (0.9m) interior nib wall at z=10 gets waived, followed by a failing 6m interior
    // partition wall at z=14. Distance from nib (10) to north (22) is 12m <= 18.29m, but the nib wall
    // was NOT originally passing so the 6m partition MUST NOT chain off it and MUST remain failing.
    const wideScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w_south: {
        id: 'w_south',
        type: 'wall',
        parentId: 'lvl1',
        start: [0, 0],
        end: [10, 0],
        height: 2.7432,
        frontSide: 'exterior',
      },
      w_nib: {
        id: 'w_nib',
        type: 'wall',
        parentId: 'lvl1',
        start: [2, 10],
        end: [2.9, 10],
        height: 2.7432,
        frontSide: 'interior',
        backSide: 'interior',
      },
      w_part: {
        id: 'w_part',
        type: 'wall',
        parentId: 'lvl1',
        start: [0, 14],
        end: [6, 14],
        height: 2.7432,
        frontSide: 'interior',
        backSide: 'interior',
      },
      d_part: {
        id: 'd_part',
        type: 'door',
        parentId: 'w_part',
        width: 5.5,
        height: 2.13,
        position: [3, 0, 0],
      },
      w_north: {
        id: 'w_north',
        type: 'wall',
        parentId: 'lvl1',
        start: [0, 22],
        end: [10, 22],
        height: 2.7432,
        frontSide: 'exterior',
      },
    }

    const bwls = evaluateBracedWallLines({ nodes: wideScene, levelId: 'lvl1' })
    const nibBwl = bwls.find((b) => b.wallIds.includes('w_nib'))
    const partBwl = bwls.find((b) => b.wallIds.includes('w_part'))
    const southBwl = bwls.find((b) => b.wallIds.includes('w_south'))
    const northBwl = bwls.find((b) => b.wallIds.includes('w_north'))

    expect(southBwl?.passes).toBe(true)
    expect(northBwl?.passes).toBe(true)
    expect(nibBwl).toBeDefined()
    expect(nibBwl?.passes).toBe(true)
    expect(partBwl).toBeDefined()
    expect(partBwl?.passes).toBe(false)
  })

  test('R2-STR-02: 3-story upper columns wire transfersToNodeId to story 1 (not story 0), and large eave-protruding duct with centerline <= wallH + 0.05 is flagged', () => {
    // Part A: 3-story L-shaped building where story 0 columns are inserted BEFORE story 1 columns
    const makeL = (lvlId: string, prefix: string): Record<string, SceneNodeLike> => ({
      [`${prefix}_s`]: { id: `${prefix}_s`, type: 'wall', parentId: lvlId, start: [0, 0], end: [18, 0], height: 2.7432 },
      [`${prefix}_el`]: { id: `${prefix}_el`, type: 'wall', parentId: lvlId, start: [18, 0], end: [18, 5], height: 2.7432 },
      [`${prefix}_sh`]: { id: `${prefix}_sh`, type: 'wall', parentId: lvlId, start: [18, 5], end: [9, 5], height: 2.7432 },
      [`${prefix}_sv`]: { id: `${prefix}_sv`, type: 'wall', parentId: lvlId, start: [9, 5], end: [9, 14], height: 2.7432 },
      [`${prefix}_nw`]: { id: `${prefix}_nw`, type: 'wall', parentId: lvlId, start: [9, 14], end: [0, 14], height: 2.7432 },
      [`${prefix}_w`]: { id: `${prefix}_w`, type: 'wall', parentId: lvlId, start: [0, 14], end: [0, 0], height: 2.7432 },
    })

    const threeStoryL: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7432 },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: 2.7432 },
      lvl2: { id: 'lvl2', type: 'level', parentId: 'bldg', level: 2, height: 2.7432 },
      ...makeL('lvl0', 'w0'),
      ...makeL('lvl1', 'w1'),
      ...makeL('lvl2', 'w2'),
    }

    const r0 = autopopulateStructuralScene(threeStoryL, { levelId: 'lvl0', floorSystem: 'tji-ijoist', includeFoundation: true })
    const afterL0 = mergeCreated(threeStoryL, r0.createdNodes)
    const l0ColIds = new Set(r0.createdNodes.filter((n) => n.type === 'structural:column').map((n) => n.id))
    expect(l0ColIds.size).toBeGreaterThanOrEqual(2)

    const r1 = autopopulateStructuralScene(afterL0, { levelId: 'lvl1', floorSystem: 'tji-ijoist', includeFoundation: false })
    const afterL1 = mergeCreated(afterL0, r1.createdNodes)
    const l1ColIds = new Set(r1.createdNodes.filter((n) => n.type === 'structural:column').map((n) => n.id))
    expect(l1ColIds.size).toBeGreaterThanOrEqual(2)

    const r2 = autopopulateStructuralScene(afterL1, { levelId: 'lvl2', floorSystem: 'tji-ijoist', includeFoundation: false })
    const l2GirderCols = r2.createdNodes.filter(
      (n) => n.type === 'structural:column' && typeof n.name === 'string' && n.name.includes('Girder'),
    )
    expect(l2GirderCols.length).toBeGreaterThanOrEqual(2)
    for (const col of l2GirderCols) {
      expect(typeof col.transfersToNodeId).toBe('string')
      expect(l1ColIds.has(col.transfersToNodeId as string)).toBe(true)
      expect(l0ColIds.has(col.transfersToNodeId as string)).toBe(false)
    }

    // Part B: Large 24"-tall duct with centerline py=2.74 <= wallH+0.05 (2.79m) near eave (z=0.1, roofY=2.79m)
    // Top is 2.74 + 0.3048 = 3.0448m > roofY + 0.15 (2.94m) -> MUST be flagged as an error!
    const eaveDuctHouse: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 0, height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [10, 0], height: 2.74 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [10, 0], end: [10, 8], height: 2.74 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [10, 8], end: [0, 8], height: 2.74 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 8], end: [0, 0], height: 2.74 },
      large_eave_duct: {
        id: 'large_eave_duct',
        type: 'hvac:duct-run',
        parentId: 'lvl1',
        name: 'Oversized Trunk Near Eave',
        shape: 'rectangular',
        width: 24,
        height: 24,
        path: [
          [2, 2.74, 0.1],
          [8, 2.74, 0.1],
        ],
      },
    }

    const eaveAudit = auditStructuralScene(eaveDuctHouse)
    const eaveFinding = eaveAudit.findings.find((f) => f.nodeId === 'large_eave_duct' && f.category === 'mep-clash')
    expect(eaveFinding).toBeDefined()
    expect(eaveFinding?.severity).toBe('error')
  })
})
