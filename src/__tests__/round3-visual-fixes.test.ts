import { describe, expect, test } from 'bun:test'
import { type InstancedMesh, Matrix4, Vector3 } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { auditStructuralScene } from '../irc/audit'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { deriveRequiredFirestops } from '../irc/fireblocking'
import { extractWallOpenings } from '../irc/openings'
import {
  type SceneNodeLike,
  shouldAdoptRoofSegmentOntoLevel,
} from '../irc/tables'
import { computeSkeletonFingerprint } from '../nodes/assembly-renderer'
import { computeSceneIdentityKey, useStructuralUi } from '../ui/store'

function extractBucketInstances(group: ReturnType<typeof buildBuildingSkeletonGroup>, bucketName: string) {
  const inst = group.children.find((c) => c.name === `structural-skeleton-${bucketName}`) as InstancedMesh | undefined
  if (!inst) return []
  const out: Array<{ center: Vector3; corners: Vector3[]; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }> = []
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
    out.push({
      center,
      corners,
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y)),
      minZ: Math.min(...corners.map((c) => c.z)),
      maxZ: Math.max(...corners.map((c) => c.z)),
    })
  }
  return out
}

function roofOnlyAssembly(levelId: string, overrides: Partial<SceneNodeLike> = {}): SceneNodeLike {
  return {
    id: `strasm_${levelId}`,
    type: 'structural:assembly',
    parentId: levelId,
    species: 'df-l-2',
    studSize: '2x6',
    studSpacingIn: 16,
    floorSystem: 'tji-ijoist',
    roofSystem: 'stick-rafter',
    visibleSystems: {
      walls: false,
      floor: false,
      roof: true,
      beams: true,
      connectors: true,
      foundation: false,
      firestop: false,
    },
    ...overrides,
  }
}

