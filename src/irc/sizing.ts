/**
 * Deterministic IRC 2021/2024, AWC NDS 2024, and AISC structural member sizing engine.
 * Framework-free: zero React, Three.js, or `@pascal-app/*` imports.
 */

import {
  BEAM_CATALOG,
  type BeamCatalogEntry,
  type BeamMaterialFamily,
  type BeamRole,
  CEILING_JOIST_SPANS_FT,
  COLUMN_CATALOG,
  type ColumnCatalogEntry,
  type ColumnType,
  CONNECTOR_CATALOG,
  type ConnectorCatalogEntry,
  DEFAULT_DESIGN_PARAMS,
  DRESSED_LUMBER_IN,
  FLOOR_JOIST_SPANS_FT,
  type FloorSystemKind,
  type LumberSpecies,
  type NominalLumberSize,
  RAFTER_SPANS_FT,
  type RoofSystemKind,
  SPECIES_PROPERTIES,
  type SeismicCategory,
  type StructuralDesignParams,
  type StudSpacingIn,
  TJI_IJOIST_CATALOG,
  type TjiIJoistEntry,
  getConnectorBySku,
  getDimensionalCf,
  getSypNo2FbPsi,
} from './tables'

export type BeamSizingInput = {
  spanFt: number
  tributaryWidthFt: number
  role: BeamRole
  preferredFamily?: BeamMaterialFamily
  maxDepthIn?: number
  liveLoadPsf?: number
  deadLoadPsf?: number
  snowLoadPsf?: number
  pointLoadLbs?: number
  species?: LumberSpecies
  bearingMaterial?: 'wood' | 'masonry'
  storiesSupported?: 0 | 1 | 2
}

export type BeamCheckResult = {
  entry: BeamCatalogEntry
  spanFt: number
  uniformLoadPlf: number
  liveLoadPlf: number
  momentFtLbs: number
  shearLbs: number
  bendingUtilization: number
  shearUtilization: number
  liveDeflectionIn: number
  liveDeflectionRatio: number
  totalDeflectionIn: number
  totalDeflectionRatio: number
  requiredBearingIn: number
  jackStudsEachEnd: 1 | 2 | 3 | 4
  recommendedHangerSku: string
  passes: boolean
  governingCheck: 'bending' | 'shear' | 'deflection-live' | 'deflection-total'
  warnings: string[]
}

/**
 * Evaluate a specific beam entry under uniform + mid-span point loads (ASD).
 */
