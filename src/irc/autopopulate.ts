/**
 * Deterministic one-click IRC/AWC/NDS structural scene synthesizer (`autopopulateStructuralScene`).
 * Scans Pascal `level`, `wall`, `door`, `window`, `slab`, `roof`, `stair`, and `zone` nodes
 * (plus optional Plumbing/Electrical MEP runs for 2x6 wet-wall upgrades & R302.11(5) firestop collars)
 * and generates persisted, editable `structural:*` nodes.
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { evaluatePlacementCandidate } from '@kruschdev/pascal-mep-kernel'
import { deriveRequiredFirestops } from './fireblocking'
import { evaluateBracedWallLines } from './load-path'
import { clusterLevelFootprints, extractWallOpenings, resolveWallHeightM } from './openings'
import { getIrcRuleById, isHighSeismicCategory } from './rules'
import {
  selectBeamHangerSku,
  selectHurricaneTieSku,
  sizeBeamOrHeader,
  sizeColumnAndFooting,
  sizeFloorSystem,
  sizeRoofSystem,
} from './sizing'
import {
  type BeamMaterialFamily,
  type ColumnType,
  DEFAULT_DESIGN_PARAMS,
  FEET_TO_METERS,
  type FloorSystemKind,
  INCHES_TO_METERS,
  METERS_TO_FEET,
  type RoofSystemKind,
  type SceneNodeLike,
  type StructuralDesignParams,
  type StudSize,
  type StudSpacingIn,
  type Vec2,
  type Vec3,
  type WallOverrideRule,
  belongsToLevel,
  findLevelCommercialRtus,
  getConnectorBySku,
  isHighestWalledLevelInBuilding,
  isHoldDownConnector,
  levelSortOrder,
  resolveHoldDownUpliftLbs,
  resolveNodeLevelId,
} from './tables'

export type AutopopulateStructuralOptions = {
  levelId?: string | null
  design?: Partial<StructuralDesignParams>
  studSize?: StudSize
  studSpacingIn?: StudSpacingIn
  floorSystem?: FloorSystemKind
  roofSystem?: RoofSystemKind
  preferredBeamFamily?: BeamMaterialFamily
  preferredColumnType?: ColumnType
  includeRoof?: boolean
  includeFoundation?: boolean
  includeFireblocking?: boolean
}

export type AutopopulateStructuralResult = {
  createdNodes: SceneNodeLike[]
  summary: {
    assemblies: number
    beams: number
    columns: number
    connectors: number
    firestops: number
    floorSystemSummary: string
    roofSystemSummary: string
    wetWallUpgrades: number
  }
}

function polyBounds(poly: ReadonlyArray<Vec2>): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  widthM: number
  depthM: number
} {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    widthM: Math.max(0, maxX - minX),
    depthM: Math.max(0, maxZ - minZ),
  }
}

export function autopopulateStructuralScene(
  nodes: Readonly<Record<string, SceneNodeLike>>,
  options: AutopopulateStructuralOptions = {},
): AutopopulateStructuralResult {
  const design: StructuralDesignParams = { ...DEFAULT_DESIGN_PARAMS, ...options.design }
  const levelId = options.levelId ?? null
  const studSpacingIn: StudSpacingIn = options.studSpacingIn ?? 16
  const floorSystem: FloorSystemKind = options.floorSystem ?? 'tji-ijoist'
  const roofSystem: RoofSystemKind = options.roofSystem ?? 'stick-rafter'
  const levelNodes = Object.values(nodes).filter((n) => belongsToLevel(nodes, n, levelId))
  const walls = levelNodes.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const slabs = levelNodes.filter((n) => n.type === 'slab' && Array.isArray(n.polygon) && n.polygon.length >= 3)
  const roofs = levelNodes.filter((n) => n.type === 'roof' || n.type === 'roof-segment')
  const zones = levelNodes.filter((n) => n.type === 'zone' || n.type === 'room')
  const plumbingFixtures = levelNodes.filter((n) => n.type === 'plumbing:fixture')
  const includeRoof = options.includeRoof ?? (roofs.length > 0 || isHighestWalledLevelInBuilding(nodes, levelId))
  const includeFoundation = options.includeFoundation ?? true
  const includeFireblocking = options.includeFireblocking ?? true
  const levelCommercialRtus = findLevelCommercialRtus(nodes, levelId)

  const findAlignedLowerColumn = (px: number, pz: number, colBottomY: number): SceneNodeLike | undefined => {
    const currentLevelNode = levelId ? nodes[levelId] : undefined
    const currentLevelOrder = currentLevelNode?.type === 'level' ? levelSortOrder(currentLevelNode) : null
    const targetBuildingId =
      currentLevelNode?.type === 'level' && typeof currentLevelNode.parentId === 'string'
        ? currentLevelNode.parentId
        : null

    const candidates: Array<{ node: SceneNodeLike; levelOrder: number; dist: number; y: number }> = []
    for (const n of Object.values(nodes)) {
      if (n.type !== 'structural:column') continue
      if (levelId && belongsToLevel(nodes, n, levelId)) continue
      const nLvlId = resolveNodeLevelId(nodes, n)
      const nLvlNode = nLvlId ? nodes[nLvlId] : undefined
      if (targetBuildingId && nLvlNode?.type === 'level') {
        const nBuildingId = typeof nLvlNode.parentId === 'string' ? nLvlNode.parentId : null
        if (nBuildingId && nBuildingId !== targetBuildingId) continue
      }
      const p = n.position ?? [0, 0, 0]
      const dist = Math.hypot(p[0] - px, p[2] - pz)
      if (dist > 0.45) continue

      let candidateOrder = Number.NEGATIVE_INFINITY
      if (currentLevelOrder !== null && nLvlNode?.type === 'level') {
        const nOrder = levelSortOrder(nLvlNode)
        if (nOrder > currentLevelOrder) continue
        if (nOrder < currentLevelOrder) {
          candidateOrder = nOrder
        } else if (p[1] < colBottomY - 0.1) {
          candidateOrder = nOrder
        } else {
          continue
        }
      } else if (p[1] < colBottomY - 0.1) {
        candidateOrder = nLvlNode?.type === 'level' ? levelSortOrder(nLvlNode) : Number.NEGATIVE_INFINITY
      } else {
        continue
      }

      candidates.push({ node: n, levelOrder: candidateOrder, dist, y: p[1] })
    }

    if (candidates.length === 0) return undefined
    candidates.sort((a, b) => {
      if (b.levelOrder !== a.levelOrder) return b.levelOrder - a.levelOrder
      if (a.dist !== b.dist) return a.dist - b.dist
      return b.y - a.y
    })
    return candidates[0]!.node
  }

  const createdNodes: SceneNodeLike[] = []
  let seq = 1
  const levelTag = (levelId ?? 'lvl').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'lvl'
  const usedIds = new Set<string>(Object.keys(nodes))
  const nextId = (prefix: string) => {
    let candidate = `${prefix}_${levelTag}_${seq++}`
    while (usedIds.has(candidate)) {
      candidate = `${prefix}_${levelTag}_${seq++}`
    }
    usedIds.add(candidate)
    return candidate
  }

  // Partition level into transitively connected building footprint clusters so detached
  // buildings on the same level never bridge empty yard with girders, columns, or ridge beams
  const footprintClusters = clusterLevelFootprints(nodes, levelId, 0.35)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const c of footprintClusters) {
    minX = Math.min(minX, c.minX)
    maxX = Math.max(maxX, c.maxX)
    minZ = Math.min(minZ, c.minZ)
    maxZ = Math.max(maxZ, c.maxZ)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    maxX = 9.144
    minZ = 0
    maxZ = 7.315
  }
  const primaryCluster = footprintClusters.reduce(
    (best, c) => (c.widthM * c.depthM > best.widthM * best.depthM ? c : best),
    footprintClusters[0] ?? {
      minX,
      maxX,
      minZ,
      maxZ,
      widthM: maxX - minX,
      depthM: maxZ - minZ,
      avgWallHeightM: 2.7432,
      baseElevationM: 0,
    },
  )
  const levelBaseY = primaryCluster.baseElevationM
  const footprintWidthFt = Math.max(10, primaryCluster.widthM * METERS_TO_FEET)
  const footprintDepthFt = Math.max(10, primaryCluster.depthM * METERS_TO_FEET)
  const shortSpanFt = Math.min(footprintWidthFt, footprintDepthFt)
  const longSpanFt = Math.max(footprintWidthFt, footprintDepthFt)
  const totalPerimFt = footprintClusters.reduce(
    (sum, c) => sum + (Math.max(10, c.widthM * METERS_TO_FEET) + Math.max(10, c.depthM * METERS_TO_FEET)) * 2,
    0,
  )
  const hostLevelNode = levelId ? nodes[levelId] : undefined
  const levelFallbackWallH =
    typeof hostLevelNode?.height === 'number' && Number.isFinite(hostLevelNode.height) && hostLevelNode.height > 1.2
      ? hostLevelNode.height
      : 2.7432
  const defaultWallHeightM =
    walls.reduce((maxH, w) => Math.max(maxH, resolveWallHeightM(nodes, w, levelFallbackWallH)), 0) ||
    levelFallbackWallH

  // Evaluate braced wall lines scoped to this level so multi-storey runs never duplicate hold-downs
  const bwlReports = evaluateBracedWallLines({ nodes, design, levelId })
  const shearWallIds = new Set<string>()
  for (const bwl of bwlReports) {
    if (bwl.bracingMethod === 'Engineered-Shear' || bwl.bracingMethod === 'CS-WSP' || bwl.bracingMethod === 'CS-PF') {
      for (const wid of bwl.wallIds) shearWallIds.add(wid)
    }
  }

  // Detect 2x6 wet walls near bathrooms/kitchens or placed plumbing fixtures
  const wallOverrides: Record<string, WallOverrideRule> = {}
  let wetWallUpgrades = 0
  for (const wall of walls) {
    const thick = typeof wall.thickness === 'number' ? wall.thickness : 0.14
    const ws = wall.start!
    const we = wall.end!
    const midX = (ws[0] + we[0]) / 2
    const midZ = (ws[1] + we[1]) / 2

    const nearPlumbing = plumbingFixtures.some((f) => {
      const p = f.position ?? [0, 0, 0]
      return Math.hypot(p[0] - midX, p[2] - midZ) <= 1.2
    })
    const inWetZone = zones.some((z) => {
      const nm = typeof z.name === 'string' ? z.name : ''
      if (!/bath|kitchen|laundry|utility|powder/i.test(nm)) return false
      if (!Array.isArray(z.polygon) || z.polygon.length < 3) return false
      const zb = polyBounds(z.polygon)
      return midX >= zb.minX - 0.3 && midX <= zb.maxX + 0.3 && midZ >= zb.minZ - 0.3 && midZ <= zb.maxZ + 0.3
    })

    const hostCluster =
      footprintClusters.find(
        (c) => midX >= c.minX - 0.35 && midX <= c.maxX + 0.35 && midZ >= c.minZ - 0.35 && midZ <= c.maxZ + 0.35,
      ) ?? primaryCluster
    const isExterior =
      wall.frontSide === 'exterior' ||
      wall.backSide === 'exterior' ||
      Math.abs(midX - hostCluster.minX) < 0.3 ||
      Math.abs(midX - hostCluster.maxX) < 0.3 ||
      Math.abs(midZ - hostCluster.minZ) < 0.3 ||
      Math.abs(midZ - hostCluster.maxZ) < 0.3
    const isShear = shearWallIds.has(wall.id)
    const isWet = nearPlumbing || inWetZone
    const studSize: StudSize = options.studSize ?? (isExterior || isWet || thick >= 0.13 ? '2x6' : '2x4')
    if (isWet && thick < 0.13 && studSize === '2x6') wetWallUpgrades += 1

    wallOverrides[wall.id] = {
      construction: isShear ? 'shear-wall' : 'wood-framed',
      studSize,
      studSpacingIn,
      isLoadBearing: isExterior,
      isShearWall: isShear,
      isWetWall: isWet,
      sheathingEdgeNailIn: isShear ? (isHighSeismicCategory(design.seismicCategory) ? 3 : 4) : 6,
    }
  }

  // 1. Floor system sizing
  const floorSizing = sizeFloorSystem({
    clearSpanFt: shortSpanFt,
    crossLengthFt: longSpanFt,
    system: floorSystem,
    species: design.species,
    spacingIn: studSpacingIn,
    liveLoadPsf: design.floorLiveLoadPsf,
    deadLoadPsf: design.floorDeadLoadPsf,
  })

  // 2. Roof system sizing (normalize pitch safely whether stored in radians <= 1.4 or degrees > 1.4)
  const firstRoof = roofs[0]
  let roofPitchRise = 6
  if (typeof firstRoof?.pitch === 'number' && Number.isFinite(firstRoof.pitch) && firstRoof.pitch >= 0) {
    const rad = firstRoof.pitch > 1.4 ? (firstRoof.pitch * Math.PI) / 180 : firstRoof.pitch
    const clampedRad = Math.min(rad, (75 * Math.PI) / 180)
    roofPitchRise = Number((Math.tan(clampedRad) * 12).toFixed(1))
  }
  const roofSizing = sizeRoofSystem({
    buildingSpanFt: shortSpanFt,
    ridgeLengthFt: longSpanFt,
    pitchRiseOver12: roofPitchRise,
    system: roofSystem,
    design,
  })

  // 3. Persist Primary Level Structural Assembly Node (`structural:assembly`)
  const assemblyId = nextId('strasm')
  createdNodes.push({
    id: assemblyId,
    type: 'structural:assembly',
    name: `Structural Framing Assembly (${design.species.toUpperCase()} / ${floorSystem})`,
    parentId: levelId,
    assemblyKind: 'wall-framing',
    species: design.species,
    studSize: options.studSize ?? '2x6',
    studSpacingIn,
    floorSystem,
    joistDepthIn: floorSizing.depthIn,
    roofSystem,
    designParams: design,
    wallOverrides,
    footprintBounds: [minX, minZ, maxX, maxZ],
    wallHeightM: defaultWallHeightM,
    xrayOpacity: 0.25,
    visibleSystems: {
      walls: true,
      floor: true,
      roof: includeRoof,
      beams: true,
      columns: true,
      connectors: true,
      firestop: includeFireblocking,
      foundation: includeFoundation,
    },
  })

  const emitConnector = (params: {
    sku: string
    position: Vec3
    rotation?: number
    quantity?: number
    attachedNodeIds?: string[]
    name?: string
  }) => {
    const cat = getConnectorBySku(params.sku)
    if (!cat) return
    createdNodes.push({
      id: nextId('strcon'),
      type: 'structural:connector',
      name: params.name ?? `${cat.sku} (${cat.name})`,
      parentId: levelId,
      position: params.position,
      rotation: params.rotation ?? 0,
      category: cat.category,
      sku: cat.sku,
      quantity: params.quantity ?? 1,
      fastenerSpec: cat.fastenerSpec,
      upliftCapacityLbs: cat.upliftLbs,
      downloadCapacityLbs: cat.downloadLbs,
      lateralCapacityLbs: cat.lateralLbs,
      attachedNodeIds: params.attachedNodeIds ?? [],
    })
  }

  // 4. Size & emit `structural:beam` headers for every door & window opening (native + Pascal `item` openings)
  for (const hostWall of walls) {
    const ws = hostWall.start!
    const we = hostWall.end!
    const lenM = Math.hypot(we[0] - ws[0], we[1] - ws[1])
    if (lenM < 0.2) continue
    const ux = (we[0] - ws[0]) / lenM
    const uz = (we[1] - ws[1]) / lenM
    const yaw = Math.atan2(-(we[1] - ws[1]), we[0] - ws[0])
    const wallH = resolveWallHeightM(nodes, hostWall, defaultWallHeightM)
    const wallBaseY = typeof hostWall.elevation === 'number' && Number.isFinite(hostWall.elevation) ? hostWall.elevation : 0
    const wallOpenings = extractWallOpenings(nodes, hostWall)

    for (const op of wallOpenings) {
      const opWidthM = op.widthM
      const centerU = op.uCenterM
      const spanFt = opWidthM * METERS_TO_FEET
      const isBearing = wallOverrides[hostWall.id]?.isLoadBearing ?? true
      const effTribFt = isBearing ? Number(Math.min(18, shortSpanFt / 2).toFixed(1)) : 2
      const effLivePsf =
        design.storiesAbove > 0
          ? design.floorLiveLoadPsf
          : Math.max(design.roofLiveLoadPsf, design.groundSnowPsf)
      const headerInputBase = {
        tributaryWidthFt: effTribFt,
        role: 'header' as const,
        preferredFamily: spanFt > 8 ? (options.preferredBeamFamily ?? 'lvl') : options.preferredBeamFamily,
        snowLoadPsf: design.groundSnowPsf,
        liveLoadPsf: effLivePsf,
        deadLoadPsf: design.roofDeadLoadPsf,
        species: design.species,
        storiesSupported: design.storiesAbove,
      }
      const clearHeaderSizing = sizeBeamOrHeader({ ...headerInputBase, spanFt })

      const halfRun = opWidthM / 2 + clearHeaderSizing.jackStudsEachEnd * 1.5 * INCHES_TO_METERS
      const startPt: Vec2 = [ws[0] + ux * Math.max(0, centerU - halfRun), ws[1] + uz * Math.max(0, centerU - halfRun)]
      const endPt: Vec2 = [ws[0] + ux * Math.min(lenM, centerU + halfRun), ws[1] + uz * Math.min(lenM, centerU + halfRun)]
      const fullHeaderSpanFt = Math.max(
        spanFt,
        Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]) * METERS_TO_FEET,
      )
      const headerSizing =
        fullHeaderSpanFt > spanFt + 0.05
          ? sizeBeamOrHeader({ ...headerInputBase, spanFt: fullHeaderSpanFt })
          : clearHeaderSizing
      const providedBearingIn = Number(
        Math.max(headerSizing.jackStudsEachEnd * 1.5, Math.ceil(headerSizing.requiredBearingIn * 2) / 2).toFixed(2),
      )
      const headerDepthM = headerSizing.entry.depthIn * INCHES_TO_METERS
      const headerY = Math.min(wallBaseY + wallH - 0.08 - headerDepthM / 2, wallBaseY + op.headYM + headerDepthM / 2)

      const beamId = nextId('strbm')
      createdNodes.push({
        id: beamId,
        type: 'structural:beam',
        name: `Header (${headerSizing.entry.designation}) over ${op.name}`,
        parentId: levelId,
        start: startPt,
        end: endPt,
        elevationY: Number(headerY.toFixed(3)),
        role: 'header',
        beamType: headerSizing.entry.family,
        designation: headerSizing.entry.designation,
        plyCount: headerSizing.entry.plyCount,
        widthIn: headerSizing.entry.widthIn,
        depthIn: headerSizing.entry.depthIn,
        species: design.species,
        mountStyle: 'flush',
        tributaryWidthFt: effTribFt,
        liveLoadPsf: effLivePsf,
        deadLoadPsf: design.roofDeadLoadPsf,
        snowLoadPsf: design.groundSnowPsf,
        bearingLengthIn: providedBearingIn,
        jackStudsEachEnd: headerSizing.jackStudsEachEnd,
        endReactionLbs: headerSizing.shearLbs,
        hostWallId: hostWall.id,
        openingId: op.id,
      })

      // High-wind or wide-opening header-to-king uplift straps (LSTA24 / CS-PF)
      if (design.windMph >= 120 || spanFt >= 6) {
        const strapSku = spanFt >= 8 && shearWallIds.has(hostWall.id) ? 'CS-PF' : 'LSTA24'
        emitConnector({
          sku: strapSku,
          position: [startPt[0], headerY, startPt[1]],
          rotation: yaw,
          quantity: 2,
          attachedNodeIds: [beamId, hostWall.id],
          name: `${strapSku} Header Uplift Straps (${op.id})`,
        })
      }
    }
  }

  // 5. Floor Girders + Stacked Columns + Post Caps + Post Bases + Joist Hangers (per connected cluster!)
  let girderSeq = 0
  for (const cluster of footprintClusters) {
    const cWidthFt = Math.max(6, cluster.widthM * METERS_TO_FEET)
    const cDepthFt = Math.max(6, cluster.depthM * METERS_TO_FEET)
    const cShortFt = Math.min(cWidthFt, cDepthFt)
    const cLongFt = Math.max(cWidthFt, cDepthFt)
    const cFloorSizing = sizeFloorSystem({
      clearSpanFt: cShortFt,
      crossLengthFt: cLongFt,
      system: floorSystem,
      species: design.species,
      spacingIn: studSpacingIn,
      liveLoadPsf: design.floorLiveLoadPsf,
      deadLoadPsf: design.floorDeadLoadPsf,
    })
    if (cFloorSizing.girderLinesNeeded <= 0 || !cFloorSizing.recommendedGirder) continue

    const runsAlongX = cluster.maxX - cluster.minX >= cluster.maxZ - cluster.minZ
    for (let g = 1; g <= cFloorSizing.girderLinesNeeded; g++) {
      girderSeq += 1
      const frac = g / (cFloorSizing.girderLinesNeeded + 1)
      const gStart: Vec2 = runsAlongX
        ? [cluster.minX, cluster.minZ + (cluster.maxZ - cluster.minZ) * frac]
        : [cluster.minX + (cluster.maxX - cluster.minX) * frac, cluster.minZ]
      const gEnd: Vec2 = runsAlongX
        ? [cluster.maxX, cluster.minZ + (cluster.maxZ - cluster.minZ) * frac]
        : [cluster.minX + (cluster.maxX - cluster.minX) * frac, cluster.maxZ]
      const girderLenFt = Math.hypot(gEnd[0] - gStart[0], gEnd[1] - gStart[1]) * METERS_TO_FEET
      // Break long floor girders into clear-span bays <= 12 ft supported by intermediate columns
      const postBays = Math.max(1, Math.ceil(girderLenFt / 12))
      const baySpanFt = girderLenFt / postBays
      const girderCheck = sizeBeamOrHeader({
        spanFt: baySpanFt,
        tributaryWidthFt: cFloorSizing.effectiveSpanFt,
        role: 'floor-girder',
        liveLoadPsf: design.floorLiveLoadPsf,
        deadLoadPsf: design.floorDeadLoadPsf,
        snowLoadPsf: 0,
        species: design.species,
        storiesSupported: design.storiesAbove,
        preferredFamily: options.preferredBeamFamily ?? cFloorSizing.recommendedGirder.entry.family,
      })
      const girderY = cluster.baseElevationM - (girderCheck.entry.depthIn * INCHES_TO_METERS) / 2
      let firstGirderId = ''
      const bayGirderIds: string[] = []

      for (let b = 0; b < postBays; b++) {
        const t0 = b / postBays
        const t1 = (b + 1) / postBays
        const bStart: Vec2 = [gStart[0] + (gEnd[0] - gStart[0]) * t0, gStart[1] + (gEnd[1] - gStart[1]) * t0]
        const bEnd: Vec2 = [gStart[0] + (gEnd[0] - gStart[0]) * t1, gStart[1] + (gEnd[1] - gStart[1]) * t1]
        const girderId = nextId('strbm')
        if (!firstGirderId) firstGirderId = girderId
        bayGirderIds.push(girderId)

        createdNodes.push({
          id: girderId,
          type: 'structural:beam',
          name:
            postBays > 1
              ? `Floor Girder #${girderSeq}-${b + 1} (${girderCheck.entry.designation})`
              : `Floor Girder #${girderSeq} (${girderCheck.entry.designation})`,
          parentId: levelId,
          start: bStart,
          end: bEnd,
          elevationY: Number(girderY.toFixed(3)),
          role: 'floor-girder',
          beamType: girderCheck.entry.family,
          designation: girderCheck.entry.designation,
          plyCount: girderCheck.entry.plyCount,
          widthIn: girderCheck.entry.widthIn,
          depthIn: girderCheck.entry.depthIn,
          species: design.species,
          mountStyle: 'flush',
          tributaryWidthFt: cFloorSizing.effectiveSpanFt,
          liveLoadPsf: design.floorLiveLoadPsf,
          deadLoadPsf: design.floorDeadLoadPsf,
          snowLoadPsf: 0,
          bearingLengthIn: Math.max(3.5, Math.ceil(girderCheck.requiredBearingIn * 2) / 2),
          jackStudsEachEnd: girderCheck.jackStudsEachEnd,
          endReactionLbs: girderCheck.shearLbs,
        })
      }

      // Batch joist hangers on both sides of the flush girder (attached to all bay girder segments)
      const joistsPerSide = Math.max(2, Math.floor((girderLenFt * 12) / cFloorSizing.spacingIn))
      emitConnector({
        sku: cFloorSizing.joistHangerSku,
        position: [(gStart[0] + gEnd[0]) / 2, girderY, (gStart[1] + gEnd[1]) / 2],
        quantity: joistsPerSide * 2,
        attachedNodeIds: [...bayGirderIds, assemblyId],
        name: `${cFloorSizing.joistHangerSku} Joist Hangers (x${joistsPerSide * 2} along Girder #${girderSeq})`,
      })

      // Heavy beam hangers at girder pocket ends (attached to first and last bay girder)
      const beamHangerSku = selectBeamHangerSku(girderCheck.entry, girderCheck.shearLbs)
      const lastGirderId = bayGirderIds[bayGirderIds.length - 1] ?? firstGirderId
      emitConnector({
        sku: beamHangerSku,
        position: [gStart[0], girderY, gStart[1]],
        quantity: 2,
        attachedNodeIds: lastGirderId !== firstGirderId ? [firstGirderId, lastGirderId] : [firstGirderId],
        name: `${beamHangerSku} Girder End Hangers (x2)`,
      })

      // Intermediate support columns + post caps + post bases + spread footings at each bay split
      const colHeightFt = cluster.avgWallHeightM * METERS_TO_FEET
      const colAxialLbs = Math.round(girderCheck.uniformLoadPlf * baySpanFt)
      const colSizing = sizeColumnAndFooting({
        axialLoadLbs: colAxialLbs,
        unbracedHeightFt: colHeightFt,
        preferredType: options.preferredColumnType,
        soilBearingPsf: design.soilBearingPsf,
        frostDepthIn: design.frostDepthIn,
      })

      for (let p = 1; p < postBays; p++) {
        const t = p / postBays
        const px = gStart[0] + (gEnd[0] - gStart[0]) * t
        const pz = gStart[1] + (gEnd[1] - gStart[1]) * t
        const colId = nextId('strcol')
        const leftBayId = bayGirderIds[p - 1] ?? firstGirderId
        const rightBayId = bayGirderIds[p]
        const colBottomY = Number((cluster.baseElevationM - cluster.avgWallHeightM).toFixed(3))
        const lowerCol = includeFoundation ? undefined : findAlignedLowerColumn(px, pz, colBottomY)
        createdNodes.push({
          id: colId,
          type: 'structural:column',
          name: `Girder Post #${p} (${colSizing.entry.designation})`,
          parentId: levelId,
          position: [Number(px.toFixed(3)), colBottomY, Number(pz.toFixed(3))],
          heightM: Number(Math.max(0.8, cluster.avgWallHeightM - girderCheck.entry.depthIn * INCHES_TO_METERS).toFixed(3)),
          columnType: colSizing.entry.columnType,
          designation: colSizing.entry.designation,
          widthIn: colSizing.entry.widthIn,
          depthIn: colSizing.entry.depthIn,
          axialLoadLbs: colAxialLbs,
          transfersFromNodeId: leftBayId,
          transfersToNodeId: includeFoundation ? `footing_${colId}` : lowerCol?.id,
          hasSquashBlocks: floorSystem === 'tji-ijoist',
          footingWidthIn: includeFoundation ? colSizing.footingWidthIn : 0,
          footingDepthIn: includeFoundation ? colSizing.footingDepthIn : 0,
          footingRebar: includeFoundation ? colSizing.footingRebar : 'Transfers to lower story',
        })

        // Post Cap (top of column to girder)
        emitConnector({
          sku: colSizing.recommendedCapSku,
          position: [px, girderY - (girderCheck.entry.depthIn * INCHES_TO_METERS) / 2, pz],
          attachedNodeIds: rightBayId ? [colId, leftBayId, rightBayId] : [colId, leftBayId],
          name: `${colSizing.recommendedCapSku} Post-to-Girder Cap`,
        })
        // Standoff Post Base (only when resting on foundation footing)
        if (includeFoundation) {
          emitConnector({
            sku: colSizing.recommendedBaseSku,
            position: [px, cluster.baseElevationM - cluster.avgWallHeightM, pz],
            attachedNodeIds: [colId],
            name: `${colSizing.recommendedBaseSku} Standoff Post Base`,
          })
        }
      }

      // End-support columns for non-rectangular / L-shaped / U-shaped footprints where gStart or gEnd
      // falls in open space without a bearing wall (perp <= 0.35 m) or existing column (within 0.45 m)
      const girderDepthM = girderCheck.entry.depthIn * INCHES_TO_METERS
      const girderBottomY = girderY - girderDepthM / 2
      const isGirderEndSupported = (pt: Vec2): boolean => {
        const onWall = walls.some((w) => {
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
        if (onWall) return true
        const existingCols = [
          ...levelNodes.filter((n) => n.type === 'structural:column'),
          ...createdNodes.filter((n) => n.type === 'structural:column'),
        ]
        return existingCols.some((c) => {
          const p = c.position ?? [0, 0, 0]
          const colH = typeof c.heightM === 'number' ? c.heightM : 2.74
          const colTopY = p[1] + colH
          const planMatch = Math.hypot(p[0] - pt[0], p[2] - pt[1]) <= 0.45
          const verticalMatch = p[1] <= girderBottomY - 0.25 && colTopY >= girderBottomY - 0.55
          return planMatch && verticalMatch
        })
      }

      const endAxialLbs = girderCheck.shearLbs
      const endColSizing = sizeColumnAndFooting({
        axialLoadLbs: endAxialLbs,
        unbracedHeightFt: colHeightFt,
        preferredType: options.preferredColumnType,
        soilBearingPsf: design.soilBearingPsf,
        frostDepthIn: design.frostDepthIn,
      })

      for (const [endTag, pt, attachedBayId] of [
        ['Start', gStart, firstGirderId],
        ['End', gEnd, lastGirderId],
      ] as const) {
        if (isGirderEndSupported(pt)) continue
        const colId = nextId('strcol')
        const endColBottomY = Number((cluster.baseElevationM - cluster.avgWallHeightM).toFixed(3))
        const lowerCol = includeFoundation ? undefined : findAlignedLowerColumn(pt[0], pt[1], endColBottomY)
        createdNodes.push({
          id: colId,
          type: 'structural:column',
          name: `Girder End Support Post #${girderSeq}-${endTag} (${endColSizing.entry.designation})`,
          parentId: levelId,
          position: [
            Number(pt[0].toFixed(3)),
            endColBottomY,
            Number(pt[1].toFixed(3)),
          ],
          heightM: Number(Math.max(0.8, cluster.avgWallHeightM - girderDepthM).toFixed(3)),
          columnType: endColSizing.entry.columnType,
          designation: endColSizing.entry.designation,
          widthIn: endColSizing.entry.widthIn,
          depthIn: endColSizing.entry.depthIn,
          axialLoadLbs: endAxialLbs,
          transfersFromNodeId: attachedBayId,
          transfersToNodeId: includeFoundation ? `footing_${colId}` : lowerCol?.id,
          hasSquashBlocks: floorSystem === 'tji-ijoist',
          footingWidthIn: includeFoundation ? endColSizing.footingWidthIn : 0,
          footingDepthIn: includeFoundation ? endColSizing.footingDepthIn : 0,
          footingRebar: includeFoundation ? endColSizing.footingRebar : 'Transfers to lower story',
        })
        emitConnector({
          sku: endColSizing.recommendedCapSku,
          position: [pt[0], girderBottomY, pt[1]],
          attachedNodeIds: [colId, attachedBayId],
          name: `${endColSizing.recommendedCapSku} End-Post-to-Girder Cap`,
        })
        if (includeFoundation) {
          emitConnector({
            sku: endColSizing.recommendedBaseSku,
            position: [pt[0], cluster.baseElevationM - cluster.avgWallHeightM, pt[1]],
            attachedNodeIds: [colId],
            name: `${endColSizing.recommendedBaseSku} End-Post Standoff Base`,
          })
        }
      }
    }
  }

  // 6. Roof Structural Ridge Beam (if cathedral or pitch < 3:12, per connected cluster!) + Hurricane Ties & Gable Angles
  // Skip residential pitched ridge beams on commercial flat-deck roofs hosting a rooftop package unit (RTU) with 0 pitched roofs.
  if (includeRoof) {
    for (const cluster of footprintClusters) {
      const clusterHasCommercialRtu = levelCommercialRtus.some(
        (rtu) =>
          Array.isArray(rtu.position) &&
          rtu.position.length >= 3 &&
          rtu.position[0] >= cluster.minX - 0.5 &&
          rtu.position[0] <= cluster.maxX + 0.5 &&
          rtu.position[2] >= cluster.minZ - 0.5 &&
          rtu.position[2] <= cluster.maxZ + 0.5,
      )
      if (clusterHasCommercialRtu && roofs.length === 0) continue
      const cShortFt = Math.max(6, Math.min(cluster.widthM, cluster.depthM) * METERS_TO_FEET)
      const cLongFt = Math.max(6, Math.max(cluster.widthM, cluster.depthM) * METERS_TO_FEET)
      const cRoofSizing = sizeRoofSystem({
        buildingSpanFt: cShortFt,
        ridgeLengthFt: cLongFt,
        pitchRiseOver12: roofPitchRise,
        system: roofSystem,
        design,
      })
      if (!cRoofSizing.needsStructuralRidgeBeam || !cRoofSizing.recommendedRidgeBeam) continue
      const runsAlongX = cluster.maxX - cluster.minX >= cluster.maxZ - cluster.minZ
      const rStart: Vec2 = runsAlongX
        ? [cluster.minX, (cluster.minZ + cluster.maxZ) / 2]
        : [(cluster.minX + cluster.maxX) / 2, cluster.minZ]
      const rEnd: Vec2 = runsAlongX
        ? [cluster.maxX, (cluster.minZ + cluster.maxZ) / 2]
        : [(cluster.minX + cluster.maxX) / 2, cluster.maxZ]
      const ridgeLenFt = Math.hypot(rEnd[0] - rStart[0], rEnd[1] - rStart[1]) * METERS_TO_FEET
      const ridgeBays = Math.max(1, Math.ceil(ridgeLenFt / 20))
      const ridgeBaySpanFt = ridgeLenFt / ridgeBays
      const ridgeTribFt = Number((cShortFt / 2).toFixed(1))
      const slopeSec = Math.hypot(1, roofPitchRise / 12)
      const slopeDeadPsf = Number((design.roofDeadLoadPsf * slopeSec).toFixed(1))
      const rb = sizeBeamOrHeader({
        spanFt: ridgeBaySpanFt,
        tributaryWidthFt: ridgeTribFt,
        role: 'ridge-beam',
        preferredFamily: options.preferredBeamFamily ?? (ridgeBaySpanFt > 14 ? 'glulam' : 'lvl'),
        liveLoadPsf: design.roofLiveLoadPsf,
        snowLoadPsf: design.groundSnowPsf,
        deadLoadPsf: slopeDeadPsf,
        species: design.species,
      })

      const ridgeY = cluster.baseElevationM + cluster.avgWallHeightM + (cShortFt / 2) * (roofPitchRise / 12) * FEET_TO_METERS
      const ridgeDepthM = rb.entry.depthIn * INCHES_TO_METERS
      const ridgeBayIds: string[] = []

      for (let b = 0; b < ridgeBays; b++) {
        const t0 = b / ridgeBays
        const t1 = (b + 1) / ridgeBays
        const bStart: Vec2 = [
          Number((rStart[0] + (rEnd[0] - rStart[0]) * t0).toFixed(4)),
          Number((rStart[1] + (rEnd[1] - rStart[1]) * t0).toFixed(4)),
        ]
        const bEnd: Vec2 = [
          Number((rStart[0] + (rEnd[0] - rStart[0]) * t1).toFixed(4)),
          Number((rStart[1] + (rEnd[1] - rStart[1]) * t1).toFixed(4)),
        ]
        const ridgeId = nextId('strbm')
        ridgeBayIds.push(ridgeId)

        createdNodes.push({
          id: ridgeId,
          type: 'structural:beam',
          name:
            ridgeBays > 1
              ? `Structural Ridge Beam #${b + 1} (${rb.entry.designation})`
              : `Structural Ridge Beam (${rb.entry.designation})`,
          parentId: levelId,
          start: bStart,
          end: bEnd,
          elevationY: Number(ridgeY.toFixed(3)),
          role: 'ridge-beam',
          beamType: rb.entry.family,
          designation: rb.entry.designation,
          plyCount: rb.entry.plyCount,
          widthIn: rb.entry.widthIn,
          depthIn: rb.entry.depthIn,
          species: design.species,
          mountStyle: 'flush',
          tributaryWidthFt: ridgeTribFt,
          liveLoadPsf: design.roofLiveLoadPsf,
          deadLoadPsf: slopeDeadPsf,
          snowLoadPsf: design.groundSnowPsf,
          bearingLengthIn: Math.max(3.5, Math.ceil(rb.requiredBearingIn * 2) / 2),
          jackStudsEachEnd: rb.jackStudsEachEnd,
          endReactionLbs: rb.shearLbs,
        })
      }

      // Ridge-beam bearing posts at both gable ends + any intermediate bay splits (span > 20 ft)
      const postHeightM = Number(Math.max(0.8, ridgeY - cluster.baseElevationM - ridgeDepthM / 2).toFixed(3))
      for (let p = 0; p <= ridgeBays; p++) {
        const t = p / ridgeBays
        const pt: Vec2 = [
          Number((rStart[0] + (rEnd[0] - rStart[0]) * t).toFixed(4)),
          Number((rStart[1] + (rEnd[1] - rStart[1]) * t).toFixed(4)),
        ]
        const isInterior = p > 0 && p < ridgeBays
        const postAxialLbs = isInterior ? Math.round(rb.uniformLoadPlf * ridgeBaySpanFt) : rb.shearLbs
        const postSizing = sizeColumnAndFooting({
          axialLoadLbs: postAxialLbs,
          unbracedHeightFt: postHeightM * METERS_TO_FEET,
          preferredType: options.preferredColumnType,
          soilBearingPsf: design.soilBearingPsf,
          frostDepthIn: design.frostDepthIn,
        })
        const colId = nextId('strcol')
        const leftRidgeId = p > 0 ? ridgeBayIds[p - 1] : undefined
        const rightRidgeId = p < ridgeBays ? ridgeBayIds[p] : undefined
        const attachedRidgeIds = [leftRidgeId, rightRidgeId].filter((id): id is string => Boolean(id))
        const lowerCol = includeFoundation ? undefined : findAlignedLowerColumn(pt[0], pt[1], cluster.baseElevationM)

        createdNodes.push({
          id: colId,
          type: 'structural:column',
          name: `Ridge Beam Bearing Post #${p + 1} (${postSizing.entry.designation})`,
          parentId: levelId,
          position: [pt[0], cluster.baseElevationM, pt[1]],
          heightM: postHeightM,
          columnType: postSizing.entry.columnType,
          designation: postSizing.entry.designation,
          widthIn: postSizing.entry.widthIn,
          depthIn: postSizing.entry.depthIn,
          axialLoadLbs: postAxialLbs,
          transfersFromNodeId: attachedRidgeIds[0],
          transfersToNodeId: includeFoundation ? `footing_${colId}` : lowerCol?.id,
          hasSquashBlocks: floorSystem === 'tji-ijoist',
          footingWidthIn: includeFoundation ? postSizing.footingWidthIn : 0,
          footingDepthIn: includeFoundation ? postSizing.footingDepthIn : 0,
          footingRebar: includeFoundation ? postSizing.footingRebar : 'Transfers to lower story',
        })
        emitConnector({
          sku: postSizing.recommendedCapSku,
          position: [pt[0], cluster.baseElevationM + postHeightM, pt[1]],
          attachedNodeIds: [colId, ...attachedRidgeIds],
        })
        if (includeFoundation) {
          emitConnector({
            sku: postSizing.recommendedBaseSku,
            position: [pt[0], cluster.baseElevationM, pt[1]],
            attachedNodeIds: [colId],
          })
        }
      }
    }

    // Hurricane ties along both eave walls (per rafter/truss bearing)
    const tieSku = roofSizing.hurricaneTieSku
    const tieCount = Math.max(8, Math.ceil((longSpanFt * 12) / roofSizing.spacingIn) * 2)
    emitConnector({
      sku: tieSku,
      position: [(minX + maxX) / 2, levelBaseY + defaultWallHeightM, minZ],
      quantity: tieCount,
      attachedNodeIds: [assemblyId],
      name: `${tieSku} Hurricane Ties (x${tieCount} @ ${roofSizing.spacingIn}" OC both eaves)`,
    })

    // Framing angles / shear transfer clips (A35 + LTP4) at rim-to-plate & gable bracing
    const clipQty = Math.max(12, Math.ceil((footprintWidthFt + footprintDepthFt) / 2))
    emitConnector({
      sku: 'A35',
      position: [minX, levelBaseY + defaultWallHeightM, (minZ + maxZ) / 2],
      quantity: clipQty,
      attachedNodeIds: [assemblyId],
      name: `A35 Framing Angles (x${clipQty} gable & blocking shear transfer)`,
    })
    emitConnector({
      sku: 'LTP4',
      position: [maxX, levelBaseY, (minZ + maxZ) / 2],
      quantity: clipQty,
      attachedNodeIds: [assemblyId],
      name: `LTP4 Lateral Tie Plates (x${clipQty} rim-to-plate shear transfer)`,
    })
  }

  // 7. Lateral Bracing, High-Wind Uplift Straps & Seismic Hold-Downs / Plate Washers
  // Read wind/seismic thresholds directly from the single-source IRC declarative rule table
  const windSeismicRule = getIrcRuleById('irc-r802-11-wind-seismic-uplift')
  const highWind = !evaluatePlacementCandidate(
    [windSeismicRule],
    {
      kind: 'structural:assembly',
      pos: [minX, levelBaseY, minZ],
      designWindMph: design.windMph,
      hasStrap: false,
    },
    'placement',
  ).legal
  const highSeismic = isHighSeismicCategory(design.seismicCategory)
  const needsHeavyStrap = !evaluatePlacementCandidate(
    [windSeismicRule],
    {
      kind: 'structural:assembly',
      pos: [minX, levelBaseY, minZ],
      designWindMph: design.windMph,
      hasHeavyStrap: false,
    },
    'placement',
  ).legal

  if (highWind || design.storiesAbove >= 1) {
    const strapSku = needsHeavyStrap ? 'MSTC40' : 'MSTA36'
    const strapQty = Math.max(8, Math.ceil(((footprintWidthFt + footprintDepthFt) * 2) / 12))
    emitConnector({
      sku: strapSku,
      position: [minX, levelBaseY + defaultWallHeightM - 0.3, minZ],
      quantity: strapQty,
      attachedNodeIds: [assemblyId],
      name: `${strapSku} Continuous Uplift / Collector Straps (x${strapQty})`,
    })
  }

  for (const bwl of bwlReports) {
    const rawHdSku =
      bwl.requiredHoldDownSku ??
      (!bwl.passes ? (bwl.bracingMethod === 'CS-PF' ? 'STHD14' : 'HDU5-SDS2.5') : null)
    const requiredUpliftLbs =
      typeof bwl.overturningUpliftLbs === 'number' && bwl.overturningUpliftLbs > 0
        ? bwl.overturningUpliftLbs
        : rawHdSku
          ? (getConnectorBySku(rawHdSku)?.upliftLbs ?? 0)
          : 0
    // On upper wood stories (includeFoundation === false), substitute wood-to-wood HDU4/HDU5-SDS2.5 instead of concrete-embedded STHD14
    const hdSku =
      rawHdSku === 'STHD14' && !includeFoundation
        ? requiredUpliftLbs <= 4565
          ? 'HDU4-SDS2.5'
          : 'HDU5-SDS2.5'
        : rawHdSku
    const bwlWallSet = new Set(bwl.wallIds)
    const existingQualifyingQty = levelNodes
      .filter(
        (n) =>
          isHoldDownConnector(n) &&
          Array.isArray(n.attachedNodeIds) &&
          n.attachedNodeIds.some((id) => typeof id === 'string' && bwlWallSet.has(id)) &&
          resolveHoldDownUpliftLbs(n) >= requiredUpliftLbs,
      )
      .reduce((sum, n) => {
        const qty = typeof n.quantity === 'number' && Number.isFinite(n.quantity) && n.quantity > 0 ? n.quantity : 1
        return sum + qty
      }, 0)
    const alreadyHasHoldDown = existingQualifyingQty >= 2
    if (hdSku && !alreadyHasHoldDown) {
      const hdPos: Vec3 =
        bwl.axis === 'X' ? [minX + 0.15, levelBaseY, bwl.offsetM] : [bwl.offsetM, levelBaseY, minZ + 0.15]
      emitConnector({
        sku: hdSku,
        position: hdPos,
        quantity: 2,
        attachedNodeIds: [...bwl.wallIds, assemblyId],
        name: `${hdSku} ${bwl.bracingMethod} Hold-Downs (${bwl.id}, x2 ends)`,
      })
      if (includeFoundation) {
        emitConnector({
          sku: 'SSTB16',
          position: hdPos,
          quantity: 2,
          attachedNodeIds: [...bwl.wallIds, assemblyId],
          name: `SSTB16 Hold-Down Anchor Bolts (${bwl.id}, x2)`,
        })
      }
      if (!bwl.passes && bwl.bracingMethod === 'CS-PF') {
        emitConnector({
          sku: 'CS-PF',
          position: [hdPos[0], levelBaseY + Math.min(2.1, defaultWallHeightM - 0.3), hdPos[2]],
          quantity: 2,
          attachedNodeIds: [...bwl.wallIds, assemblyId],
          name: `CS-PF Portal Frame Straps (${bwl.id}, x2)`,
        })
      }
    }
  }

  const needsSillBolts = !evaluatePlacementCandidate(
    [windSeismicRule],
    {
      kind: 'structural:assembly',
      pos: [(minX + maxX) / 2, levelBaseY, minZ],
      seismicDesignCategory: design.seismicCategory,
      hasSillBolt: false,
    },
    'placement',
  ).legal
  if (includeFoundation && needsSillBolts) {
    const perimFt = totalPerimFt > 0 ? totalPerimFt : (footprintWidthFt + footprintDepthFt) * 2
    const boltSpacingFt = design.storiesAbove >= 2 || highSeismic ? 4 : 6
    const boltQty = Math.max(8, Math.ceil(perimFt / boltSpacingFt) + 4)
    emitConnector({
      sku: 'SSTB16',
      position: [(minX + maxX) / 2, levelBaseY + 0.04, minZ],
      quantity: boltQty,
      attachedNodeIds: [assemblyId],
      name: `SSTB16 Foundation Sill Anchor Bolts (x${boltQty} @ ${boltSpacingFt}' OC, IRC R403.1.6)`,
    })
    if (highSeismic) {
      emitConnector({
        sku: 'BP3x3',
        position: [(minX + maxX) / 2, levelBaseY + 0.04, minZ],
        quantity: boltQty,
        attachedNodeIds: [assemblyId],
        name: `BP3x3 Seismic Plate Washers (x${boltQty} @ ${boltSpacingFt}' OC, IRC R602.11.1)`,
      })
    }
  }

  // 8. Complete IRC R302.11 Fire Blocking & R302.12 Draftstopping
  if (includeFireblocking) {
    const firestops = deriveRequiredFirestops({
      nodes,
      levelId,
      floorSystem,
      hasAttic: includeRoof && roofSystem !== 'ridge-beam-cathedral',
    })
    for (const fs of firestops) {
      createdNodes.push({
        id: nextId('strfs'),
        type: 'structural:firestop',
        name: fs.label,
        parentId: levelId,
        start: fs.start,
        end: fs.end,
        elevationY: fs.elevationY,
        heightM: fs.heightM,
        thicknessM: fs.thicknessM,
        firestopKind: fs.firestopKind,
        material: fs.material,
        codeRef: fs.codeRef,
        hostWallId: fs.hostWallId,
        penetratingNodeId: fs.penetratingNodeId,
        compartmentAreaSqFt: fs.compartmentAreaSqFt,
      })
    }
  }

  return {
    createdNodes,
    summary: {
      assemblies: createdNodes.filter((n) => n.type === 'structural:assembly').length,
      beams: createdNodes.filter((n) => n.type === 'structural:beam').length,
      columns: createdNodes.filter((n) => n.type === 'structural:column').length,
      connectors: createdNodes.filter((n) => n.type === 'structural:connector').length,
      firestops: createdNodes.filter((n) => n.type === 'structural:firestop').length,
      floorSystemSummary: floorSizing.memberLabel,
      roofSystemSummary: roofSizing.memberLabel,
      wetWallUpgrades,
    },
  }
}
