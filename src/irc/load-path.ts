/**
 * Continuous Gravity & Uplift Load-Path Tracer + IRC R602.10 Braced Wall Line Evaluator.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { selectHoldDownSku } from './sizing'
import {
  DEFAULT_DESIGN_PARAMS,
  METERS_TO_FEET,
  type SceneNodeLike,
  type StructuralDesignParams,
  type Vec2,
  getRequiredBracedWallPercent,
} from './tables'

export type BracedWallLineReport = {
  id: string
  axis: 'X' | 'Z'
  offsetM: number
  wallIds: string[]
  totalLineLengthFt: number
  bracedPanelLengthFt: number
  providedPercent: number
  requiredPercent: number
  passes: boolean
  bracingMethod: 'WSP' | 'CS-WSP' | 'CS-PF' | 'Engineered-Shear'
  requiredHoldDownSku: string | null
  requiresPlateWashers: boolean
  edgeNailSpacingIn: 2 | 3 | 4 | 6
  codeRef: string
  note?: string
}

export type LoadPathNodeLink = {
  fromNodeId: string
  fromType: string
  toNodeId: string | null
  toType: string
  position: Vec2
  axialLoadLbs: number
  continuous: boolean
  requiresSquashBlock: boolean
  issue?: string
}

export type LoadPathAnalysisReport = {
  bracedWallLines: BracedWallLineReport[]
  gravityLinks: LoadPathNodeLink[]
  brokenLoadPaths: number
  upliftContinuous: boolean
  upliftFindings: string[]
}

function getWallLengthM(w: SceneNodeLike): number {
  if (!Array.isArray(w.start) || !Array.isArray(w.end)) return 0
  return Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
}

/**
 * Evaluate IRC R602.10 Braced Wall Lines along both X and Z axes.
 * Clusters exterior/perimeter walls within 4 ft (1.22 m) perpendicular tolerance (R602.10.1.1).
 */
export function evaluateBracedWallLines(params: {
  nodes: Readonly<Record<string, SceneNodeLike>>
  design?: Partial<StructuralDesignParams>
}): BracedWallLineReport[] {
  const design = { ...DEFAULT_DESIGN_PARAMS, ...params.design }
  const all = Object.values(params.nodes)
  const walls = all.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const doorsWindows = all.filter((n) => n.type === 'door' || n.type === 'window')
  const requiredPercent = getRequiredBracedWallPercent({
    windMph: design.windMph,
    seismicCategory: design.seismicCategory,
    storiesAbove: design.storiesAbove,
  })
  const requiresPlateWashers =
    design.seismicCategory === 'D0' ||
    design.seismicCategory === 'D1' ||
    design.seismicCategory === 'D2'

  type WallEntry = {
    wall: SceneNodeLike
    axis: 'X' | 'Z'
    offsetM: number
    lenM: number
    bracedLenM: number
  }

  const entries: WallEntry[] = []
  for (const w of walls) {
    const start = w.start!
    const end = w.end!
    const dx = Math.abs(end[0] - start[0])
    const dz = Math.abs(end[1] - start[1])
    const lenM = Math.hypot(dx, dz)
    if (lenM < 0.3) continue

    const axis: 'X' | 'Z' = dx >= dz ? 'X' : 'Z'
    const offsetM = axis === 'X' ? (start[1] + end[1]) / 2 : (start[0] + end[0]) / 2

    // Sum child opening widths to estimate solid braced segments >= 4 ft (1.219 m) or portal >= 16" (0.406 m)
    const childOpenings = doorsWindows.filter((o) => o.parentId === w.id)
    const openingWidthM = childOpenings.reduce(
      (sum, o) => sum + (typeof o.width === 'number' ? o.width : 0.91),
      0,
    )
    const solidM = Math.max(0, lenM - openingWidthM)
    // Count solid segments qualifying for WSP (>= 4 ft) or CS-PF portal (>= 16")
    const bracedLenM = solidM >= 1.219 ? solidM : solidM >= 0.406 ? solidM : 0
    entries.push({ wall: w, axis, offsetM, lenM, bracedLenM })
  }

  const reports: BracedWallLineReport[] = []
  const TOL_M = 1.22 // 4 ft per IRC R602.10.1.1

  for (const axis of ['X', 'Z'] as const) {
    const axisEntries = entries
      .filter((e) => e.axis === axis)
      .sort((a, b) => a.offsetM - b.offsetM)
    const clusters: WallEntry[][] = []
    for (const e of axisEntries) {
      const last = clusters[clusters.length - 1]
      if (!last || Math.abs(e.offsetM - last[0]!.offsetM) > TOL_M) {
        clusters.push([e])
      } else {
        last.push(e)
      }
    }

    clusters.forEach((cluster, idx) => {
      const totalM = cluster.reduce((s, e) => s + e.lenM, 0)
      const bracedM = cluster.reduce((s, e) => s + e.bracedLenM, 0)
      const totalFt = totalM * METERS_TO_FEET
      const bracedFt = bracedM * METERS_TO_FEET
      const providedPercent = totalFt > 0 ? Math.round((bracedFt / totalFt) * 100) : 0
      const passes = providedPercent >= requiredPercent
      const highLateral = design.windMph >= 130 || requiresPlateWashers

      let bracingMethod: BracedWallLineReport['bracingMethod'] = 'WSP'
      if (!passes || (highLateral && providedPercent < requiredPercent + 10)) {
        bracingMethod = bracedFt < 4 ? 'CS-PF' : 'Engineered-Shear'
      } else if (highLateral) {
        bracingMethod = 'CS-WSP'
      }

      const overturningUpliftLbs =
        bracingMethod === 'Engineered-Shear'
          ? (design.storiesAbove >= 1 ? 7200 : 4800)
          : bracingMethod === 'CS-PF'
            ? 3500
            : highLateral
              ? 3000
              : 0

      const hd = overturningUpliftLbs > 0 ? selectHoldDownSku(overturningUpliftLbs) : null
      const edgeNailSpacingIn: 2 | 3 | 4 | 6 =
        bracingMethod === 'Engineered-Shear'
          ? design.storiesAbove >= 1
            ? 2
            : 3
          : highLateral
            ? 4
            : 6

      reports.push({
        id: `BWL-${axis}${idx + 1}`,
        axis,
        offsetM: Number(cluster[0]!.offsetM.toFixed(2)),
        wallIds: cluster.map((e) => e.wall.id),
        totalLineLengthFt: Number(totalFt.toFixed(1)),
        bracedPanelLengthFt: Number(bracedFt.toFixed(1)),
        providedPercent,
        requiredPercent,
        passes,
        bracingMethod,
        requiredHoldDownSku: hd?.sku ?? null,
        requiresPlateWashers,
        edgeNailSpacingIn,
        codeRef:
          bracingMethod === 'CS-PF'
            ? 'IRC R602.10.6.4'
            : bracingMethod === 'Engineered-Shear'
              ? 'AWC SDPWS / IRC R602.10'
              : 'IRC Table R602.10.3(1)/(3)',
        note: passes
          ? undefined
          : `Provided braced wall (${providedPercent}%) is below required ${requiredPercent}% — add CS-PF portal frame or engineered shear wall with ${hd?.sku ?? 'HDU5-SDS2.5'} hold-downs.`,
      })
    })
  }

  return reports
}