export function checkBeamEntry(
  entry: BeamCatalogEntry,
  input: BeamSizingInput,
): BeamCheckResult {
  const spanFt = Math.max(1, input.spanFt)
  const spanIn = spanFt * 12
  const species = input.species ?? DEFAULT_DESIGN_PARAMS.species
  const sp = SPECIES_PROPERTIES[species]

  // Adjust dimensional built-up catalog values (baselined to DF-L #2 w/ NDS Table 4A Cf) for selected species.
  // Southern Yellow Pine #2 uses NDS Table 4B size-specific Fb values (no separate Cf multiplier).
  const isDim = entry.family === 'dimensional-built-up'
  const dfl = SPECIES_PROPERTIES['df-l-2']
  const dflRefFb = entry.id.startsWith('custom-')
    ? dfl.fbPsi
    : dfl.fbPsi * getDimensionalCf(entry.depthIn)
  const fbScale = isDim
    ? species === 'syp-2'
      ? getSypNo2FbPsi(entry.depthIn) / dflRefFb
      : sp.fbPsi / dfl.fbPsi
    : 1
  const fvScale = isDim ? sp.fvPsi / dfl.fvPsi : 1
  const eScale = isDim ? sp.ePsi / dfl.ePsi : 1

  const isRoof =
    input.role === 'ridge-beam' ||
    input.role === 'hip-beam' ||
    input.role === 'valley-beam' ||
    input.role === 'porch-beam'
  const isHeader = input.role === 'header'
  const snowPsf = Math.max(0, input.snowLoadPsf ?? (isRoof ? 30 : 0))
  const stories = input.storiesSupported ?? 0
  let livePsf: number
  if (isRoof) {
    livePsf = Math.max(input.liveLoadPsf ?? 20, snowPsf)
  } else if (isHeader) {
    // Exterior/bearing headers carry roof snow + any floor live loads above
    const baseRoofLive = Math.max(20, snowPsf)
    const floorLive = input.liveLoadPsf ?? 40
    livePsf = stories > 0 ? floorLive * stories * 0.85 + baseRoofLive : Math.max(input.liveLoadPsf ?? 20, snowPsf)
  } else {
    livePsf = (input.liveLoadPsf ?? 40) * (1 + stories * 0.85)
  }
  const deadPsf = isRoof
    ? (input.deadLoadPsf ?? 12)
    : (input.deadLoadPsf ?? 10) * (1 + stories * 0.85)
  const tribFt = Math.max(1, input.tributaryWidthFt)

  const liveLoadPlf = livePsf * tribFt
  const deadLoadPlf = deadPsf * tribFt + entry.weightPlf
  const uniformLoadPlf = liveLoadPlf + deadLoadPlf
  const pointLoadLbs = Math.max(0, input.pointLoadLbs ?? 0)

  // NDS 2.3.2 load duration factor: Cd = 1.15 when snow governs on wood roof/header (stories === 0)
  const snowGoverns = (isRoof || (isHeader && stories === 0)) && snowPsf >= 20 && snowPsf >= (input.liveLoadPsf ?? 0)
  const cdFactor = entry.family === 'steel-w' ? 1.0 : snowGoverns ? 1.15 : 1.0

  const momentFtLbs = (uniformLoadPlf * spanFt * spanFt) / 8 + (pointLoadLbs * spanFt) / 4
  const shearLbs = (uniformLoadPlf * spanFt) / 2 + pointLoadLbs / 2

  const allowMoment = entry.allowableMomentFtLbs * fbScale * cdFactor
  const allowShear = entry.allowableShearLbs * fvScale * cdFactor
  const ei = entry.eiLbIn2 * eScale

  const bendingUtilization = momentFtLbs / Math.max(1, allowMoment)
  const shearUtilization = shearLbs / Math.max(1, allowShear)

  // Deflection: 5wL^4 / (384EI) + PL^3 / (48EI)
  const wLiveLbIn = liveLoadPlf / 12
  const wTotalLbIn = uniformLoadPlf / 12
  const livePointLbs = pointLoadLbs * 0.7
  const liveDeflectionIn =
    (5 * wLiveLbIn * Math.pow(spanIn, 4)) / (384 * ei) +
    (livePointLbs * Math.pow(spanIn, 3)) / (48 * ei)
  const totalDeflectionIn =
    (5 * wTotalLbIn * Math.pow(spanIn, 4)) / (384 * ei) +
    (pointLoadLbs * Math.pow(spanIn, 3)) / (48 * ei)

  const liveLimitRatio = isRoof ? 240 : 360
  const totalLimitRatio = isRoof ? 180 : 240
  const liveDeflectionRatio = liveDeflectionIn > 1e-6 ? spanIn / liveDeflectionIn : 9999
  const totalDeflectionRatio = totalDeflectionIn > 1e-6 ? spanIn / totalDeflectionIn : 9999

  const liveDeflUtil = (spanIn / liveLimitRatio > 0) ? liveDeflectionIn / (spanIn / liveLimitRatio) : 0
  const totalDeflUtil = (spanIn / totalLimitRatio > 0) ? totalDeflectionIn / (spanIn / totalLimitRatio) : 0

  // Bearing length per IRC R502.6 (min 1.5" on wood, 3.0" on masonry/concrete)
  const bearingStressPsi = input.bearingMaterial === 'masonry' ? 500 : Math.min(sp.fcPerpPsi, entry.bearingPsi)
  const minCodeBearing = input.bearingMaterial === 'masonry' ? 3.0 : 1.5
  const calcBearingIn = shearLbs / Math.max(1, entry.widthIn * bearingStressPsi)
  const requiredBearingIn = Number(Math.max(minCodeBearing, calcBearingIn).toFixed(2))

  // Jack stud count per IRC Table R602.7(1)/(2)/(3) + wood bearing reaction check.
  // On masonry bearings (3.0" min per R502.6), do not force 2 wood jack studs from the masonry floor.
  const woodBearingForJacks = input.bearingMaterial === 'masonry' ? Math.max(1.5, calcBearingIn) : requiredBearingIn
  const rawJacks = Math.max(
    Math.ceil(woodBearingForJacks / 1.5),
    spanFt > 12 ? 3 : spanFt > 8 ? 2 : spanFt > 5.5 && (input.storiesSupported ?? 0) >= 1 ? 2 : 1,
  )
  const jackStudsEachEnd = Math.min(4, Math.max(1, rawJacks)) as 1 | 2 | 3 | 4

  const warnings: string[] = []
  if (bendingUtilization > 1.0) {
    warnings.push(`Bending overstressed (${Math.round(bendingUtilization * 100)}% of ASD Fb capacity)`)
  }
  if (shearUtilization > 1.0) {
    warnings.push(`Shear overstressed (${Math.round(shearUtilization * 100)}% of ASD Fv capacity)`)
  }
  if (liveDeflUtil > 1.0) {
    warnings.push(`Live-load deflection L/${Math.round(liveDeflectionRatio)} exceeds L/${liveLimitRatio} limit`)
  }
  if (totalDeflUtil > 1.0) {
    warnings.push(`Total-load deflection L/${Math.round(totalDeflectionRatio)} exceeds L/${totalLimitRatio} limit`)
  }
  if (entry.family === 'dimensional-built-up' && spanFt > 10) {
    warnings.push('Exceeds 10 ft prescriptive built-up header range; consider LVL, Glulam, or PSL')
  }

  const maxUtil = Math.max(bendingUtilization, shearUtilization, liveDeflUtil, totalDeflUtil)
  let governingCheck: BeamCheckResult['governingCheck'] = 'bending'
  if (maxUtil === shearUtilization) governingCheck = 'shear'
  else if (maxUtil === liveDeflUtil) governingCheck = 'deflection-live'
  else if (maxUtil === totalDeflUtil) governingCheck = 'deflection-total'

  const recommendedHangerSku = selectBeamHangerSku(entry, shearLbs)

  return {
    entry,
    spanFt,
    uniformLoadPlf: Math.round(uniformLoadPlf),
    liveLoadPlf: Math.round(liveLoadPlf),
    momentFtLbs: Math.round(momentFtLbs),
    shearLbs: Math.round(shearLbs),
    bendingUtilization: Number(bendingUtilization.toFixed(3)),
    shearUtilization: Number(shearUtilization.toFixed(3)),
    liveDeflectionIn: Number(liveDeflectionIn.toFixed(3)),
    liveDeflectionRatio: Math.round(liveDeflectionRatio),
    totalDeflectionIn: Number(totalDeflectionIn.toFixed(3)),
    totalDeflectionRatio: Math.round(totalDeflectionRatio),
    requiredBearingIn,
    jackStudsEachEnd,
    recommendedHangerSku,
    passes: bendingUtilization <= 1.0 && shearUtilization <= 1.0 && liveDeflUtil <= 1.0 && totalDeflUtil <= 1.0,
    governingCheck,
    warnings,
  }
}

