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
  isHoldDownConnector,
  resolveHoldDownUpliftLbs,
  resolveNodeLevelId,
  sameLevelOrUnscoped,
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
  overturningUpliftLbs?: number
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

/** Merge overlapping or touching 1D intervals `[a, b]` so parallel walls in the same BWL never double-count. */
function mergeIntervals1D(intervals: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  if (intervals.length === 0) return []
  const sorted = intervals
    .map(([a, b]) => (a <= b ? ([a, b] as [number, number]) : ([b, a] as [number, number])))
    .filter(([a, b]) => b > a + 1e-6)
    .sort((x, y) => x[0] - y[0])
  if (sorted.length === 0) return []
  const merged: Array<[number, number]> = [[sorted[0]![0], sorted[0]![1]]]
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!
    const prev = merged[merged.length - 1]!
    if (s <= prev[1] + 1e-6) {
      prev[1] = Math.max(prev[1], e)
    } else {
      merged.push([s, e])
    }
  }
  return merged
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
    wallHeightM: number
    maxSolidPierM: number
    wspIntervalsM: Array<[number, number]>
    portalIntervalsM: Array<[number, number]>
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
    const ux = (end[0] - start[0]) / lenM
    const uz = (end[1] - start[1]) / lenM
    const projAt = (u: number): number => (axis === 'X' ? start[0] + ux * u : start[1] + uz * u)

    // Split wall into real continuous solid pier intervals around child doors/windows (both native & Pascal `item` openings)
    const childOpenings = extractWallOpenings(params.nodes, w)
    const cuts: Array<[number, number]> = childOpenings.map((o) => [
      Math.max(0, o.uCenterM - o.widthM / 2),
      Math.min(lenM, o.uCenterM + o.widthM / 2),
    ])
    cuts.sort((a, b) => a[0] - b[0])
    const solidRanges: Array<[number, number]> = []
    let cursor = 0
    for (const [c0, c1] of cuts) {
      if (c0 > cursor) solidRanges.push([cursor, c0])
      cursor = Math.max(cursor, c1)
    }
    if (cursor < lenM) solidRanges.push([cursor, lenM])

    const wallHeightM = typeof w.height === 'number' && w.height > 0 ? w.height : 2.7432
    const toProjInterval = ([u0, u1]: readonly [number, number]): [number, number] => {
      const p0 = projAt(u0)
      const p1 = projAt(u1)
      return p0 <= p1 ? [p0, p1] : [p1, p0]
    }
    const wspIntervalsM: Array<[number, number]> = solidRanges
      .filter(([u0, u1]) => u1 - u0 >= 1.2192)
      .map(toProjInterval)
    // IRC Table R602.10.5 / R602.10.6.4: CS-PF portal frames apply only adjacent to openings on walls <= 10 ft (3.05 m)
    const portalIntervalsM: Array<[number, number]> =
      childOpenings.length > 0 && wallHeightM <= 3.06 && design.storiesAbove <= 1
        ? solidRanges
            .filter(([u0, u1]) => {
              const seg = u1 - u0
              return seg >= 0.4064 && seg < 1.2192
            })
            .map(toProjInterval)
        : []
    const maxSolidPierM = solidRanges.reduce((max, [u0, u1]) => Math.max(max, u1 - u0), 0)
    entries.push({
      wall: w,
      levelKey: resolveNodeLevelId(params.nodes, w) ?? 'default',
      axis,
      offsetM,
      projMinM,
      projMaxM,
      lenM,
      wallHeightM,
      maxSolidPierM,
      wspIntervalsM,
      portalIntervalsM,
    })
  }

  const holdDownConnectors = all.filter((n) => isHoldDownConnector(n))

  const reports: BracedWallLineReport[] = []
  const TOL_M = 1.2192 // exact 4 ft per IRC R602.10.1.1
  const levelKeys = [...new Set(entries.map((e) => e.levelKey))]

  for (const levelKey of levelKeys) {
    const targetLevel = levelKey === 'default' ? null : levelKey
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

      const axisReports: Array<{
        report: BracedWallLineReport
        minProj: number
        maxProj: number
        hasExteriorWall: boolean
      }> = []
      clusters.forEach((cluster, idx) => {
        // IRC R602.10.1.2: BWL length is axis-projected out-to-out distance between extreme ends
        const minProj = cluster.reduce((m, e) => Math.min(m, e.projMinM), Number.POSITIVE_INFINITY)
        const maxProj = cluster.reduce((m, e) => Math.max(m, e.projMaxM), Number.NEGATIVE_INFINITY)
        const totalM = maxProj - minProj
        if (!Number.isFinite(totalM) || totalM <= 1e-6) return
        // Merge overlapping 1D projected intervals so parallel hallway/closet walls never exceed 100%
        const mergedWsp = mergeIntervals1D(cluster.flatMap((e) => e.wspIntervalsM))
        const wspM = Math.min(totalM, mergedWsp.reduce((s, [a, b]) => s + (b - a), 0))
        // IRC Table R602.10.5 limits CS-PF portal frames to at most 4 panels per braced wall line
        const allPortalIntervals = cluster
          .flatMap((e) => e.portalIntervalsM)
          .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
          .slice(0, 4)
        const mergedWithPortals = mergeIntervals1D([...mergedWsp, ...allPortalIntervals])
        const totalWithPortalsM = Math.min(totalM, mergedWithPortals.reduce((s, [a, b]) => s + (b - a), 0))
        const portalExtraM = Math.max(0, totalWithPortalsM - wspM)
        const totalFt = totalM * METERS_TO_FEET
        const wspFt = wspM * METERS_TO_FEET
        const portalFt = (wspM + portalExtraM) * METERS_TO_FEET
        const wspPercent = totalFt > 0 ? Math.min(100, Math.round((wspFt / totalFt) * 100)) : 0
        const highLateral = design.windMph >= 130 || requiresPlateWashers

        // Credit WSP piers (>=48") by default; only credit up to 4 CS-PF (16"-48") portal frames when adjacent to openings
        const usesPortal = wspPercent < requiredPercent && portalExtraM > 0
        const bracedFt = usesPortal ? portalFt : wspFt
        const providedPercent = totalFt > 0 ? Math.min(100, Math.round((bracedFt / totalFt) * 100)) : 0
        const prescriptivePasses = providedPercent >= requiredPercent

        // Resolve bracing method and overturning uplift demand BEFORE evaluating hold-down remediation credit
        let bracingMethod: BracedWallLineReport['bracingMethod'] = 'WSP'
        if (usesPortal) {
          bracingMethod = 'CS-PF'
        } else if (!prescriptivePasses || (highLateral && providedPercent < requiredPercent + 10)) {
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

        // Require a viable continuous solid shear pier (IRC R602.10.6.4 >= 16" CS-PF or AWC SDPWS H/3.5 max aspect ratio),
        // catalog-verified uplift capacity >= overturningUpliftLbs, and dual-end hold-down quantity >= 2.
        const hasViableShearPier =
          bracingMethod === 'CS-PF'
            ? cluster.some((e) => e.maxSolidPierM >= 0.4064 - 1e-4)
            : cluster.some((e) => e.maxSolidPierM >= e.wallHeightM / 3.5 - 1e-4)

        const clusterWallIds = new Set(cluster.map((e) => e.wall.id))
        const qualifyingHoldDowns = holdDownConnectors.filter((hdNode) => {
          if (!sameLevelOrUnscoped(resolveNodeLevelId(params.nodes, hdNode), targetLevel)) return false
          if (!Array.isArray(hdNode.attachedNodeIds)) return false
          if (!hdNode.attachedNodeIds.some((id) => typeof id === 'string' && clusterWallIds.has(id))) return false
          return resolveHoldDownUpliftLbs(hdNode) >= overturningUpliftLbs
        })
        const qualifyingHoldDownQty = qualifyingHoldDowns.reduce((sum, hdNode) => {
          const qty =
            typeof hdNode.quantity === 'number' && Number.isFinite(hdNode.quantity) && hdNode.quantity > 0
              ? hdNode.quantity
              : 1
          return sum + qty
        }, 0)
        const matchedHoldDown = qualifyingHoldDowns[0]
        const remediatedByHoldDown =
          !prescriptivePasses &&
          hasViableShearPier &&
          overturningUpliftLbs > 0 &&
          qualifyingHoldDownQty >= 2
        const passes = prescriptivePasses || remediatedByHoldDown
        const edgeNailSpacingIn: 2 | 3 | 4 | 6 =
          bracingMethod === 'Engineered-Shear'
            ? design.storiesAbove >= 1
              ? 2
              : 3
            : highLateral
              ? 4
              : 6

        const hasExteriorWall = cluster.some(
          (e) => e.wall.frontSide === 'exterior' || e.wall.backSide === 'exterior',
        )
        axisReports.push({
          minProj,
          maxProj,
          hasExteriorWall,
          report: {
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
            overturningUpliftLbs,
            requiredHoldDownSku: hd?.sku ?? null,
            requiresPlateWashers,
            edgeNailSpacingIn,
            codeRef:
              bracingMethod === 'CS-PF'
                ? 'IRC R602.10.6.4'
                : bracingMethod === 'Engineered-Shear'
                  ? 'AWC SDPWS / IRC R602.10'
                  : 'IRC Table R602.10.3(1)/(3)',
            note: prescriptivePasses
              ? undefined
              : remediatedByHoldDown
                ? `Prescriptive bracing (${providedPercent}% < ${requiredPercent}%) remediated via ${bracingMethod} with ${String(matchedHoldDown?.sku ?? hd?.sku ?? 'STHD14')} hold-downs (x${qualifyingHoldDownQty}, >= ${overturningUpliftLbs} lbs).`
                : !hasViableShearPier
                  ? `Provided braced wall (${providedPercent}%) is below required ${requiredPercent}% and lacks a qualifying solid shear pier (>= 16" CS-PF or H/3.5 engineered shear).`
                  : `Provided braced wall (${providedPercent}%) is below required ${requiredPercent}%; add CS-PF portal frame or engineered shear wall with >= 2 ${hd?.sku ?? 'HDU5-SDS2.5'} hold-downs (>= ${overturningUpliftLbs} lbs).`,
          },
        })
      })

      // IRC R602.10.1.3: Non-perimeter interior partition lines sitting strictly between overlapping passing
      // parallel braced wall lines within max BWL spacing (60 ft / 18.29m SDC A-C; 35 ft / 10.67m high-lateral)
      // are not independently required shear lines. Never waive stepped exterior walls or lines lacking
      // overlapping passing parallel braced lines on both sides.
      const maxBwlSpacingM = design.windMph >= 130 || requiresPlateWashers ? 10.67 : 18.29
      const overlapsProj = (a: { minProj: number; maxProj: number }, b: { minProj: number; maxProj: number }) =>
        Math.min(a.maxProj, b.maxProj) - Math.max(a.minProj, b.minProj) > 0.1
      if (axisReports.length >= 3) {
        for (let i = 1; i < axisReports.length - 1; i++) {
          const item = axisReports[i]!
          const rep = item.report
          if (rep.passes || item.hasExteriorWall) continue
          const prevPassing = axisReports
            .slice(0, i)
            .reverse()
            .find((r) => r.report.passes && overlapsProj(r, item))
          const nextPassing = axisReports.slice(i + 1).find((r) => r.report.passes && overlapsProj(r, item))
          if (!prevPassing || !nextPassing) continue
          const withinSpacing = Math.abs(nextPassing.report.offsetM - prevPassing.report.offsetM) <= maxBwlSpacingM
          if (withinSpacing || rep.totalLineLengthFt < 4.0) {
            item.report = {
              ...rep,
              passes: true,
              overturningUpliftLbs: 0,
              requiredHoldDownSku: null,
              note: `Interior partition line within IRC R602.10.1.3 BWL spacing (${prevPassing.report.id} to ${nextPassing.report.id}).`,
            }
          }
        }
      }
      reports.push(...axisReports.map((a) => a.report))
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

  // Scope TJI floor checks strictly per level so a TJI floor on Level 1 never requires squash blocks on Level 2
  const levelHasTji = (node: SceneNodeLike): boolean => {
    const nodeLvl = resolveNodeLevelId(params.nodes, node)
    const matching = nodeLvl
      ? assemblies.filter((a) => sameLevelOrUnscoped(resolveNodeLevelId(params.nodes, a), nodeLvl))
      : assemblies
    return matching.some((a) => a.floorSystem === 'tji-ijoist')
  }
  const gravityLinks: LoadPathNodeLink[] = []
  const SUPPORT_TOL_M = 0.45

  // 1. Check every beam's end bearing onto a column or bearing wall
  for (const beam of beams) {
    const beamLvl = resolveNodeLevelId(params.nodes, beam)
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
        if (!sameLevelOrUnscoped(beamLvl, resolveNodeLevelId(params.nodes, c))) return false
        const p = c.position ?? [0, 0, 0]
        const colH = typeof c.heightM === 'number' ? c.heightM : 2.74
        const colTopY = p[1] + colH
        const planMatch = Math.hypot(p[0] - pt[0], p[2] - pt[1]) <= SUPPORT_TOL_M
        const verticalMatch = p[1] <= beamBottomY - 0.25 && colTopY >= beamBottomY - 0.55
        return planMatch && verticalMatch
      })
      if (col) {
        const colNeedsTjiSquash = levelHasTji(col) && !col.hasSquashBlocks
        gravityLinks.push({
          fromNodeId: beam.id,
          fromType: `beam (${role})`,
          toNodeId: col.id,
          toType: 'column',
          position: pt,
          axialLoadLbs: reactionLbs,
          continuous: true,
          requiresSquashBlock: colNeedsTjiSquash,
          issue: colNeedsTjiSquash
            ? `Column ${col.id} supports beam ${beam.id} over TJI floor without squash blocks (IRC R502.1.2)`
            : undefined,
        })
        continue
      }

      // Check if beam end bears on a wall on the same level
      const wall = walls.find((w) => {
        if (!sameLevelOrUnscoped(beamLvl, resolveNodeLevelId(params.nodes, w))) return false
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
    const isFootingTarget = targetId.startsWith('footing_') || targetId.startsWith('footing:')
    const hasVerifiedTarget = isFootingTarget
      ? hasFooting
      : Boolean(targetId && params.nodes[targetId])
    const continuous = hasFooting || hasVerifiedTarget
    gravityLinks.push({
      fromNodeId: col.id,
      fromType: 'column',
      toNodeId: hasVerifiedTarget ? targetId : hasFooting ? `footing_${col.id}` : null,
      toType:
        hasVerifiedTarget && !isFootingTarget
          ? 'lower-column'
          : hasFooting
            ? 'pad-footing'
            : 'missing-footing',
      position: [pos[0], pos[2]],
      axialLoadLbs: load,
      continuous,
      requiresSquashBlock: levelHasTji(col) && !col.hasSquashBlocks,
      issue: continuous
        ? undefined
        : targetId && !isFootingTarget && !params.nodes[targetId]
          ? `Column ${col.id} references missing target "${targetId}" with no spread footing (broken load path, IRC R403.1).`
          : `Column ${col.id} (${load} lbs) lacks a foundation pad footing or stacked lower column (IRC R403.1).`,
    })
  }

  // 3. Uplift load path verification (per-column base/cap + wind/seismic continuity without assemblies===0 blind spot)
  const upliftFindings: string[] = []
  const hasStructure = assemblies.length > 0 || beams.length > 0 || columns.length > 0 || walls.length > 0
  const hasRoofTies = connectors.some((c) => c.category === 'hurricane-tie')
  const hasStraps = connectors.some((c) => c.category === 'tension-strap' || c.category === 'framing-angle')
  const hasHoldDowns = connectors.some((c) => isHoldDownConnector(c))

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

  // Verify each individual column has a post base (when on a foundation footing) and (when supporting a beam on the same level) a post cap
  const baseConnectors = connectors.filter((c) => c.category === 'post-base')
  const capConnectors = connectors.filter((c) => c.category === 'post-cap')
  const missingBases: string[] = []
  const missingCaps: string[] = []
  for (const col of columns) {
    const colLvl = resolveNodeLevelId(params.nodes, col)
    const cPos = col.position ?? [0, 0, 0]
    const targetId = typeof col.transfersToNodeId === 'string' ? col.transfersToNodeId : ''
    const stacksOntoLowerCol = Boolean(
      targetId &&
        targetId !== col.id &&
        !targetId.startsWith('footing_') &&
        !targetId.startsWith('footing:') &&
        params.nodes[targetId]?.type === 'structural:column',
    )
    const lvlAsm = colLvl
      ? assemblies.find((a) => resolveNodeLevelId(params.nodes, a) === colLvl)
      : assemblies[0]
    const levelFoundationDisabled =
      lvlAsm !== undefined &&
      (lvlAsm.visibleSystems as Record<string, boolean> | undefined)?.foundation === false &&
      (typeof col.footingWidthIn !== 'number' || col.footingWidthIn <= 0)
    const needsFoundationBase = !stacksOntoLowerCol && !levelFoundationDisabled

    if (needsFoundationBase) {
      const hasBase = baseConnectors.some((b) => {
        if (!sameLevelOrUnscoped(resolveNodeLevelId(params.nodes, b), colLvl)) return false
        return (
          (Array.isArray(b.attachedNodeIds) && b.attachedNodeIds.includes(col.id)) ||
          (Array.isArray(b.position) && Math.hypot(b.position[0] - cPos[0], b.position[2] - cPos[2]) <= 0.45)
        )
      })
      if (!hasBase) missingBases.push(col.id)
    }

    const levelHasBeams = beams.some((bm) => sameLevelOrUnscoped(resolveNodeLevelId(params.nodes, bm), colLvl))
    if (levelHasBeams) {
      const hasCap = capConnectors.some((cap) => {
        if (!sameLevelOrUnscoped(resolveNodeLevelId(params.nodes, cap), colLvl)) return false
        return (
          (Array.isArray(cap.attachedNodeIds) && cap.attachedNodeIds.includes(col.id)) ||
          (Array.isArray(cap.position) && Math.hypot(cap.position[0] - cPos[0], cap.position[2] - cPos[2]) <= 0.45)
        )
      })
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
