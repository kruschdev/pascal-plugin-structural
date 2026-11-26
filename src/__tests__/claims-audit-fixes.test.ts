import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, type InstancedMesh, Mesh, Raycaster, Vector3 } from 'three'
import { structuralAgentOperations } from '../agent-operations'
import { structuralAgentTools } from '../agent-tools'
import { buildColumnCad } from '../cad/assemblies'
import { buildBuildingSkeletonGroup } from '../cad/building-skeleton'
import { STRUCTURAL_CAD_CATALOG } from '../cad/catalog'
import { buildConnectorCad, getPostCapSeatOffsetM } from '../cad/connectors'
import { structuralChatExtension } from '../index'
import { auditStructuralScene, segmentIntersectsColumn } from '../irc/audit'
import { autopopulateStructuralScene } from '../irc/autopopulate'
import { deriveRequiredFirestops } from '../irc/fireblocking'
import { evaluateBracedWallLines, traceStructuralLoadPaths } from '../irc/load-path'
import { generateStructuralSchedulePack } from '../irc/schedule'
import { checkBeamEntry } from '../irc/sizing'
import {
  BEAM_CATALOG,
  CONNECTOR_CATALOG,
  INCHES_TO_METERS,
  type SceneNodeLike,
  resolveNodeLevelId,
} from '../irc/tables'
import { StructuralAssemblyNode, structuralAssemblyRenderDefinition } from '../nodes/assembly'
import {
  StructuralBeamNode,
  buildStructuralBeamGeometry,
  getStructuralBeamPorts,
} from '../nodes/beam'
import {
  StructuralColumnNode,
  buildStructuralColumnFloorplan,
  buildStructuralColumnGeometry,
} from '../nodes/column'
import {
  StructuralConnectorNode,
  buildStructuralConnectorGeometry,
} from '../nodes/connector'
import {
  StructuralFirestopNode,
  buildStructuralFirestopGeometry,
  structuralFirestopRenderDefinition,
} from '../nodes/firestop'
import {
  structuralAssemblyParametrics,
  structuralBeamParametrics,
  structuralConnectorParametrics,
} from '../nodes/parametrics'
import { useStructuralUi } from '../ui/store'

const dummyCtx = {} as never

