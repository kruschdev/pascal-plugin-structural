/**
 * Continuous Gravity & Uplift Load-Path Tracer + IRC R602.10 Braced Wall Line Evaluator.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { extractWallOpenings } from './openings'
import { selectHoldDownSku } from './sizing'
import {
  DEFAULT_DESIGN_PARAMS,
  METERS_TO_FEET,
  type SceneNodeLike,
  type StructuralDesignParams,
  type Vec2,
  belongsToLevel,
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
 * Evaluate IRC R602.10 Braced Wall Lines along both X and Z axes, scoped by level.
 * Clusters walls within 4 ft (1.2192 m) perpendicular tolerance (R602.10.1.1) and measures
 * genuine continuous solid panel spans (WSP >= 48", CS-PF >= 16") rather than pooling slivers.
 */
export function evaluateBracedWallLines(params: {
  nodes: Readonly<Record<string, SceneNodeLike>>
  design?: Partial<StructuralDesignParams>
  levelId?: string | null
}): BracedWallLineReport[] {
  const design = { ...DEFAULT_DESIGN_PARAMS, ...params.design }
  const all = Object.values(params.nodes).filter((n) =>
    params.levelId ? belongsToLevel(params.nodes, n, params.levelId) : true,
  )
  const walls = all.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
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
    levelKey: string
    axis: 'X' | 'Z'
    offsetM: number
    projMinM: number
    projMaxM: number
    lenM: number
    wspBracedLenM: number
    portalPanelLensM: number[]
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
    const projMinM = axis === 'X' ? Math.min(start[0], end[0]) : Math.min(start[1], end[1])
    const projMaxM = axis === 'X' ? Math.max(start[0], end[0]) : Math.max(start[1], end[1])

    // Split wall into real continuous solid pier intervals around child doors/windows (both native & Pascal `item` openings)
    const childOpenings = extractWallOpenings(params.nodes, w)
    const cuts: Array<[number, number]> = childOpenings.map((o) => [
      Math.max(0, o.uCenterM - o.widthM / 2),
      Math.min(lenM, o.uCenterM + o.widthM / 2),
    ])
    cuts.sort((a, b) => a[0] - b[0])
    const solidSpans: number[] = []
    let cursor = 0
    for (const [c0, c1] of cuts) {
      if (c0 > cursor) solidSpans.push(c0 - cursor)
      cursor = Math.max(cursor, c1)
    }
    if (cursor < lenM) solidSpans.push(lenM - cursor)

    const wallHeightM = typeof w.height === 'number' && w.height > 0 ? w.height : 2.7432
    const wspBracedLenM = solidSpans.reduce((s, seg) => s + (seg >= 1.2192 ? seg : 0), 0)
    // IRC Table R602.10.5 / R602.10.6.4: CS-PF portal frames apply only adjacent to openings on walls <= 10 ft (3.05 m)
    const portalPanelLensM =
      childOpenings.length > 0 && wallHeightM <= 3.06 && design.storiesAbove <= 1
        ? solidSpans.filter((seg) => seg >= 0.4064 && seg < 1.2192)
        : []
    entries.push({
      wall: w,
      levelKey: w.parentId ?? 'default',
      axis,
      offsetM,
      projMinM,
      projMaxM,
      lenM,
      wspBracedLenM,
      portalPanelLensM,
    })
  }

  const reports: BracedWallLineReport[] = []
  const TOL_M = 1.2192 // exact 4 ft per IRC R602.10.1.1
  const levelKeys = [...new Set(entries.map((e) => e.levelKey))]

  for (const levelKey of levelKeys) {
    for (const axis of ['X', 'Z'] as const) {
      const axisEntries = entries
        .filter((e) => e.levelKey === levelKey && e.axis === axis)
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
        // IRC R602.10.1.2: BWL length is out-to-out distance between extreme ends along the axis
        const minProj = cluster.reduce((m, e) => Math.min(m, e.projMinM), Number.POSITIVE_INFINITY)
        const maxProj = cluster.reduce((m, e) => Math.max(m, e.projMaxM), Number.NEGATIVE_INFINITY)
        const maxWallM = cluster.reduce((m, e) => Math.max(m, e.lenM), 0)
        const totalM = Math.max(maxWallM, maxProj - minProj)
        const wspM = cluster.reduce((s, e) => s + e.wspBracedLenM, 0)
        // IRC Table R602.10.5 limits CS-PF portal frames to at most 4 panels per braced wall line
        const allPortalPanels = cluster
          .flatMap((e) => e.portalPanelLensM)
          .sort((a, b) => b - a)
          .slice(0, 4)
        const portalExtraM = allPortalPanels.reduce((s, p) => s + p, 0)
        const totalFt = totalM * METERS_TO_FEET
        const wspFt = wspM * METERS_TO_FEET
        const portalFt = (wspM + portalExtraM) * METERS_TO_FEET
        const wspPercent = totalFt > 0 ? Math.round((wspFt / totalFt) * 100) : 0
        const highLateral = design.windMph >= 130 || requiresPlateWashers

        // Credit WSP piers (>=48") by default; only credit up to 4 CS-PF (16"-48") portal frames when adjacent to openings
        const usesPortal = wspPercent < requiredPercent && portalExtraM > 0
        const bracedFt = usesPortal ? portalFt : wspFt
        const providedPercent = totalFt > 0 ? Math.round((bracedFt / totalFt) * 100) : 0
        const passes = providedPercent >= requiredPercent

        let bracingMethod: BracedWallLineReport['bracingMethod'] = 'WSP'
        if (usesPortal) {
          bracingMethod = 'CS-PF'
        } else if (!passes || (highLateral && providedPercent < requiredPercent + 10)) {
          bracingMethod = 'Engineered-Shear'
        } else if (highLateral) {
          bracingMethod = 'CS-WSP'
        }

        const overturningUpliftLbs =
          bracingMethod === 'Engineered-Shear'
            ? design.storiesAbove >= 1
              ? 7200
              : 4800
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
          id: levelKeys.length > 1 ? `BWL-${levelKey}-${axis}${idx + 1}` : `BWL-${axis}${idx + 1}`,
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

    const beamY = typeof beam.elevationY === 'number' ? beam.elevationY : 2.4
    const beamDepthM = (typeof beam.depthIn === 'number' ? beam.depthIn : 11.875) * 0.0254
    const beamBottomY = beamY - beamDepthM / 2

    for (const [endIdx, pt] of [start, end].entries()) {
      // Check if a column sits near this beam end AND reaches up to support the beam underside (same level/vertical alignment)
      const col = columns.find((c) => {
        if (beam.parentId && c.parentId && c.parentId !== beam.parentId) return false
        const p = c.position ?? [0, 0, 0]
        const colH = typeof c.heightM === 'number' ? c.heightM : 2.74
        const colTopY = p[1] + colH
        const planMatch = Math.hypot(p[0] - pt[0], p[2] - pt[1]) <= SUPPORT_TOL_M
        const verticalMatch = p[1] <= beamBottomY + 0.35 && colTopY >= beamBottomY - 0.55
        return planMatch && verticalMatch
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

      // Check if beam end bears on a wall on the same level
      const wall = walls.find((w) => {
        if (beam.parentId && w.parentId && w.parentId !== beam.parentId) return false
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

  // 2. Check every column's load transfer down to a verified lower column or pad footing
  for (const col of columns) {
    const pos = col.position ?? [0, 0, 0]
    const load = typeof col.axialLoadLbs === 'number' ? col.axialLoadLbs : 4500
    const hasFooting = typeof col.footingWidthIn === 'number' && col.footingWidthIn >= 18
    const targetId = typeof col.transfersToNodeId === 'string' ? col.transfersToNodeId : ''
    const hasVerifiedTarget =
      targetId.startsWith('footing:')
        ? hasFooting
        : Boolean(targetId && params.nodes[targetId])
    const continuous = hasFooting || hasVerifiedTarget
    gravityLinks.push({
      fromNodeId: col.id,
      fromType: 'column',
      toNodeId: hasVerifiedTarget ? targetId : hasFooting ? `footing:${col.id}` : null,
      toType: hasVerifiedTarget && !targetId.startsWith('footing:')
        ? 'lower-column'
        : hasFooting
          ? 'pad-footing'
          : 'missing-footing',
      position: [pos[0], pos[2]],
      axialLoadLbs: load,
      continuous,
      requiresSquashBlock: hasTji && !col.hasSquashBlocks,
      issue: continuous
        ? undefined
        : targetId && !targetId.startsWith('footing:') && !params.nodes[targetId]
          ? `Column ${col.id} references missing target "${targetId}" with no spread footing (broken load path, IRC R403.1).`
          : `Column ${col.id} (${load} lbs) lacks a foundation pad footing or stacked lower column (IRC R403.1).`,
    })
  }

  // 3. Uplift load path verification (per-column base/cap + wind/seismic continuity without assemblies===0 blind spot)
  const upliftFindings: string[] = []
  const hasStructure = assemblies.length > 0 || beams.length > 0 || columns.length > 0 || walls.length > 0
  const hasRoofTies = connectors.some((c) => c.category === 'hurricane-tie')
  const hasStraps = connectors.some((c) => c.category === 'tension-strap' || c.category === 'framing-angle')
  const hasHoldDowns = connectors.some((c) => c.category === 'hold-down')

  if (design.windMph >= 115 && !hasRoofTies && assemblies.length > 0) {
    upliftFindings.push(`Wind ${design.windMph} mph requires roof-to-wall hurricane ties (H2.5A/H10A, IRC R802.11).`)
  }
  if (design.windMph >= 130 && !hasStraps && hasStructure) {
    upliftFindings.push(`High wind (>=130 mph) requires continuous wall/floor uplift straps (MSTA36/CS16, WFCM).`)
  }
  if (
    (design.seismicCategory === 'D0' || design.seismicCategory === 'D1' || design.seismicCategory === 'D2' || design.windMph >= 130) &&
    !hasHoldDowns &&
    hasStructure
  ) {
    upliftFindings.push(`SDC ${design.seismicCategory} / ${design.windMph} mph wind requires foundation hold-downs (HDU/STHD14).`)
  }

  // Verify each individual column has a post base and (when supporting a beam) a post cap
  const baseConnectors = connectors.filter((c) => c.category === 'post-base')
  const capConnectors = connectors.filter((c) => c.category === 'post-cap')
  const missingBases: string[] = []
  const missingCaps: string[] = []
  for (const col of columns) {
    const cPos = col.position ?? [0, 0, 0]
    const hasBase = baseConnectors.some(
      (b) =>
        (Array.isArray(b.attachedNodeIds) && b.attachedNodeIds.includes(col.id)) ||
        (Array.isArray(b.position) && Math.hypot(b.position[0] - cPos[0], b.position[2] - cPos[2]) <= 0.45),
    )
    if (!hasBase) missingBases.push(col.id)
    if (beams.length > 0) {
      const hasCap = capConnectors.some(
        (cap) =>
          (Array.isArray(cap.attachedNodeIds) && cap.attachedNodeIds.includes(col.id)) ||
          (Array.isArray(cap.position) && Math.hypot(cap.position[0] - cPos[0], cap.position[2] - cPos[2]) <= 0.45),
      )
      if (!hasCap) missingCaps.push(col.id)
    }
  }
  if (missingBases.length > 0) {
    upliftFindings.push(`Column(s) [${missingBases.join(', ')}] lack standoff post bases (ABU/CB) anchored to footings (IRC R407.3).`)
  }
  if (missingCaps.length > 0) {
    upliftFindings.push(`Column(s) [${missingCaps.join(', ')}] lack post-to-beam caps (BC/LPC/CCQ) resisting uplift/lateral displacement (IRC R502.9).`)
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