/**
 * Trace continuous gravity & uplift load paths across all structural:beam, structural:column,
 * structural:assembly, and structural:connector nodes.
 */
export function traceStructuralLoadPaths(params: {
  nodes: Readonly<Record<string, SceneNodeLike>>
  design?: Partial<StructuralDesignParams>
}): LoadPathAnalysisReport {
  const design = { ...DEFAULT_DESIGN_PARAMS, ...params.design }
  const all = Object.values(params.nodes)
  const beams = all.filter((n) => n.type === 'structural:beam')
  const columns = all.filter((n) => n.type === 'structural:column')
  const connectors = all.filter((n) => n.type === 'structural:connector')
  const assemblies = all.filter((n) => n.type === 'structural:assembly')
  const walls = all.filter((n) => n.type === 'wall' && getWallLengthM(n) > 0)

  const hasTji = assemblies.some((a) => a.floorSystem === 'tji-ijoist')
  const gravityLinks: LoadPathNodeLink[] = []
  const SUPPORT_TOL_M = 0.45

  // 1. Check every beam's end bearing onto a column or bearing wall
  for (const beam of beams) {
    const start = (beam.start as Vec2 | undefined) ?? [0, 0]
    const end = (beam.end as Vec2 | undefined) ?? [1, 0]
    const role = String(beam.role ?? 'header')
    const reactionLbs =
      typeof beam.endReactionLbs === 'number' && beam.endReactionLbs > 0
        ? beam.endReactionLbs
        : role === 'floor-girder'
          ? 4200
          : role === 'ridge-beam'
            ? 3200
            : 1800

    for (const [endIdx, pt] of [start, end].entries()) {
      // Check if a column sits near this beam end
      const col = columns.find((c) => {
        const p = c.position ?? [0, 0, 0]
        return Math.hypot(p[0] - pt[0], p[2] - pt[1]) <= SUPPORT_TOL_M
      })
      if (col) {
        gravityLinks.push({
          fromNodeId: beam.id,
          fromType: `beam (${role})`,
          toNodeId: col.id,
          toType: 'column',
          position: pt,
          axialLoadLbs: reactionLbs,
          continuous: true,
          requiresSquashBlock: hasTji && !col.hasSquashBlocks,
          issue:
            hasTji && !col.hasSquashBlocks
              ? `Column ${col.id} supports beam ${beam.id} over TJI floor without squash blocks (IRC R502.1.2)`
              : undefined,
        })
        continue
      }

      // Check if beam end bears on a wall (e.g. header in a wall or girder pocketed in perimeter wall)
      const wall = walls.find((w) => {
        const ws = w.start!
        const we = w.end!
        const len = Math.hypot(we[0] - ws[0], we[1] - ws[1])
        if (len < 0.05) return false
        const ux = (we[0] - ws[0]) / len
        const uz = (we[1] - ws[1]) / len
        const proj = (pt[0] - ws[0]) * ux + (pt[1] - ws[1]) * uz
        const perp = Math.abs((pt[0] - ws[0]) * -uz + (pt[1] - ws[1]) * ux)
        return proj >= -0.25 && proj <= len + 0.25 && perp <= 0.35
      })

      if (wall) {
        gravityLinks.push({
          fromNodeId: beam.id,
          fromType: `beam (${role})`,
          toNodeId: wall.id,
          toType: 'wall-bearing',
          position: pt,
          axialLoadLbs: reactionLbs,
          continuous: true,
          requiresSquashBlock: false,
        })
      } else {
        gravityLinks.push({
          fromNodeId: beam.id,
          fromType: `beam (${role})`,
          toNodeId: null,
          toType: 'unverified-support',
          position: pt,
          axialLoadLbs: reactionLbs,
          continuous: false,
          requiresSquashBlock: false,
          issue: `Beam ${beam.id} end #${endIdx + 1} at (${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}) has no supporting column or bearing wall below (broken load path, IRC R502.6).`,
        })
      }
    }
  }

  // 2. Check every column's load transfer down to a lower column or pad footing
  for (const col of columns) {
    const pos = col.position ?? [0, 0, 0]
    const load = typeof col.axialLoadLbs === 'number' ? col.axialLoadLbs : 4500
    const hasFooting = typeof col.footingWidthIn === 'number' && col.footingWidthIn >= 18
    const hasTarget = Boolean(col.transfersToNodeId)
    const continuous = hasFooting || hasTarget
    gravityLinks.push({
      fromNodeId: col.id,
      fromType: 'column',
      toNodeId: (col.transfersToNodeId as string | undefined) ?? (hasFooting ? `footing:${col.id}` : null),
      toType: hasTarget ? 'lower-column' : hasFooting ? 'pad-footing' : 'missing-footing',
      position: [pos[0], pos[2]],
      axialLoadLbs: load,
      continuous,
      requiresSquashBlock: hasTji && !col.hasSquashBlocks,
      issue: continuous
        ? undefined
        : `Column ${col.id} (${load} lbs) lacks a foundation pad footing or stacked lower column (IRC R403.1).`,
    })
  }

  // 3. Uplift load path verification (roof hurricane ties -> straps -> hold-downs)
  const upliftFindings: string[] = []
  const hasRoofTies = connectors.some((c) => c.category === 'hurricane-tie')
  const hasStraps = connectors.some((c) => c.category === 'tension-strap' || c.category === 'framing-angle')
  const hasHoldDowns = connectors.some((c) => c.category === 'hold-down')
  const hasPostBases = connectors.some((c) => c.category === 'post-base')
  const hasPostCaps = connectors.some((c) => c.category === 'post-cap')

  if (design.windMph >= 115 && !hasRoofTies && assemblies.length > 0) {
    upliftFindings.push(`Wind ${design.windMph} mph requires roof-to-wall hurricane ties (H2.5A/H10A, IRC R802.11).`)
  }
  if (design.windMph >= 130 && !hasStraps && assemblies.length > 0) {
    upliftFindings.push(`High wind (>=130 mph) requires continuous wall/floor uplift straps (MSTA36/CS16, WFCM).`)
  }
  if (
    (design.seismicCategory === 'D0' || design.seismicCategory === 'D1' || design.seismicCategory === 'D2' || design.windMph >= 130) &&
    !hasHoldDowns &&
    assemblies.length > 0
  ) {
    upliftFindings.push(`SDC ${design.seismicCategory} / ${design.windMph} mph wind requires foundation hold-downs (HDU/STHD14).`)
  }
  if (columns.length > 0 && !hasPostBases) {
    upliftFindings.push('Columns present without standoff post bases (ABU/CB) anchored to footings (IRC R407.3).')
  }
  if (columns.length > 0 && beams.length > 0 && !hasPostCaps) {
    upliftFindings.push('Beam-to-column bearing without post caps (BC/LPC/CCQ) resisting uplift/lateral displacement (IRC R502.9).')
  }

  const bracedWallLines = evaluateBracedWallLines({ nodes: params.nodes, design })
  const brokenLoadPaths = gravityLinks.filter((l) => !l.continuous || Boolean(l.issue)).length

  return {
    bracedWallLines,
    gravityLinks,
    brokenLoadPaths,
    upliftContinuous: upliftFindings.length === 0,
    upliftFindings,
  }
}