describe('Claims-vs-Reality Audit Fix Regression Suite (STR-01..STR-06)', () => {
  test('STR-01: live structural:beam is vertically centered on elevationY and bearing ports sit at soffit', () => {
    const beam = StructuralBeamNode.parse({
      object: 'node',
      id: 'strbm_center_check',
      start: [0, 2],
      end: [4, 2],
      elevationY: 2.5,
      beamType: 'lvl',
      widthIn: 3.5,
      depthIn: 11.875,
      plyCount: 2,
    })
    const depthM = beam.depthIn * INCHES_TO_METERS
    const group = buildStructuralBeamGeometry(beam, dummyCtx)
    const box = new Box3().setFromObject(group)
    const centerY = (box.min.y + box.max.y) / 2
    expect(centerY).toBeCloseTo(beam.elevationY, 3)
    expect(box.min.y).toBeCloseTo(beam.elevationY - depthM / 2, 2)
    expect(box.max.y).toBeCloseTo(beam.elevationY + depthM / 2, 2)

    const ports = getStructuralBeamPorts(beam)
    expect(ports[0]!.position[1]).toBeCloseTo(beam.elevationY - depthM / 2, 4)
    expect(ports[1]!.position[1]).toBeCloseTo(beam.elevationY - depthM / 2, 4)
  })

  test('STR-01: live structural:column shaft spans [0, heightM] with footing below grade and no double-stacked hardware', () => {
    const col = StructuralColumnNode.parse({
      object: 'node',
      id: 'strcol_origin_check',
      position: [2, 0, 2],
      heightM: 2.7432,
      columnType: 'wood-solid',
      widthIn: 3.5,
      depthIn: 3.5,
      footingWidthIn: 24,
      footingDepthIn: 12,
    })
    const group = buildStructuralColumnGeometry(col, dummyCtx)
    const box = new Box3().setFromObject(group)
    // Footing + pier extend below y = 0; column shaft tops out cleanly at heightM (NOT heightM + 15"!)
    expect(box.min.y).toBeLessThan(-0.3)
    expect(box.max.y).toBeCloseTo(col.heightM, 3)
    // Shaft + footing + pier only (3 meshes: footing, pier, wood shaft; no duplicated ABU66Z/CCQ66)
    let meshCount = 0
    group.traverse((o) => {
      if (o instanceof Mesh) meshCount += 1
    })
    expect(meshCount).toBe(3)

    // When buildColumnCad includes hardware on a 4x4 post without explicit SKUs, it selects width-matched ABU44Z/BC4
    const cad4x4 = buildColumnCad({
      columnType: 'wood-solid',
      widthIn: 3.5,
      depthIn: 3.5,
      heightM: 2.4,
      includeFooting: false,
      includeBaseHardware: true,
      includeCapHardware: true,
    })
    const names: string[] = []
    cad4x4.traverse((o) => {
      if (o.name) names.push(o.name)
    })
    expect(names.some((n) => n.includes('ABU44Z'))).toBe(true)
    expect(names.some((n) => n.includes('BC4'))).toBe(true)
    expect(names.some((n) => n.includes('ABU66Z'))).toBe(false)
    expect(names.some((n) => n.includes('CCQ66'))).toBe(false)
  })

  test('STR-02: autopopulated 30ft x 24ft cathedral roof AND multi-story (storiesAbove: 1) house pass audit with 0 errors', () => {
    // 1) 30 ft x 24 ft (9.144 m x 7.315 m) cathedral roof house
    const cathedralBase: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [9.144, 0], height: 2.7432, thickness: 0.165 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [9.144, 0], end: [9.144, 7.315], height: 2.7432, thickness: 0.165 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [9.144, 7.315], end: [0, 7.315], height: 2.7432, thickness: 0.165 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 7.315], end: [0, 0], height: 2.7432, thickness: 0.165 },
      roof1: { id: 'roof1', type: 'roof', parentId: 'lvl1', pitch: 26.57 },
    }
    const cathAuto = autopopulateStructuralScene(cathedralBase, {
      levelId: 'lvl1',
      floorSystem: 'tji-ijoist',
      roofSystem: 'ridge-beam-cathedral',
      design: { groundSnowPsf: 40, windMph: 115, seismicCategory: 'C', storiesAbove: 0 },
    })
    const cathCombined: Record<string, SceneNodeLike> = { ...cathedralBase }
    for (const n of cathAuto.createdNodes) cathCombined[n.id] = n

    // 30 ft ridge must split into 2 clear-span bays <= 20 ft with 3 ridge posts (2 gable + 1 intermediate)
    const ridgeBeams = cathAuto.createdNodes.filter((n) => n.type === 'structural:beam' && n.role === 'ridge-beam')
    expect(ridgeBeams.length).toBe(2)
    const ridgePosts = cathAuto.createdNodes.filter(
      (n) => n.type === 'structural:column' && String(n.name ?? '').includes('Ridge Beam Bearing Post'),
    )
    expect(ridgePosts.length).toBe(3)

    const cathAudit = auditStructuralScene(cathCombined)
    expect(cathAudit.errorCount).toBe(0)
    expect(cathAudit.passed).toBe(true)

    // 2) Multi-story (storiesAbove: 1) 12 m x 9 m house with floor girder + openings
    const twoStoryBase: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.7432 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [12, 0], height: 2.7432, thickness: 0.165 },
      w2: { id: 'w2', type: 'wall', parentId: 'lvl1', start: [12, 0], end: [12, 9], height: 2.7432, thickness: 0.165 },
      w3: { id: 'w3', type: 'wall', parentId: 'lvl1', start: [12, 9], end: [0, 9], height: 2.7432, thickness: 0.165 },
      w4: { id: 'w4', type: 'wall', parentId: 'lvl1', start: [0, 9], end: [0, 0], height: 2.7432, thickness: 0.165 },
      win1: { id: 'win1', type: 'window', parentId: 'w1', width: 2.4, height: 1.5, sillHeight: 0.9, position: [6, 0, 0] },
    }
    const twoStoryAuto = autopopulateStructuralScene(twoStoryBase, {
      levelId: 'lvl1',
      floorSystem: 'tji-ijoist',
      roofSystem: 'stick-rafter',
      design: { groundSnowPsf: 40, windMph: 120, seismicCategory: 'C', storiesAbove: 1 },
    })
    const twoStoryCombined: Record<string, SceneNodeLike> = { ...twoStoryBase }
    for (const n of twoStoryAuto.createdNodes) twoStoryCombined[n.id] = n

    const twoStoryAudit = auditStructuralScene(twoStoryCombined)
    expect(twoStoryAudit.errorCount).toBe(0)
    expect(twoStoryAudit.passed).toBe(true)
  })

  test('STR-03: multi-level isolation (MEP, firestops, TJI squash, post bases/caps), column MEP clashes, and attic draftstop audit', () => {
    const multiLevel: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', level: 0 },
      lvl2: { id: 'lvl2', type: 'level', level: 1 },
      asm1: {
        id: 'asm1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        floorSystem: 'tji-ijoist',
        roofSystem: 'stick-rafter',
        visibleSystems: { walls: true, floor: true, roof: false, beams: true, columns: true, connectors: true, firestop: true, foundation: true },
      },
      asm2: {
        id: 'asm2',
        type: 'structural:assembly',
        parentId: 'lvl2',
        floorSystem: 'dimensional',
        roofSystem: 'stick-rafter',
        visibleSystems: { walls: true, floor: true, roof: true, beams: true, columns: true, connectors: true, firestop: true, foundation: false },
      },
      // Level 1 beam & column + Level 1 tall wall WITH firestop
      bm1: {
        id: 'bm1',
        type: 'structural:beam',
        parentId: 'lvl1',
        role: 'floor-girder',
        start: [0, 3],
        end: [3.5, 3],
        elevationY: 2.4,
        beamType: 'lvl',
        widthIn: 3.5,
        depthIn: 11.875,
        bearingLengthIn: 3.5,
      },
      col1: {
        id: 'col1',
        type: 'structural:column',
        parentId: 'lvl1',
        position: [3.5, 0, 3],
        heightM: 2.25,
        widthIn: 5.5,
        depthIn: 5.5,
        axialLoadLbs: 5000,
        footingWidthIn: 24,
        footingDepthIn: 12,
        hasSquashBlocks: true,
      },
      base1: {
        id: 'base1',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'post-base',
        sku: 'ABU66Z',
        position: [3.5, 0, 3],
        attachedNodeIds: ['col1'],
      },
      cap1: {
        id: 'cap1',
        type: 'structural:connector',
        parentId: 'lvl1',
        category: 'post-cap',
        sku: 'CCQ66',
        position: [3.5, 2.25, 3],
        attachedNodeIds: ['col1', 'bm1'],
      },
      w1_tall: { id: 'w1_tall', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [5, 0], height: 3.5 },
      fs1_tall: {
        id: 'fs1_tall',
        type: 'structural:firestop',
        parentId: 'lvl1',
        firestopKind: 'wall-vertical-10ft',
        material: '2x-lumber',
        hostWallId: 'w1_tall',
        start: [0, 0],
        end: [5, 0],
        elevationY: 3.048,
      },
      // Level 2 tall wall at identical XY WITHOUT a Level 2 firestop -> must be flagged!
      w2_tall: { id: 'w2_tall', type: 'wall', parentId: 'lvl2', start: [0, 0], end: [5, 0], height: 3.5 },
      // Level 2 upper stacked column on dimensional floor -> must NOT require TJI squash blocks OR foundation post base!
      col2: {
        id: 'col2',
        type: 'structural:column',
        parentId: 'lvl2',
        position: [3.5, 0, 3],
        heightM: 2.4,
        widthIn: 5.5,
        depthIn: 5.5,
        axialLoadLbs: 4000,
        transfersToNodeId: 'col1',
        footingWidthIn: 0,
        footingDepthIn: 0,
        hasSquashBlocks: false,
      },
      // Level 2 pipe at same coordinates as Level 1 beam -> must NOT clash across levels!
      pipe_lvl2: {
        id: 'pipe_lvl2',
        type: 'plumbing:pipe-run',
        parentId: 'lvl2',
        path: [
          [1.5, 2.4, 1],
          [1.5, 2.4, 5],
        ],
      },
      // Level 1 duct piercing col1 at (3.5, 1.2, 3) -> MUST be flagged as MEP column clash!
      duct_pierce_col1: {
        id: 'duct_pierce_col1',
        type: 'hvac:duct-run',
        parentId: 'lvl1',
        path: [
          [2.0, 1.2, 3],
          [5.0, 1.2, 3],
        ],
      },
      // Level 2 large slab (> 3,000 sq ft) with attic roof -> missing R302.12.1 attic draftstop MUST be audited!
      slab2_big: {
        id: 'slab2_big',
        type: 'slab',
        parentId: 'lvl2',
        polygon: [
          [0, 0],
          [18, 0],
          [18, 18],
          [0, 18],
        ],
        elevation: 0,
      },
    }

    expect(segmentIntersectsColumn([2, 1.2, 3], [5, 1.2, 3], [3.5, 0, 3], 0.14, 0.14, 2.25)).toBe(true)
    expect(segmentIntersectsColumn([2, 2.5, 3], [5, 2.5, 3], [3.5, 0, 3], 0.14, 0.14, 2.25)).toBe(false)

    const audit = auditStructuralScene(multiLevel)
    // Level 2 pipe must NOT clash with Level 1 beam bm1
    expect(audit.findings.some((f) => f.category === 'mep-clash' && f.nodeId === 'bm1')).toBe(false)
    // Level 1 duct piercing col1 MUST be flagged
    expect(audit.findings.some((f) => f.category === 'mep-clash' && f.nodeId === 'col1')).toBe(true)
    // Level 2 tall wall missing firestop MUST be flagged despite identical XY firestop on Level 1
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.nodeId === 'w2_tall')).toBe(true)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.nodeId === 'w1_tall')).toBe(false)
    // IRC R302.12.1 attic draftstop MUST be flagged on Level 2 (> 3,000 sq ft slab + roof)
    expect(audit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.12.1')).toBe(true)

    const lp = traceStructuralLoadPaths({ nodes: multiLevel })
    // Level 2 dimensional-floor stacked column col2 must NOT require TJI squash blocks or foundation post base
    const col2Link = lp.gravityLinks.find((g) => g.fromNodeId === 'col2')
    expect(col2Link?.continuous).toBe(true)
    expect(col2Link?.requiresSquashBlock).toBe(false)
    expect(lp.upliftFindings.some((u) => u.includes('col2') && u.includes('post bases'))).toBe(false)
  })

  test('STR-04: NDS Table 4B SYP #2 Fb, roof ridge dead-load exemption, and BWL 1D interval merging (<= 100%)', () => {
    // 1) SYP #2 uses true NDS Table 4B Fb (2x8: 925, 2x10: 800, 2x12: 750) instead of 1100/900 scaling
    for (const [beamId, expectedSypFb, dflWithCf] of [
      ['dim-2-2x8', 925, 1080],
      ['dim-2-2x10', 800, 990],
      ['dim-2-2x12', 750, 900],
    ] as const) {
      const entry = BEAM_CATALOG.find((b) => b.id === beamId)!
      const dflCheck = checkBeamEntry(entry, {
        spanFt: 8,
        tributaryWidthFt: 10,
        role: 'header',
        species: 'df-l-2',
        snowLoadPsf: 30,
      })
      const sypCheck = checkBeamEntry(entry, {
        spanFt: 8,
        tributaryWidthFt: 10,
        role: 'header',
        species: 'syp-2',
        snowLoadPsf: 30,
      })
      // Since SYP Fb < DF-L Fb*Cf, SYP bending utilization must be HIGHER than DF-L by exact ratio dflWithCf / expectedSypFb
      expect(sypCheck.bendingUtilization / dflCheck.bendingUtilization).toBeCloseTo(dflWithCf / expectedSypFb, 2)
    }

    // 2) Roof ridge beam is exempt from (1 + stories * 0.85) dead-load multiplication
    const glulam = BEAM_CATALOG.find((b) => b.id === 'glulam-5.125x15')!
    const ridge0 = checkBeamEntry(glulam, {
      spanFt: 16,
      tributaryWidthFt: 12,
      role: 'ridge-beam',
      deadLoadPsf: 12,
      snowLoadPsf: 30,
      storiesSupported: 0,
    })
    const ridge2 = checkBeamEntry(glulam, {
      spanFt: 16,
      tributaryWidthFt: 12,
      role: 'ridge-beam',
      deadLoadPsf: 12,
      snowLoadPsf: 30,
      storiesSupported: 2,
    })
    expect(ridge2.uniformLoadPlf).toBe(ridge0.uniformLoadPlf)
    expect(ridge2.momentFtLbs).toBe(ridge0.momentFtLbs)

    // 3) Parallel overlapping hallway/closet walls clustered in the same BWL merge 1D intervals (never > 100%)
    const parallelNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w_hall: { id: 'w_hall', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      w_closet: { id: 'w_closet', type: 'wall', parentId: 'lvl1', start: [0, 0.9], end: [6, 0.9], height: 2.74 },
    }
    const bwls = evaluateBracedWallLines({ nodes: parallelNodes, levelId: 'lvl1' })
    expect(bwls.length).toBe(1)
    expect(bwls[0]!.providedPercent).toBe(100)
    expect(bwls[0]!.providedPercent).toBeLessThanOrEqual(100)
  })

  test('STR-05: ABU/CCQ66 0mm CAD seating, live proportional firestop + axis-aligned chase, and skeleton raycast/beams', () => {
    // 1) ABU44Z / ABU66Z standoff platform connects flush with both side cheeks (0 mm gap)
    for (const sku of ['ABU44Z', 'ABU46Z', 'ABU66Z'] as const) {
      const abu = buildConnectorCad({ sku })
      const cat = CONNECTOR_CATALOG.find((c) => c.sku === sku)!
      const baseW = cat.dimsIn[0] * INCHES_TO_METERS
      const standoffY = 1.0 * INCHES_TO_METERS
      // Find the raised standoff platform mesh at y === standoffY
      let platformBox: Box3 | null = null
      let leftCheekMaxX = Number.NEGATIVE_INFINITY
      let rightCheekMinX = Number.POSITIVE_INFINITY
      abu.traverse((o) => {
        if (!(o instanceof Mesh)) return
        const b = new Box3().setFromObject(o)
        const h = b.max.y - b.min.y
        const cy = (b.min.y + b.max.y) / 2
        if (Math.abs(cy - standoffY) < 0.002 && h < 0.01 && b.max.x - b.min.x > baseW * 0.8) {
          platformBox = b
        }
        if (h > 0.05 && b.max.x < 0) leftCheekMaxX = Math.max(leftCheekMaxX, b.max.x)
        if (h > 0.05 && b.min.x > 0) rightCheekMinX = Math.min(rightCheekMinX, b.min.x)
      })
      expect(platformBox).not.toBeNull()
      // Platform X range must cover both cheeks with 0 mm air gap
      expect(platformBox!.min.x).toBeLessThanOrEqual(leftCheekMaxX + 1e-5)
      expect(platformBox!.max.x).toBeGreaterThanOrEqual(rightCheekMinX - 1e-5)
    }

    // 2) CCQ66 bearing plate seats flush on top of column shaft (0 mm float)
    const colH = 2.4
    const colWithCcq = buildColumnCad({
      columnId: 'col-6x6-dfl',
      heightM: colH,
      includeFooting: false,
      includeBaseHardware: true,
      includeCapHardware: true,
    })
    colWithCcq.updateMatrixWorld(true)
    const capGroup = colWithCcq.children.find((c) => c.name.includes('CCQ66'))
    expect(capGroup).toBeDefined()
    let seatMinY = Number.POSITIVE_INFINITY
    capGroup!.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const b = new Box3().setFromObject(o)
      const w = b.max.x - b.min.x
      const h = b.max.y - b.min.y
      // Horizontal bearing seat plate is wide (> 0.12 m) and thin (< 0.01 m)
      if (w > 0.12 && h < 0.01) {
        seatMinY = Math.min(seatMinY, b.min.y)
      }
    })
    expect(seatMinY).toBeCloseTo(colH, 3)

    // 3) Live structural:firestop renders proportionally to widthM/heightM/depthM and includes heightM in geometryKey
    const fsNode = StructuralFirestopNode.parse({
      object: 'node',
      id: 'strfs_live_1',
      start: [0, 0],
      end: [3.0, 0],
      elevationY: 2.0,
      heightM: 0.45,
      thicknessM: 0.089,
      firestopKind: 'wall-vertical-10ft',
      material: '2x-lumber',
    })
    const fsGroup = buildStructuralFirestopGeometry(fsNode, dummyCtx)
    const fsBox = new Box3().setFromObject(fsGroup)
    expect(fsBox.max.x - fsBox.min.x).toBeCloseTo(3.0, 2)
    expect(fsBox.max.y - fsBox.min.y).toBeCloseTo(0.45, 2)
    expect(fsBox.min.y).toBeCloseTo(2.0, 2)
    const k1 = structuralFirestopRenderDefinition.geometryKey!(fsNode)
    const k2 = structuralFirestopRenderDefinition.geometryKey!({ ...fsNode, heightM: 0.9 })
    expect(k2).not.toBe(k1)

    // 4) chase-chimney-shaft is axis-aligned (not 45 deg diagonal) and uses actual wall height
    const chaseScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 3.35 },
      z_chase: {
        id: 'z_chase',
        type: 'zone',
        parentId: 'lvl1',
        name: 'Mechanical Chase',
        polygon: [
          [2, 1],
          [3, 1],
          [3, 2],
          [2, 2],
        ],
      },
    }
    const chaseFs = deriveRequiredFirestops({ nodes: chaseScene, levelId: 'lvl1' }).find(
      (f) => f.firestopKind === 'chase-chimney-shaft',
    )
    expect(chaseFs).toBeDefined()
    expect(chaseFs!.start[1]).toBeCloseTo(chaseFs!.end[1], 4) // axis-aligned along X, not diagonal
    expect(chaseFs!.elevationY).toBeCloseTo(3.35, 2) // honors wall height, not hardcoded 2.74

    // 5) Skeleton InstancedMesh raycast is no-op, respects vis.beams, and skips duplicate persisted headers
    const skelNodes: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level', height: 2.74 },
      w1: { id: 'w1', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [6, 0], height: 2.74 },
      win1: { id: 'win1', type: 'window', parentId: 'w1', width: 1.8, height: 1.2, sillHeight: 0.9, position: [3, 0, 0] },
    }
    const asmShowBeams: SceneNodeLike = {
      id: 'strasm_1',
      type: 'structural:assembly',
      parentId: 'lvl1',
      visibleSystems: { walls: true, floor: false, roof: false, beams: true, foundation: false, connectors: false, firestop: false },
    }
    const skelWithHeader = buildBuildingSkeletonGroup({ assembly: asmShowBeams, nodes: skelNodes })
    expect(skelWithHeader.children.some((c) => c.name === 'structural-skeleton-header-lvl')).toBe(true)

    // Raycast through wall center must yield 0 hits because skeleton raycast is a no-op
    const raycaster = new Raycaster(new Vector3(1, 1, 2), new Vector3(0, 0, -1))
    expect(raycaster.intersectObjects(skelWithHeader.children, true).length).toBe(0)

    // Hide beams -> skeleton header-lvl disappears
    const skelNoBeams = buildBuildingSkeletonGroup({
      assembly: { ...asmShowBeams, visibleSystems: { ...(asmShowBeams.visibleSystems as object), beams: false } },
      nodes: skelNodes,
    })
    expect(skelNoBeams.children.some((c) => c.name === 'structural-skeleton-header-lvl')).toBe(false)

    // Add persisted structural:beam header for win1 -> skeleton skips duplicate header!
    const skelWithPersistedHeader = buildBuildingSkeletonGroup({
      assembly: asmShowBeams,
      nodes: {
        ...skelNodes,
        bm_hdr: {
          id: 'bm_hdr',
          type: 'structural:beam',
          parentId: 'lvl1',
          role: 'header',
          hostWallId: 'w1',
          openingId: 'win1',
          start: [2.0, 0],
          end: [4.0, 0],
          elevationY: 2.2,
        },
      },
    })
    expect(skelWithPersistedHeader.children.some((c) => c.name === 'structural-skeleton-header-lvl')).toBe(false)
  })

  test('STR-06: UI store auto studSize, wetWallUpgrades guard, firestop refusal, 9 chat cards, rotated 2D col, parametrics & zero em-dashes', () => {
    // 1) UI store defaults studSize to 'auto' and editedDesignParams to {}
    useStructuralUi.getState().resetDesignDefaults()
    expect(useStructuralUi.getState().studSize).toBe('auto')
    expect(useStructuralUi.getState().editedDesignParams).toEqual({})

    // 2) wetWallUpgrades only counts walls that actually get '2x6'
    const wetScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w_int: { id: 'w_int', type: 'wall', parentId: 'lvl1', start: [3, 1], end: [3, 4], height: 2.74, thickness: 0.1 },
      z_bath: {
        id: 'z_bath',
        type: 'zone',
        parentId: 'lvl1',
        name: 'Bathroom',
        polygon: [
          [2, 1],
          [4, 1],
          [4, 4],
          [2, 4],
        ],
      },
    }
    const autoWet = autopopulateStructuralScene(wetScene, { levelId: 'lvl1' })
    expect(autoWet.summary.wetWallUpgrades).toBe(1)
    const forced2x4 = autopopulateStructuralScene(wetScene, { levelId: 'lvl1', studSize: '2x4' })
    expect(forced2x4.summary.wetWallUpgrades).toBe(0)

    // 3) structural_place_firestop rejects unapproved material combination cleanly
    const badFs = structuralAgentOperations.structural_place_firestop(
      {},
      {
        firestopKind: 'penetration-firestop',
        material: '2x-lumber',
        start: [0, 0],
        end: [0.15, 0],
      },
    )
    expect(badFs.ok).toBe(false)
    expect(badFs.createdNodes).toBeUndefined()
    expect(badFs.changes).toBeUndefined()

    // 4) structural_autopopulate_irc Zod input exposes clearExisting
    const autoTool = structuralAgentTools.tools.find((t) => t.name === 'structural_autopopulate_irc')!
    expect('clearExisting' in autoTool.input).toBe(true)

    // 5) structural_size_member forwards design floorLiveLoadPsf / floorDeadLoadPsf
    const lightBeam = structuralAgentOperations.structural_size_member(
      {},
      { memberKind: 'beam', spanFt: 12, tributaryWidthFt: 10, role: 'floor-girder', design: { floorLiveLoadPsf: 30, floorDeadLoadPsf: 8 } },
    )
    const heavyBeam = structuralAgentOperations.structural_size_member(
      {},
      { memberKind: 'beam', spanFt: 12, tributaryWidthFt: 10, role: 'floor-girder', design: { floorLiveLoadPsf: 100, floorDeadLoadPsf: 25 } },
    )
    expect((heavyBeam.data.result as { uniformLoadPlf: number }).uniformLoadPlf).toBeGreaterThan(
      (lightBeam.data.result as { uniformLoadPlf: number }).uniformLoadPlf,
    )

    // 6) All 9 tools registered in structuralChatExtension.cards
    const cardKeys = Object.keys(structuralChatExtension.cards ?? {}).sort()
    const toolNames = structuralAgentTools.tools.map((t) => t.name).sort()
    expect(cardKeys).toEqual(toolNames)

    // 7) Zero-footing upper-story column schedule formats cleanly without 0"x0"x0" or em-dashes
    const sched = generateStructuralSchedulePack({
      col_upper: {
        id: 'col_upper',
        type: 'structural:column',
        position: [1, 0, 1],
        heightM: 2.74,
        footingWidthIn: 0,
        footingDepthIn: 0,
      },
    })
    expect(sched.columns[0]!.footingCallout).toBe('Transfers to lower column')

    // 8) Rotated rectangular 4x6 column 2D floorplan honors widthIn x depthIn and rotation
    const rectCol = StructuralColumnNode.parse({
      object: 'node',
      id: 'strcol_rect',
      position: [2, 0, 3],
      rotation: Math.PI / 2,
      widthIn: 3.5,
      depthIn: 9.0,
    })
    const fp = buildStructuralColumnFloorplan(rectCol, dummyCtx)
    expect(fp.kind).toBe('group')
    const poly = fp.kind === 'group' ? fp.children[0] : undefined
    expect(poly?.kind).toBe('polygon')
    if (poly?.kind === 'polygon') {
      const xs = poly.points.map((p) => p[0])
      const zs = poly.points.map((p) => p[1])
      // Rotated 90 deg: original depth (9" = 0.2286 m) now spans X, width (3.5" = 0.0889 m) spans Z
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(9.0 * INCHES_TO_METERS, 2)
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3.5 * INCHES_TO_METERS, 2)
    }

    // 9) assembly geometryKey tracks footprintBounds & joistDepthIn
    const asmDef = structuralAssemblyRenderDefinition.defaults()
    const ak1 = structuralAssemblyRenderDefinition.geometryKey!(asmDef as never)
    const ak2 = structuralAssemblyRenderDefinition.geometryKey!({ ...asmDef, joistDepthIn: 14 } as never)
    const ak3 = structuralAssemblyRenderDefinition.geometryKey!({ ...asmDef, footprintBounds: [0, 0, 12, 8] } as never)
    expect(ak2).not.toBe(ak1)
    expect(ak3).not.toBe(ak1)

    // 10) parametrics.ts exposes studSpacingIn, elevationY, mountStyle, species, deadLoadPsf, sku
    const asmKeys = structuralAssemblyParametrics.groups.flatMap((g) => g.fields.map((f) => String(f.key)))
    const beamKeys = structuralBeamParametrics.groups.flatMap((g) => g.fields.map((f) => String(f.key)))
    const connKeys = structuralConnectorParametrics.groups.flatMap((g) => g.fields.map((f) => String(f.key)))
    expect(asmKeys).toContain('studSpacingIn')
    expect(beamKeys).toEqual(expect.arrayContaining(['elevationY', 'mountStyle', 'species', 'deadLoadPsf']))
    expect(connKeys).toContain('sku')

    // 11) Zero em-dashes in UI schedule-view and user-facing IRC strings
    const rootDir = fileURLToPath(new URL('../..', import.meta.url))
    for (const rel of [
      'src/ui/schedule-view.tsx',
      'src/irc/sizing.ts',
      'src/irc/audit.ts',
      'src/irc/load-path.ts',
      'src/irc/fireblocking.ts',
      'src/irc/schedule.ts',
      'README.md',
    ]) {
      const content = fs.readFileSync(path.join(rootDir, rel), 'utf8')
      expect(content.includes('—')).toBe(false)
    }
    expect(CONNECTOR_CATALOG.length).toBe(47)
  })

  test('Pass-2 Referee Fixes (#1-#9): live post-cap seat, soffit hangers, non-level container clash, studSpacingIn derive, 45deg BWL, grounded catalog footings, mixed-scope & roof-toggle audit, chase non-coplanar', () => {
    // #1a: Live persisted post-cap connector seats its horizontal bearing plate underside flush at local y = 0
    const capNode = StructuralConnectorNode.parse({
      object: 'node',
      id: 'strcon_ccq66_live',
      category: 'post-cap',
      sku: 'CCQ66',
      position: [1, 2.4, 1],
    })
    const capGroup = buildStructuralConnectorGeometry(capNode, dummyCtx)
    capGroup.updateMatrixWorld(true)
    expect(getPostCapSeatOffsetM('CCQ66')).toBeGreaterThan(0.1)
    let liveSeatMinY = Number.POSITIVE_INFINITY
    capGroup.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const b = new Box3().setFromObject(o)
      if (b.max.x - b.min.x > 0.12 && b.max.y - b.min.y < 0.01) {
        liveSeatMinY = Math.min(liveSeatMinY, b.min.y)
      }
    })
    expect(liveSeatMinY).toBeCloseTo(0, 4)

    // #1b: structural_place_beam places end hangers at beam soffit (elev - depthM / 2), not centerline
    const beamOp = structuralAgentOperations.structural_place_beam(
      {},
      { start: [0, 0], end: [3.6, 0], elevationY: 2.5, role: 'floor-girder', preferredFamily: 'lvl' },
    )
    const placedBeam = beamOp.createdNodes!.find((n) => n.type === 'structural:beam')!
    const placedHanger = beamOp.createdNodes!.find((n) => n.type === 'structural:connector')!
    const expectedSoffitY = 2.5 - (Number(placedBeam.depthIn) * INCHES_TO_METERS) / 2
    expect(placedHanger.position![1]).toBeCloseTo(expectedSoffitY, 3)

    // #2: resolveNodeLevelId returns null for non-level container ancestors (building, room) -> no silently dropped MEP clashes
    const containerScene: Record<string, SceneNodeLike> = {
      bldg1: { id: 'bldg1', type: 'building' },
      room1: { id: 'room1', type: 'room', parentId: 'bldg1' },
      bm_bldg: {
        id: 'bm_bldg',
        type: 'structural:beam',
        parentId: 'bldg1',
        start: [0, 2],
        end: [4, 2],
        elevationY: 2.4,
        widthIn: 3.5,
        depthIn: 11.875,
      },
      pipe_room: {
        id: 'pipe_room',
        type: 'plumbing:pipe-run',
        parentId: 'room1',
        path: [
          [2, 2.4, 0],
          [2, 2.4, 4],
        ],
      },
    }
    expect(resolveNodeLevelId(containerScene, containerScene.bm_bldg!)).toBeNull()
    expect(resolveNodeLevelId(containerScene, containerScene.pipe_room!)).toBeNull()
    const containerAudit = auditStructuralScene(containerScene)
    expect(containerAudit.findings.some((f) => f.category === 'mep-clash' && f.nodeId === 'bm_bldg')).toBe(true)

    // #3: structuralAssemblyParametrics.derive steps 16 -> 20 -> 24 upward and 24 -> 20 -> 16 downward
    const baseAsm = StructuralAssemblyNode.parse({ object: 'node' })
    const upStep = structuralAssemblyParametrics.derive!(
      { ...baseAsm, studSpacingIn: 20 as never },
      { studSpacingIn: 20 as never },
      { ...baseAsm, studSpacingIn: 16 },
    )
    expect(upStep.studSpacingIn).toBe(24)
    const downStep = structuralAssemblyParametrics.derive!(
      { ...baseAsm, studSpacingIn: 20 as never },
      { studSpacingIn: 20 as never },
      { ...baseAsm, studSpacingIn: 24 },
    )
    expect(downStep.studSpacingIn).toBe(16)

    // #4: 100%-solid 45-degree wall scores 100% BWL (not 71%)
    const diagWallScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      w_diag: { id: 'w_diag', type: 'wall', parentId: 'lvl1', start: [0, 0], end: [4, 4], height: 2.74 },
    }
    const diagBwls = evaluateBracedWallLines({ nodes: diagWallScene, levelId: 'lvl1' })
    expect(diagBwls.length).toBe(1)
    expect(diagBwls[0]!.providedPercent).toBe(100)

    // #5: All 3 footed catalog columns export grounded at min.y === 0 (not -0.334 m)
    for (const id of ['col-glulam-5.5', 'col-steel-lally-3.5', 'col-steel-hss-4x4'] as const) {
      const part = STRUCTURAL_CAD_CATALOG.find((p) => p.id === id)!
      const box = new Box3().setFromObject(part.build())
      expect(box.min.y).toBeCloseTo(0, 4)
    }

    // #6: Mixed scoped + unscoped firestop audit, hidden-roof UI toggle still audits R302.12.1 when roof node exists, & per-level column soilBearingPsf
    const mixedAuditScene: Record<string, SceneNodeLike> = {
      lvl1: { id: 'lvl1', type: 'level' },
      lvl2: { id: 'lvl2', type: 'level' },
      asm1: {
        id: 'asm1',
        type: 'structural:assembly',
        parentId: 'lvl1',
        roofSystem: 'stick-rafter',
        visibleSystems: { walls: true, floor: true, roof: false, beams: true, columns: true, connectors: true, firestop: true, foundation: true },
        designParams: { soilBearingPsf: 3000, frostDepthIn: 36 },
      },
      asm2: {
        id: 'asm2',
        type: 'structural:assembly',
        parentId: 'lvl2',
        designParams: { soilBearingPsf: 1000, frostDepthIn: 36 },
      },
      // Explicit roof node on lvl1 + >3,000 sq ft slab with UI roof toggle hidden -> R302.12.1 MUST still fire!
      roof_lvl1: { id: 'roof_lvl1', type: 'roof', parentId: 'lvl1', pitch: 26.57 },
      slab_lvl1: { id: 'slab_lvl1', type: 'slab', parentId: 'lvl1', polygon: [[0, 0], [18, 0], [18, 18], [0, 18]], elevation: 0 },
      // Unscoped tall wall (no parentId) in a multi-level scene -> MUST still be audited!
      w_unscoped_tall: { id: 'w_unscoped_tall', type: 'wall', start: [0, 0], end: [5, 0], height: 3.66 },
      // Column on lvl2 (weak 1000 psf soil) with 24" footing under 6000 lbs -> reqArea = 6.48 sf -> side = 36" -> MUST fail using lvl2 designParams!
      col_weak_soil: {
        id: 'col_weak_soil',
        type: 'structural:column',
        parentId: 'lvl2',
        position: [2, 0, 2],
        heightM: 2.4,
        widthIn: 5.5,
        depthIn: 5.5,
        axialLoadLbs: 6000,
        footingWidthIn: 24,
        footingDepthIn: 12,
      },
    }
    const mixedAudit = auditStructuralScene(mixedAuditScene)
    expect(mixedAudit.findings.some((f) => f.category === 'fire-blocking' && f.codeRef === 'IRC R302.12.1')).toBe(true)
    expect(mixedAudit.findings.some((f) => f.category === 'fire-blocking' && f.nodeId === 'w_unscoped_tall')).toBe(true)
    expect(
      mixedAudit.findings.some(
        (f) => f.category === 'column-footing' && f.nodeId === 'col_weak_soil' && f.message.includes('1000 psf'),
      ),
    ).toBe(true)

    // #8: Live chase-chimney-shaft separates bottom galvanized plate from mineral wool block (zero coplanar Z-fighting)
    const chaseFs = StructuralFirestopNode.parse({
      object: 'node',
      id: 'strfs_chase_zfight',
      firestopKind: 'chase-chimney-shaft',
      material: 'mineral-wool-batt',
      start: [0, 0],
      end: [0.8, 0],
      elevationY: 2.74,
      heightM: 0.14,
      thicknessM: 0.8,
    })
    const chaseGroup = buildStructuralFirestopGeometry(chaseFs, dummyCtx)
    chaseGroup.updateMatrixWorld(true)
    const chaseMeshes: Box3[] = []
    chaseGroup.traverse((o) => {
      if (o instanceof Mesh) chaseMeshes.push(new Box3().setFromObject(o))
    })
    expect(chaseMeshes.length).toBe(2)
    chaseMeshes.sort((a, b) => a.min.y - b.min.y)
    // Lower galvanized plate top === upper mineral-wool block bottom (stacked, zero coplanar overlap)
    expect(chaseMeshes[1]!.min.y).toBeCloseTo(chaseMeshes[0]!.max.y, 4)

    // #9: Stale "all 40 catalog SKUs" JSDoc updated to 47
    const rootDir = fileURLToPath(new URL('../..', import.meta.url))
    const connSrc = fs.readFileSync(path.join(rootDir, 'src/cad/connectors.ts'), 'utf8')
    expect(connSrc.includes('40 catalog SKUs')).toBe(false)
    expect(connSrc.includes('47 catalog SKUs')).toBe(true)
  })
})
