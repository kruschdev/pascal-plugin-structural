/**
 * Deterministic IRC / AWC NDS / WFCM / AISC structural scene code audit (`auditStructuralScene`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { deriveRequiredFirestops, isApprovedFirestopMaterial } from './fireblocking'
import { traceStructuralLoadPaths } from './load-path'
import { checkBeamEntry, checkColumnEntry, resolveBeamCatalogEntry } from './sizing'
import {
  type BeamMaterialFamily,
  type BeamRole,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
  FIRESTOP_RULES,
  type FirestopKind,
  type FirestopMaterial,
  INCHES_TO_METERS,
  METERS_TO_FEET,
  type SceneNodeLike,
  type StructuralDesignParams,
  type Vec2,
  type Vec3,
  getConnectorBySku,
} from './tables'

export type AuditSeverity = 'error' | 'warning' | 'info'

export type StructuralAuditFinding = {
  id: string
  severity: AuditSeverity
  category:
    | 'beam-sizing'
    | 'column-footing'
    | 'connector-hardware'
    | 'fire-blocking'
    | 'load-path'
    | 'bracing-shear'
    | 'mep-clash'
  codeRef: string
  nodeId?: string
  message: string
  remediation: string
}

export type StructuralAuditReport = {
  passed: boolean
  errorCount: number
  warningCount: number
  infoCount: number
  findings: StructuralAuditFinding[]
}

/**
 * True 3D segment vs. Oriented Bounding Box (OBB) intersection for angled/diagonal beams.
 * Transforms segment `a -> b` into beam-local `(u along beam, y vertical, n transverse)` space
 * and applies the exact Kay-Kajiya slab clipping test (eliminating diagonal AABB false positives).
 */
export function segmentIntersectsBeam(
  a: Vec3,
  b: Vec3,
  beamStart: Vec2,
  beamEnd: Vec2,
  beamY: number,
  beamWidthM: number,
  beamDepthM: number,
  mepRadiusM = 0.025,
): boolean {
  const bdx = beamEnd[0] - beamStart[0]
  const bdz = beamEnd[1] - beamStart[1]
  const beamLen = Math.hypot(bdx, bdz)
  if (beamLen < 1e-4) return false
  const ux = bdx / beamLen
  const uz = bdz / beamLen
  const nx = -uz
  const nz = ux

  const toLocal = (p: Vec3): [number, number, number] => {
    const rx = p[0] - beamStart[0]
    const rz = p[2] - beamStart[1]
    return [rx * ux + rz * uz, p[1] - beamY, rx * nx + rz * nz]
  }

  const la = toLocal(a)
  const lb = toLocal(b)
  const minB: [number, number, number] = [-mepRadiusM, -beamDepthM / 2 - mepRadiusM, -beamWidthM / 2 - mepRadiusM]
  const maxB: [number, number, number] = [beamLen + mepRadiusM, beamDepthM / 2 + mepRadiusM, beamWidthM / 2 + mepRadiusM]

  let tMin = 0
  let tMax = 1
  for (let axis = 0; axis < 3; axis++) {
    const o = la[axis]!
    const d = lb[axis]! - o
    const lo = minB[axis]!
    const hi = maxB[axis]!
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false
    } else {
      let t1 = (lo - o) / d
      let t2 = (hi - o) / d
      if (t1 > t2) [t1, t2] = [t2, t1]
      tMin = Math.max(tMin, t1)
      tMax = Math.min(tMax, t2)
      if (tMin > tMax) return false
    }
  }
  return tMax >= 0 && tMin <= 1
}

