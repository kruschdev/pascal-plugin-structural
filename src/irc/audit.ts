/**
 * Deterministic IRC / AWC NDS / WFCM / AISC structural scene code audit (`auditStructuralScene`).
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  type SceneNodeLike as KernelSceneNodeLike,
  compileLevelRoofShell,
  distancePointToSegment2D,
  evaluatePlacementCandidate,
  evaluateRoofSegmentSurfaceY,
  extractBeamPrism,
  extractColumnPrism,
  resolveMepRunExtents as kernelResolveMepRunExtents,
  segmentIntersectsOrientedPrismY,
} from '@kruschdev/pascal-mep-kernel'
import { deriveRequiredFirestops, isApprovedFirestopMaterial } from './fireblocking'
import { traceStructuralLoadPaths } from './load-path'
import {
  IRC_ROOF_ENVELOPE_THRESHOLDS,
  IRC_WIND_SEISMIC_THRESHOLDS,
  getIrcRuleById,
} from './rules'
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

/**
 * Resolve real physical half-extents (`halfXZ`, `halfY` in meters) for HVAC ducts,
 * plumbing pipes, and electrical conduits so structural beam/column clash checks catch
 * large ducts (e.g., 14"x8") and 3"/4" DWV stacks without over-inflating 1/2" PEX/EMT.
 */
export function resolveMepRunExtents(run: SceneNodeLike): MepRunExtents {
  return kernelResolveMepRunExtents(run as KernelSceneNodeLike)
}

