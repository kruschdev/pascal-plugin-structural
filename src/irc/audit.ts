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
  belongsToLevel,
  getConnectorBySku,
  resolveNodeLevelId,
  sameLevelOrUnscoped,
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

export type MepRunExtents = {
  halfXZ: number
  halfY: number
}

const PLUMBING_PIPE_HALF_OD_M: Readonly<Record<string, number>> = {
  '1/2': 0.008,
  '3/4': 0.011,
  '1': 0.015,
  '1-1/4': 0.021,
  '1-1/2': 0.024,
  '2': 0.030,
  '2-1/2': 0.0365,
  '3': 0.044,
  '4': 0.057,
  '6': 0.084,
}

const ELECTRICAL_CONDUIT_HALF_OD_M: Readonly<Record<string, number>> = {
  '1/2': 0.011,
  '3/4': 0.013,
  '1': 0.017,
  '1-1/4': 0.021,
  '1-1/2': 0.024,
  '2': 0.030,
  '2-1/2': 0.036,
  '3': 0.044,
  '4': 0.057,
}

function normalizeNominalInchKey(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return String(raw)
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/["'″\s]+/g, '')
  return cleaned.length > 0 ? cleaned : null
}

function parseNominalInches(key: string): number | null {
  const mixed = /^(\d+)-(\d+)\/(\d+)$/.exec(key)
  if (mixed) {
    const den = Number(mixed[3])
    if (den > 0) return Number(mixed[1]) + Number(mixed[2]) / den
  }
  const frac = /^(\d+)\/(\d+)$/.exec(key)
  if (frac) {
    const den = Number(frac[2])
    if (den > 0) return Number(frac[1]) / den
  }
  const num = Number(key)
  return Number.isFinite(num) && num > 0 ? num : null
}

/**
 * Resolve real physical half-extents (`halfXZ`, `halfY` in meters) for HVAC ducts,
 * plumbing pipes, and electrical conduits so structural beam/column clash checks catch
 * large ducts (e.g., 14"x8") and 3"/4" DWV stacks without over-inflating 1/2" PEX/EMT.
 */
export function resolveMepRunExtents(run: SceneNodeLike): MepRunExtents {
  if (run.type === 'hvac:duct-run') {
    if (run.shape === 'rectangular') {
      const widthIn =
        typeof run.width === 'number' && Number.isFinite(run.width) && run.width > 0 ? run.width : 10
      const heightIn =
        typeof run.height === 'number' && Number.isFinite(run.height) && run.height > 0 ? run.height : 8
      return {
        halfXZ: Math.max(0.025, (widthIn * INCHES_TO_METERS) / 2),
        halfY: Math.max(0.025, (heightIn * INCHES_TO_METERS) / 2),
      }
    }
    const diaIn =
      typeof run.diameter === 'number' && Number.isFinite(run.diameter) && run.diameter > 0
        ? run.diameter
        : typeof run.width === 'number' && Number.isFinite(run.width) && run.width > 0
          ? run.width
          : 6
    const r = Math.max(0.015, (diaIn * INCHES_TO_METERS) / 2)
    return { halfXZ: r, halfY: r }
  }

  if (run.type === 'plumbing:pipe-run') {
    const key = normalizeNominalInchKey(run.nominalSize ?? run.diameter)
    if (key) {
      if (key in PLUMBING_PIPE_HALF_OD_M) {
        const r = PLUMBING_PIPE_HALF_OD_M[key]!
        return { halfXZ: r, halfY: r }
      }
      const inches = parseNominalInches(key)
      if (inches !== null) {
        const r = Math.max(0.008, (inches * 1.12 * INCHES_TO_METERS) / 2)
        return { halfXZ: r, halfY: r }
      }
    }
    return { halfXZ: 0.025, halfY: 0.025 }
  }

  if (run.type === 'electrical:conduit-run') {
    const key = normalizeNominalInchKey(run.tradeSize)
    if (key) {
      if (key in ELECTRICAL_CONDUIT_HALF_OD_M) {
        const r = ELECTRICAL_CONDUIT_HALF_OD_M[key]!
        return { halfXZ: r, halfY: r }
      }
      const inches = parseNominalInches(key)
      if (inches !== null) {
        const r = Math.max(0.011, (inches * 1.12 * INCHES_TO_METERS) / 2)
        return { halfXZ: r, halfY: r }
      }
    }
    return { halfXZ: 0.014, halfY: 0.014 }
  }

  return { halfXZ: 0.025, halfY: 0.025 }
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
  mepExtents: number | MepRunExtents = 0.025,
): boolean {
  const halfXZ = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfXZ
  const halfY = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfY
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
  const minB: [number, number, number] = [-halfXZ, -beamDepthM / 2 - halfY, -beamWidthM / 2 - halfXZ]
  const maxB: [number, number, number] = [beamLen + halfXZ, beamDepthM / 2 + halfY, beamWidthM / 2 + halfXZ]

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

/**
 * True 3D segment vs. structural column box (OBB honoring `rotationY` around Y).
 * Column local shaft spans `X: [-widthM/2, +widthM/2]`, `Y: [0, heightM]`, `Z: [-depthM/2, +depthM/2]`.
 */
export function segmentIntersectsColumn(
  a: Vec3,
  b: Vec3,
  colPos: Vec3,
  widthM: number,
  depthM: number,
  heightM: number,
  rotationY = 0,
  mepExtents: number | MepRunExtents = 0.025,
): boolean {
  if (heightM <= 1e-4 || widthM <= 1e-4 || depthM <= 1e-4) return false
  const halfXZ = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfXZ
  const halfY = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfY
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  // Inverse of Three.js Ry(rot): localX = dx*cos - dz*sin, localZ = dx*sin + dz*cos
  const toLocal = (p: Vec3): [number, number, number] => {
    const dx = p[0] - colPos[0]
    const dy = p[1] - colPos[1]
    const dz = p[2] - colPos[2]
    return [dx * cos - dz * sin, dy, dx * sin + dz * cos]
  }
  const la = toLocal(a)
  const lb = toLocal(b)
  const minB: [number, number, number] = [-widthM / 2 - halfXZ, -halfY, -depthM / 2 - halfXZ]
  const maxB: [number, number, number] = [widthM / 2 + halfXZ, heightM + halfY, depthM / 2 + halfXZ]

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
  const designForNode = (node: SceneNodeLike): StructuralDesignParams => {
    const nodeLvl = resolveNodeLevelId(nodes, node)
    const lvlAsm = nodeLvl ? assemblies.find((a) => resolveNodeLevelId(nodes, a) === nodeLvl) : undefined
    const asmDesign = ((lvlAsm ?? assemblies[0])?.designParams as Partial<StructuralDesignParams> | undefined) ?? {}
    return {
      ...DEFAULT_DESIGN_PARAMS,
      ...asmDesign,
      ...designOverride,
    }
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

    const nodeDesign = designForNode(beam)
    const check = checkBeamEntry(entry, {
      spanFt,
      tributaryWidthFt: tribFt,
      role,
      liveLoadPsf: typeof beam.liveLoadPsf === 'number' ? beam.liveLoadPsf : nodeDesign.floorLiveLoadPsf,
      deadLoadPsf: typeof beam.deadLoadPsf === 'number' ? beam.deadLoadPsf : nodeDesign.floorDeadLoadPsf,
      snowLoadPsf: typeof beam.snowLoadPsf === 'number' ? beam.snowLoadPsf : nodeDesign.groundSnowPsf,
      species: typeof beam.species === 'string' ? (beam.species as StructuralDesignParams['species']) : nodeDesign.species,
      storiesSupported: nodeDesign.storiesAbove,
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
    const colDesign = designForNode(col)
    const axial = typeof col.axialLoadLbs === 'number' ? col.axialLoadLbs : 4500
    const heightFt = (typeof col.heightM === 'number' ? col.heightM : 2.74) * METERS_TO_FEET
    const colCheck = checkColumnEntry({
      designation: typeof col.designation === 'string' ? col.designation : undefined,
      columnType: col.columnType as ColumnType | undefined,
      widthIn: typeof col.widthIn === 'number' ? col.widthIn : undefined,
      depthIn: typeof col.depthIn === 'number' ? col.depthIn : undefined,
      axialLoadLbs: axial,
      unbracedHeightFt: heightFt,
      soilBearingPsf: colDesign.soilBearingPsf,
      frostDepthIn: colDesign.frostDepthIn,
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
        !targetId.startsWith('footing_') &&
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
          message: `Column "${col.name ?? col.id}" pad footing (${actualFootingW}" sq x ${actualFootingD || 0}" deep) is undersized for ${axial} lbs on ${colDesign.soilBearingPsf} psf soil (needs ${colCheck.footingWidthIn}"x${colCheck.footingWidthIn}"x${colCheck.footingDepthIn}").`,
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

  // Scope required vs. placed firestops strictly per level (and derive hasAttic per level so R302.12.1 is audited)
  const explicitLevels = all.filter((n) => n.type === 'level').map((n) => n.id)
  const inferredLevels = new Set<string>(explicitLevels)
  let hasUnscopedFirestopSources = false
  for (const n of all) {
    const isFirestopSource =
      n.type === 'wall' ||
      n.type === 'slab' ||
      n.type === 'stair' ||
      n.type === 'stairs' ||
      n.type === 'zone' ||
      n.type === 'room' ||
      n.type === 'roof' ||
      n.type === 'roof-segment' ||
      n.type === 'plumbing:pipe-run' ||
      n.type === 'electrical:conduit-run' ||
      n.type === 'hvac:duct-run'
    if (isFirestopSource || n.type.startsWith('structural:')) {
      const lvl = resolveNodeLevelId(nodes, n)
      if (lvl) inferredLevels.add(lvl)
      else if (isFirestopSource) hasUnscopedFirestopSources = true
    }
  }
  const auditPasses: Array<{ lvlId: string | null; scopeNodes: Readonly<Record<string, SceneNodeLike>> }> =
    inferredLevels.size > 0
      ? [...inferredLevels].map((lvlId) => ({ lvlId, scopeNodes: nodes }))
      : [{ lvlId: null, scopeNodes: nodes }]

  if (inferredLevels.size > 0 && hasUnscopedFirestopSources) {
    const unscopedNodes: Record<string, SceneNodeLike> = {}
    for (const [id, n] of Object.entries(nodes)) {
      if (resolveNodeLevelId(nodes, n) === null) unscopedNodes[id] = n
    }
    auditPasses.push({ lvlId: null, scopeNodes: unscopedNodes })
  }

  const midOf = (s?: Vec2, e?: Vec2): Vec2 => [
    ((s?.[0] ?? 0) + (e?.[0] ?? 0)) / 2,
    ((s?.[1] ?? 0) + (e?.[1] ?? 0)) / 2,
  ]

  for (const { lvlId, scopeNodes } of auditPasses) {
    const lvlAsm = lvlId
      ? assemblies.find((a) => resolveNodeLevelId(nodes, a) === lvlId)
      : assemblies.find((a) => resolveNodeLevelId(nodes, a) === null) ?? assemblies[0]
    const floorSys =
      (lvlAsm?.floorSystem as 'dimensional' | 'tji-ijoist' | 'open-web-truss' | undefined) ?? 'dimensional'
    const hasRoofNode = Object.values(scopeNodes).some(
      (n) => (n.type === 'roof' || n.type === 'roof-segment') && belongsToLevel(scopeNodes, n, lvlId),
    )
    const hasAttic = lvlAsm
      ? lvlAsm.roofSystem !== 'ridge-beam-cathedral' &&
        (hasRoofNode || (lvlAsm.visibleSystems as Record<string, boolean> | undefined)?.roof !== false)
      : hasRoofNode

    const requiredFs = deriveRequiredFirestops({
      nodes: scopeNodes,
      levelId: lvlId,
      floorSystem: floorSys,
      hasAttic,
    })
    const lvlValidFirestops = validFirestops.filter((fs) =>
      sameLevelOrUnscoped(resolveNodeLevelId(nodes, fs), lvlId),
    )

    for (const req of requiredFs) {
      const reqMid = midOf(req.start, req.end)
      const matched = lvlValidFirestops.some((fs) => {
        if (fs.firestopKind !== req.firestopKind) return false
        const elevDiff = Math.abs((typeof fs.elevationY === 'number' ? fs.elevationY : req.elevationY) - req.elevationY)
        if (elevDiff > 0.75) return false
        if (req.hostWallId && fs.hostWallId) return fs.hostWallId === req.hostWallId
        const fsMid = midOf(fs.start as Vec2 | undefined, fs.end as Vec2 | undefined)
        const distPlan = Math.hypot(fsMid[0] - reqMid[0], fsMid[1] - reqMid[1])
        if (req.penetratingNodeId && fs.penetratingNodeId) {
          return fs.penetratingNodeId === req.penetratingNodeId && distPlan <= 1.25
        }
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

  // 6. Priority #1 Structural Right-of-Way: detect MEP runs boring through structural beams & columns (strictly per level)!
  const reportedClashes = new Set<string>()
  for (const run of mepRuns) {
    const runLvl = resolveNodeLevelId(nodes, run)
    const mepExtents = resolveMepRunExtents(run)
    const path = run.path as ReadonlyArray<Vec3>
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      for (const beam of beams) {
        if (!sameLevelOrUnscoped(runLvl, resolveNodeLevelId(nodes, beam))) continue
        const clashKey = `${run.id}::${beam.id}`
        if (reportedClashes.has(clashKey)) continue
        const start = (beam.start as Vec2 | undefined) ?? [0, 0]
        const end = (beam.end as Vec2 | undefined) ?? [1, 0]
        const beamY = typeof beam.elevationY === 'number' ? beam.elevationY : 2.4
        const wM = (typeof beam.widthIn === 'number' ? beam.widthIn : 3.5) * INCHES_TO_METERS
        const dM = (typeof beam.depthIn === 'number' ? beam.depthIn : 11.875) * INCHES_TO_METERS
        if (segmentIntersectsBeam(a, b, start, end, beamY, wM, dM, mepExtents)) {
          reportedClashes.add(clashKey)
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: 'IRC R502.8 / Priority #1 Structural Right-of-Way',
            nodeId: beam.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural beam "${beam.name ?? beam.id}" (${beam.designation ?? beam.beamType}); boring engineered beams or headers is prohibited.`,
            remediation: `Re-route ${run.type} below the beam soffit or through an adjacent open joist/TJI knockout bay.`,
          })
        }
      }
      for (const col of columns) {
        if (!sameLevelOrUnscoped(runLvl, resolveNodeLevelId(nodes, col))) continue
        const clashKey = `${run.id}::${col.id}`
        if (reportedClashes.has(clashKey)) continue
        const colPos = (col.position as Vec3 | undefined) ?? [0, 0, 0]
        const wM = (typeof col.widthIn === 'number' ? col.widthIn : 5.5) * INCHES_TO_METERS
        const dM = (typeof col.depthIn === 'number' ? col.depthIn : 5.5) * INCHES_TO_METERS
        const hM = typeof col.heightM === 'number' ? col.heightM : 2.7432
        const rotY =
          typeof col.rotation === 'number'
            ? col.rotation
            : Array.isArray(col.rotation) && typeof col.rotation[1] === 'number'
              ? col.rotation[1]
              : 0
        if (segmentIntersectsColumn(a, b, colPos, wM, dM, hM, rotY, mepExtents)) {
          reportedClashes.add(clashKey)
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: 'IRC R502.8 / Priority #1 Structural Right-of-Way',
            nodeId: col.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural column "${col.name ?? col.id}" (${col.designation ?? col.columnType}); piercing load-bearing columns is prohibited.`,
            remediation: `Re-route ${run.type} horizontally around the structural column shaft with >= 1 in clearance.`,
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