/**
 * Resolve a beam node's catalog entry with exact designation precedence,
 * or synthesize exact section properties (S = bd^2/6, I = bd^3/12) when custom
 * dimensions were edited in the Parametric Inspector (never silently falling back to 2x8).
 */
export function resolveBeamCatalogEntry(params: {
  designation?: string
  family?: BeamMaterialFamily
  widthIn?: number
  depthIn?: number
  plyCount?: number
}): BeamCatalogEntry {
  const family = params.family ?? 'lvl'
  const w = typeof params.widthIn === 'number' && Number.isFinite(params.widthIn) && params.widthIn > 0 ? params.widthIn : undefined
  const d = typeof params.depthIn === 'number' && Number.isFinite(params.depthIn) && params.depthIn > 0 ? params.depthIn : undefined

  if (params.designation) {
    const exact = BEAM_CATALOG.find((c) => c.designation === params.designation)
    if (exact && (!w || Math.abs(exact.widthIn - w) < 0.35) && (!d || Math.abs(exact.depthIn - d) < 0.5)) {
      return exact
    }
  }
  if (w !== undefined && d !== undefined) {
    const close = BEAM_CATALOG.find(
      (c) => c.family === family && Math.abs(c.widthIn - w) < 0.35 && Math.abs(c.depthIn - d) < 0.5,
    )
    if (close) return close

    // Synthesize exact custom section properties matching the family's reference material
    const propsByFamily: Record<BeamMaterialFamily, { fb: number; fv: number; e: number; fcPerp: number; pcf: number; costScale: number }> = {
      'dimensional-built-up': { fb: 950, fv: 180, e: 1_600_000, fcPerp: 625, pcf: 35, costScale: 0.28 },
      lsl: { fb: 2325, fv: 310, e: 1_550_000, fcPerp: 900, pcf: 44, costScale: 0.45 },
      lvl: { fb: 2600, fv: 285, e: 2_000_000, fcPerp: 750, pcf: 42, costScale: 0.58 },
      psl: { fb: 2850, fv: 290, e: 2_000_000, fcPerp: 750, pcf: 45, costScale: 0.72 },
      glulam: { fb: 2350, fv: 265, e: 1_800_000, fcPerp: 650, pcf: 36, costScale: 0.64 },
      flitch: { fb: 3200, fv: 380, e: 3_400_000, fcPerp: 625, pcf: 65, costScale: 1.45 },
      'steel-w': { fb: 30_000, fv: 18_000, e: 29_000_000, fcPerp: 20_000, pcf: 140, costScale: 1.8 },
    }
    const p = propsByFamily[family]
    const effArea = family === 'steel-w' ? w * d * 0.16 : w * d
    const sIn3 = family === 'steel-w' ? (w * d * d) / 20 : (w * d * d) / 6
    const iIn4 = family === 'steel-w' ? (w * d * d * d) / 36 : (w * d * d * d) / 12
    return {
      id: `custom-${family}-${w}x${d}`,
      family,
      designation: params.designation ?? `Custom ${w}"x${d}" ${family.toUpperCase()}`,
      plyCount: params.plyCount ?? 1,
      widthIn: w,
      depthIn: d,
      allowableMomentFtLbs: Math.round((p.fb * sIn3) / 12),
      allowableShearLbs: Math.round((2 / 3) * p.fv * effArea),
      eiLbIn2: Math.round(p.e * iIn4),
      bearingPsi: p.fcPerp,
      weightPlf: Number(((effArea / 144) * p.pcf).toFixed(1)),
      costPerLfUsd: Number(Math.max(6, w * d * p.costScale).toFixed(2)),
    }
  }
  return BEAM_CATALOG.find((c) => c.family === family) ?? BEAM_CATALOG[0]!
}

