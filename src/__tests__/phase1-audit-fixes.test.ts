import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  compileBuildingAnatomy,
  compileLevelRoofShell,
  evaluateDeclarativeRules,
  evaluatePlacementCandidate,
  evaluateRoofSegmentSurfaceY,
  extractBeamPrism,
  extractCanonicalRoofSegments,
  extractColumnPrism,
  segmentIntersectsOrientedPrismY,
} from '@kruschdev/pascal-mep-kernel'
import { Box3, InstancedMesh, Matrix4, Vector3 } from 'three'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import {
  IRC_DECLARATIVE_RULES,
  IRC_ROOF_ENVELOPE_THRESHOLDS,
  IRC_WIND_SEISMIC_THRESHOLDS,
  type SceneNodeLike,
  auditStructuralScene,
  autopopulateStructuralScene,
  computeLevelBounds,
  evaluateIrcWindSeismicCandidate,
  extractWallOpenings,
  getIrcRuleById,
  normalizeCanonicalWallOpenings,
  segmentIntersectsBeam,
  segmentIntersectsColumn,
  traceStructuralLoadPaths,
} from '../irc'

function makeHouseScene(levelId = 'level_0'): Record<string, SceneNodeLike> {
  return {
    [levelId]: { id: levelId, type: 'level', name: 'Level 1', height: 2.7432 },
    w_n: { id: 'w_n', type: 'wall', parentId: levelId, start: [0, 0], end: [9, 0], height: 2.7432, thickness: 0.14 },
    w_e: { id: 'w_e', type: 'wall', parentId: levelId, start: [9, 0], end: [9, 7], height: 2.7432, thickness: 0.14 },
    w_s: { id: 'w_s', type: 'wall', parentId: levelId, start: [9, 7], end: [0, 7], height: 2.7432, thickness: 0.14 },
    w_w: { id: 'w_w', type: 'wall', parentId: levelId, start: [0, 7], end: [0, 0], height: 2.7432, thickness: 0.14 },
  }
}

