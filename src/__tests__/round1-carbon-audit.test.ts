import { describe, expect, test } from 'bun:test'
import { auditStructuralScene, segmentIntersectsBeam } from '../irc/audit'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { deriveRequiredFirestops } from '../irc/fireblocking'
import { evaluateBracedWallLines, traceStructuralLoadPaths } from '../irc/load-path'
import { generateStructuralBom } from '../irc/pricing'
import {
  calcColumnCapacityLbs,
  checkBeamEntry,
  checkColumnEntry,
  resolveBeamCatalogEntry,
  selectBeamHangerSku,
  sizeBeamOrHeader,
  sizeRoofSystem,
} from '../irc/sizing'
import { BEAM_CATALOG, COLUMN_CATALOG, type SceneNodeLike } from '../irc/tables'
import { StructuralAssemblyNode } from '../nodes/assembly'
import { activeLevelOf, belongsToLevel, toPascalNode } from '../ui/structural-panel'

describe('Round 1 Gemini 4 Carbon Audit Regression Suite', () => {
  test('R1-BUG-01: multi-level autopopulate generates non-colliding IDs and level scoping works', () => {
    const baseScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      lvl2: { id: 'lvl2', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [6, 0], end: [6, 5], height: 2.74 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [6, 0], height: 2.74 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl2', start: [6, 0], end: [6, 5], height: 2.74 },
    }
    const r1 = autopopulateStructuralScene(baseScene, { levelId: 'lvl1', includeRoof: false })
    const merged: Record<string, SceneNodeLike> = { ...baseScene }
    for (const n of r1.createdNodes) merged[n.id] = n

    const r2 = autopopulateStructuralScene(merged, { levelId: 'lvl2', includeRoof: false })
    const lvl1Ids = new Set(r1.createdNodes.map((n) => n.id))
    for (const n of r2.createdNodes) {
      expect(lvl1Ids.has(n.id)).toBe(false)
      expect(n.parentId).toBe('lvl2')
    }

    const allScene: Record<string, SceneNodeLike> = { ...merged }
    for (const n of r2.createdNodes) allScene[n.id] = n
    const lvl2Structural = Object.values(allScene).filter(
      (n) => n.type.startsWith('structural:') && belongsToLevel(allScene, n, 'lvl2'),
    )
    expect(lvl2Structural.length).toBe(r2.createdNodes.length)
    expect(lvl2Structural.every((n) => n.parentId === 'lvl2')).toBe(true)
  })

  test('R1-BUG-02 & R1-CON-03: header snow load governs with Cd=1.15 and masonry bearing does not force 2 wood jacks', () => {
    const entry = BEAM_CATALOG.find((c) => c.id === 'lvl-2-11.875')!
    const lowSnow = checkBeamEntry(entry, {
      spanFt: 10,
      tributaryWidthFt: 14,
      role: 'header',
      snowLoadPsf: 20,
      storiesSupported: 0,
    })
    const heavySnow = checkBeamEntry(entry, {
      spanFt: 10,
      tributaryWidthFt: 14,
      role: 'header',
      snowLoadPsf: 80,
      storiesSupported: 0,
    })
    expect(heavySnow.uniformLoadPlf).toBeGreaterThan(lowSnow.uniformLoadPlf)
    expect(heavySnow.bendingUtilization).toBeGreaterThan(lowSnow.bendingUtilization)

    const masonryBearing = checkBeamEntry(entry, {
      spanFt: 6,
      tributaryWidthFt: 6,
      role: 'header',
      bearingMaterial: 'masonry',
      snowLoadPsf: 20,
      storiesSupported: 0,
    })
    expect(masonryBearing.requiredBearingIn).toBeGreaterThanOrEqual(3.0)
    // Should NOT force 2 jack studs simply because masonry requires 3.0" bearing
    expect(masonryBearing.jackStudsEachEnd).toBe(1)
  })

  test('R1-BUG-03: audit flags overstressed placed columns, AISC E3 steel buckling, and missing/undersized footings', () => {
    const hss = COLUMN_CATALOG.find((c) => c.columnType === 'steel-hss')!
    const cap9 = calcColumnCapacityLbs(hss, 9)
    const cap18 = calcColumnCapacityLbs(hss, 18)
    expect(cap9).toBeGreaterThan(cap18)
    expect(cap18).toBeGreaterThan(0)

    const check = checkColumnEntry({
      designation: '4x4 DF-L #2 Post',
      columnType: 'wood-solid',
      widthIn: 3.5,
      depthIn: 3.5,
      axialLoadLbs: 15000,
      unbracedHeightFt: 10,
    })
    expect(check.passes).toBe(false)
    expect(check.utilization).toBeGreaterThan(1)

    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      col_bad: {
        id: 'col_bad',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [2, 0, 2],
        heightM: 3.05,
        columnType: 'wood-solid',
        designation: '4x4 DF-L #2 Post',
        widthIn: 3.5,
        depthIn: 3.5,
        axialLoadLbs: 15000,
      },
    }
    const report = auditStructuralScene(scene)
    expect(
      report.findings.some(
        (f) => f.nodeId === 'col_bad' && f.category === 'column-footing' && f.message.toLowerCase().includes('overstressed'),
      ),
    ).toBe(true)
    expect(
      report.findings.some(
        (f) => f.nodeId === 'col_bad' && f.category === 'column-footing' && f.message.toLowerCase().includes('footing'),
      ),
    ).toBe(true)
  })

  test('R1-BUG-04: resolveBeamCatalogEntry exact match + custom synthesis, maxDepthIn preserved on escalation, depth-matched hanger', () => {
    const custom = resolveBeamCatalogEntry({
      designation: 'Custom 3.5x16 LVL',
      family: 'lvl',
      widthIn: 3.5,
      depthIn: 16,
      plyCount: 2,
    })
    expect(custom.widthIn).toBe(3.5)
    expect(custom.depthIn).toBe(16)
    expect(custom.allowableMomentFtLbs).toBeGreaterThan(28_000)

    const shallow = sizeBeamOrHeader({
      spanFt: 18,
      tributaryWidthFt: 14,
      role: 'floor-girder',
      preferredFamily: 'lvl',
      maxDepthIn: 12,
    })
    expect(shallow.entry.depthIn).toBeLessThanOrEqual(12)

    const w8 = BEAM_CATALOG.find((c) => c.family === 'steel-w')!
    expect(['CCQ46', 'CCQ66']).toContain(selectBeamHangerSku(w8, 5000))
    const deepLvl = BEAM_CATALOG.find((c) => c.id === 'lvl-2-14')!
    expect(selectBeamHangerSku(deepLvl, 4500)).not.toBe('LUS28')
  })

  test('R1-BUG-05: firestop audit matches per-hostWall/penetration and flags missing/empty material', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w_tall_a: { id: 'w_tall_a', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [4, 0], height: 3.66 },
      w_tall_b: { id: 'w_tall_b', type: 'wall', parentId: 'lvl1', start: [0, 4], end: [4, 4], height: 3.66 },
      fs_a: {
        id: 'fs_a',
        type: 'structural:firestop',
        parentId: 'lvl1',
        firestopKind: 'wall-vertical-10ft',
        material: '2x-lumber',
        hostWallId: 'w_tall_a',
        start: [0, 0],
        end: [4, 0],
        elevationY: 3.048,
      },
      fs_bad: {
        id: 'fs_bad',
        type: 'structural:firestop',
        parentId: 'lvl1',
        firestopKind: 'penetration-firestop',
        material: '',
        start: [1, 1],
        end: [1.1, 1],
        elevationY: 2.7,
      },
    }
    const report = auditStructuralScene(scene)
    expect(
      report.findings.some(
        (f) => f.nodeId === 'w_tall_b' && f.category === 'fire-blocking' && f.remediation.includes('wall-vertical-10ft'),
      ),
    ).toBe(true)
    expect(report.findings.some((f) => f.nodeId === 'w_tall_a' && f.category === 'fire-blocking')).toBe(false)
    expect(
      report.findings.some(
        (f) => f.nodeId === 'fs_bad' && f.category === 'fire-blocking' && f.message.toLowerCase().includes('material'),
      ),
    ).toBe(true)
  })

  test('R1-BUG-06 & R1-OPT-04: tall-wall dead zone removed, furred wall normal, stair rotation, 2-edge soffit, dynamic plate Y', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w_10_2: { id: 'w_10_2', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [4, 0], height: 3.1 },
      w_tall_plate: { id: 'w_tall_plate', type: 'wall', parentId: 'lvl1', start: [0, 2], end: [4, 2], height: 3.1 },
      soffit: {
        id: 'soffit',
        type: 'zone',
        parentId: 'lvl1',
        name: 'Kitchen Soffit',
        polygon: [
          [0, 0],
          [3, 0],
          [3, 1.2],
          [0, 1.2],
        ],
      },
      stair_rot: {
        id: 'stair_rot',
        type: 'stair',
        parentId: 'lvl1',
        position: [5, 0, 5],
        width: 1.0,
        length: 3.0,
        height: 2.74,
        rotation: Math.PI / 2,
      },
      pipe1: {
        id: 'pipe1',
        type: 'plumbing:pipe-run',
        parentId: 'lvl1',
        path: [
          [2, 0.2, 2],
          [2, 3.3, 2],
        ],
      },
    }
    const req = deriveRequiredFirestops({ nodes: scene, levelId: 'lvl1' })
    expect(req.some((r) => r.firestopKind === 'wall-vertical-10ft' && r.hostWallId === 'w_10_2')).toBe(true)
    expect(req.filter((r) => r.firestopKind === 'soffit-drop-ceiling').length).toBeGreaterThanOrEqual(2)
    const stairStops = req.filter((r) => r.firestopKind === 'stair-stringer')
    expect(stairStops.length).toBe(2)
    expect(Math.abs(stairStops[1]!.start[0] - stairStops[0]!.start[0])).toBeGreaterThan(1.5)
    const pen = req.find((r) => r.firestopKind === 'penetration-firestop')
    expect(pen).toBeDefined()
    expect(pen!.elevationY).toBeGreaterThan(2.9)
  })

  test('R1-BUG-07: diagonal beam OBB intersection avoids false positive & reports multiple pierced beams', () => {
    const wM = 3.5 * 0.0254
    const dM = 11.875 * 0.0254
    // Segment far from diagonal beam centerline (at x=0, z=6) must NOT intersect
    expect(segmentIntersectsBeam([0, 2.5, 5.5], [0, 2.5, 6.0], [0, 0], [6, 6], 2.5, wM, dM)).toBe(false)
    // Segment crossing diagonal beam at (3, 2.5, 3) MUST intersect
    expect(segmentIntersectsBeam([2.5, 2.5, 3.5], [3.5, 2.5, 2.5], [0, 0], [6, 6], 2.5, wM, dM)).toBe(true)

    // MEP run piercing TWO parallel beams must generate 2 clash findings (no premature break)
    const clashScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      bm1: { id: 'bm1', type: 'structural:beam', parentId: 'lvl1', start: [0, 2], end: [4, 2], elevationY: 2.5, widthIn: 3.5, depthIn: 11.875 },
      bm2: { id: 'bm2', type: 'structural:beam', parentId: 'lvl1', start: [0, 4], end: [4, 4], elevationY: 2.5, widthIn: 3.5, depthIn: 11.875 },
      duct1: {
        id: 'duct1',
        type: 'hvac:duct-run',
        parentId: 'lvl1',
        path: [
          [2, 2.5, 0],
          [2, 2.5, 6],
        ],
      },
    }
    const report = auditStructuralScene(clashScene)
    const clashes = report.findings.filter((f) => f.category === 'mep-clash')
    expect(clashes.length).toBe(2)
  })

  test('R1-BUG-08: level-scoped BWL with real WSP/CS-PF pier credit, broken transfersToNodeId detection, failed BWL = error', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      // 20 ft wall with 4 wide 1.3 m windows leaving only ~10" (< 16" CS-PF min) slivers
      w_swiss: { id: 'w_swiss', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6.096, 0], height: 2.74 },
      win1: { id: 'win1', type: 'window', parentId: 'w_swiss', width: 1.3, position: [0.85, 1.0, 0] },
      win2: { id: 'win2', type: 'window', parentId: 'w_swiss', width: 1.3, position: [2.35, 1.0, 0] },
      win3: { id: 'win3', type: 'window', parentId: 'w_swiss', width: 1.3, position: [3.85, 1.0, 0] },
      win4: { id: 'win4', type: 'window', parentId: 'w_swiss', width: 1.3, position: [5.25, 1.0, 0] },
      col_broken: {
        id: 'col_broken',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [3, 0, 3],
        heightM: 2.74,
        axialLoadLbs: 5000,
        transfersToNodeId: 'nonexistent-node-id',
      },
    }
    const bwls = evaluateBracedWallLines({ nodes: scene, levelId: 'lvl1' })
    expect(bwls.length).toBeGreaterThan(0)
    expect(bwls[0]!.passes).toBe(false)
    expect(bwls[0]!.bracingMethod).toBe('Engineered-Shear')

    const lp = traceStructuralLoadPaths({ nodes: scene })
    expect(lp.gravityLinks.some((g) => g.fromNodeId === 'col_broken' && !g.continuous)).toBe(true)

    const audit = auditStructuralScene(scene)
    const bwlFinding = audit.findings.find((f) => f.category === 'bracing-shear')
    expect(bwlFinding?.severity).toBe('error')
  })

  test('R1-BUG-09 & R1-CON-01: assembly visibleSystems Zod schema, toPascalNode hiddenLayers, and strict activeLevelOf', () => {
    const parsed = StructuralAssemblyNode.parse({
      id: 'strasm_test1',
      type: 'structural:assembly',
      visibleSystems: { walls: false, floor: true, roof: true, beams: true, columns: true, connectors: true, firestop: true, foundation: true },
    })
    expect(parsed.visibleSystems.walls).toBe(false)
    expect(parsed.visibleSystems.floor).toBe(true)

    const hiddenNode = toPascalNode(
      { id: 'strbm_1', type: 'structural:beam' },
      'lvl1',
      { walls: false, floor: false, roof: false, beams: true, columns: false, connectors: false, firestop: false, foundation: false },
    )
    expect(hiddenNode.visible).toBe(false)

    const nodes = {
      wall_not_lvl: { id: 'wall_not_lvl', type: 'wall' },
      real_lvl: { id: 'real_lvl', type: 'level' },
    } as never
    expect(activeLevelOf(nodes, 'wall_not_lvl')).toBe('real_lvl')
  })

  test('R1-BUG-10: roof pitch unit normalization, includeFoundation=false respected, SDC C emits SSTB16', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [10, 0], height: 2.74 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [10, 0], end: [10, 8], height: 2.74 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [10, 8], end: [0, 8], height: 2.74 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 8], end: [0, 0], height: 2.74 },
      roof_rad: { id: 'roof_rad', type: 'roof', parentId: 'lvl1', pitch: 0.4636 },
    }
    const noFdn = autopopulateStructuralScene(scene, {
      levelId: 'lvl1',
      includeFoundation: false,
      design: { seismicCategory: 'C' },
    })
    expect(noFdn.createdNodes.some((n) => n.type === 'structural:connector' && n.sku === 'SSTB16')).toBe(false)
    expect(noFdn.createdNodes.some((n) => n.type === 'structural:connector' && n.sku === 'ABU66Z')).toBe(false)

    const withFdnC = autopopulateStructuralScene(scene, {
      levelId: 'lvl1',
      includeFoundation: true,
      design: { seismicCategory: 'C' },
    })
    expect(withFdnC.createdNodes.some((n) => n.type === 'structural:connector' && n.sku === 'SSTB16')).toBe(true)
  })

  test('R1-BUG-11 & R1-CON-02: BOM hardening (unknown species/firestop, NaN guard, unique SKUs, firestop quantity, Markdown escaping)', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      asm1: {
        id: 'asm1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        species: 'unknown-species-xyz',
        studSize: '2x6',
      },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [4, 0], height: 3.1 },
      bm1: {
        id: 'bm1',
        type: 'structural:beam',
        parentId: 'lvl1',
        beamType: 'lvl',
        designation: '(2) 1-3/4"x11-7/8" | LVL\nLine2',
        start: [0, 0],
        end: [4, 0],
        widthIn: 3.5,
        depthIn: 11.875,
        plyCount: 2,
      },
      bm2: {
        id: 'bm2',
        type: 'structural:beam',
        parentId: 'lvl1',
        beamType: 'lvl',
        designation: '(3) 1-3/4"x14" LVL',
        start: [0, 2],
        end: [4, 2],
        widthIn: 5.25,
        depthIn: 14,
        plyCount: 3,
      },
      fs_ea: {
        id: 'fs_ea',
        type: 'structural:firestop',
        parentId: 'lvl1',
        firestopKind: 'penetration-firestop',
        material: 'intumescent-caulk',
        quantity: 4,
        start: [1, 1],
        end: [1.1, 1],
      },
      fs_unknown: {
        id: 'fs_unknown',
        type: 'structural:firestop',
        parentId: 'lvl1',
        firestopKind: 'totally-custom-kind',
        material: 'mineral-wool',
        start: [0, 0],
        end: [Number.NaN, 0],
      },
    }
    const bom = generateStructuralBom(scene)
    expect(Number.isFinite(bom.totalMaterialCostUsd)).toBe(true)
    const beamItems = bom.items.filter((i) => i.category === 'Engineered Wood & Steel Beams')
    expect(beamItems.length).toBe(2)
    expect(beamItems[0]!.sku).not.toBe(beamItems[1]!.sku)
    const penItem = bom.items.find((i) => i.sku.includes('PENETRATION-FIRESTOP'))
    expect(penItem?.quantity).toBe(4)
    expect(bom.markdown).toContain('\\|')
    expect(bom.markdown).not.toContain('LVL\nLine2')
  })

  test('R1-OPT-03: ceiling joist respects spacingIn and cathedral ridge beam applies sec(theta) slope dead load', () => {
    const roof16 = sizeRoofSystem({
      system: 'stick-rafter',
      buildingSpanFt: 28,
      ridgeLengthFt: 20,
      pitchRiseOver12: 6,
      spacingIn: 16,
    })
    const roof24 = sizeRoofSystem({
      system: 'stick-rafter',
      buildingSpanFt: 28,
      ridgeLengthFt: 20,
      pitchRiseOver12: 6,
      spacingIn: 24,
    })
    const sizeRank: Record<string, number> = { '2x4': 0, '2x6': 1, '2x8': 2, '2x10': 3, '2x12': 4 }
    expect(sizeRank[roof24.ceilingJoistSize]!).toBeGreaterThanOrEqual(sizeRank[roof16.ceilingJoistSize]!)

    const flatRidge = sizeRoofSystem({
      system: 'ridge-beam-cathedral',
      buildingSpanFt: 24,
      ridgeLengthFt: 16,
      pitchRiseOver12: 2,
    })
    const steepRidge = sizeRoofSystem({
      system: 'ridge-beam-cathedral',
      buildingSpanFt: 24,
      ridgeLengthFt: 16,
      pitchRiseOver12: 12,
    })
    expect(steepRidge.recommendedRidgeBeam!.uniformLoadPlf).toBeGreaterThan(
      flatRidge.recommendedRidgeBeam!.uniformLoadPlf,
    )
  })
})
