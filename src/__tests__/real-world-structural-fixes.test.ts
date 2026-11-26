import { describe, expect, test } from 'bun:test'
import { structuralAgentOperations } from '../agent-operations'
import { auditStructuralScene } from '../irc/audit'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { evaluateBracedWallLines, traceStructuralLoadPaths } from '../irc/load-path'
import { sizeBeamOrHeader } from '../irc/sizing'
import { BEAM_CATALOG, type SceneNodeLike } from '../irc/tables'

function mergeCreated(
  base: Readonly<Record<string, SceneNodeLike>>,
  created: ReadonlyArray<SceneNodeLike>,
): Record<string, SceneNodeLike> {
  const out: Record<string, SceneNodeLike> = { ...base }
  for (const n of created) out[n.id] = n
  return out
}

describe('Real-World Public Pascal Structural Regression Suite (REAL-STR-01..04)', () => {
  test('REAL-STR-01: L-shaped floor girder emits end-support columns (footing_ IDs + caps/bases) and achieves 0 broken load paths', () => {
    // L-shaped footprint: 18m x 14m bounding box, with NE quadrant [9..18, 5..14] cut out in open space.
    // Floor girder spans along X at Z = 7.0 m; its east end (18, 7.0) sits in open space 2 m clear of any wall!
    const lShapedScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', name: 'Ground Floor', level: 0, height: 2.7432 },
      w_south: { id: 'w_south', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [18, 0], height: 2.7432, thickness: 0.16 },
      w_east_low: { id: 'w_east_low', type: 'wall', parentId: 'lvl1', start: [18, 0], end: [18, 5], height: 2.7432, thickness: 0.16 },
      w_step_h: { id: 'w_step_h', type: 'wall', parentId: 'lvl1', start: [18, 5], end: [9, 5], height: 2.7432, thickness: 0.16 },
      w_step_v: { id: 'w_step_v', type: 'wall', parentId: 'lvl1', start: [9, 5], end: [9, 14], height: 2.7432, thickness: 0.16 },
      w_north_west: { id: 'w_north_west', type: 'wall', parentId: 'lvl1', start: [9, 14], end: [0, 14], height: 2.7432, thickness: 0.16 },
      w_west: { id: 'w_west', type: 'wall', parentId: 'lvl1', start: [0, 14], end: [0, 0], height: 2.7432, thickness: 0.16 },
    }

    const res = autopopulateStructuralScene(lShapedScene, {
      levelId: 'lvl1',
      floorSystem: 'tji-ijoist',
      includeFoundation: true,
    })
    const combined = mergeCreated(lShapedScene, res.createdNodes)

    const endPosts = res.createdNodes.filter(
      (n) => n.type === 'structural:column' && typeof n.name === 'string' && n.name.includes('End Support Post'),
    )
    expect(endPosts.length).toBeGreaterThanOrEqual(1)
    for (const post of endPosts) {
      expect(String(post.transfersToNodeId)).toMatch(/^footing_/)
      expect(String(post.transfersToNodeId)).not.toContain('footing:')
      expect(Number(post.footingWidthIn)).toBeGreaterThanOrEqual(24)
    }

    const lp = traceStructuralLoadPaths({ nodes: combined })
    expect(lp.brokenLoadPaths).toBe(0)
    expect(lp.upliftContinuous).toBe(true)

    const audit = auditStructuralScene(combined)
    expect(audit.passed).toBe(true)
    expect(audit.errorCount).toBe(0)

    // Sanity: on a rectangular footprint where perimeter walls support both girder ends, no end-support posts are emitted
    const rectScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', name: 'Ground Floor', level: 0, height: 2.7432 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [16, 0], height: 2.7432, thickness: 0.16 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [16, 0], end: [16, 12], height: 2.7432, thickness: 0.16 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [16, 12], end: [0, 12], height: 2.7432, thickness: 0.16 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 12], end: [0, 0], height: 2.7432, thickness: 0.16 },
    }
    const rectRes = autopopulateStructuralScene(rectScene, { levelId: 'lvl1', floorSystem: 'tji-ijoist' })
    const rectEndPosts = rectRes.createdNodes.filter(
      (n) => n.type === 'structural:column' && typeof n.name === 'string' && n.name.includes('End Support Post'),
    )
    expect(rectEndPosts.length).toBe(0)
  })

  test('REAL-STR-02: deep AISC A992 steel W-beams (W14x48..W24x104) size a 34 ft storefront window header to L/360', () => {
    for (const [id, ix, sx, depthIn, widthIn, areaIn2, weightPlf] of [
      ['steel-w14x48', 484, 70.2, 13.8, 8.03, 14.1, 48.0],
      ['steel-w16x57', 758, 92.2, 16.4, 7.12, 16.8, 57.0],
      ['steel-w18x76', 1330, 146, 18.2, 11.0, 22.3, 76.0],
      ['steel-w21x93', 2070, 192, 21.6, 8.42, 27.3, 93.0],
      ['steel-w24x104', 3100, 258, 24.1, 12.8, 30.6, 104.0],
    ] as const) {
      const entry = BEAM_CATALOG.find((b) => b.id === id)
      expect(entry).toBeDefined()
      expect(entry!.family).toBe('steel-w')
      expect(entry!.ixIn4).toBe(ix)
      expect(entry!.sxIn3).toBe(sx)
      expect(entry!.depthIn).toBe(depthIn)
      expect(entry!.widthIn).toBe(widthIn)
      expect(entry!.areaIn2).toBe(areaIn2)
      expect(entry!.weightPlf).toBe(weightPlf)
      expect(entry!.eiLbIn2).toBe(Math.round(ix * 29_000_000))
      expect(entry!.allowableMomentFtLbs).toBe(Math.round(sx * 2500))
    }

    const headerSizing = sizeBeamOrHeader({
      spanFt: 34,
      tributaryWidthFt: 12,
      role: 'header',
      preferredFamily: 'lvl',
      liveLoadPsf: 30,
      deadLoadPsf: 10,
      snowLoadPsf: 30,
      storiesSupported: 0,
    })
    expect(headerSizing.passes).toBe(true)
    expect(headerSizing.entry.family).toBe('steel-w')
    expect(headerSizing.liveDeflectionRatio).toBeGreaterThanOrEqual(360)
    expect(headerSizing.totalDeflectionRatio).toBeGreaterThanOrEqual(240)

    // End-to-end commercial storefront scene with a 34 ft glazing span
    const gymScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', name: 'Gym Floor', level: 0, height: 4.2 },
      w_front: { id: 'w_front', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [14, 0], height: 4.2, thickness: 0.2 },
      w_right: { id: 'w_right', type: 'wall', parentId: 'lvl1', start: [14, 0], end: [14, 10], height: 4.2, thickness: 0.2 },
      w_back: { id: 'w_back', type: 'wall', parentId: 'lvl1', start: [14, 10], end: [0, 10], height: 4.2, thickness: 0.2 },
      w_left: { id: 'w_left', type: 'wall', parentId: 'lvl1', start: [0, 10], end: [0, 0], height: 4.2, thickness: 0.2 },
      win_storefront: {
        id: 'win_storefront',
        type: 'window',
        parentId: 'w_front',
        name: 'Storefront Window 5',
        width: 10.36, // 34.0 ft
        height: 2.8,
        position: [7, 1.8, 0],
      },
    }
    const auto = autopopulateStructuralScene(gymScene, { levelId: 'lvl1' })
    const combined = mergeCreated(gymScene, auto.createdNodes)
    const audit = auditStructuralScene(combined)
    expect(audit.findings.filter((f) => f.category === 'beam-sizing')).toHaveLength(0)
    expect(audit.passed).toBe(true)
  })

  test('REAL-STR-03: BWL auto-remediation credits anchored hold-downs while still failing when hold-downs are absent', () => {
    // Wall line with large French doors leaving < 20% prescriptive WSP bracing
    const storefrontScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', name: 'Main Level', level: 0, height: 2.7432 },
      w_glass: { id: 'w_glass', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [8, 0], height: 2.7432, thickness: 0.16 },
      d_wide1: { id: 'd_wide1', type: 'door', parentId: 'w_glass', width: 3.4, height: 2.13, position: [2.0, 0, 0] },
      d_wide2: { id: 'd_wide2', type: 'door', parentId: 'w_glass', width: 3.4, height: 2.13, position: [6.0, 0, 0] },
      w_north: { id: 'w_north', type: 'wall', parentId: 'lvl1', start: [0, 6], end: [8, 6], height: 2.7432, thickness: 0.16 },
      w_west: { id: 'w_west', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [0, 6], height: 2.7432, thickness: 0.16 },
      w_east: { id: 'w_east', type: 'wall', parentId: 'lvl1', start: [8, 0], end: [8, 6], height: 2.7432, thickness: 0.16 },
    }

    // 1. Negative test: without hold-downs, deficient BWL MUST fail both evaluateBracedWallLines and auditStructuralScene
    const rawBwls = evaluateBracedWallLines({ nodes: storefrontScene, levelId: 'lvl1' })
    const rawGlassBwl = rawBwls.find((b) => b.wallIds.includes('w_glass'))!
    expect(rawGlassBwl.passes).toBe(false)
    expect(rawGlassBwl.providedPercent).toBeLessThan(rawGlassBwl.requiredPercent)

    const rawAudit = auditStructuralScene(storefrontScene)
    expect(rawAudit.findings.some((f) => f.category === 'bracing-shear' && f.severity === 'error')).toBe(true)

    // 2. Negative isolation test: a hold-down attached ONLY to an unrelated wall (w_north) must NOT pass w_glass
    const wrongWallHoldDownScene: Record<string, SceneNodeLike> = {
      ...storefrontScene,
      hd_wrong: {
        id: 'hd_wrong',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'hold-down',
        sku: 'HDU5-SDS2.5',
        position: [0.2, 0, 6],
        attachedNodeIds: ['w_north'],
      },
    }
    const wrongBwls = evaluateBracedWallLines({ nodes: wrongWallHoldDownScene, levelId: 'lvl1' })
    expect(wrongBwls.find((b) => b.wallIds.includes('w_glass'))!.passes).toBe(false)

    // 3. Positive test: autopopulate emits anchored hold-downs (with wall IDs + assemblyId) and BWL passes cleanly
    const auto = autopopulateStructuralScene(storefrontScene, { levelId: 'lvl1' })
    const asm = auto.createdNodes.find((n) => n.type === 'structural:assembly')!
    const holdDowns = auto.createdNodes.filter(
      (n) =>
        n.type === 'structural:connector' &&
        n.category === 'hold-down' &&
        Array.isArray(n.attachedNodeIds) &&
        n.attachedNodeIds.includes('w_glass'),
    )
    expect(holdDowns.length).toBeGreaterThanOrEqual(1)
    expect(holdDowns[0]!.attachedNodeIds).toContain(asm.id)

    const combined = mergeCreated(storefrontScene, auto.createdNodes)
    const remediatedBwls = evaluateBracedWallLines({ nodes: combined, levelId: 'lvl1' })
    const remediatedGlassBwl = remediatedBwls.find((b) => b.wallIds.includes('w_glass'))!
    expect(remediatedGlassBwl.passes).toBe(true)
    expect(['CS-PF', 'Engineered-Shear']).toContain(remediatedGlassBwl.bracingMethod)

    const finalAudit = auditStructuralScene(combined)
    expect(finalAudit.findings.filter((f) => f.category === 'bracing-shear')).toHaveLength(0)
    expect(finalAudit.passed).toBe(true)
  })

  test('REAL-STR-04: unwalled rooftop deck level with stairs & >1000 sqft slab matches autopopulate parity without masking walled-level firestop errors', () => {
    const multiStoryWithRoofDeck: Record<string, SceneNodeLike> = {
      building_1: { id: 'building_1', type: 'building', name: 'Warner Style House' },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'building_1', name: 'Level 0', level: 0, height: 2.7432 },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'building_1', name: 'Level 1', level: 1, height: 2.7432 },
      // Unwalled rooftop terrace/deck level (0 walls, 2 stairs, 2900 sq ft deck slab, roof nodes)
      lvl2_deck: { id: 'lvl2_deck', type: 'level', parentId: 'building_1', name: 'Level 2 Roof Deck', level: 2, height: 2.7432 },

      // Level 0 walled footprint + slab (>1000 sqft) + stair
      w0_s: { id: 'w0_s', type: 'wall', parentId: 'lvl0', start: [0, 0], end: [12, 0], height: 2.7432, thickness: 0.16 },
      w0_e: { id: 'w0_e', type: 'wall', parentId: 'lvl0', start: [12, 0], end: [12, 10], height: 2.7432, thickness: 0.16 },
      w0_n: { id: 'w0_n', type: 'wall', parentId: 'lvl0', start: [12, 10], end: [0, 10], height: 2.7432, thickness: 0.16 },
      w0_w: { id: 'w0_w', type: 'wall', parentId: 'lvl0', start: [0, 10], end: [0, 0], height: 2.7432, thickness: 0.16 },
      slab0: { id: 'slab0', type: 'slab', parentId: 'lvl0', polygon: [[0, 0], [12, 0], [12, 10], [0, 10]], elevation: 0 },
      stair0: { id: 'stair0', type: 'stair', parentId: 'lvl0', position: [5, 0, 5], width: 1.05, depth: 3.2, height: 2.74 },

      // Level 1 walled footprint + stair
      w1_s: { id: 'w1_s', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0], height: 2.7432, thickness: 0.16 },
      w1_e: { id: 'w1_e', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 10], height: 2.7432, thickness: 0.16 },
      w1_n: { id: 'w1_n', type: 'wall', parentId: 'lvl1', start: [12, 10], end: [0, 10], height: 2.7432, thickness: 0.16 },
      w1_w: { id: 'w1_w', type: 'wall', parentId: 'lvl1', start: [0, 10], end: [0, 0], height: 2.7432, thickness: 0.16 },
      stair1: { id: 'stair1', type: 'stair', parentId: 'lvl1', position: [5, 0, 5], width: 1.05, depth: 3.2, height: 2.74 },

      // Unwalled Level 2 roof deck: 0 walls, 2900 sq ft slab, 2 stairs, roof
      slab_deck: { id: 'slab_deck', type: 'slab', parentId: 'lvl2_deck', polygon: [[0, 0], [18, 0], [18, 15], [0, 15]], elevation: 0.05 },
      stair_deck1: { id: 'stair_deck1', type: 'stair', parentId: 'lvl2_deck', position: [3, 0, 3], width: 1.05, depth: 3.2, height: 2.74 },
      stair_deck2: { id: 'stair_deck2', type: 'stair', parentId: 'lvl2_deck', position: [14, 0, 3], width: 1.05, depth: 3.2, height: 2.74 },
      roof_deck: { id: 'roof_deck', type: 'roof', parentId: 'lvl2_deck', pitch: 26.57 },
    }

    // Autopopulate all walled levels (lvl0 and lvl1)
    let working = { ...multiStoryWithRoofDeck }
    for (const lvlId of ['lvl0', 'lvl1']) {
      const res = structuralAgentOperations.structural_autopopulate_irc(working, { levelId: lvlId })
      working = mergeCreated(working, res.createdNodes ?? [])
    }

    // Audit MUST suppress open roof-deck floor/attic draftstops (R302.12 / R302.12.1) on unwalled lvl2_deck
    // while STILL auditing IRC R302.11(3) stair-stringer fire blocking on lvl2_deck (STR-BUG-04)!
    const auditBeforeDeckStairFs = auditStructuralScene(working)
    expect(
      auditBeforeDeckStairFs.findings.some(
        (f) => f.category === 'fire-blocking' && (f.codeRef === 'IRC R302.12' || f.codeRef === 'IRC R302.12.1'),
      ),
    ).toBe(false)
    expect(
      auditBeforeDeckStairFs.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11(3)'),
    ).toBe(true)

    // Once the unwalled roof deck's stair stringers are fire-blocked (or when deck has no stairs), audit passes with 0 errors
    const noDeckStairs = { ...working }
    delete noDeckStairs.stair_deck1
    delete noDeckStairs.stair_deck2
    const audit = auditStructuralScene(noDeckStairs)
    expect(audit.findings.filter((f) => f.category === 'fire-blocking')).toHaveLength(0)
    expect(audit.passed).toBe(true)

    // Negative parity check: removing a stair firestop from walled lvl1 MUST still be flagged!
    const missingL1StairFs = { ...noDeckStairs }
    for (const [id, n] of Object.entries(missingL1StairFs)) {
      if (n.type === 'structural:firestop' && n.parentId === 'lvl1' && n.firestopKind === 'stair-stringer') {
        delete missingL1StairFs[id]
      }
    }
    const auditMissing = auditStructuralScene(missingL1StairFs)
    expect(
      auditMissing.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.11(3)'),
    ).toBe(true)
  })
})