export function selectBeamHangerSku(entry: BeamCatalogEntry, reactionLbs: number): string {
  if (entry.family === 'steel-w') {
    return entry.widthIn >= 5.5 ? 'CCQ66' : 'CCQ46'
  }
  if (entry.family === 'glulam' && entry.widthIn <= 3.75 && reactionLbs <= 5900) return 'HUCQ410-SDS'
  if (entry.widthIn >= 5.0) {
    return reactionLbs > 7500 || entry.depthIn >= 14 ? 'HGUS5.50/12' : 'HHUS5.50/10'
  }
  if (entry.widthIn >= 3.25) {
    return reactionLbs > 5400 || entry.depthIn >= 11.875 ? 'HHUS410' : 'HHUS210-2'
  }
  if (entry.depthIn <= 6.0) return 'LUS26'
  if (entry.depthIn <= 8.0) return 'LUS28'
  if (entry.depthIn >= 11.0 && reactionLbs <= 1965) return 'LUS212'
  return reactionLbs > 1800 ? 'HUS210' : 'LUS210'
}

/**
 * Automatically size the most economical passing beam/header/girder across dimensional,
 * LVL, LSL, PSL, Glulam, Flitch, and A992 Steel W-beam families.
 */
export function sizeBeamOrHeader(input: BeamSizingInput): BeamCheckResult {
  const depthFilter = (list: BeamCatalogEntry[]) => {
    if (input.maxDepthIn === undefined) return list
    const fit = list.filter((c) => c.depthIn <= input.maxDepthIn! + 0.05)
    return fit.length > 0 ? fit : list
  }

  let candidates = depthFilter([...BEAM_CATALOG])
  if (input.preferredFamily) {
    const filtered = candidates.filter((c) => c.family === input.preferredFamily)
    if (filtered.length > 0) candidates = filtered
  }

  candidates.sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)
  for (const cand of candidates) {
    const check = checkBeamEntry(cand, input)
    if (check.passes) return check
  }

  // If preferred family exhausted, escalate across full catalog while preserving maxDepthIn!
  if (input.preferredFamily) {
    const full = depthFilter([...BEAM_CATALOG]).sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)
    for (const cand of full) {
      const check = checkBeamEntry(cand, input)
      if (check.passes) return check
    }
  }

  // Return lowest-utilization candidate from the depth-compliant pool
  const pool = depthFilter([...BEAM_CATALOG])
  const checked = pool.map((c) => checkBeamEntry(c, input))
  checked.sort(
    (a, b) =>
      Math.max(a.bendingUtilization, a.shearUtilization) -
      Math.max(b.bendingUtilization, b.shearUtilization),
  )
  return checked[0]!
}

// ============================================================================
// FLOOR & ROOF FRAMING SIZING
// ============================================================================

export type FloorSystemSizingResult = {
  system: FloorSystemKind
  memberLabel: string
  depthIn: number
  spacingIn: StudSpacingIn
  maxAllowableSpanFt: number
  clearSpanFt: number
  girderLinesNeeded: number
  effectiveSpanFt: number
  joistHangerSku: string
  recommendedGirder?: BeamCheckResult
  tjiEntry?: TjiIJoistEntry
  codeRef: string
}

