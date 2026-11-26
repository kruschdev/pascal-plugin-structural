/**
 * Unified Structural Engineering Schedule Pack Generator:
 * - Beam & Header Schedule (with LVL/Glulam/PSL/Steel/Flitch designation & jack counts)
 * - Column & Pad Footing Schedule
 * - Simpson-Class Connector & Fastener Schedule
 * - IRC R302.11 / R302.12 Fire-Blocking & Draftstopping Schedule
 * - Braced Wall Line & Continuous Load-Path Summary
 * - Priced Material BOM
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { type StructuralAuditReport, auditStructuralScene } from './audit'
import { type LoadPathAnalysisReport, traceStructuralLoadPaths } from './load-path'
import { type StructuralBomSummary, generateStructuralBom } from './pricing'
import {
  DEFAULT_DESIGN_PARAMS,
  METERS_TO_FEET,
  type SceneNodeLike,
  type StructuralDesignParams,
  type Vec2,
  getConnectorBySku,
} from './tables'

export type BeamScheduleRow = {
  id: string
  mark: string
  role: string
  beamType: string
  designation: string
  spanFt: number
  plyCount: number
  sizeIn: string
  mountStyle: string
  bearingIn: number
  jackStudsEachEnd: number
  endReactionLbs: number
}

export type ColumnScheduleRow = {
  id: string
  mark: string
  columnType: string
  designation: string
  heightFt: number
  axialLoadLbs: number
  hasSquashBlocks: boolean
  footingCallout: string
}

export type ConnectorScheduleRow = {
  sku: string
  category: string
  name: string
  totalQuantity: number
  fastenerSpec: string
  upliftLbs: number
  downloadLbs: number
  codeRef: string
}

export type FirestopScheduleRow = {
  id: string
  firestopKind: string
  codeRef: string
  material: string
  lengthFt: number
  elevationFt: number
  label: string
}

export type StructuralSchedulePack = {
  designParams: StructuralDesignParams
  beams: BeamScheduleRow[]
  columns: ColumnScheduleRow[]
  connectors: ConnectorScheduleRow[]
  firestops: FirestopScheduleRow[]
  loadPath: LoadPathAnalysisReport
  audit: StructuralAuditReport
  bom: StructuralBomSummary
}

export function generateStructuralSchedulePack(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  designOverride?: Partial<StructuralDesignParams>,
): StructuralSchedulePack {
  const all = Object.values(nodes)
  const assemblies = all.filter((n) => n.type === 'structural:assembly')
  const firstDesign = (assemblies[0]?.designParams as Partial<StructuralDesignParams> | undefined) ?? {}
  const designParams: StructuralDesignParams = {
    ...DEFAULT_DESIGN_PARAMS,
    ...firstDesign,
    ...designOverride,
  }

  const beams: BeamScheduleRow[] = all
    .filter((n) => n.type === 'structural:beam')
    .map((b, idx) => {
      const s = (b.start as Vec2 | undefined) ?? [0, 0]
      const e = (b.end as Vec2 | undefined) ?? [1, 0]
      const spanFt = Number((Math.hypot(e[0] - s[0], e[1] - s[1]) * METERS_TO_FEET).toFixed(2))
      const role = String(b.role ?? 'header')
      const prefix = role === 'header' ? 'H' : role === 'ridge-beam' ? 'RB' : 'B'
      return {
        id: b.id,
        mark: `${prefix}-${idx + 1}`,
        role,
        beamType: String(b.beamType ?? 'lvl'),
        designation: String(b.designation ?? 'Engineered Beam'),
        spanFt,
        plyCount: Number(b.plyCount ?? 1),
        sizeIn: `${b.widthIn ?? 3.5}" x ${b.depthIn ?? 11.875}"`,
        mountStyle: String(b.mountStyle ?? 'flush'),
        bearingIn: Number(b.bearingLengthIn ?? 1.5),
        jackStudsEachEnd: Number(b.jackStudsEachEnd ?? 1),
        endReactionLbs: Number(b.endReactionLbs ?? 0),
      }
    })

  const columns: ColumnScheduleRow[] = all
    .filter((n) => n.type === 'structural:column')
    .map((c, idx) => {
      const fw = Number(c.footingWidthIn ?? 24)
      const fd = Number(c.footingDepthIn ?? 12)
      const rebar = String(c.footingRebar ?? '(4) #4 EW')
      return {
        id: c.id,
        mark: `C-${idx + 1}`,
        columnType: String(c.columnType ?? 'wood-solid'),
        designation: String(c.designation ?? '6x6 DF-L #2'),
        heightFt: Number(((typeof c.heightM === 'number' ? c.heightM : 2.74) * METERS_TO_FEET).toFixed(2)),
        axialLoadLbs: Number(c.axialLoadLbs ?? 0),
        hasSquashBlocks: Boolean(c.hasSquashBlocks),
        footingCallout: `${fw}"x${fw}"x${fd}" — ${rebar}`,
      }
    })

  const conMap = new Map<string, number>()
  for (const c of all.filter((n) => n.type === 'structural:connector')) {
    const sku = String(c.sku ?? 'H2.5A')
    conMap.set(sku, (conMap.get(sku) ?? 0) + Math.max(1, Number(c.quantity ?? 1)))
  }
  const connectors: ConnectorScheduleRow[] = [...conMap.entries()].map(([sku, qty]) => {
    const cat = getConnectorBySku(sku)
    return {
      sku,
      category: cat?.category ?? 'hurricane-tie',
      name: cat?.name ?? sku,
      totalQuantity: qty,
      fastenerSpec: cat?.fastenerSpec ?? 'Per manufacturer spec',
      upliftLbs: cat?.upliftLbs ?? 0,
      downloadLbs: cat?.downloadLbs ?? 0,
      codeRef: cat?.codeRef ?? 'IRC R802.11',
    }
  })

  const firestops: FirestopScheduleRow[] = all
    .filter((n) => n.type === 'structural:firestop')
    .map((f) => {
      const s = (f.start as Vec2 | undefined) ?? [0, 0]
      const e = (f.end as Vec2 | undefined) ?? [1, 0]
      const lenFt = Number((Math.hypot(e[0] - s[0], e[1] - s[1]) * METERS_TO_FEET).toFixed(1))
      const elevFt = Number(((typeof f.elevationY === 'number' ? f.elevationY : 0) * METERS_TO_FEET).toFixed(1))
      return {
        id: f.id,
        firestopKind: String(f.firestopKind ?? 'wall-vertical-10ft'),
        codeRef: String(f.codeRef ?? 'IRC R302.11'),
        material: String(f.material ?? '2x-lumber'),
        lengthFt: lenFt,
        elevationFt: elevFt,
        label: String(f.name ?? f.firestopKind),
      }
    })

  const loadPath = traceStructuralLoadPaths({ nodes, design: designParams })
  const audit = auditStructuralScene(nodes, designParams)
  const bom = generateStructuralBom(nodes)

  return {
    designParams,
    beams,
    columns,
    connectors,
    firestops,
    loadPath,
    audit,
    bom,
  }
}
