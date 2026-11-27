import { describe, expect, test } from 'bun:test'
import {
  type PlacementCandidate,
  evaluateDeclarativeRules,
  evaluatePlacementCandidate,
  extractBeamPrism,
  extractColumnPrism,
  segmentIntersectsOrientedPrismY,
  validateRuleTable,
} from '@kruschdev/pascal-mep-kernel'
import {
  INCHES_TO_METERS,
  IRC_DECLARATIVE_RULES,
  IRC_ROOF_ENVELOPE_THRESHOLDS,
  IRC_WIND_SEISMIC_THRESHOLDS,
  type SceneNodeLike,
  auditStructuralScene,
  autopopulateStructuralScene,
  evaluateBracedWallLines,
  getIrcRuleById,
  isHighSeismicCategory,
  requiresSillAnchorBolts,
  segmentIntersectsBeam,
  segmentIntersectsColumn,
  traceStructuralLoadPaths,
} from '../irc'

function makeBasicHouseScene(levelId = 'level_0'): Record<string, SceneNodeLike> {
  return {
    [levelId]: { id: levelId, type: 'level', name: 'Level 1', height: 2.7432 },
    w_n: { id: 'w_n', type: 'wall', parentId: levelId, start: [0, 0], end: [9, 0], height: 2.7432, thickness: 0.14 },
    w_e: { id: 'w_e', type: 'wall', parentId: levelId, start: [9, 0], end: [9, 7], height: 2.7432, thickness: 0.14 },
    w_s: { id: 'w_s', type: 'wall', parentId: levelId, start: [9, 7], end: [0, 7], height: 2.7432, thickness: 0.14 },
    w_w: { id: 'w_w', type: 'wall', parentId: levelId, start: [0, 7], end: [0, 0], height: 2.7432, thickness: 0.14 },
  }
}