describe('Round 3 Structural Visual & Geometry Regression Suite (VIS-V3-01/02/06/07/08/11)', () => {
  test('VIS-V3-01a: narrow-width/long-depth hip & dutch roofs rotate ridge onto Z axis with tapered hip ends (no monster gable)', () => {
    const H = 2.8
    // Narrow-width / long-depth hip roof (w=4.85, d=19.4, 40 deg)
    const hipNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_hip: {
        id: 'r_hip',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'hip',
        width: 4.85,
        depth: 19.4,
        pitch: 40,
        overhang: 0.35,
        wallHeight: 0,
      },
    }
    const hipGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: hipNodes })
    const hipBeams = extractBucketInstances(hipGroup, 'header-lvl')
    const hipLumber = extractBucketInstances(hipGroup, 'lumber')

    // Ridge must run along Z (~19.4 - 4.85 = 14.55 m), NOT along X!
    expect(hipBeams.length).toBe(1)
    const ridge = hipBeams[0]!
    expect(ridge.maxZ - ridge.minZ).toBeGreaterThan(14.0)
    expect(ridge.maxZ - ridge.minZ).toBeLessThan(15.0)
    expect(ridge.maxX - ridge.minX).toBeLessThan(0.25)

    // True rise = (4.85 / 2) * tan(40 deg) = 2.035 m -> peak ~ 4.835 m (NEVER ~10.94 m!)
    const expectedRise = (4.85 / 2) * Math.tan((40 * Math.PI) / 180)
    const maxHipY = Math.max(...hipLumber.map((m) => m.maxY))
    expect(maxHipY).toBeGreaterThan(H + expectedRise - 0.15)
    expect(maxHipY).toBeLessThan(H + expectedRise + 0.25)

    // Verify hip ends taper cleanly: at |z| > 8.5 m (past ridge end at 7.275 m), no lumber exceeds the hip end slope!
    const slopeTan = Math.tan((40 * Math.PI) / 180)
    for (const m of hipLumber) {
      if (Math.abs(m.center.z) > 8.5) {
        const dFromEnd = Math.max(0, 19.4 / 2 - Math.abs(m.center.z))
        const allowedY = H + dFromEnd * slopeTan + 0.22
        expect(m.center.y).toBeLessThanOrEqual(allowedY)
      }
    }

    // Narrow-width / long-depth dutch roof (w=5.72, d=14.61, 40 deg)
    const dutchNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_dutch: {
        id: 'r_dutch',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'dutch',
        width: 5.72,
        depth: 14.61,
        pitch: 40,
        overhang: 0.35,
        wallHeight: 0,
      },
    }
    const dutchGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: dutchNodes })
    const dutchBeams = extractBucketInstances(dutchGroup, 'header-lvl')
    const dutchLumber = extractBucketInstances(dutchGroup, 'lumber')
    expect(dutchBeams.length).toBe(1)
    expect(dutchBeams[0]!.maxZ - dutchBeams[0]!.minZ).toBeGreaterThan(8.5)
    expect(dutchBeams[0]!.maxX - dutchBeams[0]!.minX).toBeLessThan(0.25)
    const dutchRise = (5.72 / 2) * Math.tan((40 * Math.PI) / 180)
    const maxDutchY = Math.max(...dutchLumber.map((m) => m.maxY))
    expect(maxDutchY).toBeLessThan(H + dutchRise + 0.25)
  })

  test('VIS-V3-01b: conical turret emits radial rafters + octagonal ring plate + king post (zero rectangular corners), mansard caps <= 2.2m, flat stays flat', () => {
    const H = 3.0
    // 1. Conical turret (radius = 2.0 m, overhang = 0.3 m)
    const coneNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_cone: {
        id: 'r_cone',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [5, 0, -4],
        rotation: 0,
        roofType: 'conical',
        width: 4.0,
        depth: 4.0,
        pitch: 50,
        overhang: 0.3,
        wallHeight: 0,
      },
    }
    const coneGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: coneNodes })
    const coneLumber = extractBucketInstances(coneGroup, 'lumber')
    // 8 octagonal ring plates + 1 king post + 12..16 radial rafters >= 21
    expect(coneLumber.length).toBeGreaterThanOrEqual(21)
    // Every single corner must stay radially within radius + overhang + member clearance (never rectangular sqrt(2)*2.3 = 3.25m!)
    const maxAllowedRadius = 2.0 + 0.3 + 0.16
    for (const m of coneLumber) {
      for (const c of m.corners) {
        const r = Math.hypot(c.x - 5, c.z - -4)
        expect(r).toBeLessThanOrEqual(maxAllowedRadius)
      }
    }
    const maxConeY = Math.max(...coneLumber.map((m) => m.maxY))
    expect(maxConeY).toBeGreaterThan(H + 2.0 * Math.tan((50 * Math.PI) / 180) - 0.15)

    // 2. Mansard roof (steep perimeter slope + capped rise <= 2.2m + flat upper deck joists)
    const mansardNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_man: {
        id: 'r_man',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'mansard',
        width: 6.0,
        depth: 10.0,
        pitch: 65,
        overhang: 0.3,
        wallHeight: 0,
      },
    }
    const mansardGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: mansardNodes })
    const mansardLumber = extractBucketInstances(mansardGroup, 'lumber')
    const mansardCapBeams = extractBucketInstances(mansardGroup, 'header-lvl')
    expect(mansardCapBeams.length).toBe(4) // 4 upper cap perimeter rim beams
    const maxMansardY = Math.max(...mansardLumber.map((m) => m.maxY))
    expect(maxMansardY).toBeLessThanOrEqual(H + 2.2 + 0.25)

    // 3. Flat roof segment (riseM = 0, flat joists at y = H..H+0.35m)
    const flatNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_flat: {
        id: 'r_flat',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'flat',
        width: 8.0,
        depth: 6.0,
        pitch: 30,
        overhang: 0.3,
        wallHeight: 0,
      },
    }
    const flatGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: flatNodes })
    const flatLumber = extractBucketInstances(flatGroup, 'lumber')
    expect(flatLumber.length).toBeGreaterThanOrEqual(6)
    const maxFlatY = Math.max(...flatLumber.map((m) => m.maxY))
    expect(maxFlatY).toBeLessThan(H + 0.4)
  })

  test('VIS-V3-02 & Polish A: directly-parented upper-story wing roof seats flush at y=0 even when touching shared 2-story wall, and does not suppress upper-story roof', () => {
    const H = 2.8
    // Realistic 2-story Pascal layout:
    // - lvl0 (Main floor) covers core X[0..8] + 1-story wing X[8..14]
    // - lvl1 (Floor 2) covers ONLY core X[0..8]; 1-story wing roof is directly parented to lvl1 at py=0 and TOUCHES shared wall X=8!
    // - lvl2_roof (wall-less Roof level) holds the 2-story core roof over X[0..8]
    const stackedNodes: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: H },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: H },
      lvl2_roof: { id: 'lvl2_roof', type: 'level', parentId: 'bldg', level: 2, height: 0 },
      w0_1: { id: 'w0_1', type: 'wall', parentId: 'lvl0', start: [0, 0], end: [14, 0], height: H },
      w0_2: { id: 'w0_2', type: 'wall', parentId: 'lvl0', start: [14, 0], end: [14, 6], height: H },
      w0_3: { id: 'w0_3', type: 'wall', parentId: 'lvl0', start: [14, 6], end: [0, 6], height: H },
      w0_4: { id: 'w0_4', type: 'wall', parentId: 'lvl0', start: [0, 6], end: [0, 0], height: H },
      w1_1: { id: 'w1_1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [8, 0], height: H },
      w1_2: { id: 'w1_2', type: 'wall', parentId: 'lvl1', start: [8, 0], end: [8, 6], height: H },
      w1_3: { id: 'w1_3', type: 'wall', parentId: 'lvl1', start: [8, 6], end: [0, 6], height: H },
      w1_4: { id: 'w1_4', type: 'wall', parentId: 'lvl1', start: [0, 6], end: [0, 0], height: H },
      // 2-story core roof on wall-less Roof level -> adopted onto lvl1 at cy = H = 2.8m
      r_core: {
        id: 'r_core',
        type: 'roof-segment',
        parentId: 'lvl2_roof',
        position: [4, 0, 3],
        rotation: 0,
        roofType: 'gable',
        width: 8,
        depth: 6,
        pitch: 26.57,
        overhang: 0.35,
        wallHeight: 0,
      },
      // 1-story wing roof directly parented to Floor 2 at py = 0, TOUCHING shared wall X = 8 (X in [8..14]) -> MUST STILL seat at cy = 0!
      r_wing: {
        id: 'r_wing',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [11, 0, 3],
        rotation: 0,
        roofType: 'gable',
        width: 6,
        depth: 6,
        pitch: 26.57,
        overhang: 0.35,
        wallHeight: 0,
      },
    }

    const skelLvl1 = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: stackedNodes })
    const ridges = extractBucketInstances(skelLvl1, 'header-lvl')
    const coreRidge = ridges.find((r) => r.center.x < 8)
    const wingRidge = ridges.find((r) => r.center.x > 8)
    expect(coreRidge).toBeDefined()
    expect(wingRidge).toBeDefined()
    // Core ridge sits at H + 1.5m - 0.09 ≈ 4.21m; wing ridge sits at 0 + 1.5m - 0.09 ≈ 1.41m (exact 2.8m step!)
    expect(coreRidge!.center.y).toBeGreaterThan(H + 1.1)
    expect(wingRidge!.center.y).toBeLessThan(1.8)
    expect(coreRidge!.center.y - wingRidge!.center.y).toBeCloseTo(H, 1)

    // Per-segment wall-less roof level adoption picks exact underlying story
    const roofLvlNode = stackedNodes.lvl2_roof!
    // Wing roof over X[9..14], Z[0.5..5.5] (center 11.5, 3, half 2.5, 2.5) overlaps lvl0's walls (X=14, Z=0, Z=6) and NOT lvl1's (X<=8)
    expect(shouldAdoptRoofSegmentOntoLevel(stackedNodes, 'lvl0', roofLvlNode, 11.5, 3, 2.5, 2.5)).toBe(true)
    expect(shouldAdoptRoofSegmentOntoLevel(stackedNodes, 'lvl1', roofLvlNode, 11.5, 3, 2.5, 2.5)).toBe(false)
    expect(shouldAdoptRoofSegmentOntoLevel(stackedNodes, 'lvl1', roofLvlNode, 4, 3, 4, 3)).toBe(true)
    expect(shouldAdoptRoofSegmentOntoLevel(stackedNodes, 'lvl0', roofLvlNode, 4, 3, 4, 3)).toBe(false)

    // Polish A (FarmHouse case): when Floor 2 has ONLY a directly-parented 1-story porch roof at y=0 (and NO top roof),
    // the low porch roof must NOT suppress Floor 2's 2nd-story fallback gable roof!
    const porchOnlyNodes: Record<string, SceneNodeLike> = { ...stackedNodes }
    delete porchOnlyNodes.r_core
    delete porchOnlyNodes.lvl2_roof
    const skelPorch = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: porchOnlyNodes })
    const porchRidges = extractBucketInstances(skelPorch, 'header-lvl')
    const upperFallbackRidge = porchRidges.find((r) => r.center.x < 8 && r.center.y > H + 1.0)
    const lowerPorchRidge = porchRidges.find((r) => r.center.x > 8 && r.center.y < 1.8)
    expect(upperFallbackRidge).toBeDefined()
    expect(lowerPorchRidge).toBeDefined()
  })

  test('VIS-V3-06: partial explicit roof coverage synthesizes clipped fallback gable over uncovered wing with zero overlap', () => {
    const H = 2.74
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      // Full 12.7m x 11.8m walled footprint: X[22.9..35.6], Z[-13.5..-1.7]
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [22.9, -13.5], end: [35.6, -13.5], height: H },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [35.6, -13.5], end: [35.6, -1.7], height: H },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [35.6, -1.7], end: [22.9, -1.7], height: H },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [22.9, -1.7], end: [22.9, -13.5], height: H },
      // Explicit roof segment covering only NW corner (~25% of footprint): X[22.9..27.55], Z[-13.5..-5.45]
      r_partial: {
        id: 'r_partial',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [25.2, 0, -9.5],
        rotation: 0,
        roofType: 'gable',
        width: 4.65,
        depth: 8.05,
        pitch: 30,
        overhang: 0.35,
        wallHeight: 0,
      },
    }

    const skel = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes })
    const lumber = extractBucketInstances(skel, 'lumber')
    const ridges = extractBucketInstances(skel, 'header-lvl')

    // Expect BOTH the explicit ridge (around X=25.2) AND a synthesized fallback ridge covering the uncovered east/south wing (X > 28)
    expect(ridges.length).toBeGreaterThanOrEqual(2)
    const uncoveredRafters = lumber.filter((m) => m.center.x > 30.0 && m.center.z > -8.0 && m.center.y > H + 0.1)
    expect(uncoveredRafters.length).toBeGreaterThan(4)
  })

  test('VIS-V3-07: tall commercial wall resolves level.height fallback in extractWallOpenings & splits 10-ft firestops cleanly around storefront glass', () => {
    const H = 5.0
    const gymNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      // Wall intentionally omits wall.height (relies on host level.height = 5.0m)
      w_front: { id: 'w_front', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0] },
      w_right: { id: 'w_right', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 8] },
      w_back: { id: 'w_back', type: 'wall', parentId: 'lvl1', start: [12, 8], end: [0, 8] },
      w_left: { id: 'w_left', type: 'wall', parentId: 'lvl1', start: [0, 8], end: [0, 0] },
      // 4.06m tall storefront window centered at u=6.0m, sill=0.2m -> head=4.26m (crosses 3.048m 10-ft firestop tier!)
      win_storefront: {
        id: 'win_storefront',
        type: 'window',
        parentId: 'w_front',
        name: 'Storefront Glazing',
        width: 4.0,
        height: 4.06,
        sillHeight: 0.2,
        position: [6.0, 2.23, 0],
      },
    }

    // 1. Opening height must NOT be clamped to 2.37m!
    const ops = extractWallOpenings(gymNodes, gymNodes.w_front!)
    expect(ops.length).toBe(1)
    expect(ops[0]!.heightM).toBeCloseTo(4.06, 2)
    expect(ops[0]!.headYM).toBeCloseTo(4.26, 2)

    // 2. Skeleton wall studs, headers & 10-ft firestops must NOT slice through storefront glass X[4.05..7.95], Y[0.35..4.15]
    const asm: SceneNodeLike = {
      id: 'strasm_gym',
      type: 'structural:assembly',
      parentId: 'lvl1',
      visibleSystems: { walls: true, floor: false, roof: false, beams: true, connectors: false, foundation: false, firestop: true },
    }
    const skel = buildBuildingSkeletonGroup({ assembly: asm, nodes: gymNodes })
    const lumber = extractBucketInstances(skel, 'lumber')
    const headers = extractBucketInstances(skel, 'header-lvl')
    const firestops = extractBucketInstances(skel, 'firestop')

    const studsInGlass = lumber.filter(
      (m) => m.center.z < 0.25 && m.maxX > 4.08 && m.minX < 7.92 && m.maxY > 0.35 && m.minY < 4.15,
    )
    expect(studsInGlass).toHaveLength(0)

    const headersInGlass = headers.filter(
      (m) => m.center.z < 0.25 && m.maxX > 4.08 && m.minX < 7.92 && m.minY < 4.15,
    )
    expect(headersInGlass).toHaveLength(0)

    // 10-ft firestops on w_front must exist on BOTH solid sides (X < 4 and X > 8) and NEVER cross X[4.05..7.95]!
    const frontFirestops = firestops.filter((m) => m.center.z < 0.25)
    expect(frontFirestops.length).toBe(2)
    for (const fs of frontFirestops) {
      expect(fs.maxX <= 4.05 || fs.minX >= 7.95).toBe(true)
    }

    // 3. Persisted IRC R302.11(2) firestops from deriveRequiredFirestops / autopopulate ALSO split cleanly around storefront glass
    const derived = deriveRequiredFirestops({ nodes: gymNodes, levelId: 'lvl1' }).filter(
      (f) => f.hostWallId === 'w_front' && f.firestopKind === 'wall-vertical-10ft',
    )
    expect(derived.length).toBe(2)
    for (const fs of derived) {
      const segMinX = Math.min(fs.start[0], fs.end[0])
      const segMaxX = Math.max(fs.start[0], fs.end[0])
      expect(segMaxX <= 4.05 || segMinX >= 7.95).toBe(true)
    }

    const auto = autopopulateStructuralScene(gymNodes, { levelId: 'lvl1' })
    const merged: Record<string, SceneNodeLike> = { ...gymNodes }
    for (const n of auto.createdNodes) merged[n.id] = n
    const audit = auditStructuralScene(merged)
    expect(audit.errorCount).toBe(0)
  })

  test('VIS-V3-08: exposed gable & gambrel ends emit vertical rake studs from plate to rafter underside, and xrayHiddenIds preserves roof framing', () => {
    const H = 2.74
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_gambrel: {
        id: 'r_gambrel',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gambrel',
        width: 8.0,
        depth: 6.0,
        pitch: 35,
        overhang: 0.35,
        wallHeight: 0,
      },
    }
    const asm = roofOnlyAssembly('lvl1', { studSpacingIn: 16 })
    const group = buildBuildingSkeletonGroup({ assembly: asm, nodes })
    const lumber = extractBucketInstances(group, 'lumber')
    // Vertical rake studs at lx = -4.0 and lx = +4.0 start at y = H (plate) and extend vertically
    const rakeStuds = lumber.filter(
      (m) =>
        (Math.abs(m.center.x - -4.0) < 0.08 || Math.abs(m.center.x - 4.0) < 0.08) &&
        m.maxY - m.minY > 0.25 &&
        m.maxZ - m.minZ < 0.14 &&
        Math.abs(m.minY - H) < 0.05,
    )
    expect(rakeStuds.length).toBeGreaterThanOrEqual(8)

    // X-Ray mode hides architectural roof-segment (`visible: false`) while keeping ID in `xrayHiddenIds`:
    // roof framing skeleton AND fingerprint MUST remain intact!
    const xrayNodes: Record<string, SceneNodeLike> = {
      ...nodes,
      r_gambrel: { ...nodes.r_gambrel!, visible: false },
    }
    const hiddenSet = new Set(['r_gambrel'])
    const fpVisible = computeSkeletonFingerprint(asm, nodes)
    const fpXray = computeSkeletonFingerprint(asm, xrayNodes, hiddenSet)
    expect(fpXray).toBe(fpVisible)

    const xrayGroup = buildBuildingSkeletonGroup({ assembly: asm, nodes: xrayNodes, xrayHiddenIds: hiddenSet })
    expect(extractBucketInstances(xrayGroup, 'lumber').length).toBe(lumber.length)
  })

  test('VIS-V3-11: scene-switch resets stale editedDesignParams & xrayHiddenNodeIds, and rotated RTU curb opening avoids trimmer overlap', () => {
    // 1. Cross-project UI store isolation
    const ui = useStructuralUi.getState()
    ui.resetDesignDefaults()
    ui.syncSceneKey(computeSceneIdentityKey({ site_a: { id: 'site_a', type: 'site' } }))
    ui.setGroundSnowPsf(95)
    ui.setSeismicCategory('D2')
    ui.setXrayHiddenNodeIds(['roof_a'])
    expect(useStructuralUi.getState().editedDesignParams.groundSnowPsf).toBe(95)
    expect(useStructuralUi.getState().xrayHiddenNodeIds).toEqual(['roof_a'])

    // Switching to Project B must clear stale design overrides and X-Ray hidden list
    useStructuralUi.getState().syncSceneKey(computeSceneIdentityKey({ site_b: { id: 'site_b', type: 'site' } }))
    expect(useStructuralUi.getState().editedDesignParams).toEqual({})
    expect(useStructuralUi.getState().groundSnowPsf).toBe(30)
    expect(useStructuralUi.getState().xrayHiddenNodeIds).toEqual([])

    // 2. Rotated RTU (`rotation: [0, Math.PI/2, 0]`, `width: 2.0, depth: 1.2`) on commercial flat roof
    const dental: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: 3.0 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0], height: 3.0 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 9], height: 3.0 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [12, 9], end: [0, 9], height: 3.0 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 9], end: [0, 0], height: 3.0 },
      rtu_rot: {
        id: 'rtu_rot',
        type: 'hvac:equipment',
        parentId: 'lvl1',
        name: 'Commercial RTU',
        equipmentKind: 'rooftop-package-unit',
        position: [6, 3.15, 4.5],
        rotation: [0, Math.PI / 2, 0],
        width: 2.0,
        depth: 1.2,
        heightM: 1.1,
      },
    }
    const skel = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: dental })
    const lumber = extractBucketInstances(skel, 'lumber')
    const lvl = extractBucketInstances(skel, 'header-lvl')
    // Rotated 90 deg -> spans X[6-0.6..6+0.6], Z[4.5-1.0..4.5+1.0]: zero lumber joists may enter the rotated RTU box!
    const slicingRtu = lumber.filter(
      (m) => m.maxX > 6 - 0.58 && m.minX < 6 + 0.58 && m.maxZ > 4.5 - 0.98 && m.minZ < 4.5 + 0.98,
    )
    expect(slicingRtu).toHaveLength(0)
    expect(lvl.length).toBeGreaterThanOrEqual(8)

    // Polish C: Verify commercial flat-roof joists use crisp 24" OC (0.6096m) spacing (not crowded 16" OC)
    const fullSpanJoists = lumber
      .filter((m) => m.maxZ - m.minZ > 8.0)
      .sort((a, b) => a.center.x - b.center.x)
    expect(fullSpanJoists.length).toBeGreaterThanOrEqual(4)
    const minSpacing = Math.min(
      ...fullSpanJoists.slice(1).map((m, idx) => m.center.x - fullSpanJoists[idx]!.center.x),
    )
    expect(minSpacing).toBeGreaterThan(0.58)
  })

  test('Polish B: raised-heel roof wallHeight (0.5m gable/hip, 1.0m conical) frames perimeter knee-walls & extended gable rake studs flush to double top plate (zero air gap)', () => {
    const H = 2.8
    // 1. Gable with wallHeight = 0.5m: gable-end rake studs AND eave knee-wall studs must extend down to y = H = 2.8m!
    const gableNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_gable: {
        id: 'r_gable',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 8.0,
        depth: 6.0,
        pitch: 30,
        overhang: 0.3,
        wallHeight: 0.5,
      },
    }
    const gableGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: gableNodes })
    const gableLumber = extractBucketInstances(gableGroup, 'lumber')
    // Eave knee-wall members at z = ±3.0 must span the [H, H + 0.5] band (zero gap!)
    const eaveKneeStuds = gableLumber.filter(
      (m) =>
        (Math.abs(m.center.z - -3.0) < 0.08 || Math.abs(m.center.z - 3.0) < 0.08) &&
        m.minY >= H - 0.05 &&
        m.minY <= H + 0.08 &&
        m.maxY <= H + 0.52 &&
        m.maxY - m.minY > 0.35,
    )
    expect(eaveKneeStuds.length).toBeGreaterThanOrEqual(20)
    // Gable-end rake studs at x = ±4.0 must extend all the way down to y = H (NOT stop at H + 0.5!)
    const extendedRakeStuds = gableLumber.filter(
      (m) =>
        (Math.abs(m.center.x - -4.0) < 0.08 || Math.abs(m.center.x - 4.0) < 0.08) &&
        m.minY <= H + 0.05 &&
        m.maxY > H + 0.8 &&
        m.maxZ - m.minZ < 0.14,
    )
    expect(extendedRakeStuds.length).toBeGreaterThanOrEqual(8)

    // 2. Conical turret with wallHeight = 1.0m: octagonal drum knee-wall studs fill [H, H + 1.0] strictly within radius
    const coneNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: H },
      r_cone: {
        id: 'r_cone',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'conical',
        width: 3.5,
        depth: 3.5,
        pitch: 32,
        overhang: 0.3,
        wallHeight: 1.0,
      },
    }
    const coneGroup = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes: coneNodes })
    const coneLumber = extractBucketInstances(coneGroup, 'lumber')
    const drumStuds = coneLumber.filter(
      (m) => m.minY <= H + 0.08 && m.maxY >= H + 0.9 && m.maxY <= H + 1.05 && m.maxY - m.minY > 0.8,
    )
    expect(drumStuds.length).toBeGreaterThanOrEqual(16)
    for (const s of drumStuds) {
      expect(Math.hypot(s.center.x, s.center.z)).toBeLessThanOrEqual(1.75 + 0.12)
    }
  })

  test('Polish D: audit firestop matching honors continuous segment distance for multi-hole stairwells & exact zone label after modest edge drift', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0, height: 2.8 },
      // Slab with 2 adjacent stairwell holes covered by a single continuous 3.78m placed stair-stringer firestop
      slab1: {
        id: 'slab1',
        type: 'slab',
        parentId: 'lvl1',
        elevation: 0.05,
        polygon: [
          [-4, -4],
          [4, -4],
          [4, 4],
          [-4, 4],
        ],
        holes: [
          [
            [-1.8, -1.79],
            [0.68, -1.79],
            [0.68, 0.2],
            [-1.8, 0.2],
          ],
          [
            [0.68, -1.54],
            [1.79, -1.54],
            [1.79, -0.5],
            [0.68, -0.5],
          ],
        ],
      },
      // Zone whose west edge shifted 2.0m east after initial firestop placement
      zone_bath: {
        id: 'zone_bath',
        type: 'zone',
        parentId: 'lvl1',
        name: 'Kid bathroom',
        polygon: [
          [-10, -7],
          [-8.5, -7],
          [-8.5, -4],
          [-10, -4],
        ],
      },
      // Continuous stair-stringer firestop covering both holes (midpoint [-0.1, -1.79] is 1.36m from hole #2 midpoint, but 0.25m from segment!)
      fs_stair: {
        id: 'fs_stair',
        type: 'structural:firestop',
        parentId: 'lvl1',
        name: 'R302.11(3) Stairwell Opening Stringer Fire Blocking (slab1)',
        firestopKind: 'stair-stringer',
        material: '2x-lumber',
        start: [-1.99, -1.79],
        end: [1.79, -1.79],
        elevationY: -0.2,
        heightM: 0.25,
        thicknessM: 0.0381,
      },
      fs_bath_ns: {
        id: 'fs_bath_ns',
        type: 'structural:firestop',
        parentId: 'lvl1',
        name: 'R302.11(1) Soffit / Drop-Ceiling Fireblock (North/South edge, Kid bathroom)',
        firestopKind: 'soffit-drop-ceiling',
        material: '23/32-osb',
        start: [-12, -7],
        end: [-8.5, -7],
        elevationY: 2.14,
        heightM: 0.3,
        thicknessM: 0.019,
      },
      fs_bath_ew: {
        id: 'fs_bath_ew',
        type: 'structural:firestop',
        parentId: 'lvl1',
        name: 'R302.11(1) Soffit / Drop-Ceiling Fireblock (East/West edge, Kid bathroom)',
        firestopKind: 'soffit-drop-ceiling',
        material: '23/32-osb',
        start: [-12, -7],
        end: [-12, -4],
        elevationY: 2.14,
        heightM: 0.3,
        thicknessM: 0.019,
      },
    }

    const rep = auditStructuralScene(scene)
    const fireFindings = rep.findings.filter((f) => f.category === 'fire-blocking')
    expect(fireFindings).toHaveLength(0)

    // Still catches genuinely missing firestop when removed!
    const missingBathEw = { ...scene }
    delete missingBathEw.fs_bath_ew
    const repMissing = auditStructuralScene(missingBathEw)
    expect(repMissing.findings.some((f) => f.category === 'fire-blocking' && f.message.includes('East/West edge, Kid bathroom'))).toBe(true)
  })

  test('User Annotated Fix 1: zero-gap roof bearing extension bridges level.height (2.8m) vs wall.height (2.5m) on both adopted upper roofs and directly-parented 1-story wing roofs', () => {
    const STACK_H = 2.8
    const WALL_H = 2.5
    const nodes: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: STACK_H },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: STACK_H },
      lvl2_roof: { id: 'lvl2_roof', type: 'level', parentId: 'bldg', level: 2, height: 0 },
      // Main floor right 1-story wing: X[5..10], Z[-4..4], explicit wall.height = 2.5m under level.height = 2.8m
      w0_1: { id: 'w0_1', type: 'wall', parentId: 'lvl0', start: [5, -4], end: [10, -4], height: WALL_H },
      w0_2: { id: 'w0_2', type: 'wall', parentId: 'lvl0', start: [10, -4], end: [10, 4], height: WALL_H },
      w0_3: { id: 'w0_3', type: 'wall', parentId: 'lvl0', start: [10, 4], end: [5, 4], height: WALL_H },
      w0_4: { id: 'w0_4', type: 'wall', parentId: 'lvl0', start: [5, 4], end: [5, -4], height: WALL_H },
      // Floor 2 left 2-story core: X[-10..-4], Z[-4..4], explicit wall.height = 2.5m under level.height = 2.8m
      w1_1: { id: 'w1_1', type: 'wall', parentId: 'lvl1', start: [-10, -4], end: [-4, -4], height: WALL_H },
      w1_2: { id: 'w1_2', type: 'wall', parentId: 'lvl1', start: [-4, -4], end: [-4, 4], height: WALL_H },
      w1_3: { id: 'w1_3', type: 'wall', parentId: 'lvl1', start: [-4, 4], end: [-10, 4], height: WALL_H },
      w1_4: { id: 'w1_4', type: 'wall', parentId: 'lvl1', start: [-10, 4], end: [-10, -4], height: WALL_H },
      // Adopted gable roof over Floor 2 core (wallHeight = 0.5m)
      r_upper_gable: {
        id: 'r_upper_gable',
        type: 'roof-segment',
        parentId: 'lvl2_roof',
        position: [-7, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 6,
        depth: 8,
        pitch: 30,
        overhang: 0.3,
        wallHeight: 0.5,
      },
      // Directly-parented 1-story hip roof on Floor 2 at py = 0 over Main floor's 2.5m right wing (wallHeight = 0.5m)
      r_wing_hip: {
        id: 'r_wing_hip',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [7.5, 0, 0],
        rotation: 0,
        roofType: 'hip',
        width: 5,
        depth: 8,
        pitch: 35,
        overhang: 0.3,
        wallHeight: 0.5,
      },
    }

    const skelLvl1 = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes })
    const lumber = extractBucketInstances(skelLvl1, 'lumber')

    // Gap #1 (Floor 2 gable): gable rake studs & raised-heel knee wall extend all the way down to localY = 2.50m (0.00m gap!)
    const upperGableBearing = lumber.filter((m) => m.center.x < -3.5)
    expect(upperGableBearing.length).toBeGreaterThan(20)
    const upperMinY = Math.min(...upperGableBearing.map((m) => m.minY))
    expect(upperMinY).toBeCloseTo(WALL_H, 2)

    // Gap #2 (1-story right hip wing on Floor 2): raised-heel knee wall extends down to localY = -0.30m (worldY = 2.50m, 0.00m gap!)
    const rightWingBearing = lumber.filter((m) => m.center.x > 4.5)
    expect(rightWingBearing.length).toBeGreaterThan(20)
    const rightWingMinY = Math.min(...rightWingBearing.map((m) => m.minY))
    expect(rightWingMinY).toBeCloseTo(WALL_H - STACK_H, 2)
  })

  test('User Annotated Fix 2: uncovered 1-story central flat-roofed connecting wing gets 24" OC flat joists at bearing wall top (zero joists over Pool/Lanai or under Floor 2)', () => {
    const STACK_H = 2.8
    const WALL_H = 2.5
    const nodes: Record<string, SceneNodeLike> = {
      bldg: { id: 'bldg', type: 'building' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: STACK_H },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: STACK_H },
      // Main floor U-shape: left wing X[-12..-6], central bar X[-6..4.5] Z[-8..1.5], right wing X[4.5..9]
      w0_n: { id: 'w0_n', type: 'wall', parentId: 'lvl0', start: [-12, -8], end: [9, -8], height: WALL_H },
      w0_e: { id: 'w0_e', type: 'wall', parentId: 'lvl0', start: [9, -8], end: [9, 6], height: WALL_H },
      w0_se: { id: 'w0_se', type: 'wall', parentId: 'lvl0', start: [9, 6], end: [4.5, 6], height: WALL_H },
      w0_m1: { id: 'w0_m1', type: 'wall', parentId: 'lvl0', start: [4.5, 6], end: [4.5, 1.5], height: WALL_H },
      w0_mid: { id: 'w0_mid', type: 'wall', parentId: 'lvl0', start: [4.5, 1.5], end: [-6, 1.5], height: WALL_H },
      w0_m2: { id: 'w0_m2', type: 'wall', parentId: 'lvl0', start: [-6, 1.5], end: [-6, 6], height: WALL_H },
      w0_sw: { id: 'w0_sw', type: 'wall', parentId: 'lvl0', start: [-6, 6], end: [-12, 6], height: WALL_H },
      w0_w: { id: 'w0_w', type: 'wall', parentId: 'lvl0', start: [-12, 6], end: [-12, -8], height: WALL_H },
      // Indoor living/kitchen zone in central connecting bar
      z_living: {
        id: 'z_living',
        type: 'zone',
        parentId: 'lvl0',
        name: 'Living room',
        polygon: [
          [-6, -8],
          [4.5, -8],
          [4.5, 1.5],
          [-6, 1.5],
        ],
      },
      // Outdoor Lanai & Pool in courtyard Z[1.5..8.5] — MUST receive ZERO flat-roof joists!
      z_lanai: {
        id: 'z_lanai',
        type: 'zone',
        parentId: 'lvl0',
        name: 'Lanai',
        polygon: [
          [-6, 1.5],
          [4.5, 1.5],
          [4.5, 6],
          [-6, 6],
        ],
      },
      z_pool: {
        id: 'z_pool',
        type: 'zone',
        parentId: 'lvl0',
        name: 'Pool',
        polygon: [
          [-5, 6],
          [3.5, 6],
          [3.5, 9],
          [-5, 9],
        ],
      },
      // Floor 2 covers ONLY left wing X[-12..-6], Z[-8..6]
      w1_1: { id: 'w1_1', type: 'wall', parentId: 'lvl1', start: [-12, -8], end: [-6, -8], height: WALL_H },
      w1_2: { id: 'w1_2', type: 'wall', parentId: 'lvl1', start: [-6, -8], end: [-6, 6], height: WALL_H },
      w1_3: { id: 'w1_3', type: 'wall', parentId: 'lvl1', start: [-6, 6], end: [-12, 6], height: WALL_H },
      w1_4: { id: 'w1_4', type: 'wall', parentId: 'lvl1', start: [-12, 6], end: [-12, -8], height: WALL_H },
      // Right 1-story wing covered by explicit hip roof directly parented on Floor 2
      r_right: {
        id: 'r_right',
        type: 'roof-segment',
        parentId: 'lvl1',
        position: [6.75, 0, -1],
        rotation: 0,
        roofType: 'hip',
        width: 4.5,
        depth: 14,
        pitch: 35,
        overhang: 0.3,
        wallHeight: 0.5,
      },
      // Standard auto-framed Main floor assembly has visibleSystems.roof = false (per VIS-X7)
      strasm_lvl0: {
        id: 'strasm_lvl0',
        type: 'structural:assembly',
        parentId: 'lvl0',
        visibleSystems: { walls: true, floor: true, roof: false, beams: true, connectors: true, foundation: true },
      },
    }

    // 1. Rendered via Floor 2's roof pass (live DB / VIS-X7 path when Main floor has roof: false)
    const skelLvl1 = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl1'), nodes })
    const lumber1 = extractBucketInstances(skelLvl1, 'lumber')
    const flatJoists1 = lumber1.filter(
      (m) => m.center.x > -5.8 && m.center.x < 4.3 && m.center.z > -7.8 && m.center.z < 1.3 && m.center.y < 0.05 && m.center.y > -0.35,
    )
    expect(flatJoists1.length).toBeGreaterThanOrEqual(8)
    // Seated cleanly at localY = -0.30..-0.059 (worldY = 2.50..2.741m)
    expect(Math.min(...flatJoists1.map((m) => m.minY))).toBeCloseTo(WALL_H - STACK_H, 2)
    // ZERO joists over outdoor Lanai / Pool courtyard (Z > 1.7)
    const overCourtyard = lumber1.filter((m) => m.center.x > -5.5 && m.center.x < 4.2 && m.center.z > 1.7)
    expect(overCourtyard).toHaveLength(0)

    // 2. Rendered directly on Main floor when Main floor assembly has roof: true
    const skelLvl0 = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('lvl0'), nodes })
    const lumber0 = extractBucketInstances(skelLvl0, 'lumber')
    const flatJoists0 = lumber0.filter(
      (m) => m.center.x > -5.8 && m.center.x < 4.3 && m.center.z > -7.8 && m.center.z < 1.3,
    )
    expect(flatJoists0.length).toBeGreaterThanOrEqual(8)
    expect(Math.min(...flatJoists0.map((m) => m.minY))).toBeCloseTo(WALL_H, 2)
    // ZERO joists inside Floor 2's footprint (X < -6.3) or over Lanai/Pool (Z > 1.7)
    expect(lumber0.filter((m) => m.center.x < -6.3)).toHaveLength(0)
    expect(lumber0.filter((m) => m.center.z > 1.7)).toHaveLength(0)
  })
})