/**
 * True 3D segment vs. Oriented Bounding Box (OBB) intersection for angled/diagonal beams.
 * Delegates to `@kruschdev/pascal-mep-kernel`'s `extractBeamPrism` + `segmentIntersectsOrientedPrismY`
 * so structural audit and cross-trade occupancy/routing share 100% identical OBB geometry.
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
  if (
    !Number.isFinite(beamY) ||
    !Number.isFinite(beamWidthM) ||
    !Number.isFinite(beamDepthM) ||
    beamWidthM <= 0 ||
    beamDepthM <= 0
  ) {
    return false
  }
  const prism = extractBeamPrism({
    id: '__beam__',
    type: 'structural:beam',
    start: beamStart,
    end: beamEnd,
    elevationY: beamY,
    widthIn: beamWidthM / INCHES_TO_METERS,
    depthIn: beamDepthM / INCHES_TO_METERS,
  })
  if (!prism) return false
  const halfXZ = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfXZ
  const halfY = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfY
  if (!Number.isFinite(halfXZ) || !Number.isFinite(halfY)) return false
  return segmentIntersectsOrientedPrismY(a, b, prism, [halfXZ, halfY, halfXZ])
}

/**
 * True 3D segment vs. structural column box (OBB honoring `rotationY` around Y).
 * Delegates to `@kruschdev/pascal-mep-kernel`'s `extractColumnPrism` + `segmentIntersectsOrientedPrismY`
 * so column clash geometry matches cross-trade occupancy extraction 1:1.
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
  if (
    !Number.isFinite(heightM) ||
    !Number.isFinite(widthM) ||
    !Number.isFinite(depthM) ||
    !Number.isFinite(rotationY) ||
    heightM <= 1e-4 ||
    widthM <= 1e-4 ||
    depthM <= 1e-4
  ) {
    return false
  }
  const prism = extractColumnPrism({
    id: '__column__',
    type: 'structural:column',
    position: colPos,
    widthIn: widthM / INCHES_TO_METERS,
    depthIn: depthM / INCHES_TO_METERS,
    heightM,
    rotation: rotationY,
  })
  if (!prism) return false
  const halfXZ = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfXZ
  const halfY = typeof mepExtents === 'number' ? mepExtents : mepExtents.halfY
  if (!Number.isFinite(halfXZ) || !Number.isFinite(halfY)) return false
  return segmentIntersectsOrientedPrismY(a, b, prism, [halfXZ, halfY, halfXZ])
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
    if (actualBearingIn < check.requiredBearingIn - IRC_WIND_SEISMIC_THRESHOLDS.minBearingToleranceIn) {
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
        const fsStart = (fs.start as Vec2 | undefined) ?? [0, 0]
        const fsEnd = (fs.end as Vec2 | undefined) ?? fsStart
        const distToSeg = distancePointToSegment2D(reqMid[0], reqMid[1], fsStart[0], fsStart[1], fsEnd[0], fsEnd[1])
        if (req.penetratingNodeId && fs.penetratingNodeId) {
          return fs.penetratingNodeId === req.penetratingNodeId && distToSeg <= 1.25
        }
        if (distToSeg <= 1.25) return true
        // Same-level, same-kind, same-elevation firestop explicitly labeled for the exact room/zone/slab
        // tolerates modest polygon-edge drift (<= 3.0 m) after scene edits or DB round-trips.
        if (typeof fs.name === 'string' && fs.name === req.label && distToSeg <= 3.0) {
          return true
        }
        return false
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
  const mepRightOfWayRule = getIrcRuleById('irc-r502-8-mep-right-of-way')
  const isPositiveFinite = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
  const isInvalidDim = (v: unknown): boolean =>
    typeof v === 'number' && (!Number.isFinite(v) || v <= 0)

  const beamPrisms = beams.map((beam) => {
    const invalidDim =
      isInvalidDim(beam.widthIn) ||
      isInvalidDim(beam.depthIn) ||
      (beam.widthIn === undefined && isInvalidDim(beam.width)) ||
      (beam.depthIn === undefined && isInvalidDim(beam.height))
    const has3DStart =
      Array.isArray(beam.start) &&
      beam.start.length >= 3 &&
      typeof beam.start[1] === 'number' &&
      Number.isFinite(beam.start[1]) &&
      typeof beam.start[2] === 'number' &&
      Number.isFinite(beam.start[2])
    const hasExplicitElev =
      (typeof beam.elevationY === 'number' && Number.isFinite(beam.elevationY)) ||
      (typeof beam.elevation === 'number' && Number.isFinite(beam.elevation)) ||
      has3DStart
    const beamForPrism: KernelSceneNodeLike = {
      ...(beam as KernelSceneNodeLike),
      start: (beam.start as Vec2 | Vec3 | undefined) ?? [0, 0],
      end: (beam.end as Vec2 | Vec3 | undefined) ?? [1, 0],
      ...(hasExplicitElev ? {} : { elevationY: 2.4 }),
      ...(isPositiveFinite(beam.widthIn) || isPositiveFinite(beam.width) ? {} : { widthIn: 3.5 }),
      ...(isPositiveFinite(beam.depthIn) || isPositiveFinite(beam.height) ? {} : { depthIn: 11.875 }),
    }
    return {
      beam,
      levelId: resolveNodeLevelId(nodes, beam),
      prism: invalidDim ? null : extractBeamPrism(beamForPrism),
    }
  })
  const columnPrisms = columns.map((col) => {
    const hasExplicitH = isPositiveFinite(col.heightM) || isPositiveFinite(col.height)
    const wIn = typeof col.widthIn === 'number' ? col.widthIn : 5.5
    const dIn = typeof col.depthIn === 'number' ? col.depthIn : 5.5
    const hM = isPositiveFinite(col.heightM)
      ? col.heightM
      : isPositiveFinite(col.height)
        ? col.height
        : col.heightM !== undefined
          ? Number(col.heightM)
          : col.height !== undefined
            ? Number(col.height)
            : 2.7432
    const wM = wIn * INCHES_TO_METERS
    const dM = dIn * INCHES_TO_METERS
    const invalidDim =
      !Number.isFinite(hM) ||
      !Number.isFinite(wM) ||
      !Number.isFinite(dM) ||
      hM <= 1e-4 ||
      wM <= 1e-4 ||
      dM <= 1e-4
    const colForPrism: KernelSceneNodeLike = {
      ...(col as KernelSceneNodeLike),
      position: (col.position as Vec3 | undefined) ?? [0, 0, 0],
      ...(hasExplicitH ? {} : { heightM: 2.7432 }),
    }
    return {
      col,
      levelId: resolveNodeLevelId(nodes, col),
      prism: invalidDim ? null : extractColumnPrism(colForPrism, 2.7432),
    }
  })

  const reportedClashes = new Set<string>()
  for (const run of mepRuns) {
    const runLvl = resolveNodeLevelId(nodes, run)
    const mepExtents = resolveMepRunExtents(run)
    const pad: Vec3 = [mepExtents.halfXZ, mepExtents.halfY, mepExtents.halfXZ]
    const path = run.path as ReadonlyArray<Vec3>
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      for (const { beam, levelId: beamLvl, prism } of beamPrisms) {
        if (!prism || !sameLevelOrUnscoped(runLvl, beamLvl)) continue
        const clashKey = `${run.id}::${beam.id}`
        if (reportedClashes.has(clashKey)) continue
        if (segmentIntersectsOrientedPrismY(a, b, prism, pad)) {
          reportedClashes.add(clashKey)
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: mepRightOfWayRule.codeRef,
            nodeId: beam.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural beam "${beam.name ?? beam.id}" (${beam.designation ?? beam.beamType}); boring engineered beams or headers is prohibited.`,
            remediation: `Re-route ${run.type} below the beam soffit or through an adjacent open joist/TJI knockout bay.`,
          })
        }
      }
      for (const { col, levelId: colLvl, prism } of columnPrisms) {
        if (!prism || !sameLevelOrUnscoped(runLvl, colLvl)) continue
        const clashKey = `${run.id}::${col.id}`
        if (reportedClashes.has(clashKey)) continue
        if (segmentIntersectsOrientedPrismY(a, b, prism, pad)) {
          reportedClashes.add(clashKey)
          push({
            severity: 'error',
            category: 'mep-clash',
            codeRef: mepRightOfWayRule.codeRef,
            nodeId: col.id,
            message: `MEP run "${run.id}" (${run.type}) penetrates structural column "${col.name ?? col.id}" (${col.designation ?? col.columnType}); piercing load-bearing columns is prohibited.`,
            remediation: `Re-route ${run.type} horizontally around the structural column shaft with >= 1 in clearance.`,
          })
        }
      }
    }
  }

  // 7. Roof-rafter-plane & exterior-envelope MEP intrusion diagnostics (VIS-07)
  const roofEnvelopeRule = getIrcRuleById('irc-r802-roof-framing-envelope')
  const OUTDOOR_OR_ROOF_EQUIP_RE =
    /condenser|heat-pump-outdoor|mini-split-outdoor|rooftop-package|\brtu\b|gas-meter|hose[- ]?bibb|well|outdoor/i
  const EXTERIOR_MEP_RUN_RE =
    /refrigerant-lineset|condensate|exhaust|fresh-air|intake|building-drain|sewer|gas|hose[- ]?bibb|outdoor|condenser|\brtu\b/i
  const isMainDwvVentStack = (n: SceneNodeLike): boolean =>
    Boolean(n.isMainVentStack) || /Main DWV Soil & Vent Stack|Through Roof/i.test(String(n.name ?? ''))

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
    const roofShell = isTopWalledLevel
      ? compileLevelRoofShell(
          nodes as Readonly<Record<string, KernelSceneNodeLike>>,
          lvlId,
          wallH,
          {
            includeHidden: true,
            levelBaseY: baseY,
            wallBounds: bounds,
            fallbackPitchRiseOver12: pitchRise,
            clampOverhangToEave: true,
            footprintPadM: 0.15,
          },
        )
      : null
    const upperRoofSegs = (roofShell?.segments ?? []).filter((seg) => seg.eaveY >= baseY + wallH - 0.6)
    const hasUpperRoofSegs = upperRoofSegs.length > 0
    const hasCommercialRtu = findLevelCommercialRtus(nodes, lvlId).length > 0
    const isFlatCommercialRoof = hasCommercialRtu && !hasUpperRoofSegs
    const syntheticRoofShell =
      isTopWalledLevel && !isFlatCommercialRoof
        ? compileLevelRoofShell({}, null, wallH, {
            levelBaseY: baseY,
            wallBounds: bounds,
            fallbackPitchRiseOver12: pitchRise,
            clampOverhangToEave: true,
            footprintPadM: 0.15,
          })
        : null
    const evalAuditRoofSurfaceY = (x: number, z: number): number => {
      if (isFlatCommercialRoof) return baseY + wallH + 0.2858
      if (upperRoofSegs.length > 0) {
        let bestY: number | null = null
        for (const seg of upperRoofSegs) {
          const sy = evaluateRoofSegmentSurfaceY(seg, x, z, {
            clampOverhangToEave: true,
            footprintPadM: 0.15,
          })
          if (sy !== null && (bestY === null || sy > bestY)) bestY = sy
        }
        if (bestY !== null) return bestY
      }
      return syntheticRoofShell ? syntheticRoofShell.roofEnvelopeY(x, z) : baseY + wallH
    }

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

        if (isTopWalledLevel && insideBounds && topY > baseY + wallH + IRC_ROOF_ENVELOPE_THRESHOLDS.atticThresholdOffsetM) {
          const roofY = evalAuditRoofSurfaceY(pos[0], pos[2])
          const roofEval = evaluatePlacementCandidate(
            [roofEnvelopeRule],
            {
              id: n.id,
              kind: t,
              pos: [pos[0], topY, pos[2]],
              roofSurfaceYM: roofY,
            },
            'audit',
          )
          const excess = topY - roofY
          if (!roofEval.legal) {
            push({
              severity: excess > IRC_ROOF_ENVELOPE_THRESHOLDS.errorProtrusionM ? 'error' : 'warning',
              category: 'mep-clash',
              codeRef: roofEnvelopeRule.codeRef,
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
        if (extOverhang > IRC_ROOF_ENVELOPE_THRESHOLDS.equipmentExteriorWarningM) {
          push({
            severity: extOverhang > IRC_ROOF_ENVELOPE_THRESHOLDS.equipmentExteriorErrorM ? 'error' : 'warning',
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
              if (!insideXZ || py + halfY <= baseY + wallH + IRC_ROOF_ENVELOPE_THRESHOLDS.atticThresholdOffsetM) continue
              const roofY = evalAuditRoofSurfaceY(px, pz)
              const topY = py + halfY
              const roofEval = evaluatePlacementCandidate(
                [roofEnvelopeRule],
                {
                  id: n.id,
                  kind: t,
                  pos: [px, topY, pz],
                  roofSurfaceYM: roofY,
                },
                'audit',
              )
              const excess = topY - roofY
              if (!roofEval.legal) {
                roofHitLogged = true
                push({
                  severity: excess > IRC_ROOF_ENVELOPE_THRESHOLDS.errorProtrusionM ? 'error' : 'warning',
                  category: 'mep-clash',
                  codeRef: roofEnvelopeRule.codeRef,
                  nodeId: n.id,
                  message: `MEP run "${n.name ?? n.id}" (${t}) top (${topY.toFixed(2)}m) protrudes +${excess.toFixed(2)}m above the roof framing plane (${roofY.toFixed(2)}m) at (${px.toFixed(2)}, ${pz.toFixed(2)}).`,
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
              if (overhang > IRC_ROOF_ENVELOPE_THRESHOLDS.runExteriorWarningM) {
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