export function sizeFloorSystem(params: {
  clearSpanFt: number
  crossLengthFt: number
  system: FloorSystemKind
  species?: LumberSpecies
  spacingIn?: StudSpacingIn
  liveLoadPsf?: number
  deadLoadPsf?: number
}): FloorSystemSizingResult {
  const {
    clearSpanFt,
    crossLengthFt,
    system,
    species = 'df-l-2',
    spacingIn = 16,
    liveLoadPsf = 40,
    deadLoadPsf = 10,
  } = params

  if (system === 'open-web-truss') {
    const depthIn = clearSpanFt > 26 ? 24 : clearSpanFt > 20 ? 18 : clearSpanFt > 15 ? 14 : 12
    const maxSpan = depthIn === 24 ? 32 : depthIn === 18 ? 26 : depthIn === 14 ? 21 : 17
    const girderLinesNeeded = clearSpanFt > maxSpan ? Math.ceil(clearSpanFt / maxSpan) - 1 : 0
    const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
    const recommendedGirder =
      girderLinesNeeded > 0
        ? sizeBeamOrHeader({
            spanFt: Math.min(crossLengthFt, 16),
            tributaryWidthFt: effectiveSpanFt,
            role: 'floor-girder',
            preferredFamily: 'lvl',
            liveLoadPsf,
            deadLoadPsf,
            species,
          })
        : undefined
    return {
      system,
      memberLabel: `${depthIn}" Open-Web Floor Truss @ ${spacingIn}" OC`,
      depthIn,
      spacingIn,
      maxAllowableSpanFt: maxSpan,
      clearSpanFt,
      girderLinesNeeded,
      effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
      joistHangerSku: 'MIT411.88',
      recommendedGirder,
      codeRef: 'IRC R502.11 / TPI 1',
    }
  }

  if (system === 'tji-ijoist') {
    const pickTji = (span: number) =>
      TJI_IJOIST_CATALOG.find((t) => t.maxSpanFt[spacingIn] >= span)
    let girderLinesNeeded = 0
    let tji = pickTji(clearSpanFt)
    while (!tji && girderLinesNeeded < 3) {
      girderLinesNeeded += 1
      tji = pickTji(clearSpanFt / (girderLinesNeeded + 1))
    }
    const chosen = tji ?? TJI_IJOIST_CATALOG[TJI_IJOIST_CATALOG.length - 1]!
    const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
    const recommendedGirder =
      girderLinesNeeded > 0
        ? sizeBeamOrHeader({
            spanFt: Math.min(crossLengthFt, 16),
            tributaryWidthFt: effectiveSpanFt,
            role: 'floor-girder',
            preferredFamily: 'lvl',
            liveLoadPsf,
            deadLoadPsf,
            species,
          })
        : undefined
    return {
      system,
      memberLabel: `${chosen.series} ${chosen.depthIn}" I-Joist @ ${spacingIn}" OC`,
      depthIn: chosen.depthIn,
      spacingIn,
      maxAllowableSpanFt: chosen.maxSpanFt[spacingIn],
      clearSpanFt,
      girderLinesNeeded,
      effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
      joistHangerSku: chosen.depthIn >= 14 ? 'MIT411.88' : 'IUS2.56/11.88',
      recommendedGirder,
      tjiEntry: chosen,
      codeRef: 'IRC R502.1.2 / PRI-400',
    }
  }

  // Dimensional lumber multi-species lookup (IRC Table R502.3.1(2))
  const sizes: Array<'2x6' | '2x8' | '2x10' | '2x12'> = ['2x8', '2x10', '2x12']
  const table = FLOOR_JOIST_SPANS_FT[species]
  const pickDim = (span: number) => sizes.find((s) => table[s][spacingIn] >= span)

  let girderLinesNeeded = 0
  let chosenSize = pickDim(clearSpanFt)
  while (!chosenSize && girderLinesNeeded < 3) {
    girderLinesNeeded += 1
    chosenSize = pickDim(clearSpanFt / (girderLinesNeeded + 1))
  }
  const finalSize = chosenSize ?? '2x12'
  const effectiveSpanFt = clearSpanFt / (girderLinesNeeded + 1)
  const depthIn = DRESSED_LUMBER_IN[finalSize][1]
  const hangerSku =
    finalSize === '2x12' ? 'LUS212' : finalSize === '2x10' ? 'LUS210' : finalSize === '2x8' ? 'LUS28' : 'LUS26'

  const recommendedGirder =
    girderLinesNeeded > 0
      ? sizeBeamOrHeader({
          spanFt: Math.min(crossLengthFt, 14),
          tributaryWidthFt: effectiveSpanFt,
          role: 'floor-girder',
          liveLoadPsf,
          deadLoadPsf,
          species,
        })
      : undefined

  return {
    system: 'dimensional',
    memberLabel: `${finalSize} ${SPECIES_PROPERTIES[species].label} @ ${spacingIn}" OC`,
    depthIn,
    spacingIn,
    maxAllowableSpanFt: table[finalSize][spacingIn],
    clearSpanFt,
    girderLinesNeeded,
    effectiveSpanFt: Number(effectiveSpanFt.toFixed(2)),
    joistHangerSku: hangerSku,
    recommendedGirder,
    codeRef: 'IRC Table R502.3.1(2)',
  }
}

export type RoofSystemSizingResult = {
  system: RoofSystemKind
  memberLabel: string
  rafterOrChordSize: NominalLumberSize
  ceilingJoistSize: NominalLumberSize
  spacingIn: StudSpacingIn
  maxHorizontalRunFt: number
  actualHorizontalRunFt: number
  needsPurlinAndStruts: boolean
  needsStructuralRidgeBeam: boolean
  ridgeBaysNeeded?: number
  recommendedRidgeBeam?: BeamCheckResult
  hurricaneTieSku: string
  gableClipSku: string
  codeRef: string
}

