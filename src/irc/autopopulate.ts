/**
 * Deterministic one-click IRC/AWC/NDS structural scene synthesizer (`autopopulateStructuralScene`).
 * Scans Pascal `level`, `wall`, `door`, `window`, `slab`, `roof`, `stair`, and `zone` nodes
 * (plus optional Plumbing/Electrical MEP runs for 2x6 wet-wall upgrades & R302.11(5) firestop collars)
 * and generates persisted, editable `structural:*` nodes.
 *
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import { deriveRequiredFirestops } from './fireblocking'
import { evaluateBracedWallLines } from './load-path'
import { extractWallOpenings } from './openings'
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
  getConnectorBySku,
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
  const includeRoof = options.includeRoof ?? true
  const includeFoundation = options.includeFoundation ?? true
  const includeFireblocking = options.includeFireblocking ?? true

  const levelNodes = Object.values(nodes).filter((n) => belongsToLevel(nodes, n, levelId))
  const walls = levelNodes.filter((n) => n.type === 'wall' && Array.isArray(n.start) && Array.isArray(n.end))
  const slabs = levelNodes.filter((n) => n.type === 'slab' && Array.isArray(n.polygon) && n.polygon.length >= 3)
  const roofs = levelNodes.filter((n) => n.type === 'roof' || n.type === 'roof-segment')
  const zones = levelNodes.filter((n) => n.type === 'zone' || n.type === 'room')
  const plumbingFixtures = levelNodes.filter((n) => n.type === 'plumbing:fixture')

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

  // Determine overall footprint bounds (from slabs or walls)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const s of slabs) {
    const b = polyBounds(s.polygon!)
    minX = Math.min(minX, b.minX)
    maxX = Math.max(maxX, b.maxX)
    minZ = Math.min(minZ, b.minZ)
    maxZ = Math.max(maxZ, b.maxZ)
  }
  if (!Number.isFinite(minX)) {
    for (const w of walls) {
      minX = Math.min(minX, w.start![0], w.end![0])
      maxX = Math.max(maxX, w.start![0], w.end![0])
      minZ = Math.min(minZ, w.start![1], w.end![1])
      maxZ = Math.max(maxZ, w.start![1], w.end![1])
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    maxX = 9.144
    minZ = 0
    maxZ = 7.315
  }
  const footprintWidthFt = Math.max(10, (maxX - minX) * METERS_TO_FEET)
  const footprintDepthFt = Math.max(10, (maxZ - minZ) * METERS_TO_FEET)
  const shortSpanFt = Math.min(footprintWidthFt, footprintDepthFt)
  const longSpanFt = Math.max(footprintWidthFt, footprintDepthFt)
  const defaultWallHeightM =
    walls.reduce((maxH, w) => Math.max(maxH, typeof w.height === 'number' ? w.height : 2.7432), 0) || 2.7432

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

    const isExterior =
      wall.frontSide === 'exterior' ||
      wall.backSide === 'exterior' ||
      Math.abs(midX - minX) < 0.3 ||
      Math.abs(midX - maxX) < 0.3 ||
      Math.abs(midZ - minZ) < 0.3 ||
      Math.abs(midZ - maxZ) < 0.3
    const isShear = shearWallIds.has(wall.id)
    const isWet = nearPlumbing || inWetZone
    const studSize: StudSize = options.studSize ?? (isExterior || isWet || thick >= 0.13 ? '2x6' : '2x4')
    if (isWet && thick < 0.13) wetWallUpgrades += 1

    wallOverrides[wall.id] = {
      construction: isShear ? 'shear-wall' : 'wood-framed',
      studSize,
      studSpacingIn,
      isLoadBearing: isExterior,
      isShearWall: isShear,
      isWetWall: isWet,
      sheathingEdgeNailIn: isShear ? (design.seismicCategory.startsWith('D') ? 3 : 4) : 6,
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
    const wallH = typeof hostWall.height === 'number' && hostWall.height > 1.2 ? hostWall.height : defaultWallHeightM
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
      const headerSizing = sizeBeamOrHeader({
        spanFt,
        tributaryWidthFt: effTribFt,
        role: 'header',
        preferredFamily: spanFt > 8 ? (options.preferredBeamFamily ?? 'lvl') : options.preferredBeamFamily,
        snowLoadPsf: design.groundSnowPsf,
        liveLoadPsf: effLivePsf,
        deadLoadPsf: design.roofDeadLoadPsf,
        species: design.species,
        storiesSupported: design.storiesAbove,
      })

      const halfRun = opWidthM / 2 + headerSizing.jackStudsEachEnd * 1.5 * INCHES_TO_METERS
      const startPt: Vec2 = [ws[0] + ux * Math.max(0, centerU - halfRun), ws[1] + uz * Math.max(0, centerU - halfRun)]
      const endPt: Vec2 = [ws[0] + ux * Math.min(lenM, centerU + halfRun), ws[1] + uz * Math.min(lenM, centerU + halfRun)]
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
        bearingLengthIn: headerSizing.requiredBearingIn,
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

  // 5. Floor Girders + Stacked Columns + Post Caps + Post Bases + Joist Hangers
  if (floorSizing.girderLinesNeeded > 0 && floorSizing.recommendedGirder) {
    const girderCheck = floorSizing.recommendedGirder
    const runsAlongX = maxX - minX >= maxZ - minZ
    for (let g = 1; g <= floorSizing.girderLinesNeeded; g++) {
      const frac = g / (floorSizing.girderLinesNeeded + 1)
      const gStart: Vec2 = runsAlongX
        ? [minX, minZ + (maxZ - minZ) * frac]
        : [minX + (maxX - minX) * frac, minZ]
      const gEnd: Vec2 = runsAlongX
        ? [maxX, minZ + (maxZ - minZ) * frac]
        : [minX + (maxX - minX) * frac, maxZ]
      const girderLenFt = Math.hypot(gEnd[0] - gStart[0], gEnd[1] - gStart[1]) * METERS_TO_FEET
      const girderId = nextId('strbm')
      const girderY = -((girderCheck.entry.depthIn * INCHES_TO_METERS) / 2)

      createdNodes.push({
        id: girderId,
        type: 'structural:beam',
        name: `Floor Girder #${g} (${girderCheck.entry.designation})`,
        parentId: levelId,
        start: gStart,
        end: gEnd,
        elevationY: Number(girderY.toFixed(3)),
        role: 'floor-girder',
        beamType: girderCheck.entry.family,
        designation: girderCheck.entry.designation,
        plyCount: girderCheck.entry.plyCount,
        widthIn: girderCheck.entry.widthIn,
        depthIn: girderCheck.entry.depthIn,
        species: design.species,
        mountStyle: 'flush',
        tributaryWidthFt: floorSizing.effectiveSpanFt,
        liveLoadPsf: design.floorLiveLoadPsf,
        deadLoadPsf: design.floorDeadLoadPsf,
        snowLoadPsf: 0,
        bearingLengthIn: girderCheck.requiredBearingIn,
        jackStudsEachEnd: girderCheck.jackStudsEachEnd,
        endReactionLbs: girderCheck.shearLbs,
      })

      // Batch joist hangers on both sides of the flush girder
      const joistsPerSide = Math.max(2, Math.floor((girderLenFt * 12) / floorSizing.spacingIn))
      emitConnector({
        sku: floorSizing.joistHangerSku,
        position: [(gStart[0] + gEnd[0]) / 2, girderY, (gStart[1] + gEnd[1]) / 2],
        quantity: joistsPerSide * 2,
        attachedNodeIds: [girderId, assemblyId],
        name: `${floorSizing.joistHangerSku} Joist Hangers (x${joistsPerSide * 2} along Girder #${g})`,
      })

      // Heavy beam hangers at girder pocket ends
      const beamHangerSku = selectBeamHangerSku(girderCheck.entry, girderCheck.shearLbs)
      emitConnector({
        sku: beamHangerSku,
        position: [gStart[0], girderY, gStart[1]],
        quantity: 2,
        attachedNodeIds: [girderId],
        name: `${beamHangerSku} Girder End Hangers (x2)`,
      })

      // Intermediate support columns + post caps + post bases + spread footings every <= 12 ft
      const postBays = Math.max(2, Math.ceil(girderLenFt / 12))
      const colHeightFt = defaultWallHeightM * METERS_TO_FEET
      const colAxialLbs = Math.round(girderCheck.uniformLoadPlf * (girderLenFt / postBays))
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
        createdNodes.push({
          id: colId,
          type: 'structural:column',
          name: `Girder Post #${p} (${colSizing.entry.designation})`,
          parentId: levelId,
          position: [Number(px.toFixed(3)), -defaultWallHeightM, Number(pz.toFixed(3))],
          heightM: Number(Math.max(0.8, defaultWallHeightM - girderCheck.entry.depthIn * INCHES_TO_METERS).toFixed(3)),
          columnType: colSizing.entry.columnType,
          designation: colSizing.entry.designation,
          widthIn: colSizing.entry.widthIn,
          depthIn: colSizing.entry.depthIn,
          axialLoadLbs: colAxialLbs,
          transfersFromNodeId: girderId,
          transfersToNodeId: includeFoundation ? `footing:${colId}` : undefined,
          hasSquashBlocks: floorSystem === 'tji-ijoist',
          footingWidthIn: includeFoundation ? colSizing.footingWidthIn : 0,
          footingDepthIn: includeFoundation ? colSizing.footingDepthIn : 0,
          footingRebar: includeFoundation ? colSizing.footingRebar : 'Transfers to lower story',
        })

        // Post Cap (top of column to girder)
        emitConnector({
          sku: colSizing.recommendedCapSku,
          position: [px, girderY - (girderCheck.entry.depthIn * INCHES_TO_METERS) / 2, pz],
          attachedNodeIds: [colId, girderId],
          name: `${colSizing.recommendedCapSku} Post-to-Girder Cap`,
        })
        // Standoff Post Base (only when resting on foundation footing)
        if (includeFoundation) {
          emitConnector({
            sku: colSizing.recommendedBaseSku,
            position: [px, -defaultWallHeightM, pz],
            attachedNodeIds: [colId],
            name: `${colSizing.recommendedBaseSku} Standoff Post Base`,
          })
        }
      }
    }
  }

  // 6. Roof Structural Ridge Beam (if cathedral or pitch < 3:12) + Hurricane Ties & Gable Angles
  if (includeRoof) {
    if (roofSizing.needsStructuralRidgeBeam && roofSizing.recommendedRidgeBeam) {
      const rb = roofSizing.recommendedRidgeBeam
      const runsAlongX = maxX - minX >= maxZ - minZ
      const rStart: Vec2 = runsAlongX ? [minX, (minZ + maxZ) / 2] : [(minX + maxX) / 2, minZ]
      const rEnd: Vec2 = runsAlongX ? [maxX, (minZ + maxZ) / 2] : [(minX + maxX) / 2, maxZ]
      const ridgeY = defaultWallHeightM + (shortSpanFt / 2) * (roofPitchRise / 12) * FEET_TO_METERS
      const ridgeId = nextId('strbm')

      createdNodes.push({
        id: ridgeId,
        type: 'structural:beam',
        name: `Structural Ridge Beam (${rb.entry.designation})`,
        parentId: levelId,
        start: rStart,
        end: rEnd,
        elevationY: Number(ridgeY.toFixed(3)),
        role: 'ridge-beam',
        beamType: rb.entry.family,
        designation: rb.entry.designation,
        plyCount: rb.entry.plyCount,
        widthIn: rb.entry.widthIn,
        depthIn: rb.entry.depthIn,
        species: design.species,
        mountStyle: 'flush',
        tributaryWidthFt: Number((shortSpanFt / 2).toFixed(1)),
        liveLoadPsf: design.roofLiveLoadPsf,
        deadLoadPsf: design.roofDeadLoadPsf,
        snowLoadPsf: design.groundSnowPsf,
        bearingLengthIn: rb.requiredBearingIn,
        jackStudsEachEnd: rb.jackStudsEachEnd,
        endReactionLbs: rb.shearLbs,
      })

      // Ridge-beam bearing posts at both gable ends
      const postSizing = sizeColumnAndFooting({
        axialLoadLbs: rb.shearLbs,
        unbracedHeightFt: ridgeY * METERS_TO_FEET,
        soilBearingPsf: design.soilBearingPsf,
        frostDepthIn: design.frostDepthIn,
      })
      for (const [idx, pt] of [rStart, rEnd].entries()) {
        const colId = nextId('strcol')
        createdNodes.push({
          id: colId,
          type: 'structural:column',
          name: `Ridge Beam Bearing Post #${idx + 1} (${postSizing.entry.designation})`,
          parentId: levelId,
          position: [pt[0], 0, pt[1]],
          heightM: Number(ridgeY.toFixed(3)),
          columnType: postSizing.entry.columnType,
          designation: postSizing.entry.designation,
          widthIn: postSizing.entry.widthIn,
          depthIn: postSizing.entry.depthIn,
          axialLoadLbs: rb.shearLbs,
          transfersFromNodeId: ridgeId,
          transfersToNodeId: `footing:${colId}`,
          hasSquashBlocks: floorSystem === 'tji-ijoist',
          footingWidthIn: postSizing.footingWidthIn,
          footingDepthIn: postSizing.footingDepthIn,
          footingRebar: postSizing.footingRebar,
        })
        emitConnector({
          sku: postSizing.recommendedCapSku,
          position: [pt[0], ridgeY - 0.15, pt[1]],
          attachedNodeIds: [colId, ridgeId],
        })
        emitConnector({
          sku: postSizing.recommendedBaseSku,
          position: [pt[0], 0, pt[1]],
          attachedNodeIds: [colId],
        })
      }
    }

    // Hurricane ties along both eave walls (per rafter/truss bearing)
    const tieSku = roofSizing.hurricaneTieSku
    const tieCount = Math.max(8, Math.ceil((longSpanFt * 12) / roofSizing.spacingIn) * 2)
    emitConnector({
      sku: tieSku,
      position: [(minX + maxX) / 2, defaultWallHeightM, minZ],
      quantity: tieCount,
      attachedNodeIds: [assemblyId],
      name: `${tieSku} Hurricane Ties (x${tieCount} @ ${roofSizing.spacingIn}" OC both eaves)`,
    })

    // Framing angles / shear transfer clips (A35 + LTP4) at rim-to-plate & gable bracing
    const clipQty = Math.max(12, Math.ceil((footprintWidthFt + footprintDepthFt) / 2))
    emitConnector({
      sku: 'A35',
      position: [minX, defaultWallHeightM, (minZ + maxZ) / 2],
      quantity: clipQty,
      attachedNodeIds: [assemblyId],
      name: `A35 Framing Angles (x${clipQty} gable & blocking shear transfer)`,
    })
    emitConnector({
      sku: 'LTP4',
      position: [maxX, 0, (minZ + maxZ) / 2],
      quantity: clipQty,
      attachedNodeIds: [assemblyId],
      name: `LTP4 Lateral Tie Plates (x${clipQty} rim-to-plate shear transfer)`,
    })
  }

  // 7. Lateral Bracing, High-Wind Uplift Straps & Seismic Hold-Downs / Plate Washers
  const highWind = design.windMph >= 130
  const highSeismic =
    design.seismicCategory === 'D0' ||
    design.seismicCategory === 'D1' ||
    design.seismicCategory === 'D2'

  if (highWind || design.storiesAbove >= 1) {
    const strapSku = design.windMph >= 140 ? 'MSTC40' : 'MSTA36'
    const strapQty = Math.max(8, Math.ceil(((footprintWidthFt + footprintDepthFt) * 2) / 12))
    emitConnector({
      sku: strapSku,
      position: [minX, defaultWallHeightM - 0.3, minZ],
      quantity: strapQty,
      attachedNodeIds: [assemblyId],
      name: `${strapSku} Continuous Uplift / Collector Straps (x${strapQty})`,
    })
  }

  for (const bwl of bwlReports) {
    if (bwl.requiredHoldDownSku) {
      const hdPos: Vec3 =
        bwl.axis === 'X' ? [minX + 0.15, 0, bwl.offsetM] : [bwl.offsetM, 0, minZ + 0.15]
      emitConnector({
        sku: bwl.requiredHoldDownSku,
        position: hdPos,
        quantity: 2,
        attachedNodeIds: bwl.wallIds,
        name: `${bwl.requiredHoldDownSku} Hold-Downs (${bwl.id}, x2 ends)`,
      })
      emitConnector({
        sku: 'SSTB16',
        position: hdPos,
        quantity: 2,
        attachedNodeIds: bwl.wallIds,
        name: `SSTB16 Hold-Down Anchor Bolts (${bwl.id}, x2)`,
      })
    }
  }

  if (includeFoundation && (highSeismic || design.seismicCategory === 'C')) {
    const perimFt = (footprintWidthFt + footprintDepthFt) * 2
    const boltSpacingFt = design.storiesAbove >= 2 || highSeismic ? 4 : 6
    const boltQty = Math.max(8, Math.ceil(perimFt / boltSpacingFt) + 4)
    emitConnector({
      sku: 'SSTB16',
      position: [(minX + maxX) / 2, 0.04, minZ],
      quantity: boltQty,
      attachedNodeIds: [assemblyId],
      name: `SSTB16 Foundation Sill Anchor Bolts (x${boltQty} @ ${boltSpacingFt}' OC, IRC R403.1.6)`,
    })
    if (highSeismic) {
      emitConnector({
        sku: 'BP3x3',
        position: [(minX + maxX) / 2, 0.04, minZ],
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