describe('Kernel Layer 2/3 Adoption — Single-Source Declarative IRC Rule Engine & Occupancy Parity', () => {
  test('validateRuleTable(IRC_DECLARATIVE_RULES) passes with 0 errors and exposes all 3 canonical IRC rules', () => {
    const validation = validateRuleTable(IRC_DECLARATIVE_RULES)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
    expect(IRC_DECLARATIVE_RULES.length).toBeGreaterThanOrEqual(3)

    const windRule = getIrcRuleById('irc-r802-11-wind-seismic-uplift')
    expect(windRule.trade).toBe('structural')
    expect(windRule.kind).toBe('wind-seismic-threshold')
    expect(windRule.params).toEqual(IRC_WIND_SEISMIC_THRESHOLDS)
    expect(IRC_WIND_SEISMIC_THRESHOLDS).toEqual({
      roofTieWindMph: 115,
      strapWindMph: 130,
      heavyStrapWindMph: 140,
      holdDownWindMph: 130,
      highSeismicCategories: ['D0', 'D1', 'D2'],
      sillBoltSeismicCategories: ['C', 'D0', 'D1', 'D2'],
      minFootingWidthIn: 18,
      minBearingLengthIn: 1.5,
      minBearingToleranceIn: 0.05,
    })

    const roofRule = getIrcRuleById('irc-r802-roof-framing-envelope')
    expect(roofRule.trade).toBe('structural')
    expect(roofRule.kind).toBe('elevation-band')
    expect(roofRule.params.roofMarginM).toBe(-0.08)
    expect(roofRule.params.atticThresholdOffsetM).toBeUndefined()
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.warningProtrusionM).toBe(0.08)
    expect(IRC_ROOF_ENVELOPE_THRESHOLDS.errorProtrusionM).toBe(0.15)

    const rowRule = getIrcRuleById('irc-r502-8-mep-right-of-way')
    expect(rowRule.trade).toBe('structural')
    expect(rowRule.kind).toBe('fixture-keepout')
    expect(rowRule.codeRef).toContain('IRC R502.8')

    expect(getIrcRuleById('non-existent-irc-rule')).toBeUndefined()
  })

  test('wind/seismic uplift threshold parity across autopopulate.ts, load-path.ts, and audit.ts', () => {
    const baseScene = makeBasicHouseScene()

    // 1. Strap & heavy-strap transitions at 129 -> 130 -> 140 mph (single-story, SDC B)
    const pop129 = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 129, seismicCategory: 'B', storiesAbove: 0 },
    })
    const pop130 = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 130, seismicCategory: 'B', storiesAbove: 0 },
    })
    const pop140 = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 140, seismicCategory: 'B', storiesAbove: 0 },
    })

    const straps129 = pop129.createdNodes.filter(
      (n) => n.type === 'structural:connector' && (n.sku === 'MSTA36' || n.sku === 'MSTC40'),
    )
    const straps130 = pop130.createdNodes.filter((n) => n.type === 'structural:connector' && n.sku === 'MSTA36')
    const straps140 = pop140.createdNodes.filter((n) => n.type === 'structural:connector' && n.sku === 'MSTC40')
    expect(straps129.length).toBe(0)
    expect(straps130.length).toBeGreaterThanOrEqual(1)
    expect(straps140.length).toBeGreaterThanOrEqual(1)

    // Autopopulated 130 mph and 140 mph scenes pass audit with 0 errors
    const scene130: Record<string, SceneNodeLike> = { ...baseScene }
    for (const n of pop130.createdNodes) scene130[n.id] = n
    expect(auditStructuralScene(scene130).errorCount).toBe(0)

    const scene140: Record<string, SceneNodeLike> = { ...baseScene }
    for (const n of pop140.createdNodes) scene140[n.id] = n
    expect(auditStructuralScene(scene140).errorCount).toBe(0)

    // 2. Load-path tracer checks exact same roofTieWindMph (115) & strapWindMph/holdDownWindMph (130)
    const bareAsmScene: Record<string, SceneNodeLike> = {
      ...baseScene,
      asm1: { id: 'asm1', type: 'structural:assembly', parentId: 'level_0' },
    }
    const lp114 = traceStructuralLoadPaths({
      nodes: bareAsmScene,
      design: { windMph: 114, seismicCategory: 'B' },
    })
    const lp115 = traceStructuralLoadPaths({
      nodes: bareAsmScene,
      design: { windMph: 115, seismicCategory: 'B' },
    })
    const lp129 = traceStructuralLoadPaths({
      nodes: bareAsmScene,
      design: { windMph: 129, seismicCategory: 'B' },
    })
    const lp130 = traceStructuralLoadPaths({
      nodes: bareAsmScene,
      design: { windMph: 130, seismicCategory: 'B' },
    })

    expect(lp114.upliftFindings.some((f) => /hurricane ties/i.test(f))).toBe(false)
    expect(lp115.upliftFindings.some((f) => /hurricane ties/i.test(f))).toBe(true)
    expect(lp129.upliftFindings.some((f) => /uplift straps/i.test(f))).toBe(false)
    expect(lp129.upliftFindings.some((f) => /hold-downs/i.test(f))).toBe(false)
    expect(lp130.upliftFindings.some((f) => /uplift straps/i.test(f))).toBe(true)
    expect(lp130.upliftFindings.some((f) => /hold-downs/i.test(f))).toBe(true)

    // 3. Seismic sill anchor bolt & plate washer thresholds match IRC_WIND_SEISMIC_THRESHOLDS
    expect(isHighSeismicCategory('C')).toBe(false)
    expect(isHighSeismicCategory('D0')).toBe(true)
    expect(requiresSillAnchorBolts('B')).toBe(false)
    expect(requiresSillAnchorBolts('C')).toBe(true)

    const popSdcB = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 110, seismicCategory: 'B' },
    })
    const popSdcC = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 110, seismicCategory: 'C' },
    })
    const popSdcD0 = autopopulateStructuralScene(baseScene, {
      levelId: 'level_0',
      design: { windMph: 110, seismicCategory: 'D0' },
    })
    expect(popSdcB.createdNodes.some((n) => n.sku === 'SSTB16')).toBe(false)
    expect(popSdcC.createdNodes.some((n) => n.sku === 'SSTB16')).toBe(true)
    expect(popSdcC.createdNodes.some((n) => n.sku === 'BP3x3')).toBe(false)
    expect(popSdcD0.createdNodes.some((n) => n.sku === 'BP3x3')).toBe(true)

    const bwlC = evaluateBracedWallLines({ nodes: baseScene, design: { seismicCategory: 'C', windMph: 115 } })
    const bwlD0 = evaluateBracedWallLines({ nodes: baseScene, design: { seismicCategory: 'D0', windMph: 115 } })
    expect(bwlC.every((b) => !b.requiresPlateWashers)).toBe(true)
    expect(bwlD0.every((b) => b.requiresPlateWashers)).toBe(true)
  })

  test('minFootingWidthIn (18"), minBearingToleranceIn (0.05"), and roof envelope (0.08m / 0.15m) parity', () => {
    // 1. Footing width boundary (17.5" fails, 18" passes)
    const colPass: Record<string, SceneNodeLike> = {
      c1: { id: 'c1', type: 'structural:column', position: [2, 0, 2], heightM: 2.7, footingWidthIn: 18 },
    }
    const colFail: Record<string, SceneNodeLike> = {
      c1: { id: 'c1', type: 'structural:column', position: [2, 0, 2], heightM: 2.7, footingWidthIn: 17.5 },
    }
    expect(traceStructuralLoadPaths({ nodes: colPass }).gravityLinks[0]?.continuous).toBe(true)
    expect(traceStructuralLoadPaths({ nodes: colFail }).gravityLinks[0]?.continuous).toBe(false)

    // 2. Beam bearing tolerance (0.05" tolerance below required 1.5" bearing)
    const makeBeamScene = (bearingLengthIn: number): Record<string, SceneNodeLike> => ({
      w1: { id: 'w1', type: 'wall', start: [0, 0], end: [4, 0], height: 2.74, thickness: 0.14 },
      b1: {
        id: 'b1',
        type: 'structural:beam',
        name: 'Window Header',
        role: 'header',
        beamType: 'lvl',
        designation: '2-ply 1-3/4x11-7/8 LVL',
        widthIn: 3.5,
        depthIn: 11.875,
        start: [1, 0],
        end: [2.2, 0],
        elevationY: 2.3,
        tributaryWidthFt: 4,
        bearingLengthIn,
        jackStudsEachEnd: 1,
      },
    })
    const bearingOk = auditStructuralScene(makeBeamScene(1.46)) // within 0.05" tolerance of 1.5"
    const bearingLow = auditStructuralScene(makeBeamScene(1.44)) // outside 0.05" tolerance of 1.5"
    expect(bearingOk.findings.some((f) => f.codeRef === 'IRC R502.6')).toBe(false)
    expect(bearingLow.findings.some((f) => f.codeRef === 'IRC R502.6')).toBe(true)

    // 3. Roof framing envelope warning (>0.08m) vs error (>0.15m)
    const makeRoofEquipScene = (excessM: number): Record<string, SceneNodeLike> => {
      const scene = makeBasicHouseScene()
      // Flat commercial roof plane = baseY (0) + wallH (2.7432) + 0.2858 = 3.029m
      const roofY = 2.7432 + 0.2858
      scene.rtu = {
        id: 'rtu',
        type: 'hvac:equipment',
        parentId: 'level_0',
        equipmentKind: 'rooftop-package-unit',
        position: [4.5, 3.03, 3.5],
      }
      scene.ahu = {
        id: 'ahu',
        type: 'hvac:equipment',
        parentId: 'level_0',
        equipmentKind: 'air-handler',
        name: 'Indoor AHU',
        heightM: 1.0,
        position: [4.5, roofY + excessM - 1.0, 3.5],
      }
      return scene
    }
    const warnAudit = auditStructuralScene(makeRoofEquipScene(0.11))
    const errAudit = auditStructuralScene(makeRoofEquipScene(0.2))
    const warnFinding = warnAudit.findings.find((f) => f.nodeId === 'ahu')
    const errFinding = errAudit.findings.find((f) => f.nodeId === 'ahu')
    expect(warnFinding?.severity).toBe('warning')
    expect(warnFinding?.codeRef).toBe(getIrcRuleById('irc-r802-roof-framing-envelope').codeRef)
    expect(errFinding?.severity).toBe('error')
    expect(errFinding?.codeRef).toBe(getIrcRuleById('irc-r802-roof-framing-envelope').codeRef)
  })

  test('segmentIntersectsBeam & segmentIntersectsColumn match kernel extractBeamPrism / extractColumnPrism / segmentIntersectsOrientedPrismY 1:1', () => {
    const beamNode: SceneNodeLike = {
      id: 'bm_diag',
      type: 'structural:beam',
      start: [0, 0],
      end: [6, 6],
      elevationY: 2.5,
      widthIn: 5.5,
      depthIn: 14,
    }
    const beamPrism = extractBeamPrism(beamNode)!
    expect(beamPrism).not.toBeNull()

    const wM = 5.5 * INCHES_TO_METERS
    const dM = 14 * INCHES_TO_METERS
    const extents = { halfXZ: 0.18, halfY: 0.1 }
    const pad = [extents.halfXZ, extents.halfY, extents.halfXZ] as const

    const beamTestSegments: Array<readonly [[number, number, number], [number, number, number], boolean]> = [
      [[0, 2.5, 5.5], [0, 2.5, 6.0], false], // corner miss that naive AABB would false-hit
      [[2.5, 2.5, 3.5], [3.5, 2.5, 2.5], true], // perpendicular pierce at midpoint
      [[3.0, 2.0, 3.0], [3.0, 2.1, 3.0], false], // well below soffit
    ]
    for (const [a, b, expected] of beamTestSegments) {
      const localRes = segmentIntersectsBeam(a, b, [0, 0], [6, 6], 2.5, wM, dM, extents)
      const kernelRes = segmentIntersectsOrientedPrismY(a, b, beamPrism, pad)
      expect(localRes).toBe(expected)
      expect(localRes).toBe(kernelRes)
    }

    const rotY = Math.PI / 4
    const colNode: SceneNodeLike = {
      id: 'col_rot',
      type: 'structural:column',
      position: [4, 0, 4],
      widthIn: 12,
      depthIn: 4,
      heightM: 2.8,
      rotation: rotY,
    }
    const colPrism = extractColumnPrism(colNode)!
    expect(colPrism).not.toBeNull()

    const colW = 12 * INCHES_TO_METERS
    const colD = 4 * INCHES_TO_METERS
    const colTestSegments: Array<readonly [[number, number, number], [number, number, number], boolean]> = [
      [[3.5, 1.4, 3.5], [4.5, 1.4, 4.5], true], // pierces rotated shaft center
      [[4.0, 1.4, 4.5], [4.5, 1.4, 4.5], false], // outside rotated narrow face
      [[3.5, 3.2, 3.5], [4.5, 3.2, 4.5], false], // above column top
    ]
    for (const [a, b, expected] of colTestSegments) {
      const localRes = segmentIntersectsColumn(a, b, [4, 0, 4], colW, colD, 2.8, rotY, 0.025)
      const kernelRes = segmentIntersectsOrientedPrismY(a, b, colPrism, [0.025, 0.025, 0.025])
      expect(localRes).toBe(expected)
      expect(localRes).toBe(kernelRes)
    }
  })

  test('evaluateDeclarativeRules returns canonical { ok, tool, summary, data } JSON envelope and enforces INV-MEP-08 monotonicity', () => {
    const cleanCandidates: PlacementCandidate[] = [
      {
        id: 'asm_ok',
        kind: 'structural:assembly',
        pos: [0, 0, 0],
        designWindMph: 145,
        seismicDesignCategory: 'D2',
        hasRoofTie: true,
        hasStrap: true,
        hasHeavyStrap: true,
        hasHoldDown: true,
        hasSillBolt: true,
        footingWidthIn: 24,
        bearingIn: 3.5,
      },
      {
        id: 'pipe_ok',
        kind: 'plumbing:pipe-run',
        role: 'plumbing:pipe-run',
        pos: [2, 2.2, 2],
        roofSurfaceYM: 3.1,
        nearFixtures: [{ kind: 'structural:beam', horizontalDistM: 0.05 }],
      },
    ]

    const passEnvelope = evaluateDeclarativeRules(IRC_DECLARATIVE_RULES, cleanCandidates, {
      trade: 'structural',
      tool: 'structural_audit_irc',
    })
    expect(passEnvelope.ok).toBe(true)
    expect(passEnvelope.tool).toBe('structural_audit_irc')
    expect(typeof passEnvelope.summary).toBe('string')
    expect(passEnvelope.summary).toContain('structural audit passed')
    expect(passEnvelope.data.trade).toBe('structural')
    expect(passEnvelope.data.rulesEvaluated).toBe(IRC_DECLARATIVE_RULES.length)
    expect(passEnvelope.data.violationCount).toBe(0)
    expect(passEnvelope.data.violations).toEqual([])

    const failingCandidates: PlacementCandidate[] = [
      {
        id: 'asm_bad',
        kind: 'structural:assembly',
        pos: [0, 0, 0],
        designWindMph: 145,
        seismicDesignCategory: 'D1',
        hasRoofTie: false,
        hasStrap: false,
        hasHeavyStrap: false,
        hasHoldDown: false,
        hasSillBolt: false,
        footingWidthIn: 14,
      },
      {
        id: 'duct_clash',
        kind: 'hvac:duct-run',
        role: 'hvac:duct-run',
        pos: [3, 2.5, 3],
        nearFixtures: [{ kind: 'structural:beam', horizontalDistM: 0 }],
      },
    ]

    const failEnvelope = evaluateDeclarativeRules(IRC_DECLARATIVE_RULES, failingCandidates, {
      trade: 'structural',
      tool: 'structural_audit_irc',
    })
    expect(failEnvelope.ok).toBe(false)
    expect(failEnvelope.tool).toBe('structural_audit_irc')
    expect(failEnvelope.data.trade).toBe('structural')
    expect(failEnvelope.data.violationCount).toBe(7) // 6 wind/seismic/footing + 1 MEP beam right-of-way
    expect(failEnvelope.data.violations.some((v) => v.ruleId === 'irc-r802-11-wind-seismic-uplift')).toBe(true)
    expect(failEnvelope.data.violations.some((v) => v.ruleId === 'irc-r502-8-mep-right-of-way')).toBe(true)

    // INV-MEP-08 soundness: candidate in placement cushion (0.015m from beam) is rejected in placement
    // mode (< 0.0254m = 1") while passing audit (> 0m), and any placement-legal candidate always passes audit.
    const cushionCandidate: PlacementCandidate = {
      id: 'pipe_cushion',
      kind: 'plumbing:pipe-run',
      role: 'plumbing:pipe-run',
      pos: [1, 2.2, 1],
      nearFixtures: [{ kind: 'structural:beam', horizontalDistM: 0.015 }],
    }
    expect(evaluatePlacementCandidate(IRC_DECLARATIVE_RULES, cushionCandidate, 'placement').legal).toBe(false)
    expect(evaluatePlacementCandidate(IRC_DECLARATIVE_RULES, cushionCandidate, 'audit').legal).toBe(true)

    // Warning-only roof framing envelope violation keeps ok: true while surfacing the violation
    const warnOnlyEnvelope = evaluateDeclarativeRules(
      IRC_DECLARATIVE_RULES,
      [
        {
          id: 'ahu_warn',
          kind: 'hvac:equipment',
          pos: [2, 3.11, 2],
          roofSurfaceYM: 3.0, // protrudes +0.11m > +0.08m roofMarginM (-0.08) -> warning
        },
      ],
      { trade: 'structural', tool: 'structural_audit_irc' },
    )
    expect(warnOnlyEnvelope.ok).toBe(true)
    expect(warnOnlyEnvelope.data.violationCount).toBe(1)
    expect(warnOnlyEnvelope.data.violations[0]?.ruleId).toBe('irc-r802-roof-framing-envelope')
    expect(warnOnlyEnvelope.data.violations[0]?.severity).toBe('warning')
  })
})