export function sizeRoofSystem(params: {
  buildingSpanFt: number
  ridgeLengthFt: number
  pitchRiseOver12: number
  system: RoofSystemKind
  design?: Partial<StructuralDesignParams>
  spacingIn?: StudSpacingIn
}): RoofSystemSizingResult {
  const design = { ...DEFAULT_DESIGN_PARAMS, ...params.design }
  const spacingIn: StudSpacingIn = params.spacingIn ?? (params.system === 'stick-rafter' ? 16 : 24)
  const halfSpanFt = Math.max(2, params.buildingSpanFt / 2)
  const snowBand: 'snow20' | 'snow30' | 'snow50' | 'snow70' =
    design.groundSnowPsf >= 60
      ? 'snow70'
      : design.groundSnowPsf >= 45
        ? 'snow50'
        : design.groundSnowPsf >= 25
          ? 'snow30'
          : 'snow20'

  const hurricaneTieSku = selectHurricaneTieSku({
    windMph: design.windMph,
    exposure: design.exposure,
    seismicCategory: design.seismicCategory,
    isGirderTruss: false,
  })

  if (params.system === 'fink-truss' || params.system === 'scissor-truss' || params.system === 'attic-truss') {
    const labelMap: Record<'fink-truss' | 'scissor-truss' | 'attic-truss', string> = {
      'fink-truss': `Prefab Fink Roof Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC, 2x4/2x6 chords)`,
      'scissor-truss': `Prefab Scissor Vault Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC)`,
      'attic-truss': `Prefab Habitable Attic Truss (${params.buildingSpanFt.toFixed(0)}' span @ 24" OC, 2x10 bottom chord)`,
    }
    return {
      system: params.system,
      memberLabel: labelMap[params.system],
      rafterOrChordSize: params.system === 'attic-truss' ? '2x8' : '2x6',
      ceilingJoistSize: params.system === 'attic-truss' ? '2x10' : '2x4',
      spacingIn: 24,
      maxHorizontalRunFt: 48,
      actualHorizontalRunFt: halfSpanFt,
      needsPurlinAndStruts: false,
      needsStructuralRidgeBeam: false,
      hurricaneTieSku,
      gableClipSku: 'A35',
      codeRef: 'IRC R802.10 / TPI 1',
    }
  }

  const rafterTable = RAFTER_SPANS_FT[snowBand][design.species]
  const cjTable = CEILING_JOIST_SPANS_FT[design.species]
  const sizes: Array<'2x6' | '2x8' | '2x10' | '2x12'> = ['2x6', '2x8', '2x10', '2x12']
  const chosenRafter = sizes.find((s) => rafterTable[s][spacingIn] >= halfSpanFt) ?? '2x12'
  const maxRunFt = rafterTable[chosenRafter][spacingIn]
  const chosenCj = sizes.find((s) => cjTable[s][spacingIn] >= halfSpanFt) ?? '2x12'

  const needsStructuralRidgeBeam =
    params.system === 'ridge-beam-cathedral' || params.pitchRiseOver12 < 3
  const needsPurlinAndStruts = !needsStructuralRidgeBeam && halfSpanFt > maxRunFt

  // Slope dead-load magnification sec(theta) = sqrt(1 + (pitch/12)^2) for sloped roofs.
  // Split ridge spans > 20 ft into equal clear-span bays supported by intermediate ridge posts.
  const slopeSec = Math.hypot(1, params.pitchRiseOver12 / 12)
  const ridgeBaysNeeded = needsStructuralRidgeBeam ? Math.max(1, Math.ceil(params.ridgeLengthFt / 20)) : 0
  const ridgeBaySpanFt = ridgeBaysNeeded > 0 ? params.ridgeLengthFt / ridgeBaysNeeded : params.ridgeLengthFt
  const recommendedRidgeBeam = needsStructuralRidgeBeam
    ? sizeBeamOrHeader({
        spanFt: ridgeBaySpanFt,
        tributaryWidthFt: halfSpanFt,
        role: 'ridge-beam',
        preferredFamily: ridgeBaySpanFt > 14 ? 'glulam' : 'lvl',
        liveLoadPsf: design.roofLiveLoadPsf,
        snowLoadPsf: design.groundSnowPsf,
        deadLoadPsf: Number((design.roofDeadLoadPsf * slopeSec).toFixed(1)),
        species: design.species,
      })
    : undefined

  return {
    system: params.system,
    memberLabel: `${chosenRafter} ${SPECIES_PROPERTIES[design.species].label} Rafters @ ${spacingIn}" OC`,
    rafterOrChordSize: chosenRafter,
    ceilingJoistSize: chosenCj,
    spacingIn,
    maxHorizontalRunFt: maxRunFt,
    actualHorizontalRunFt: Number(halfSpanFt.toFixed(2)),
    needsPurlinAndStruts,
    needsStructuralRidgeBeam,
    ridgeBaysNeeded,
    recommendedRidgeBeam,
    hurricaneTieSku,
    gableClipSku: design.windMph >= 130 ? 'HGA10' : 'A35',
    codeRef: needsStructuralRidgeBeam ? 'IRC R802.4.3 / R802.4.1' : 'IRC Table R802.4.1(1)/(5)',
  }
}

