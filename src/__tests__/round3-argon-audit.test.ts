import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { type InstancedMesh, Matrix4, Vector3 } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { clusterLevelFootprints, computeLevelBounds } from '../irc/openings'
import type { SceneNodeLike } from '../irc/tables'
import { computeSkeletonFingerprint } from '../nodes/assembly-renderer'
import { structuralBeamParametrics, structuralColumnParametrics } from '../nodes/parametrics'

function extractBucketInstances(group: ReturnType<typeof buildBuildingSkeletonGroup>, bucketName: string) {
  const inst = group.children.find((c) => c.name === `structural-skeleton-${bucketName}`) as InstancedMesh | undefined
  if (!inst) return []
  const out: Array<{ center: Vector3; corners: Vector3[]; ySpan: number }> = []
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
    const ys = corners.map((c) => c.y)
    out.push({ center, corners, ySpan: Math.max(...ys) - Math.min(...ys) })
  }
  return out
}

const roofOnlyAssembly = (levelId = 'level_1'): SceneNodeLike => ({
  id: 'strasm_r3',
  type: 'structural:assembly',
  parentId: levelId,
  visible: true,
  species: 'df-l-2',
  studSize: '2x6',
  studSpacingIn: 16,
  floorSystem: 'tji-ijoist',
  roofSystem: 'stick-rafter',
  wallHeightM: 2.55,
  visibleSystems: {
    walls: false,
    floor: false,
    roof: true,
    beams: true,
    columns: false,
    connectors: true,
    firestop: false,
    foundation: false,
  },
})