describe('Phase 1 Structural Audit Fixes (BUG-PS-06..10, BUG-EH-11, OPT-PS-03..04, CON-PS-05)', () => {
  test('BUG-PS-06: IRC_ROOF_FRAMING_ENVELOPE_RULE aligns roofMarginM sign & atticThresholdOffsetM semantics with kernel evaluateElevationBand', () => {
    const roofRule = getIrcRuleById('irc-r802-roof-framing-envelope')
    expect(roofRule.params.roofMarginM).toBe(-0.08)
    expect(roofRule.params.atticThresholdOffsetM).toBeUndefined()
    expect(roofRule.placementMarginM).toBe(0.16)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.roofMarginM).toBe(-0.08)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.placementClearanceM).toBe(0.08)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.warningProtrusionM).toBe(0.08)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.errorProtrusionM).toBe(0.15)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.atticThresholdOffsetM).toBe(0.05)

    // Legal attic AHU above ceiling (y=3.0, ceilingHeightM=2.7) and safely below roof (roofSurfaceYM=4.0)
    // MUST pass both placement and audit modes (no inverted atticThresholdOffsetM ceiling ban).
    const legalAtticAhu = {
      id: 'ahu_attic',
      kind: 'hvac:equipment',
      pos: [4, 3.0, 3.5] as const,
      ceilingHeightM: 2.7,
      roofSurfaceYM: 4.0,
    }
    expect(evaluatePlacementCandidate(IRC_DECLARATIVE_RULES, legalAtticAhu, 'placement').legal).toBe(true)
    expect(evaluatePlacementCandidate(IRC_DECLARATIVE_RULES, legalAtticAhu, 'audit').legal).toBe(true)

    // Near-roof clearance boundary (roofSurfaceYM = 3.0):
    // - y = 2.90 (0.10m below roof): legal in both placement (<= 2.92) and audit (<= 3.08)
    // - y = 2.95 (0.05m below roof): rejected in placement (> 2.92), legal in audit (<= 3.08) — INV-MEP-08!
    // - y = 3.05 (+0.05m above roof): rejected in placement, legal in audit (<= 3.08)
    // - y = 3.11 (+0.11m above roof): rejected in both placement and audit (> 3.08)
    expect(
      evaluatePlacementCandidate(
        IRC_DECLARATIVE_RULES,
        { id: 'c1', kind: 'hvac:duct-run', pos: [2, 2.9, 2], roofSurfaceYM: 3.0 },
        'placement',
      ).legal,
    ).toBe(true)
    expect(
      evaluatePlacementCandidate(
        IRC_DECLARATIVE_RULES,
        { id: 'c2', kind: 'hvac:duct-run', pos: [2, 2.95, 2], roofSurfaceYM: 3.0 },
        'placement',
      ).legal,
    ).toBe(false)
    expect(
      evaluatePlacementCandidate(
        IRC_DECLARATIVE_RULES,
        { id: 'c2', kind: 'hvac:duct-run', pos: [2, 2.95, 2], roofSurfaceYM: 3.0 },
        'audit',
      ).legal,
    ).toBe(true)
    expect(
      evaluatePlacementCandidate(
        IRC_DECLARATIVE_RULES,
        { id: 'c3', kind: 'hvac:duct-run', pos: [2, 3.05, 2], roofSurfaceYM: 3.0 },
        'audit',
      ).legal,
    ).toBe(true)
    expect(
      evaluatePlacementCandidate(
        IRC_DECLARATIVE_RULES,
        { id: 'c4', kind: 'hvac:duct-run', pos: [2, 3.11, 2], roofSurfaceYM: 3.0 },
        'audit',
      ).legal,
    ).toBe(false)

    // Parity with auditStructuralScene on non-RTU synthetic gable roof (CON-PS-05 compileLevelRoofShell delegation)
    const scene = makeHouseScene()
    const shell = compileLevelRoofShell(scene, 'level_0', 2.7432, {
      includeHidden: true,
      levelBaseY: 0,
      wallBounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 7 },
      fallbackPitchRiseOver12: 6,
      clampOverhangToEave: true,
      footprintPadM: 0.15,
    })
    const roofAtEave = shell.roofEnvelopeY(4.5, 0.5)
    scene.ahu_ok = {
      id: 'ahu_ok',
      type: 'hvac:equipment',
      parentId: 'level_0',
      equipmentKind: 'air-handler',
      heightM: 1.0,
      position: [4.5, roofAtEave + 0.05 - 1.0, 0.5], // +0.05m <= +0.08m tolerance -> legal
    }
    scene.ahu_warn = {
      id: 'ahu_warn',
      type: 'hvac:equipment',
      parentId: 'level_0',
      equipmentKind: 'air-handler',
      heightM: 1.0,
      position: [4.5, roofAtEave + 0.11 - 1.0, 0.5], // +0.11m > +0.08m -> warning
    }
    scene.ahu_err = {
      id: 'ahu_err',
      type: 'hvac:equipment',
      parentId: 'level_0',
      equipmentKind: 'air-handler',
      heightM: 1.0,
      position: [4.5, roofAtEave + 0.2 - 1.0, 0.5], // +0.20m > +0.15m -> error
    }
    const audit = auditStructuralScene(scene)
    expect(audit.findings.some((f) => f.nodeId === 'ahu_ok')).toBe(false)
    expect(audit.findings.find((f) => f.nodeId === 'ahu_warn')?.severity).toBe('warning')
    expect(audit.findings.find((f) => f.nodeId === 'ahu_err')?.severity).toBe('error')
  })

  test('BUG-PS-07 & CON-PS-05: SDC D0/D1/D2 at low wind speed requires & emits uplift straps and roof ties consistently', () => {
    const baseScene = makeHouseScene()

    // Single-story house in SDC D1 at 110 mph wind (below 115 mph roof tie and 130 mph strap wind thresholds)
    const directStrapEval = evaluateIrcWindSeismicCandidate(
      {
        kind: 'structural:assembly',
        pos: [0, 0, 0],
        designWindMph: 110,
        seismicDesignCategory: 'D1',
        hasStrap: false,
      },
      'audit',
    )
    expect(directStrapEval.legal).toBe(false)

    const popD1 = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 110, seismicCategory: 'D1', storiesAbove: 0 },
    })
    const strapsD1 = popD1.createdNodes.filter(
      (n) => n.type === 'structural:connector' && (n.sku === 'MSTA36' || n.sku === 'MSTC40'),
    )
    expect(strapsD1.length).toBeGreaterThanOrEqual(1)

    // Autopopulated SDC D1 / 110 mph scene passes both load-path uplift check and full audit with 0 errors
    const populatedScene: Record<string, SceneNodeLike> = { ...baseScene }
    for (const n of popD1.createdNodes) populatedScene[n.id] = n
    const lpClean = traceStructuralLoadPaths({
      nodes: populatedScene,
      design: { windMph: 110, seismicCategory: 'D1', storiesAbove: 0 },
    })
    expect(lpClean.upliftFindings).toEqual([])
    expect(auditStructuralScene(populatedScene, { windMph: 110, seismicCategory: 'D1', storiesAbove: 0 }).errorCount).toBe(0)

    // Bare scene (no connectors) in SDC D1 at 110 mph MUST report missing roof ties, straps, AND hold-downs
    const bareScene: Record<string, SceneNodeLike> = {
      ...baseScene,
      asm1: { id: 'asm1', type: 'structural:assembly', parentId: 'level_0' },
    }
    const lpBareD1 = traceStructuralLoadPaths({
      nodes: bareScene,
      design: { windMph: 110, seismicCategory: 'D1', storiesAbove: 0 },
    })
    expect(lpBareD1.upliftFindings.some((f) => /hurricane ties/i.test(f))).toBe(true)
    expect(lpBareD1.upliftFindings.some((f) => /uplift straps/i.test(f))).toBe(true)
    expect(lpBareD1.upliftFindings.some((f) => /hold-downs/i.test(f))).toBe(true)
  })

  test('BUG-PS-08: NaN guards in segmentIntersectsBeam/Column and OBB parity with kernel for elevation, 3D start/end, width/height, col.height', () => {
    // 1. NaN / Infinity inputs MUST return false rather than falling through to kernel defaults
    expect(segmentIntersectsBeam([1, 2.4, 0], [3, 2.4, 0], [0, 0], [4, 0], 2.4, Number.NaN, 0.3)).toBe(false)
    expect(segmentIntersectsBeam([1, 2.4, 0], [3, 2.4, 0], [0, 0], [4, 0], 2.4, 0.1, Number.NaN)).toBe(false)
    expect(segmentIntersectsBeam([1, 2.4, 0], [3, 2.4, 0], [0, 0], [4, 0], Number.NaN, 0.1, 0.3)).toBe(false)
    expect(segmentIntersectsColumn([2, 1.0, 2], [2, 1.5, 2], [2, 0, 2], Number.NaN, 0.14, 2.7)).toBe(false)
    expect(segmentIntersectsColumn([2, 1.0, 2], [2, 1.5, 2], [2, 0, 2], 0.14, Number.NaN, 2.7)).toBe(false)
    expect(segmentIntersectsColumn([2, 1.0, 2], [2, 1.5, 2], [2, 0, 2], 0.14, 0.14, Number.NaN)).toBe(false)
    expect(segmentIntersectsColumn([2, 1.0, 2], [2, 1.5, 2], [2, 0, 2], 0.14, 0.14, 2.7, Number.NaN)).toBe(false)

    // 2. Beam using `elevation` + `width`/`height` (no `elevationY`/`widthIn`/`depthIn`) & beam using 3D start/end
    //    and commercial column using `height: 4.5` (no `heightM`) match kernel prisms 1:1 in auditStructuralScene
    const beamElev: SceneNodeLike = {
      id: 'bm_elev',
      type: 'structural:beam',
      parentId: 'level_0',
      start: [0, 0],
      end: [4, 0],
      elevation: 3.4,
      width: 0.25,
      height: 0.4,
      role: 'header',
      beamType: 'lvl',
      designation: '2-ply 1-3/4x11-7/8 LVL',
    }
    const beam3D: SceneNodeLike = {
      id: 'bm_3d',
      type: 'structural:beam',
      parentId: 'level_0',
      start: [0, 3.8, 3] as unknown as [number, number],
      end: [4, 3.8, 3] as unknown as [number, number],
      role: 'header',
      beamType: 'lvl',
      designation: '2-ply 1-3/4x11-7/8 LVL',
    }
    const colTall: SceneNodeLike = {
      id: 'col_tall',
      type: 'structural:column',
      parentId: 'level_0',
      position: [6, 0, 2],
      height: 4.5,
      widthIn: 5.5,
      depthIn: 5.5,
      footingWidthIn: 24,
      footingDepthIn: 12,
    }

    // Sanity check kernel prisms directly
    const pElev = extractBeamPrism(beamElev)!
    const p3D = extractBeamPrism(beam3D)!
    const pCol = extractColumnPrism(colTall)!
    expect(segmentIntersectsOrientedPrismY([2, 3.4, -1], [2, 3.4, 1], pElev, [0.05, 0.05, 0.05])).toBe(true)
    expect(segmentIntersectsOrientedPrismY([2, 3.8, 2], [2, 3.8, 4], p3D, [0.05, 0.05, 0.05])).toBe(true)
    expect(segmentIntersectsOrientedPrismY([5, 3.9, 2], [7, 3.9, 2], pCol, [0.05, 0.05, 0.05])).toBe(true)

    const scene: Record<string, SceneNodeLike> = {
      level_0: { id: 'level_0', type: 'level', height: 5.0 },
      bm_elev: beamElev,
      bm_3d: beam3D,
      col_tall: colTall,
      pipe_elev: {
        id: 'pipe_elev',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        nominalSize: '2',
        path: [
          [2, 3.4, -1],
          [2, 3.4, 1],
        ],
      },
      pipe_3d: {
        id: 'pipe_3d',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        nominalSize: '2',
        path: [
          [2, 3.8, 2],
          [2, 3.8, 4],
        ],
      },
      pipe_col_high: {
        id: 'pipe_col_high',
        type: 'plumbing:pipe-run',
        parentId: 'level_0',
        nominalSize: '2',
        path: [
          [5, 3.9, 2],
          [7, 3.9, 2],
        ],
      },
    }

    const report = auditStructuralScene(scene)
    const clashNodeIds = report.findings.filter((f) => f.category === 'mep-clash').map((f) => f.nodeId)
    expect(clashNodeIds).toContain('bm_elev')
    expect(clashNodeIds).toContain('bm_3d')
    expect(clashNodeIds).toContain('col_tall')
  })

  test('BUG-PS-09: narrow low-pitch dormer roof framing matches kernel evaluateRoofSegmentSurfaceY without 0.25m rise floor', () => {
    // 1.6m deep dormer @ 3:12 pitch (atan(0.25) = 14.0362 deg) -> exact halfRun * tan(pitch) = 0.8 * 0.25 = 0.20m (< 0.25m!)
    const pitchDeg = (Math.atan(3 / 12) * 180) / Math.PI
    const wallH = 2.7
    const nodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: wallH },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [2, 0], height: wallH },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [2, 0], end: [2, 1.6], height: wallH },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [2, 1.6], end: [0, 1.6], height: wallH },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 1.6], end: [0, 0], height: wallH },
      dormer_roof: {
        id: 'dormer_roof',
        type: 'roof-segment',
        parentId: 'lvl1',
        roofType: 'gable',
        position: [1.0, wallH, 0.8],
        width: 2.0,
        depth: 1.6,
        wallHeight: 0,
        pitch: pitchDeg,
        overhang: 0.15,
      },
      asm1: {
        id: 'asm1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        roofSystem: 'stick-rafter',
        visibleSystems: { walls: false, floor: false, foundation: false, roof: true, connectors: false, firestop: false },
      },
    }

    const segs = extractCanonicalRoofSegments(nodes, 'lvl1', wallH)
    expect(segs.length).toBe(1)
    const kernelPeakY = evaluateRoofSegmentSurfaceY(segs[0]!, 1.0, 0.8)!
    expect(kernelPeakY).toBeCloseTo(wallH + 0.2, 3)

    const group = buildBuildingSkeletonGroup({ assembly: nodes.asm1!, nodes })
    group.updateMatrixWorld(true)
    const tmpBox = new Box3()
    const mat = new Matrix4()
    const pt = new Vector3()
    let maxRoofY = Number.NEGATIVE_INFINITY
    let ridgeCenterY: number | null = null

    group.traverse((obj) => {
      if (obj instanceof InstancedMesh) {
        const geomBox = obj.geometry.boundingBox ?? (obj.geometry.computeBoundingBox(), obj.geometry.boundingBox!)
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, mat)
          tmpBox.copy(geomBox).applyMatrix4(mat)
          pt.set(0, tmpBox.max.y, 0)
          if (pt.y > maxRoofY) maxRoofY = pt.y
          if (obj.name.includes('header-lvl')) {
            ridgeCenterY = (tmpBox.min.y + tmpBox.max.y) / 2
          }
        }
      }
    })

    // Exact riseM = 0.20m (no 0.25m floor):
    // - 2x8 rafter centerline hits kernelPeakY (2.90m), so rafter top sits at kernelPeakY + (0.184/2)*cos(pitch) (~2.989m)
    //   instead of the old inflated 3.039m (+0.05m floor error).
    // - Ridge beam center sits at kernelPeakY - 0.09 (~2.81m), not 2.86m.
    const pitchRad = Math.atan(3 / 12)
    const expectedRafterTopY = kernelPeakY + (0.184 / 2) * Math.cos(pitchRad)
    expect(maxRoofY).toBeCloseTo(expectedRafterTopY, 2)
    expect(maxRoofY).toBeLessThan(kernelPeakY + (0.184 / 2) * Math.cos(pitchRad) + 0.015)
    expect(ridgeCenterY).not.toBeNull()
    expect(ridgeCenterY!).toBeCloseTo(kernelPeakY - 0.09, 2)
  })

  test('BUG-PS-10: IRC_WIND_SEISMIC_UPLIFT_RULE sets minBearingLengthIn=1.5 alongside minBearingToleranceIn=0.05 with INV-MEP-08 soundness', () => {
    expect(IRC_WIND_SEISMIC_THRESHOLDS.minBearingLengthIn).toBe(1.5)
    expect(IRC_WIND_SEISMIC_THRESHOLDS.minBearingToleranceIn).toBe(0.05)

    // Severely under-bearing beam (0.5" < 1.45") MUST fail audit
    const underBearing = evaluateDeclarativeRules(
      IRC_DECLARATIVE_RULES,
      [{ id: 'bm_short', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 0.5 }],
      { trade: 'structural', tool: 'structural_audit_irc' },
    )
    expect(underBearing.ok).toBe(false)
    expect(underBearing.data.violationCount).toBe(1)
    expect(underBearing.data.violations[0]?.ruleId).toBe('irc-r802-11-wind-seismic-uplift')

    // Audit boundary: 1.44" fails, 1.46" passes (1.5 - 0.05 = 1.45")
    expect(
      evaluateIrcWindSeismicCandidate(
        { id: 'bm_144', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 1.44 },
        'audit',
      ).legal,
    ).toBe(false)
    expect(
      evaluateIrcWindSeismicCandidate(
        { id: 'bm_146', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 1.46 },
        'audit',
      ).legal,
    ).toBe(true)

    // Placement soundness (INV-MEP-08): 1.46" fails placement (< 1.5"), 1.5" passes both placement and audit
    expect(
      evaluateIrcWindSeismicCandidate(
        { id: 'bm_146', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 1.46 },
        'placement',
      ).legal,
    ).toBe(false)
    expect(
      evaluateIrcWindSeismicCandidate(
        { id: 'bm_150', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 1.5 },
        'placement',
      ).legal,
    ).toBe(true)
    expect(
      evaluateIrcWindSeismicCandidate(
        { id: 'bm_150', kind: 'structural:beam', pos: [0, 2.4, 0], bearingIn: 1.5 },
        'audit',
      ).legal,
    ).toBe(true)
  })

  test('BUG-EH-11: build-dist.ts externalizes @kruschdev/pascal-mep-kernel instead of inlining it into dist/', () => {
    const repoRoot = path.resolve(import.meta.dir, '..', '..')
    const buildScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-dist.ts'), 'utf8')
    expect(buildScript).toContain("'@kruschdev/pascal-mep-kernel'")
    expect(buildScript).toContain("'@kruschdev/pascal-mep-kernel/*'")

    const distDir = path.join(repoRoot, 'dist')
    if (fs.existsSync(distDir)) {
      const jsFiles: string[] = []
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.name.endsWith('.js')) jsFiles.push(full)
        }
      }
      walk(distDir)
      const combinedJs = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
      expect(combinedJs).toContain('@kruschdev/pascal-mep-kernel')
      expect(combinedJs).not.toContain('function evaluateWindSeismicThreshold(')
      expect(combinedJs).not.toContain('function compileBuildingAnatomy(')
    }
  })

  test('OPT-PS-03 & OPT-PS-04: single-pass computeLevelBounds and canonical wall opening normalization preserve 1:1 accuracy', () => {
    const scene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 3.0 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [1, 2], end: [7, 2], height: 3.0, elevation: 0.4 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [7, 2], end: [7, 8], height: 2.6, elevation: 0.4 },
      w_hidden: { id: 'w_hidden', type: 'wall', parentId: 'lvl1', visible: false, start: [-50, -50], end: [50, 50], height: 9.0, elevation: -5 },
      slab1: { id: 'slab1', type: 'slab', parentId: 'lvl1', elevation: 0.25, polygon: [[1, 2], [7, 2], [7, 8], [1, 8]] },
      door1: { id: 'door1', type: 'door', parentId: 'w1', position: [2.0, 0, 0], width: 0.9144, height: 2.0828 },
      win1: {
        id: 'win1',
        type: 'item',
        parentId: 'w1',
        position: [4.8, 0.9, 0],
        asset: { category: 'window', name: 'Double Hung', dimensions: [1.2, 1.3, 0.12] },
      },
    }

    const bounds = computeLevelBounds(scene, 'lvl1')
    expect(bounds.minX).toBe(1)
    expect(bounds.maxX).toBe(7)
    expect(bounds.minZ).toBe(2)
    expect(bounds.maxZ).toBe(8)
    expect(bounds.avgWallHeightM).toBeCloseTo(2.8, 5)
    expect(bounds.baseElevationM).toBeCloseTo(0.25, 5)

    // Verify canonical Map lookup + normalizeCanonicalWallOpenings matches extractWallOpenings 1:1
    const anatomy = compileBuildingAnatomy(scene)
    const cw = anatomy.getWalls('lvl1').find((w) => w.id === 'w1')!
    expect(cw).toBeDefined()
    const normalized = normalizeCanonicalWallOpenings(cw.openings, cw.lengthM, 3.0)
    const direct = extractWallOpenings(scene, scene.w1!)
    expect(normalized).toEqual(direct)
  })
})