// ============================================================================
// COLUMN & FOOTING SIZING (NDS Cp BUCKLING + IRC R403.1 SPREAD FOOTINGS)
// ============================================================================

export type ColumnSizingResult = {
  entry: ColumnCatalogEntry
  unbracedHeightFt: number
  axialLoadLbs: number
  allowableAxialLbs: number
  utilization: number
  passes: boolean
  footingWidthIn: number
  footingDepthIn: number
  footingRebar: string
  recommendedBaseSku: string
  recommendedCapSku: string
  codeRef: string
}

/**
 * Compute ASD axial compression capacity (lbs) for a column at unbracedHeightFt:
 * - Steel HSS / Lally: AISC 360 Chapter E (E3 flexural buckling with KL/r <= 200, Omega_c = 1.67)
 * - Wood / PSL / Glulam: AWC NDS 3.7 Cp Euler buckling formula (Le/d <= 50)
 */
export function calcColumnCapacityLbs(col: ColumnCatalogEntry, unbracedHeightFt: number): number {
  const hFt = Math.max(1, unbracedHeightFt)
  if (col.columnType === 'steel-hss' || col.columnType === 'steel-lally') {
    const dMin = Math.min(col.widthIn, col.depthIn)
    // Radius of gyration approximation: hollow square HSS r ≈ 0.39*d, round pipe r ≈ 0.33*d
    const rIn = col.columnType === 'steel-lally' ? 0.33 * dMin : 0.39 * dMin
    const klOverR = (hFt * 12) / Math.max(0.5, rIn)
    if (klOverR > 200) return 0
    const fy = col.columnType === 'steel-lally' ? 35_000 : 46_000
    const fe = (Math.PI * Math.PI * 29_000_000) / (klOverR * klOverR)
    const fcr = fy / fe <= 2.25 ? Math.pow(0.658, fy / fe) * fy : 0.877 * fe
    const pAllow = (fcr * col.areaIn2) / 1.67
    return Math.round(pAllow)
  }
  // NDS 3.7 Cp Euler buckling formula
  const dMin = Math.min(col.widthIn, col.depthIn)
  const leOverD = (hFt * 12) / dMin
  if (leOverD > 50) return 0
  const fcStar = col.fcPsi
  const fcE = (0.822 * col.eMinPsi) / (leOverD * leOverD)
  const ratio = fcE / fcStar
  const c = col.columnType === 'psl' || col.columnType === 'glulam' ? 0.9 : 0.8
  const term = (1 + ratio) / (2 * c)
  const cp = term - Math.sqrt(Math.max(0, term * term - ratio / c))
  return Math.round(fcStar * cp * col.areaIn2)
}

/**
 * Resolve an existing placed column's catalog entry or synthesize section properties
 * for auditing its actual structural buckling capacity.
 */
export function resolveColumnCatalogEntry(params: {
  designation?: string
  columnType?: ColumnType
  widthIn?: number
  depthIn?: number
}): ColumnCatalogEntry {
  if (params.designation) {
    const exact = COLUMN_CATALOG.find((c) => c.designation === params.designation)
    if (exact) return exact
  }
  const type = params.columnType ?? 'wood-solid'
  const w = typeof params.widthIn === 'number' && params.widthIn > 0 ? params.widthIn : undefined
  const d = typeof params.depthIn === 'number' && params.depthIn > 0 ? params.depthIn : undefined
  if (w !== undefined && d !== undefined) {
    const close = COLUMN_CATALOG.find(
      (c) => c.columnType === type && Math.abs(c.widthIn - w) < 0.35 && Math.abs(c.depthIn - d) < 0.35,
    )
    if (close) return close
    const areaIn2 = type === 'steel-hss' ? Math.max(2, (w + d) * 0.45) : type === 'steel-lally' ? Math.max(1.8, w * 0.65) : w * d
    const fcPsi = type === 'psl' ? 2500 : type === 'glulam' ? 1900 : type.startsWith('steel') ? 30_000 : 1350
    const eMinPsi = type === 'psl' ? 910_000 : type === 'glulam' ? 850_000 : type.startsWith('steel') ? 29_000_000 : 580_000
    return {
      id: `custom-${type}-${w}x${d}`,
      columnType: type,
      designation: params.designation ?? `Custom ${w}"x${d}" ${type}`,
      widthIn: w,
      depthIn: d,
      areaIn2,
      fcPsi,
      eMinPsi,
      allowableAxial9FtLbs: 0,
      recommendedBaseSku: w >= 5 ? 'ABU66Z' : 'ABU44Z',
      recommendedCapSku: w >= 5 ? 'CCQ66' : 'BC4',
      costPerLfUsd: 12,
    }
  }
  return COLUMN_CATALOG.find((c) => c.columnType === type) ?? COLUMN_CATALOG[0]!
}