export function auditStructuralScene(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  designOverride?: Partial<StructuralDesignParams>,
): StructuralAuditReport {
  const all = Object.values(nodes)
  const assemblies = all.filter((n) => n.type === 'structural:assembly')
  const firstDesign = (assemblies[0]?.designParams as Partial<StructuralDesignParams> | undefined) ?? {}
  const design: StructuralDesignParams = {
    ...DEFAULT_DESIGN_PARAMS,
    ...firstDesign,
    ...designOverride,
  }

  const beams = all.filter((n) => n.type === 'structural:beam')
  const columns = all.filter((n) => n.type === 'structural:column')
  const connectors = all.filter((n) => n.type === 'structural:connector')
  const firestops = all.filter((n) => n.type === 'structural:firestop')
  const mepRuns = all.filter(
    (n) =>
      (n.type === 'plumbing:pipe-run' ||
        n.type === 'electrical:conduit-run' ||
        n.type === 'hvac:duct-run') &&
      Array.isArray(n.path) &&
      n.path.length >= 2,
  )

  const findings: StructuralAuditFinding[] = []
  let seq = 1
  const push = (f: Omit<StructuralAuditFinding, 'id'>) =>
    findings.push({ id: `STR-${String(seq++).padStart(3, '0')}`, ...f })

  // 1. Audit every structural:beam for bending, shear, L/360 deflection, bearing, and jack studs
  for (const beam of beams) {
    const start = (beam.start as Vec2 | undefined) ?? [0, 0]
    const end = (beam.end as Vec2 | undefined) ?? [1, 0]
    const spanFt = Math.max(1, Math.hypot(end[0] - start[0], end[1] - start[1]) * METERS_TO_FEET)
    const family = (beam.beamType as BeamMaterialFamily | undefined) ?? 'lvl'
    const widthIn = typeof beam.widthIn === 'number' ? beam.widthIn : 3.5
    const depthIn = typeof beam.depthIn === 'number' ? beam.depthIn : 11.875
    const role = (beam.role as BeamRole | undefined) ?? 'header'
    const tribFt = typeof beam.tributaryWidthFt === 'number' ? beam.tributaryWidthFt : 10

    const entry = resolveBeamCatalogEntry({
      designation: typeof beam.designation === 'string' ? beam.designation : undefined,
      family,
      widthIn,
      depthIn,
      plyCount: typeof beam.plyCount === 'number' ? beam.plyCount : undefined,
    })

    const check = checkBeamEntry(entry, {
      spanFt,
      tributaryWidthFt: tribFt,
      role,
      liveLoadPsf: typeof beam.liveLoadPsf === 'number' ? beam.liveLoadPsf : design.floorLiveLoadPsf,
      deadLoadPsf: typeof beam.deadLoadPsf === 'number' ? beam.deadLoadPsf : design.floorDeadLoadPsf,
      snowLoadPsf: typeof beam.snowLoadPsf === 'number' ? beam.snowLoadPsf : design.groundSnowPsf,
      species: design.species,
      storiesSupported: design.storiesAbove,
    })

    if (!check.passes) {
      push({
        severity: 'error',
        category: 'beam-sizing',
        codeRef: 'AWC NDS / IRC R602.7 / R502.5',
        nodeId: beam.id,
        message: `Beam "${beam.name ?? beam.id}" (${entry.designation}, ${spanFt.toFixed(1)} ft) fails ${check.governingCheck}: ${check.warnings.join('; ')}.`,
        remediation: `Upsize beam depth/plies (e.g., 3-ply LVL, Glulam, PSL, or A992 steel W-beam) or add an intermediate support column.`,
      })
    }

    const actualBearingIn = typeof beam.bearingLengthIn === 'number' ? beam.bearingLengthIn : 1.5
    if (actualBearingIn < check.requiredBearingIn - 0.05) {
      push({
        severity: 'error',
        category: 'beam-sizing',
        codeRef: 'IRC R502.6',
        nodeId: beam.id,
        message: `Beam "${beam.name ?? beam.id}" bearing (${actualBearingIn}") is below required ${check.requiredBearingIn}" for ${check.shearLbs} lb reaction.`,
        remediation: `Increase end bearing length to >= ${check.requiredBearingIn}" or install ${check.recommendedHangerSku} girder hanger.`,
      })
    }

    const actualJacks = typeof beam.jackStudsEachEnd === 'number' ? beam.jackStudsEachEnd : 1
    if (role === 'header' && actualJacks < check.jackStudsEachEnd) {
      push({
        severity: 'error',
        category: 'beam-sizing',
        codeRef: 'IRC Table R602.7(1)/(2)',
        nodeId: beam.id,
        message: `Header "${beam.name ?? beam.id}" has ${actualJacks} jack stud(s)/end but requires ${check.jackStudsEachEnd} jack studs/end for ${spanFt.toFixed(1)} ft span.`,
        remediation: `Add ${check.jackStudsEachEnd - actualJacks} additional trimmer/jack stud(s) at each opening jamb.`,
      })
    }
  }

  // 2. Audit actual placed column buckling capacity & spread footings
  for (const col of columns) {
    const axial = typeof col.axialLoadLbs === 'number' ? col.axialLoadLbs : 4500
    const heightFt = (typeof col.heightM === 'number' ? col.heightM : 2.74) * METERS_TO_FEET
    const colCheck = checkColumnEntry({
      designation: typeof col.designation === 'string' ? col.designation : undefined,
      columnType: col.columnType as ColumnType | undefined,
      widthIn: typeof col.widthIn === 'number' ? col.widthIn : undefined,
      depthIn: typeof col.depthIn === 'number' ? col.depthIn : undefined,
      axialLoadLbs: axial,
      unbracedHeightFt: heightFt,
      soilBearingPsf: design.soilBearingPsf,
      frostDepthIn: design.frostDepthIn,
    })

    if (!colCheck.passes) {
      push({
        severity: 'error',
        category: 'column-footing',
        codeRef: colCheck.codeRef,
        nodeId: col.id,
        message: `Column "${col.name ?? col.id}" (${colCheck.entry.designation}, ${heightFt.toFixed(1)} ft) is overstressed under ${axial} lbs (allowable ${colCheck.allowableAxialLbs} lbs, ${Math.round(colCheck.utilization * 100)}%).`,
        remediation: 'Upsize column section (e.g., 6x6 DF-L, 5-1/4" PSL, or Steel HSS 4x4x1/4).',
      })
    }

    const targetId = typeof col.transfersToNodeId === 'string' ? col.transfersToNodeId : ''
    const stacksToLowerCol = Boolean(
      targetId &&
        targetId !== col.id &&
        !targetId.startsWith('footing:') &&
        nodes[targetId]?.type === 'structural:column',
    )
    const actualFootingW = typeof col.footingWidthIn === 'number' ? col.footingWidthIn : 0
    const actualFootingD = typeof col.footingDepthIn === 'number' ? col.footingDepthIn : 0
    if (!stacksToLowerCol) {
      if (actualFootingW <= 0) {
        push({
          severity: 'error',
          category: 'column-footing',
          codeRef: 'IRC R403.1',
          nodeId: col.id,
          message: `Column "${col.name ?? col.id}" has no spread/pad footing and does not stack onto a verified lower column.`,
          remediation: `Provide a ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}" spread footing with ${colCheck.footingRebar}.`,
        })
      } else if (actualFootingW < colCheck.footingWidthIn - 1 || actualFootingD < colCheck.footingDepthIn - 1) {
        push({
          severity: 'error',
          category: 'column-footing',
          codeRef: 'IRC R403.1',
          nodeId: col.id,
          message: `Column "${col.name ?? col.id}" pad footing (${actualFootingW}" sq x ${actualFootingD || 0}" deep) is undersized for ${axial} lbs on ${design.soilBearingPsf} psf soil (needs ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}").`,
          remediation: `Enlarge footing to ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}" with ${colCheck.footingRebar}.`,
        })
      }
    }
  }

  // 3. Audit connectors & hardware catalog validity
  for (const con of connectors) {
    const sku = String(con.sku ?? '')
    const catalog = getConnectorBySku(sku)
    if (!catalog) {
      push({
        severity: 'warning',
        category: 'connector-hardware',
        codeRef: 'IRC R502.6.2 / R802.11',
        nodeId: con.id,
        message: `Connector "${con.name ?? con.id}" uses unlisted SKU "${sku}".`,
        remediation: 'Select a verified Simpson-class SKU from CONNECTOR_CATALOG with published ASD uplift/download ratings.',
      })
    }
  }

  // 4. Audit Fire Blocking & Draftstopping completeness + approved materials (IRC R302.11 / R302.12)
  const validFirestops: SceneNodeLike[] = []
  for (const fs of firestops) {
    const kind = fs.firestopKind as FirestopKind | undefined
    const mat = fs.material as FirestopMaterial | undefined
    if (!kind || !(kind in FIRESTOP_RULES)) {
      push({
        severity: 'error',
        category: 'fire-blocking',
        codeRef: 'IRC R302.11',
        nodeId: fs.id,
        message: `Firestop "${fs.name ?? fs.id}" has missing or unrecognized firestopKind "${String(kind ?? '')}".`,
        remediation: 'Assign a valid IRC R302.11 / R302.12 firestopKind.',
      })
      continue
    }
    if (!mat || !isApprovedFirestopMaterial(kind, mat)) {
      push({
        severity: 'error',
        category: 'fire-blocking',
        codeRef: 'IRC R302.11.1',
        nodeId: fs.id,
        message: `Firestop "${fs.name ?? fs.id}" uses missing or unapproved material "${String(mat ?? 'none')}" for ${kind}.`,
        remediation: 'Switch to a code-approved IRC R302.11.1 material (2x lumber, 23/32" OSB, 1/2" gypsum, mineral wool, or listed intumescent collar).',
      })
      continue
    }
    validFirestops.push(fs)
  }

  const floorSys = (assemblies[0]?.floorSystem as 'dimensional' | 'tji-ijoist' | 'open-web-truss' | undefined) ?? 'dimensional'
  const requiredFs = deriveRequiredFirestops({ nodes, levelId: null, floorSystem: floorSys })
  const midOf = (s?: Vec2, e?: Vec2): Vec2 => [
    ((s?.[0] ?? 0) + (e?.[0] ?? 0)) / 2,
    ((s?.[1] ?? 0) + (e?.[1] ?? 0)) / 2,
  ]
  for (const req of requiredFs) {
    const reqMid = midOf(req.start, req.end)
    const matched = validFirestops.some((fs) => {
      if (fs.firestopKind !== req.firestopKind) return false
      const elevDiff = Math.abs((typeof fs.elevationY === 'number' ? fs.elevationY : req.elevationY) - req.elevationY)
      if (elevDiff > 0.75) return false
      if (req.hostWallId && fs.hostWallId) return fs.hostWallId === req.hostWallId
      if (req.penetratingNodeId && fs.penetratingNodeId) return fs.penetratingNodeId === req.penetratingNodeId
      const fsMid = midOf(fs.start as Vec2 | undefined, fs.end as Vec2 | undefined)
      const distPlan = Math.hypot(fsMid[0] - reqMid[0], fsMid[1] - reqMid[1])
      return distPlan <= 1.25
    })
    if (!matched) {
      push({
        severity: 'error',
        category: 'fire-blocking',
        codeRef: req.codeRef,
        nodeId: req.hostWallId ?? req.penetratingNodeId,
        message: `Missing required ${req.codeRef} fire blocking / draftstopping: ${req.label}.`,
        remediation: `Place a structural:firestop (${req.firestopKind}) using ${req.material}.`,
      })
    }
  }

  // 5. Continuous gravity & uplift load-path + IRC R602.10 Braced Wall Lines
  const lp = traceStructuralLoadPaths({ nodes, design })
  for (const link of lp.gravityLinks) {
    if (!link.continuous || link.issue) {
      push({
        severity: 'error',
        category: 'load-path',
        codeRef: link.requiresSquashBlock ? 'IRC R502.1.2' : 'IRC R502.6 / R403.1',
        nodeId: link.fromNodeId,
        message: link.issue ?? `Broken gravity load path from ${link.fromNodeId}.`,
        remediation: link.requiresSquashBlock
          ? 'Install 2x4 squash blocks alongside TJI I-joists under concentrated column load.'
          : 'Add a bearing column stacked to a sized spread footing or bearing wall below.',
      })
    }
  }
  for (const uf of lp.upliftFindings) {
    push({
      severity: 'error',
      category: 'connector-hardware',
      codeRef: 'IRC R802.11 / WFCM',
      message: uf,
      remediation: 'Add the required roof hurricane ties, wall/floor tension straps, post caps/bases, and foundation hold-downs.',
    })
  }
  for (const bwl of lp.bracedWallLines) {
    if (!bwl.passes) {
      push({
        severity: 'error',
        category: 'bracing-shear',
        codeRef: bwl.codeRef,
        message: `Braced Wall Line ${bwl.id} (${bwl.axis}-axis): ${bwl.note}`,
        remediation: `Upgrade wall line ${bwl.id} to ${bwl.bracingMethod} (${bwl.edgeNailSpacingIn}" OC edge nailing, ${bwl.requiredHoldDownSku ?? 'HDU5-SDS2.5'} hold-downs).`,
      })
    }
  }

  // 6. Priority #1 Structural Right-of-Way: detect MEP runs boring through structural beams (deduped per run/beam, checking all beams)!
  const reportedClashes = new Set<string>()
  for (const run of mepRuns) {
    const path = run.path as ReadonlyArray<Vec3>
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      for (const beam of beams) {
        const clashKey = `${run.id}::${beam.id}`
        if (reportedClashes.has(clashKey)) continue
        const start = (beam.start as Vec2 | undefined) ?? [0, 0]
        const end = (beam.end as Vec2 | undefined) ?? [1, 0]
        const beamY = typeof beam.elevationY === 'number' ? beam.elevationY : 2.4
        const wM = (typeof beam.widthIn === 'number' ? beam.widthIn : 3.5) * INCHES_TO_METERS
        const dM = (typeof beam.depthIn === 'number' ? beam.depthIn : 11.875) * INCHES_TO_METERS
        if (segmentIntersectsBeam(a, b, start, end, beamY, wM, dM)) {
          reportedClashes.add(clashKey)
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: 'IRC R502.8 / Priority #1 Structural Right-of-Way',
            nodeId: beam.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural beam "${beam.name ?? beam.id}" (${beam.designation ?? beam.beamType}) — boring engineered beams/headers is prohibited.`,
            remediation: `Re-route ${run.type} below the beam soffit or through an adjacent open joist/TJI knockout bay.`,
          })
        }
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const infoCount = findings.filter((f) => f.severity === 'info').length

  return {
    passed: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  }
}
