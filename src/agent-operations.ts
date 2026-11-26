/**
 * Headless Pure Agent Operations (`@kruschdev/pascal-plugin-structural/agent-operations`).
 * Zero React, Three.js, `@pascal-app/viewer`, or `@pascal-app/editor` imports.
 * Runnable inside live Pascal Editor, detached Node/Bun CLI scripts, or MCP servers.
 */

import { auditStructuralScene } from './irc/audit'
import { type AutopopulateStructuralOptions, autopopulateStructuralScene } from './irc/autopopulate'
import { traceStructuralLoadPaths } from './irc/load-path'
import { generateStructuralSchedulePack } from './irc/schedule'
import {
  selectHoldDownSku,
  selectHurricaneTieSku,
  sizeBeamOrHeader,
  sizeColumnAndFooting,
  sizeFloorSystem,
  sizeRoofSystem,
} from './irc/sizing'
import {
  type BeamMaterialFamily,
  type BeamRole,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  type FloorSystemKind,
  INCHES_TO_METERS,
  METERS_TO_FEET,
  type RoofSystemKind,
  type SceneNodeLike,
  type StructuralDesignParams,
  type StudSpacingIn,
  type Vec2,
  type Vec3,
  getConnectorBySku,
} from './irc/tables'

export type AgentOperationResult = {
  ok: boolean
  tool: string
  text: string
  createdNodes?: SceneNodeLike[]
  data: Record<string, unknown>
}

let opSeq = 1
function makeOpId(prefix: string): string {
  return `${prefix}_op_${Date.now().toString(36)}_${opSeq++}`
}