/**
 * Audit a specific placed column's actual buckling capacity + required spread pad footing.
 */
export function checkColumnEntry(params: {
  designation?: string
  columnType?: ColumnType
  widthIn?: number
  depthIn?: number
  axialLoadLbs: number
  unbracedHeightFt: number
  soilBearingPsf?: number
  frostDepthIn?: number
}): ColumnSizingResult {
  const entry = resolveColumnCatalogEntry(params)
  const allowableAxialLbs = Math.max(1, calcColumnCapacityLbs(entry, params.unbracedHeightFt))
  const utilization = Number((params.axialLoadLbs / allowableAxialLbs).toFixed(3))
  const soil = Math.max(500, params.soilBearingPsf ?? 1500)
  // Include ~8% footing & column self-weight allowance in spread footing area
  const reqAreaSqFt = Math.max(4, (params.axialLoadLbs * 1.08) / soil)
  const sideIn = Math.max(24, Math.ceil((Math.sqrt(reqAreaSqFt) * 12) / 6) * 6)
  const footingDepthIn = Math.max(10, Math.ceil(sideIn / 3), (params.frostDepthIn ?? 36) > 0 ? 12 : 10)
  const barCount = Math.max(3, Math.ceil(sideIn / 8))
  const footingRebar = `(${barCount}) #4 EW @ bottom (3" clear cover)`

  return {
    entry,
    unbracedHeightFt: params.unbracedHeightFt,
    axialLoadLbs: Math.round(params.axialLoadLbs),
    allowableAxialLbs,
    utilization,
    passes: utilization <= 1.0,
    footingWidthIn: sideIn,
    footingDepthIn,
    footingRebar,
    recommendedBaseSku: entry.recommendedBaseSku,
    recommendedCapSku: entry.recommendedCapSku,
    codeRef: 'AWC NDS 3.7 / AISC E3 / IRC R403.1',
  }
}

export function sizeColumnAndFooting(params: {
  axialLoadLbs: number
  unbracedHeightFt: number
  preferredType?: ColumnType
  soilBearingPsf?: number
  frostDepthIn?: number
}): ColumnSizingResult {
  const {
    axialLoadLbs,
    unbracedHeightFt,
    preferredType,
    soilBearingPsf = 1500,
    frostDepthIn = 36,
  } = params

  let pool = [...COLUMN_CATALOG]
  if (preferredType) {
    const f = pool.filter((c) => c.columnType === preferredType)
    if (f.length > 0) pool = f
  }
  pool.sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)

  let chosen = pool.find((c) => calcColumnCapacityLbs(c, unbracedHeightFt) >= axialLoadLbs)
  if (!chosen && preferredType) {
    chosen = [...COLUMN_CATALOG]
      .sort((a, b) => a.costPerLfUsd - b.costPerLfUsd)
      .find((c) => calcColumnCapacityLbs(c, unbracedHeightFt) >= axialLoadLbs)
  }
  const entry = chosen ?? COLUMN_CATALOG[COLUMN_CATALOG.length - 1]!
  return checkColumnEntry({
    designation: entry.designation,
    columnType: entry.columnType,
    widthIn: entry.widthIn,
    depthIn: entry.depthIn,
    axialLoadLbs,
    unbracedHeightFt,
    soilBearingPsf,
    frostDepthIn,
  })
}

// ============================================================================
// CONNECTOR & HARDWARE SELECTION (SIMPSON-CLASS SKUs)
// ============================================================================

export function selectHurricaneTieSku(params: {
  windMph: number
  exposure: 'B' | 'C' | 'D'
  seismicCategory: SeismicCategory
  isGirderTruss?: boolean
  upliftDemandLbs?: number
}): string {
  const { windMph, exposure, isGirderTruss = false, upliftDemandLbs = 0 } = params
  if (isGirderTruss || upliftDemandLbs > 1600) return 'HGA10'
  if (windMph >= 150 || (windMph >= 140 && exposure === 'D') || upliftDemandLbs > 1300) return 'HTS20'
  if (windMph >= 130 || (windMph >= 120 && exposure !== 'B') || upliftDemandLbs > 600) return 'H10A'
  if (windMph >= 115) return 'H2.5A'
  return 'H1'
}

export function selectHoldDownSku(upliftDemandLbs: number): ConnectorCatalogEntry {
  const holdDowns = CONNECTOR_CATALOG.filter((c) => c.category === 'hold-down').sort(
    (a, b) => a.upliftLbs - b.upliftLbs,
  )
  return (
    holdDowns.find((h) => h.upliftLbs >= upliftDemandLbs) ??
    getConnectorBySku('HDU11-SDS2.5') ??
    holdDowns[holdDowns.length - 1]!
  )
}
