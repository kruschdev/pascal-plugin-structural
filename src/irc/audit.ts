/**
 * Deterministic IRC / AWC NDS / WFCM / AISC structural scene code audit (`auditStructuralScene`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { deriveRequiredFirestops, isApprovedFirestopMaterial } from './fireblocking'
import { traceStructuralLoadPaths } from './load-path'
import { checkBeamEntry, sizeColumnAndFooting } from './sizing'
import {
  BEAM_CATALOG,
  type BeamMaterialFamily,
  type BeamRole,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
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

function segmentIntersectsBeam(
  a: Vec3,
  b: Vec3,
  beamStart: Vec2,
  beamEnd: Vec2,
  beamY: number,
  beamWidthM: number,
  beamDepthM: number,
): boolean {
  const minBy = beamY - beamDepthM / 2 - 0.02
  const maxBy = beamY + beamDepthM / 2 + 0.02
  const segMinY = Math.min(a[1], b[1])
  const segMaxY = Math.max(a[1], b[1])
  if (segMaxY < minBy || segMinY > maxBy) return false

  const bMinX = Math.min(beamStart[0], beamEnd[0]) - beamWidthM / 2
  const bMaxX = Math.max(beamStart[0], beamEnd[0]) + beamWidthM / 2
  const bMinZ = Math.min(beamStart[1], beamEnd[1]) - beamWidthM / 2
  const bMaxZ = Math.max(beamStart[1], beamEnd[1]) + beamWidthM / 2

  const segMinX = Math.min(a[0], b[0])
  const segMaxX = Math.max(a[0], b[0])
  const segMinZ = Math.min(a[2], b[2])
  const segMaxZ = Math.max(a[2], b[2])

  return segMaxX >= bMinX && segMinX <= bMaxX && segMaxZ >= bMinZ && segMinZ <= bMaxZ
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

    const entry =
      BEAM_CATALOG.find(
        (c) =>
          c.family === family &&
          Math.abs(c.widthIn - widthIn) < 0.35 &&
          Math.abs(c.depthIn - depthIn) < 0.75,
      ) ??
      BEAM_CATALOG.find((c) => c.designation === beam.designation) ??
      BEAM_CATALOG.find((c) => c.family === family) ??
      BEAM_CATALOG[0]!

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

  // 2. Audit columns & footings
  for (const col of columns) {
    const axial = typeof col.axialLoadLbs === 'number' ? col.axialLoadLbs : 4500
    const heightFt = (typeof col.heightM === 'number' ? col.heightM : 2.74) * METERS_TO_FEET
    const colCheck = sizeColumnAndFooting({
      axialLoadLbs: axial,
      unbracedHeightFt: heightFt,
      preferredType: col.columnType as ColumnType | undefined,
      soilBearingPsf: design.soilBearingPsf,
      frostDepthIn: design.frostDepthIn,
    })

    const actualFootingW = typeof col.footingWidthIn === 'number' ? col.footingWidthIn : 0
    if (actualFootingW > 0 && actualFootingW < colCheck.footingWidthIn - 1) {
      push({
        severity: 'error',
        category: 'column-footing',
        codeRef: 'IRC R403.1',
        nodeId: col.id,
        message: `Column "${col.name ?? col.id}" pad footing (${actualFootingW}" sq) is undersized for ${axial} lbs on ${design.soilBearingPsf} psf soil (needs ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}").`,
        remediation: `Enlarge footing to ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}" with ${colCheck.footingRebar}.`,
      })
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
  for (const fs of firestops) {
    const kind = fs.firestopKind as FirestopKind | undefined
    const mat = fs.material as FirestopMaterial | undefined
    if (kind && mat && !isApprovedFirestopMaterial(kind, mat)) {
      push({
        severity: 'error',
        category: 'fire-blocking',
        codeRef: 'IRC R302.11.1',
        nodeId: fs.id,
        message: `Firestop "${fs.name ?? fs.id}" uses unapproved material "${mat}" for ${kind}.`,
        remediation: 'Switch to a code-approved IRC R302.11.1 material (2x lumber, 23/32" OSB, 1/2" gypsum, mineral wool, or listed intumescent collar).',
      })
    }
  }

  const floorSys = (assemblies[0]?.floorSystem as 'dimensional' | 'tji-ijoist' | 'open-web-truss' | undefined) ?? 'dimensional'
  const requiredFs = deriveRequiredFirestops({ nodes, levelId: null, floorSystem: floorSys })
  const presentKinds = new Set(firestops.map((f) => String(f.firestopKind)))
  for (const req of requiredFs) {
    if (!presentKinds.has(req.firestopKind)) {
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
        severity: 'warning',
        category: 'bracing-shear',
        codeRef: bwl.codeRef,
        message: `Braced Wall Line ${bwl.id} (${bwl.axis}-axis): ${bwl.note}`,
        remediation: `Upgrade wall line ${bwl.id} to ${bwl.bracingMethod} (${bwl.edgeNailSpacingIn}" OC edge nailing, ${bwl.requiredHoldDownSku ?? 'HDU5-SDS2.5'} hold-downs).`,
      })
    }
  }

  // 6. Priority #1 Structural Right-of-Way: detect MEP runs boring through structural beams!
  for (const run of mepRuns) {
    const path = run.path as ReadonlyArray<Vec3>
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      for (const beam of beams) {
        const start = (beam.start as Vec2 | undefined) ?? [0, 0]
        const end = (beam.end as Vec2 | undefined) ?? [1, 0]
        const beamY = typeof beam.elevationY === 'number' ? beam.elevationY : 2.4
        const wM = (typeof beam.widthIn === 'number' ? beam.widthIn : 3.5) * INCHES_TO_METERS
        const dM = (typeof beam.depthIn === 'number' ? beam.depthIn : 11.875) * INCHES_TO_METERS
        if (segmentIntersectsBeam(a, b, start, end, beamY, wM, dM)) {
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: 'IRC R502.8 / Priority #1 Structural Right-of-Way',
            nodeId: beam.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural beam "${beam.name ?? beam.id}" (${beam.designation ?? beam.beamType}) — boring engineered beams/headers is prohibited.`,
            remediation: `Re-route ${run.type} below the beam soffit or through an adjacent open joist/TJI knockout bay.`,
          })
          break
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