describe('Round 3 Gemini 4 Argon Audit Regression Suite (R3-BUG-01..06, R3-OPT-01..02, R3-CON-01..03)', () => {
  test('R3-BUG-01: both-ends-clipped cross-gable emits diagonal valley sleepers down to low eave (never horizontal ridge bar)', () => {
    const H = 2.55
    // Two parallel tall wings (z = -4 and z = +4) flanking a lower perpendicular connector gable bridging z = -3..+3
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: H, baseElevation: 0 },
      roof_n: { id: 'roof_n', type: 'roof', parentId: 'level_1', visible: true, position: [0, H, -4], rotation: 0 },
      rseg_n: {
        id: 'rseg_n',
        type: 'roof-segment',
        parentId: 'roof_n',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 12,
        depth: 6,
        pitch: 33.69, // peak H + 2.0
        overhang: 0.35,
        wallHeight: 0,
      },
      roof_s: { id: 'roof_s', type: 'roof', parentId: 'level_1', visible: true, position: [0, H, 4], rotation: 0 },
      rseg_s: {
        id: 'rseg_s',
        type: 'roof-segment',
        parentId: 'roof_s',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 12,
        depth: 6,
        pitch: 33.69, // peak H + 2.0
        overhang: 0.35,
        wallHeight: 0,
      },
      roof_bridge: {
        id: 'roof_bridge',
        type: 'roof',
        parentId: 'level_1',
        visible: true,
        position: [0, H, 0],
        rotation: Math.PI / 2,
      },
      rseg_bridge: {
        id: 'rseg_bridge',
        type: 'roof-segment',
        parentId: 'roof_bridge',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 8, // clips at BOTH ends against roof_n and roof_s!
        depth: 4,
        pitch: 26.57, // peak H + 1.0 < H + 2.0
        overhang: 0.3,
        wallHeight: 0,
      },
    }

    const group = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('level_1'), nodes })
    const lvl = extractBucketInstances(group, 'header-lvl')
    // 2 host ridges + 1 bridge ridge + 4 diagonal valley sleepers (2 per side) = 7 LVL members
    expect(lvl.length).toBeGreaterThanOrEqual(7)
    const valleySleepers = lvl.slice(3)
    // Every valley sleeper MUST slope diagonally in Y (never collapse into a flat horizontal beam along the ridge!)
    for (const vs of valleySleepers) {
      expect(vs.ySpan).toBeGreaterThan(0.35)
    }
  })

  test('R3-BUG-02: equal-peak T-intersection anchors valley sleepers flush to ridge apex (zero top gap)', () => {
    const H = 2.55
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: H, baseElevation: 0 },
      roof_main: { id: 'roof_main', type: 'roof', parentId: 'level_1', visible: true, position: [0, H, 0], rotation: 0 },
      rseg_main: {
        id: 'rseg_main',
        type: 'roof-segment',
        parentId: 'roof_main',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 12,
        depth: 8,
        pitch: 26.565, // peak = 2.55 + 2.0 = 4.55
        overhang: 0.4,
        wallHeight: 0,
      },
      roof_wing: {
        id: 'roof_wing',
        type: 'roof',
        parentId: 'level_1',
        visible: true,
        position: [0, H, 3.0],
        rotation: Math.PI / 2,
      },
      rseg_wing: {
        id: 'rseg_wing',
        type: 'roof-segment',
        parentId: 'roof_wing',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 6, // z from 0.0 to 6.0: ridge touches main ridge at exact (0, 4.55, 0)!
        depth: 8,
        pitch: 26.565, // exact equal peak = 4.55
        overhang: 0.4,
        wallHeight: 0,
      },
    }

    const group = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('level_1'), nodes })
    const lvl = extractBucketInstances(group, 'header-lvl')
    // 1 main ridge + 1 wing ridge + 2 diagonal valley sleepers = 4
    expect(lvl.length).toBe(4)
    const apex = new Vector3(0, H + 2.0, 0)
    for (const sleeper of lvl.slice(2)) {
      const minDistToApex = Math.min(...sleeper.corners.map((c) => c.distanceTo(apex)))
      expect(minDistToApex).toBeLessThan(0.2)
    }
  })

  test('R3-BUG-04: elevated walls/slabs propagate baseElevationM through openings, autopopulate, and skeleton fallbacks', () => {
    const BASE_Y = 3.0
    const H = 2.7432
    const nodes: Record<string, SceneNodeLike> = {
      level_e: { id: 'level_e', type: 'level', level: 0, height: H, baseElevation: 0 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_e', start: [0, 0], end: [10, 0], height: H, elevation: BASE_Y },
      w2: { id: 'w2', type: 'wall', parentId: 'level_e', start: [10, 0], end: [10, 8], height: H, elevation: BASE_Y },
      w3: { id: 'w3', type: 'wall', parentId: 'level_e', start: [10, 8], end: [0, 8], height: H, elevation: BASE_Y },
      w4: { id: 'w4', type: 'wall', parentId: 'level_e', start: [0, 8], end: [0, 0], height: H, elevation: BASE_Y },
    }
    const bounds = computeLevelBounds(nodes, 'level_e')
    expect(bounds.baseElevationM).toBeCloseTo(BASE_Y, 3)
    const clusters = clusterLevelFootprints(nodes, 'level_e')
    expect(clusters[0]!.baseElevationM).toBeCloseTo(BASE_Y, 3)

    const auto = autopopulateStructuralScene(nodes, {
      levelId: 'level_e',
      floorSystem: 'tji-ijoist',
      roofSystem: 'ridge-beam-cathedral',
      includeRoof: true,
      includeFoundation: true,
    })
    const ridgeBeams = auto.createdNodes.filter((n) => n.type === 'structural:beam' && n.role === 'ridge-beam')
    expect(ridgeBeams.length).toBeGreaterThan(0)
    // Ridge must sit above BASE_Y + H = 5.7432 m (not down at 2.74 m!)
    expect(Number(ridgeBeams[0]!.elevationY)).toBeGreaterThan(BASE_Y + H)

    const ties = auto.createdNodes.filter((n) => n.type === 'structural:connector' && n.sku === 'H2.5A')
    expect(ties.length).toBeGreaterThan(0)
    expect(ties[0]!.position![1]).toBeCloseTo(BASE_Y + H, 2)

    const asm = auto.createdNodes.find((n) => n.type === 'structural:assembly')!
    const skel = buildBuildingSkeletonGroup({ assembly: asm, nodes })
    const lumber = extractBucketInstances(skel, 'lumber')
    // Fallback roof peak corners must sit well above BASE_Y + H (e.g. ~7.74 m, not ~4.74 m)
    const maxY = Math.max(...lumber.flatMap((m) => m.corners.map((c) => c.y)))
    expect(maxY).toBeGreaterThan(BASE_Y + H + 1.8)
  })

  test('R3-BUG-05: suppresses interior valley-throat gable rake studs while preserving flush exterior front gable studs', () => {
    const H = 2.4384
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level', level: 1, height: H, baseElevation: 0 },
      roof_main: { id: 'roof_main', type: 'roof', parentId: 'level_1', visible: true, position: [0, H, 0], rotation: 0 },
      rseg_main: {
        id: 'rseg_main',
        type: 'roof-segment',
        parentId: 'roof_main',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 10.98,
        depth: 7.32,
        pitch: 33.69, // 8:12
        overhang: 0.45,
        wallHeight: 0,
      },
      roof_cross: {
        id: 'roof_cross',
        type: 'roof',
        parentId: 'level_1',
        visible: true,
        position: [-2.74, H, 2.55],
        rotation: Math.PI / 2,
      },
      rseg_cross: {
        id: 'rseg_cross',
        type: 'roof-segment',
        parentId: 'roof_cross',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        // Rear end at z = 2.55 - 1.11 = 1.44 (mid-slope where hostY = H + 1.48 < peak H + 1.75 -> valley throat!)
        // Front end at z = 2.55 + 1.11 = 3.66 (flush on front wall where hostY = H -> exterior gable face!)
        width: 2.22,
        depth: 4.2,
        pitch: 39.81, // 10:12
        overhang: 0.42,
        wallHeight: 0,
      },
    }

    const mainOnly = { ...nodes }
    delete mainOnly.roof_cross
    delete mainOnly.rseg_cross
    const mainLumber = extractBucketInstances(
      buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('level_1'), nodes: mainOnly }),
      'lumber',
    )
    const dualLumber = extractBucketInstances(
      buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('level_1'), nodes }),
      'lumber',
    )
    const crossLumber = dualLumber.slice(mainLumber.length)

    // Count vertical studs (tall ySpan, narrow XZ footprint) at rear throat (z ≈ 1.44) vs front exterior gable (z ≈ 3.66)
    const isVerticalStud = (m: { corners: Vector3[]; ySpan: number }) => {
      const xs = m.corners.map((c) => c.x)
      const zs = m.corners.map((c) => c.z)
      return m.ySpan > 0.2 && Math.max(...xs) - Math.min(...xs) < 0.12 && Math.max(...zs) - Math.min(...zs) < 0.12
    }
    const rearThroatStuds = crossLumber.filter((m) => isVerticalStud(m) && Math.abs(m.center.z - 1.44) < 0.15)
    const frontExteriorStuds = crossLumber.filter((m) => isVerticalStud(m) && Math.abs(m.center.z - 3.66) < 0.15)
    expect(rearThroatStuds.length).toBe(0)
    expect(frontExteriorStuds.length).toBeGreaterThanOrEqual(5)
  })

  test('R3-BUG-06: persisted E-W main ridge beam does not suppress perpendicular N-S cross-gable skeleton ridge beam', () => {
    const H = 2.4384
    const nodes: Record<string, SceneNodeLike> = {
      level_1: { id: 'level_1', type: 'level', level: 1, height: H, baseElevation: 0 },
      roof_main: { id: 'roof_main', type: 'roof', parentId: 'level_1', visible: true, position: [0, H, 0], rotation: 0 },
      rseg_main: {
        id: 'rseg_main',
        type: 'roof-segment',
        parentId: 'roof_main',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 10.98,
        depth: 7.32,
        pitch: 33.69,
        overhang: 0.45,
        wallHeight: 0,
      },
      roof_cross: {
        id: 'roof_cross',
        type: 'roof',
        parentId: 'level_1',
        visible: true,
        position: [-2.74, H, 1.95],
        rotation: Math.PI / 2,
      },
      rseg_cross: {
        id: 'rseg_cross',
        type: 'roof-segment',
        parentId: 'roof_cross',
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        roofType: 'gable',
        width: 3.42,
        depth: 4.2,
        pitch: 39.81,
        overhang: 0.42,
        wallHeight: 0,
      },
      persisted_main_ridge: {
        id: 'persisted_main_ridge',
        type: 'structural:beam',
        parentId: 'level_1',
        visible: true,
        role: 'ridge-beam',
        start: [-5.49, 0],
        end: [5.49, 0],
        elevationY: H + 2.35,
      },
    }

    const group = buildBuildingSkeletonGroup({ assembly: roofOnlyAssembly('level_1'), nodes })
    const lvl = extractBucketInstances(group, 'header-lvl')
    // Main skeleton ridge IS suppressed (covered by persisted_main_ridge),
    // but perpendicular cross-gable ridge + 2 valley sleepers = 3 LVL members MUST remain!
    expect(lvl.length).toBe(3)
  })

  test('R3-OPT-02: computeSkeletonFingerprint ignores door/window/slab edits on other stories', () => {
    const asm0: SceneNodeLike = { id: 'asm0', type: 'structural:assembly', parentId: 'level_0', visible: true }
    const baseNodes: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', level: 0, height: 2.74 },
      level_1: { id: 'level_1', type: 'level', level: 1, height: 2.44 },
      w0: { id: 'w0', type: 'wall', parentId: 'level_0', start: [0, 0], end: [6, 0], height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'level_1', start: [0, 0], end: [6, 0], height: 2.44 },
      win0: { id: 'win0', type: 'window', parentId: 'w0', width: 1.2, height: 1.2, position: [3, 1.4, 0] },
      win1: { id: 'win1', type: 'window', parentId: 'w1', width: 1.2, height: 1.2, position: [3, 1.4, 0] },
    }
    const fp0 = computeSkeletonFingerprint(asm0, baseNodes)

    // Mutate Second Floor window -> Ground Floor fingerprint MUST stay identical!
    const editOtherStory: Record<string, SceneNodeLike> = {
      ...baseNodes,
      win1: { ...baseNodes.win1!, width: 1.8, position: [4, 1.4, 0] as const },
    }
    expect(computeSkeletonFingerprint(asm0, editOtherStory)).toBe(fp0)

    // Mutate Ground Floor window -> Ground Floor fingerprint MUST invalidate!
    const editSameStory = {
      ...baseNodes,
      win0: { ...baseNodes.win0!, width: 1.8 },
    }
    expect(computeSkeletonFingerprint(asm0, editSameStory)).not.toBe(fp0)
  })

  test('R3-CON-03: beam and column parametrics derive hooks sync designation on inspector edits', () => {
    const beamPatch = structuralBeamParametrics.derive?.(
      {
        beamType: 'psl',
        widthIn: 3.5,
        depthIn: 11.875,
        plyCount: 1,
        designation: '(2) 1-3/4"x11-7/8" 2.0E LVL',
      } as never,
      { beamType: 'psl' } as never,
      undefined as never,
    )
    expect(beamPatch?.designation).toContain('PSL')

    const colPatch = structuralColumnParametrics.derive?.(
      {
        columnType: 'steel-hss',
        widthIn: 4,
        depthIn: 4,
        designation: '6x6 DF-L #1',
      } as never,
      { columnType: 'steel-hss' } as never,
      undefined as never,
    )
    expect(colPatch?.designation).toContain('HSS')
  })

  test('R3-BUG-03, R3-OPT-01, R3-CON-01 & R3-CON-02: structural-panel firestop elevation, inspector guard, and media script hardening', () => {
    const root = path.resolve(import.meta.dir, '../..')
    const panelSrc = fs.readFileSync(path.join(root, 'src/ui/structural-panel.tsx'), 'utf8')
    expect(panelSrc).toContain('seg.wall.h > 3.048 ? 3.048')
    expect(panelSrc).toContain('seg.wall.baseY')
    expect(panelSrc).toContain('n.visible !== false')

    const inspSrc = fs.readFileSync(path.join(root, 'src/ui/inspector-card.tsx'), 'utf8')
    expect(inspSrc).toContain('isStructuralNode ? auditStructuralScene(nodes, designOverride) : null')

    const voiceSrc = fs.readFileSync(path.join(root, 'scripts/add-voiceover.sh'), 'utf8')
    expect(voiceSrc).toContain('sys.argv[1]')
    expect(voiceSrc).not.toContain("float('$VID_DUR')")

    const videoSrc = fs.readFileSync(path.join(root, 'scripts/render-walkthrough-video.ts'), 'utf8')
    expect(videoSrc).toContain("gifProc.kill('SIGKILL')")
  })
})
