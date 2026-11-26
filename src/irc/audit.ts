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
  findLevelCommercialRtus,
  getConnectorBySku,
  isHighestWalledLevelInBuilding,
  levelSortOrder,
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
    let isAdoptedUnwalledRoofLevel = false
    if (lvlId !== null && !lvlAsm) {
      const lvlNode = nodes[lvlId]
      const lvlBuildingId = typeof lvlNode?.parentId === 'string' ? lvlNode.parentId : null
      const hasSameBuildingAssembly = assemblies.some((a) => {
        const asmLvlId = resolveNodeLevelId(nodes, a)
        if (!asmLvlId || asmLvlId === lvlId) return false
        const asmLvlNode = nodes[asmLvlId]
        const asmBuildingId = typeof asmLvlNode?.parentId === 'string' ? asmLvlNode.parentId : null
        if (lvlBuildingId || asmBuildingId) return lvlBuildingId === asmBuildingId
        return true
      })
      if (hasSameBuildingAssembly) {
        const lvlScopedNodes = Object.values(scopeNodes).filter((n) => belongsToLevel(scopeNodes, n, lvlId))
        const lvlHasWalls = lvlScopedNodes.some((n) => n.type === 'wall' && n.visible !== false)
        const lvlHasStructural = lvlScopedNodes.some(
          (n) => String(n.type ?? '').startsWith('structural:') && n.type !== 'structural:firestop',
        )
        // Suppress only concealed-cavity draftstops on adopted wall-less roof-deck levels in the same building,
        // while still auditing IRC R302.11(3) stair stringers and R302.11(5) MEP plate penetrations.
        if (!lvlHasWalls && !lvlHasStructural) {
          isAdoptedUnwalledRoofLevel = true
        }
      }
    }
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
    }).filter((req) =>
      isAdoptedUnwalledRoofLevel
        ? req.firestopKind !== 'floor-draftstop' && req.firestopKind !== 'attic-draftstop'
        : true,
    )
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

  // 7. Roof-rafter-plane & exterior-envelope MEP intrusion diagnostics (VIS-07)
  const OUTDOOR_OR_ROOF_EQUIP_RE =
    /condenser|heat-pump-outdoor|mini-split-outdoor|rooftop-package|\brtu\b|gas-meter|hose[- ]?bibb|well|outdoor/i
  const EXTERIOR_MEP_RUN_RE =
    /refrigerant-lineset|condensate|exhaust|fresh-air|intake|building-drain|sewer|gas|hose[- ]?bibb|outdoor|condenser|\brtu\b/i
  const isMainDwvVentStack = (n: SceneNodeLike): boolean =>
    Boolean(n.isMainVentStack) || /Main DWV Soil & Vent Stack|Through Roof/i.test(String(n.name ?? ''))

  type AuditRoofSeg = {
    cx: number
    cy: number
    cz: number
    yaw: number
    roofType: string
    widthM: number
    depthM: number
    pitchRad: number
    overhangM: number
  }

  const extractAuditRoofSegsForLevel = (
    targetLvlId: string | null,
    wallH: number,
    baseY: number,
  ): AuditRoofSeg[] => {
    const segs: AuditRoofSeg[] = []
    const targetLevelNode = targetLvlId ? nodes[targetLvlId] : undefined
    const targetBuildingId = typeof targetLevelNode?.parentId === 'string' ? targetLevelNode.parentId : null
    const targetOrder = targetLevelNode?.type === 'level' ? levelSortOrder(targetLevelNode) : 0

    for (const node of all) {
      if (node.type !== 'roof-segment' || node.visible === false) continue
      const segPos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
      let px = typeof segPos[0] === 'number' ? segPos[0] : 0
      let py = typeof segPos[1] === 'number' ? segPos[1] : 0
      let pz = typeof segPos[2] === 'number' ? segPos[2] : 0
      let yaw = typeof node.rotation === 'number' ? node.rotation : 0

      let curParentId = typeof node.parentId === 'string' ? node.parentId : null
      let belongsHere = !targetLvlId
      for (let hop = 0; hop < 6 && curParentId; hop++) {
        if (!targetLvlId || curParentId === targetLvlId) {
          belongsHere = true
          break
        }
        const parent = nodes[curParentId]
        if (!parent) break
        if (parent.type === 'level') {
          const pBuildingId = typeof parent.parentId === 'string' ? parent.parentId : null
          const sameBldg = !targetBuildingId || !pBuildingId || targetBuildingId === pBuildingId
          const parentHasWalls = all.some(
            (w) => w.type === 'wall' && w.visible !== false && belongsToLevel(nodes, w, parent.id),
          )
          if (sameBldg && !parentHasWalls && levelSortOrder(parent) >= targetOrder && isHighestWalledLevelInBuilding(nodes, targetLvlId)) {
            belongsHere = true
          }
          break
        }
        if (parent.type === 'roof') {
          const rot = typeof parent.rotation === 'number' ? parent.rotation : 0
          const rp = Array.isArray(parent.position) ? (parent.position as number[]) : [0, 0, 0]
          const cos = Math.cos(rot)
          const sin = Math.sin(rot)
          const nx = px * cos + pz * sin
          const nz = -px * sin + pz * cos
          px = nx + (typeof rp[0] === 'number' ? rp[0] : 0)
          py += typeof rp[1] === 'number' ? rp[1] : 0
          pz = nz + (typeof rp[2] === 'number' ? rp[2] : 0)
          yaw += rot
        }
        curParentId = typeof parent.parentId === 'string' ? parent.parentId : null
      }
      if (!belongsHere) continue

      const widthM = typeof node.width === 'number' && node.width > 0.2 ? node.width : 6.0
      const depthM = typeof node.depth === 'number' && node.depth > 0.2 ? node.depth : 6.0
      const rawPitch = typeof node.pitch === 'number' && Number.isFinite(node.pitch) ? node.pitch : 26.57
      const pitchRad =
        rawPitch <= 0
          ? 0
          : rawPitch > 1.4
            ? (Math.min(65, rawPitch) * Math.PI) / 180
            : Math.min((65 * Math.PI) / 180, rawPitch)
      const overhangM = typeof node.overhang === 'number' && node.overhang >= 0 ? node.overhang : 0.35
      const segWallH = typeof node.wallHeight === 'number' && node.wallHeight >= 0 ? node.wallHeight : 0
      const cy = py > 0.05 ? py + segWallH : baseY + wallH + segWallH
      segs.push({
        cx: px,
        cy,
        cz: pz,
        yaw,
        roofType: typeof node.roofType === 'string' ? node.roofType : 'gable',
        widthM,
        depthM,
        pitchRad,
        overhangM,
      })
    }
    return segs
  }

  const evalAuditRoofSurfaceY = (
    x: number,
    z: number,
    roofSegs: readonly AuditRoofSeg[],
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    baseY: number,
    wallH: number,
    pitchRiseOver12: number,
    isFlatCommercialRoof: boolean,
  ): number => {
    if (isFlatCommercialRoof) {
      return baseY + wallH + 0.2858
    }
    if (roofSegs.length > 0) {
      let bestY: number | null = null
      for (const seg of roofSegs) {
        const cosR = Math.cos(seg.yaw)
        const sinR = Math.sin(seg.yaw)
        const dx = x - seg.cx
        const dz = z - seg.cz
        const lx = dx * cosR - dz * sinR
        const lz = dx * sinR + dz * cosR
        if (Math.abs(lx) > seg.widthM / 2 + 0.15 || Math.abs(lz) > seg.depthM / 2 + seg.overhangM + 0.15) {
          continue
        }
        const slopeTan = Math.tan(seg.pitchRad)
        const sy =
          seg.roofType === 'shed'
            ? seg.cy + Math.max(0, seg.depthM / 2 - lz) * slopeTan
            : seg.cy + Math.max(0, seg.depthM / 2 - Math.abs(lz)) * slopeTan
        if (bestY === null || sy > bestY) bestY = sy
      }
      if (bestY !== null) return bestY
    }
    const spanX = bounds.maxX - bounds.minX
    const spanZ = bounds.maxZ - bounds.minZ
    const ridgeAlongX = spanX >= spanZ
    const halfSpan = (ridgeAlongX ? spanZ : spanX) / 2
    const center = ridgeAlongX ? (bounds.minZ + bounds.maxZ) / 2 : (bounds.minX + bounds.maxX) / 2
    const distFromRidge = Math.abs((ridgeAlongX ? z : x) - center)
    return baseY + wallH + Math.max(0, halfSpan - distFromRidge) * (pitchRiseOver12 / 12)
  }

  for (const { lvlId, scopeNodes } of auditPasses) {
    const lvlScopedNodes = Object.values(scopeNodes).filter((n) => belongsToLevel(scopeNodes, n, lvlId))
    const lvlWalls = lvlScopedNodes.filter(
      (n) => n.type === 'wall' && n.visible !== false && Array.isArray(n.start) && Array.isArray(n.end),
    )
    if (lvlWalls.length < 2) continue

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let baseY = Number.POSITIVE_INFINITY
    let maxWallH = 0
    for (const w of lvlWalls) {
      const ws = w.start!
      const we = w.end!
      if (Number.isFinite(ws[0]) && Number.isFinite(ws[1]) && Number.isFinite(we[0]) && Number.isFinite(we[1])) {
        minX = Math.min(minX, ws[0], we[0])
        maxX = Math.max(maxX, ws[0], we[0])
        minZ = Math.min(minZ, ws[1], we[1])
        maxZ = Math.max(maxZ, ws[1], we[1])
      }
      const elev = typeof w.elevation === 'number' && Number.isFinite(w.elevation) ? w.elevation : 0
      if (elev < baseY) baseY = elev
      const h = typeof w.height === 'number' && Number.isFinite(w.height) && w.height > 1.2 ? w.height : 0
      if (h > maxWallH) maxWallH = h
    }
    if (!Number.isFinite(minX) || maxX - minX < 1.0 || maxZ - minZ < 1.0) continue
    if (!Number.isFinite(baseY)) baseY = 0
    const levelNode = lvlId ? nodes[lvlId] : undefined
    const wallH =
      maxWallH > 1.5
        ? maxWallH
        : typeof levelNode?.height === 'number' && Number.isFinite(levelNode.height) && levelNode.height > 1.5
          ? levelNode.height
          : 2.7
    const bounds = { minX, maxX, minZ, maxZ }
    const isTopWalledLevel = isHighestWalledLevelInBuilding(nodes, lvlId)
    const lvlAsm = lvlId
      ? assemblies.find((a) => resolveNodeLevelId(nodes, a) === lvlId)
      : assemblies.find((a) => resolveNodeLevelId(nodes, a) === null) ?? assemblies[0]
    const pitchRise =
      typeof lvlAsm?.roofPitchRise === 'number' && Number.isFinite(lvlAsm.roofPitchRise)
        ? lvlAsm.roofPitchRise
        : 6
    const levelRoofSegs = isTopWalledLevel ? extractAuditRoofSegsForLevel(lvlId, wallH, baseY) : []
    const hasCommercialRtu = findLevelCommercialRtus(nodes, lvlId).length > 0
    const isFlatCommercialRoof = hasCommercialRtu && levelRoofSegs.length === 0

    for (const n of lvlScopedNodes) {
      if (n.visible === false) continue
      const t = String(n.type ?? '')

      // 7a. Indoor MEP equipment & plenums vs. roof plane and building wall envelope
      if (t === 'hvac:equipment' || t === 'hvac:plenum' || t === 'plumbing:equipment') {
        const pos = n.position
        if (!Array.isArray(pos) || pos.length < 3) continue
        const kind = String(n.equipmentKind ?? n.kind ?? '')
        const isOutdoorOrRoof =
          n.isOutdoor === true || OUTDOOR_OR_ROOF_EQUIP_RE.test(`${kind} ${String(n.name ?? '')}`)
        if (isOutdoorOrRoof) continue

        const hM =
          typeof n.heightM === 'number' && Number.isFinite(n.heightM) && n.heightM > 0
            ? n.heightM
            : /air-handler|furnace/i.test(kind)
              ? 1.22
              : /water-heater/i.test(kind)
                ? 1.5
                : t === 'hvac:plenum'
                  ? 0.45
                  : 0.6
        const topY = pos[1] + hM
        const insideBounds =
          pos[0] >= bounds.minX - 0.15 &&
          pos[0] <= bounds.maxX + 0.15 &&
          pos[2] >= bounds.minZ - 0.15 &&
          pos[2] <= bounds.maxZ + 0.15

        if (isTopWalledLevel && insideBounds && topY > baseY + wallH + 0.05) {
          const roofY = evalAuditRoofSurfaceY(
            pos[0],
            pos[2],
            levelRoofSegs,
            bounds,
            baseY,
            wallH,
            pitchRise,
            isFlatCommercialRoof,
          )
          const excess = topY - roofY
          if (excess > 0.08) {
            push({
              severity: excess > 0.15 ? 'error' : 'warning',
              category: 'mep-clash',
              codeRef: 'IRC R802 / Roof Framing Envelope',
              nodeId: n.id,
              message: `Indoor MEP equipment "${n.name ?? n.id}" (${t}) top (${topY.toFixed(2)}m) protrudes +${excess.toFixed(2)}m above the roof framing plane (${roofY.toFixed(2)}m).`,
              remediation:
                'Lower indoor equipment/plenum below the ceiling/rafter plane or relocate closer to the ridge / into an indoor mechanical closet.',
            })
          }
        }

        const extOverhang = Math.max(
          bounds.minX - pos[0],
          pos[0] - bounds.maxX,
          bounds.minZ - pos[2],
          pos[2] - bounds.maxZ,
        )
        if (extOverhang > 0.15) {
          push({
            severity: extOverhang > 0.6 ? 'error' : 'warning',
            category: 'mep-clash',
            codeRef: 'IRC R802 / Building Framing Envelope',
            nodeId: n.id,
            message: `Indoor MEP equipment "${n.name ?? n.id}" (${t}) at (${pos[0].toFixed(2)}, ${pos[2].toFixed(2)}) protrudes ${extOverhang.toFixed(2)}m outside the walled building envelope.`,
            remediation:
              'Relocate indoor mechanical/plumbing equipment inside the conditioned walled building footprint.',
          })
        }
      }

      // 7b. Indoor MEP ducts, pipes & conduits vs. roof rafter plane and building wall envelope
      if (
        (t === 'hvac:duct-run' || t === 'plumbing:pipe-run' || t === 'electrical:conduit-run') &&
        Array.isArray(n.path) &&
        n.path.length >= 2
      ) {
        const isMainVent = isMainDwvVentStack(n)
        const isExtRun = EXTERIOR_MEP_RUN_RE.test(`${String(n.system ?? '')} ${String(n.name ?? '')}`)
        const halfY = resolveMepRunExtents(n).halfY
        const pts = n.path as ReadonlyArray<Vec3>
        let roofHitLogged = false
        let extHitLogged = false

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!
          const b = pts[i + 1]!
          if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 0.02) continue

          if (isTopWalledLevel && !isMainVent && !isExtRun && !roofHitLogged) {
            for (const f of [0, 0.25, 0.5, 0.75, 1]) {
              const px = a[0] + (b[0] - a[0]) * f
              const py = a[1] + (b[1] - a[1]) * f
              const pz = a[2] + (b[2] - a[2]) * f
              const insideXZ =
                px >= bounds.minX - 0.1 &&
                px <= bounds.maxX + 0.1 &&
                pz >= bounds.minZ - 0.1 &&
                pz <= bounds.maxZ + 0.1
              if (!insideXZ || py + halfY <= baseY + wallH + 0.05) continue
              const roofY = evalAuditRoofSurfaceY(
                px,
                pz,
                levelRoofSegs,
                bounds,
                baseY,
                wallH,
                pitchRise,
                isFlatCommercialRoof,
              )
              const excess = py + halfY - roofY
              if (excess > 0.08) {
                roofHitLogged = true
                push({
                  severity: excess > 0.15 ? 'error' : 'warning',
                  category: 'mep-clash',
                  codeRef: 'IRC R802 / Roof Framing Envelope',
                  nodeId: n.id,
                  message: `MEP run "${n.name ?? n.id}" (${t}) top (${(py + halfY).toFixed(2)}m) protrudes +${excess.toFixed(2)}m above the roof framing plane (${roofY.toFixed(2)}m) at (${px.toFixed(2)}, ${pz.toFixed(2)}).`,
                  remediation:
                    'Drop the MEP run below the ceiling joists or route centrally inside the attic volume beneath the roof rafters.',
                })
                break
              }
            }
          }

          if (!extHitLogged && !isExtRun && !isMainVent) {
            for (const pt of [a, b]) {
              const overhang = Math.max(
                bounds.minX - pt[0],
                pt[0] - bounds.maxX,
                bounds.minZ - pt[2],
                pt[2] - bounds.maxZ,
              )
              if (overhang > 0.35) {
                extHitLogged = true
                push({
                  severity: 'warning',
                  category: 'mep-clash',
                  codeRef: 'IRC R802 / Building Framing Envelope',
                  nodeId: n.id,
                  message: `Indoor MEP run "${n.name ?? n.id}" (${t}) vertex (${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}, ${pt[2].toFixed(2)}) extends ${overhang.toFixed(2)}m outside the walled building envelope.`,
                  remediation:
                    'Keep indoor ducts, pipes, and conduits inside the framed exterior wall envelope or mark exterior utility runs explicitly.',
                })
                break
              }
            }
          }
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