export const structuralAgentOperations = {
  structural_autopopulate_irc(
    nodes: Readonly<Record<string, SceneNodeLike>>,
    args: AutopopulateStructuralOptions = {},
  ): AgentOperationResult {
    const res = autopopulateStructuralScene(nodes, args)
    return {
      ok: true,
      tool: 'structural_autopopulate_irc',
      text: `Synthesized ${res.createdNodes.length} structural node(s): ${res.summary.assemblies} assembly, ${res.summary.beams} engineered beam(s)/header(s), ${res.summary.columns} column(s), ${res.summary.connectors} connector schedule node(s), and ${res.summary.firestops} IRC R302.11/R302.12 firestop zone(s).`,
      createdNodes: res.createdNodes,
      data: {
        summary: res.summary,
        nodeIds: res.createdNodes.map((n) => n.id),
      },
    }
  },

  structural_place_beam(
    _nodes: Readonly<Record<string, SceneNodeLike>>,
    args: {
      levelId?: string | null
      name?: string
      start: Vec2
      end: Vec2
      elevationY?: number
      role?: BeamRole
      preferredFamily?: BeamMaterialFamily
      mountStyle?: 'flush' | 'dropped'
      tributaryWidthFt?: number
      liveLoadPsf?: number
      deadLoadPsf?: number
      snowLoadPsf?: number
      pointLoadLbs?: number
      species?: StructuralDesignParams['species']
      storiesSupported?: 0 | 1 | 2
      autoPlaceHangers?: boolean
    },
  ): AgentOperationResult {
    const spanFt = Math.max(
      1,
      Math.hypot(args.end[0] - args.start[0], args.end[1] - args.start[1]) * METERS_TO_FEET,
    )
    const role = args.role ?? 'floor-girder'
    const check = sizeBeamOrHeader({
      spanFt,
      tributaryWidthFt: args.tributaryWidthFt ?? 12,
      role,
      preferredFamily: args.preferredFamily,
      liveLoadPsf: args.liveLoadPsf,
      deadLoadPsf: args.deadLoadPsf,
      snowLoadPsf: args.snowLoadPsf,
      pointLoadLbs: args.pointLoadLbs,
      species: args.species,
      storiesSupported: args.storiesSupported,
    })

    const beamId = makeOpId('strbm')
    const elev = args.elevationY ?? 2.4
    const createdNodes: SceneNodeLike[] = [
      {
        id: beamId,
        type: 'structural:beam',
        name: args.name ?? `${check.entry.designation} (${role})`,
        parentId: args.levelId ?? null,
        start: args.start,
        end: args.end,
        elevationY: elev,
        role,
        beamType: check.entry.family,
        designation: check.entry.designation,
        plyCount: check.entry.plyCount,
        widthIn: check.entry.widthIn,
        depthIn: check.entry.depthIn,
        species: args.species ?? DEFAULT_DESIGN_PARAMS.species,
        mountStyle: args.mountStyle ?? 'flush',
        tributaryWidthFt: args.tributaryWidthFt ?? 12,
        liveLoadPsf: args.liveLoadPsf ?? 40,
        deadLoadPsf: args.deadLoadPsf ?? 10,
        snowLoadPsf: args.snowLoadPsf ?? 30,
        bearingLengthIn: check.requiredBearingIn,
        jackStudsEachEnd: check.jackStudsEachEnd,
        endReactionLbs: check.shearLbs,
      },
    ]

    if (args.autoPlaceHangers !== false) {
      const cat = getConnectorBySku(check.recommendedHangerSku)
      if (cat) {
        createdNodes.push({
          id: makeOpId('strcon'),
          type: 'structural:connector',
          name: `${cat.sku} End Hangers for ${beamId} (x2)`,
          parentId: args.levelId ?? null,
          position: [args.start[0], elev, args.start[1]],
          rotation: 0,
          category: cat.category,
          sku: cat.sku,
          quantity: 2,
          fastenerSpec: cat.fastenerSpec,
          upliftCapacityLbs: cat.upliftLbs,
          downloadCapacityLbs: cat.downloadLbs,
          lateralCapacityLbs: cat.lateralLbs,
          attachedNodeIds: [beamId],
        })
      }
    }

    return {
      ok: check.passes,
      tool: 'structural_place_beam',
      text: `Placed ${check.entry.designation} (${spanFt.toFixed(1)} ft span, bending ${Math.round(check.bendingUtilization * 100)}%, L/${check.liveDeflectionRatio}, ${check.jackStudsEachEnd} jack(s)/end, hanger ${check.recommendedHangerSku}).`,
      createdNodes,
      data: { beamId, sizing: check },
    }
  },

  structural_place_column(
    _nodes: Readonly<Record<string, SceneNodeLike>>,
    args: {
      levelId?: string | null
      name?: string
      position: Vec3
      heightM?: number
      axialLoadLbs?: number
      preferredType?: ColumnType
      soilBearingPsf?: number
      frostDepthIn?: number
      hasSquashBlocks?: boolean
      transfersFromNodeId?: string
      transfersToNodeId?: string
      autoPlaceBaseAndCap?: boolean
    },
  ): AgentOperationResult {
    const heightM = args.heightM ?? 2.7432
    const axialLoadLbs = args.axialLoadLbs ?? 6000
    const sizing = sizeColumnAndFooting({
      axialLoadLbs,
      unbracedHeightFt: heightM * METERS_TO_FEET,
      preferredType: args.preferredType,
      soilBearingPsf: args.soilBearingPsf ?? 1500,
      frostDepthIn: args.frostDepthIn ?? 36,
    })

    const colId = makeOpId('strcol')
    const createdNodes: SceneNodeLike[] = [
      {
        id: colId,
        type: 'structural:column',
        name: args.name ?? `${sizing.entry.designation} (${axialLoadLbs} lbs)`,
        parentId: args.levelId ?? null,
        position: args.position,
        heightM,
        columnType: sizing.entry.columnType,
        designation: sizing.entry.designation,
        widthIn: sizing.entry.widthIn,
        depthIn: sizing.entry.depthIn,
        axialLoadLbs,
        transfersFromNodeId: args.transfersFromNodeId,
        transfersToNodeId: args.transfersToNodeId ?? `footing:${colId}`,
        hasSquashBlocks: Boolean(args.hasSquashBlocks),
        footingWidthIn: sizing.footingWidthIn,
        footingDepthIn: sizing.footingDepthIn,
        footingRebar: sizing.footingRebar,
      },
    ]

    if (args.autoPlaceBaseAndCap !== false) {
      const baseCat = getConnectorBySku(sizing.recommendedBaseSku)
      const capCat = getConnectorBySku(sizing.recommendedCapSku)
      if (baseCat) {
        createdNodes.push({
          id: makeOpId('strcon'),
          type: 'structural:connector',
          name: `${baseCat.sku} Post Base (${colId})`,
          parentId: args.levelId ?? null,
          position: args.position,
          rotation: 0,
          category: baseCat.category,
          sku: baseCat.sku,
          quantity: 1,
          fastenerSpec: baseCat.fastenerSpec,
          upliftCapacityLbs: baseCat.upliftLbs,
          downloadCapacityLbs: baseCat.downloadLbs,
          lateralCapacityLbs: baseCat.lateralLbs,
          attachedNodeIds: [colId],
        })
      }
      if (capCat) {
        createdNodes.push({
          id: makeOpId('strcon'),
          type: 'structural:connector',
          name: `${capCat.sku} Post Cap (${colId})`,
          parentId: args.levelId ?? null,
          position: [args.position[0], args.position[1] + heightM, args.position[2]],
          rotation: 0,
          category: capCat.category,
          sku: capCat.sku,
          quantity: 1,
          fastenerSpec: capCat.fastenerSpec,
          upliftCapacityLbs: capCat.upliftLbs,
          downloadCapacityLbs: capCat.downloadLbs,
          lateralCapacityLbs: capCat.lateralLbs,
          attachedNodeIds: [colId],
        })
      }
    }

    return {
      ok: sizing.passes,
      tool: 'structural_place_column',
      text: `Placed ${sizing.entry.designation} (${Math.round(sizing.utilization * 100)}% axial capacity) on ${sizing.footingWidthIn}"x${sizing.footingWidthIn}"x${sizing.footingDepthIn}" footing with ${sizing.recommendedBaseSku} base + ${sizing.recommendedCapSku} cap.`,
      createdNodes,
      data: { columnId: colId, sizing },
    }
  },

  structural_place_connector(
    _nodes: Readonly<Record<string, SceneNodeLike>>,
    args: {
      levelId?: string | null
      name?: string
      sku: string
      position: Vec3
      rotation?: number
      quantity?: number
      attachedNodeIds?: string[]
    },
  ): AgentOperationResult {
    const cat = getConnectorBySku(args.sku)
    if (!cat) {
      return {
        ok: false,
        tool: 'structural_place_connector',
        text: `Unknown connector SKU "${args.sku}". Check CONNECTOR_CATALOG for valid Simpson-class SKUs.`,
        data: { sku: args.sku },
      }
    }
    const id = makeOpId('strcon')
    const node: SceneNodeLike = {
      id,
      type: 'structural:connector',
      name: args.name ?? `${cat.sku} (${cat.name})`,
      parentId: args.levelId ?? null,
      position: args.position,
      rotation: args.rotation ?? 0,
      category: cat.category,
      sku: cat.sku,
      quantity: args.quantity ?? 1,
      fastenerSpec: cat.fastenerSpec,
      upliftCapacityLbs: cat.upliftLbs,
      downloadCapacityLbs: cat.downloadLbs,
      lateralCapacityLbs: cat.lateralLbs,
      attachedNodeIds: args.attachedNodeIds ?? [],
    }
    return {
      ok: true,
      tool: 'structural_place_connector',
      text: `Placed ${cat.sku} (${cat.name}, qty ${node.quantity}, ${cat.fastenerSpec}).`,
      createdNodes: [node],
      data: { connectorId: id, spec: cat },
    }
  },

  structural_place_firestop(
    _nodes: Readonly<Record<string, SceneNodeLike>>,
    args: {
      levelId?: string | null
      name?: string
      firestopKind: FirestopKind
      material?: FirestopMaterial
      start: Vec2
      end: Vec2
      elevationY?: number
      heightM?: number
      thicknessM?: number
      hostWallId?: string
      penetratingNodeId?: string
      compartmentAreaSqFt?: number
    },
  ): AgentOperationResult {
    const rule = FIRESTOP_RULES[args.firestopKind]
    const material = args.material ?? rule.defaultMaterial
    const id = makeOpId('strfs')
    const node: SceneNodeLike = {
      id,
      type: 'structural:firestop',
      name: args.name ?? `${rule.codeRef} ${rule.title}`,
      parentId: args.levelId ?? null,
      start: args.start,
      end: args.end,
      elevationY: args.elevationY ?? 2.4,
      heightM: args.heightM ?? 0.3,
      thicknessM: args.thicknessM ?? 1.5 * INCHES_TO_METERS,
      firestopKind: args.firestopKind,
      material,
      codeRef: rule.codeRef,
      hostWallId: args.hostWallId,
      penetratingNodeId: args.penetratingNodeId,
      compartmentAreaSqFt: args.compartmentAreaSqFt,
    }
    return {
      ok: true,
      tool: 'structural_place_firestop',
      text: `Placed ${rule.codeRef} firestop (${args.firestopKind}, ${material}).`,
      createdNodes: [node],
      data: { firestopId: id, rule },
    }
  },

  structural_size_member(
    _nodes: Readonly<Record<string, SceneNodeLike>>,
    args: {
      memberKind: 'beam' | 'floor' | 'roof' | 'column' | 'hurricane-tie' | 'hold-down'
      spanFt?: number
      tributaryWidthFt?: number
      role?: BeamRole
      preferredBeamFamily?: BeamMaterialFamily
      floorSystem?: FloorSystemKind
      roofSystem?: RoofSystemKind
      pitchRiseOver12?: number
      axialLoadLbs?: number
      unbracedHeightFt?: number
      upliftDemandLbs?: number
      species?: StructuralDesignParams['species']
      spacingIn?: StudSpacingIn
      design?: Partial<StructuralDesignParams>
    },
  ): AgentOperationResult {
    const design = { ...DEFAULT_DESIGN_PARAMS, ...args.design }
    if (args.memberKind === 'beam') {
      const res = sizeBeamOrHeader({
        spanFt: args.spanFt ?? 12,
        tributaryWidthFt: args.tributaryWidthFt ?? 12,
        role: args.role ?? 'floor-girder',
        preferredFamily: args.preferredBeamFamily,
        snowLoadPsf: design.groundSnowPsf,
        species: args.species ?? design.species,
        storiesSupported: design.storiesAbove,
      })
      return {
        ok: res.passes,
        tool: 'structural_size_member',
        text: `Sized beam: ${res.entry.designation} (bending ${Math.round(res.bendingUtilization * 100)}%, shear ${Math.round(res.shearUtilization * 100)}%, L/${res.liveDeflectionRatio}, ${res.jackStudsEachEnd} jack(s)/end, hanger ${res.recommendedHangerSku}).`,
        data: { result: res },
      }
    }
    if (args.memberKind === 'floor') {
      const res = sizeFloorSystem({
        clearSpanFt: args.spanFt ?? 16,
        crossLengthFt: args.tributaryWidthFt ?? 24,
        system: args.floorSystem ?? 'tji-ijoist',
        species: args.species ?? design.species,
        spacingIn: args.spacingIn ?? 16,
      })
      return {
        ok: true,
        tool: 'structural_size_member',
        text: `Sized floor: ${res.memberLabel} (girders needed: ${res.girderLinesNeeded}, hanger ${res.joistHangerSku}).`,
        data: { result: res },
      }
    }
    if (args.memberKind === 'roof') {
      const res = sizeRoofSystem({
        buildingSpanFt: args.spanFt ?? 28,
        ridgeLengthFt: args.tributaryWidthFt ?? 32,
        pitchRiseOver12: args.pitchRiseOver12 ?? 6,
        system: args.roofSystem ?? 'stick-rafter',
        design,
        spacingIn: args.spacingIn,
      })
      return {
        ok: true,
        tool: 'structural_size_member',
        text: `Sized roof: ${res.memberLabel} (hurricane tie ${res.hurricaneTieSku}, structural ridge beam: ${res.needsStructuralRidgeBeam}).`,
        data: { result: res },
      }
    }
    if (args.memberKind === 'column') {
      const res = sizeColumnAndFooting({
        axialLoadLbs: args.axialLoadLbs ?? 8000,
        unbracedHeightFt: args.unbracedHeightFt ?? 9,
        soilBearingPsf: design.soilBearingPsf,
        frostDepthIn: design.frostDepthIn,
      })
      return {
        ok: res.passes,
        tool: 'structural_size_member',
        text: `Sized column: ${res.entry.designation} (${Math.round(res.utilization * 100)}% capacity) + ${res.footingWidthIn}"x${res.footingWidthIn}"x${res.footingDepthIn}" footing (${res.recommendedBaseSku} / ${res.recommendedCapSku}).`,
        data: { result: res },
      }
    }
    if (args.memberKind === 'hurricane-tie') {
      const sku = selectHurricaneTieSku({
        windMph: design.windMph,
        exposure: design.exposure,
        seismicCategory: design.seismicCategory,
        upliftDemandLbs: args.upliftDemandLbs ?? 0,
      })
      const cat = getConnectorBySku(sku)
      return {
        ok: true,
        tool: 'structural_size_member',
        text: `Recommended hurricane tie: ${sku} (${cat?.name ?? sku}, uplift ${cat?.upliftLbs ?? 0} lbs).`,
        data: { sku, spec: cat },
      }
    }
    const hd = selectHoldDownSku(args.upliftDemandLbs ?? 4500)
    return {
      ok: true,
      tool: 'structural_size_member',
      text: `Recommended hold-down: ${hd.sku} (${hd.name}, uplift ${hd.upliftLbs} lbs, ${hd.fastenerSpec}).`,
      data: { spec: hd },
    }
  },

  structural_trace_load_path(
    nodes: Readonly<Record<string, SceneNodeLike>>,
    args: { design?: Partial<StructuralDesignParams> } = {},
  ): AgentOperationResult {
    const report = traceStructuralLoadPaths({ nodes, design: args.design })
    return {
      ok: report.brokenLoadPaths === 0 && report.upliftContinuous,
      tool: 'structural_trace_load_path',
      text: `Load path trace: ${report.gravityLinks.length} gravity link(s) (${report.brokenLoadPaths} broken), uplift continuous: ${report.upliftContinuous}, ${report.bracedWallLines.length} braced wall line(s).`,
      data: { report },
    }
  },

  structural_audit_irc(
    nodes: Readonly<Record<string, SceneNodeLike>>,
    args: { design?: Partial<StructuralDesignParams> } = {},
  ): AgentOperationResult {
    const report = auditStructuralScene(nodes, args.design)
    return {
      ok: report.passed,
      tool: 'structural_audit_irc',
      text: report.passed
        ? `IRC/NDS Structural Audit PASSED (0 errors, ${report.warningCount} warning(s)).`
        : `IRC/NDS Structural Audit FAILED (${report.errorCount} error(s), ${report.warningCount} warning(s)).`,
      data: { ...report },
    }
  },

  structural_generate_schedule(
    nodes: Readonly<Record<string, SceneNodeLike>>,
    args: { design?: Partial<StructuralDesignParams> } = {},
  ): AgentOperationResult {
    const pack = generateStructuralSchedulePack(nodes, args.design)
    return {
      ok: pack.audit.passed,
      tool: 'structural_generate_schedule',
      text: `Generated Structural Schedule Pack: ${pack.beams.length} beam(s), ${pack.columns.length} column(s), ${pack.connectors.length} connector SKU line(s), ${pack.firestops.length} firestop(s), BOM total $${pack.bom.totalMaterialCostUsd.toFixed(2)}.`,
      data: { schedule: pack },
    }
  },
}
